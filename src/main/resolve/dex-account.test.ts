import { mkdtemp, readFile, writeFile, rm, access } from 'fs/promises'
import { basename, dirname, join, resolve } from 'path'
import { tmpdir } from 'os'
import { createHash } from 'crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  directory: '',
  encryptionAvailable: vi.fn(),
  encrypt: vi.fn(),
  decrypt: vi.fn(),
  openExternal: vi.fn(),
  fetch: vi.fn()
}))
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: mocks.encryptionAvailable,
    encryptString: mocks.encrypt,
    decryptString: mocks.decrypt
  },
  shell: { openExternal: mocks.openExternal }
}))
vi.mock('../utils/dirs', () => ({
  dataDir: () => mocks.directory,
  dexSharedAccountDir: () => join(mocks.directory, 'shared')
}))

const origin = 'https://navio.mydex.top'
const user = { id: 'account-test-user', username: 'navio_test', displayName: '账号测试' }
const accessToken = 'opaque-token-only-for-isolated-unit-tests'
const device = {
  deviceCode: 'isolated-device-request',
  userCode: 'ABCD1234',
  verificationUri: `${origin}/account/?user_code=ABCD1234`,
  expiresIn: 600,
  interval: 5
}
const encrypted = (value: string): Buffer =>
  Buffer.from('TEST-ENCRYPTED:' + Buffer.from(value).toString('base64'))
const response = (data: unknown, status = 200): Response =>
  new Response(status === 204 ? null : JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
let account: typeof import('./dex-account')
const vaultFile = (): string => join(mocks.directory, 'dex-account.vault')
const sharedFile = (): string =>
  join(mocks.directory, 'shared', createHash('sha256').update(origin).digest('hex') + '.vault')

async function login(): Promise<void> {
  mocks.fetch.mockResolvedValueOnce(response(device))
  await account.startDexLogin()
  mocks.fetch.mockResolvedValueOnce(response({ status: 'approved', accessToken, user }))
  expect(await account.pollDexLogin(device.deviceCode)).toEqual({
    status: 'complete',
    account: { status: 'online', serverUrl: origin, user }
  })
}
async function assertNoVault(): Promise<void> {
  await expect(access(vaultFile())).rejects.toMatchObject({ code: 'ENOENT' })
}

describe('D.E.X explicit same-user SSO and account recovery', () => {
  const ssoToken = 'A'.repeat(43)
  const ssoExpiresAt = '2099-01-01T00:00:00.000Z'
  const signInWithShared = async (): Promise<unknown> => {
    mocks.fetch.mockResolvedValueOnce(response({ accessToken, user, ssoToken, ssoExpiresAt }))
    return account.dexAccountAction('login', {
      identifier: user.username,
      password: 'test-password'
    })
  }
  it('encrypts shared credentials without returning them to the renderer or auto-signing-in', async () => {
    const result = await signInWithShared()
    expect(result).toEqual({ status: 'online', serverUrl: origin, user })
    const raw = await readFile(sharedFile(), 'utf8')
    expect(raw).not.toContain(ssoToken)
    expect(raw).not.toContain(accessToken)
    const saved = JSON.parse(mocks.decrypt(Buffer.from(raw)))
    expect(saved).toMatchObject({ serverUrl: origin, ssoToken, sourceAppId: 'navio', user })
    expect(saved.accessToken).toBeUndefined()
    await rm(vaultFile())
    mocks.fetch.mockClear()
    expect(await account.getDexAccount()).toEqual({ status: 'signed-out', serverUrl: origin })
    expect(mocks.fetch).not.toHaveBeenCalled()
    mocks.fetch.mockResolvedValueOnce(response({ user, sourceAppId: 'mystery' }))
    expect(await account.dexAccountAction('sso-info')).toEqual({ user, sourceAppId: 'mystery' })
    await assertNoVault()
  })
  it('requires confirmed identity before exchanging an internal SSO token for Navio', async () => {
    await signInWithShared()
    await rm(vaultFile())
    mocks.fetch.mockClear()
    await expect(
      account.dexAccountAction('sso-continue', { expectedUserId: user.id })
    ).rejects.toThrow('核对')
    await expect(
      account.dexAccountAction('sso-continue', { confirmed: true, expectedUserId: 'other' })
    ).rejects.toThrow('核对')
    expect(mocks.fetch).not.toHaveBeenCalled()
    mocks.fetch.mockResolvedValueOnce(response({ accessToken: 'new-navio-session', user }))
    expect(
      await account.dexAccountAction('sso-continue', {
        confirmed: true,
        expectedUserId: user.id,
        ssoToken: 'renderer-injected',
        appId: 'mystery'
      })
    ).toEqual({ status: 'online', serverUrl: origin, user })
    const [url, options] = mocks.fetch.mock.calls[0]
    expect(url).toBe(origin + '/api/v1/desktop/sso/continue')
    expect(JSON.parse(options.body)).toMatchObject({ ssoToken, appId: 'navio', confirmed: true })
    expect(options.headers.get('Authorization')).toBeNull()
  })
  it('partitions shared credentials by service and does not erase a newer other-product login', async () => {
    await signInWithShared()
    const saved = JSON.parse(mocks.decrypt(await readFile(sharedFile())))
    await writeFile(
      sharedFile(),
      encrypted(JSON.stringify({ ...saved, ssoToken: 'B'.repeat(43), sourceAppId: 'mystery' }))
    )
    mocks.fetch.mockResolvedValueOnce(response({ ok: true }))
    await account.logoutDexAccount()
    expect(JSON.parse(mocks.decrypt(await readFile(sharedFile()))).sourceAppId).toBe('mystery')
    await account.setDexServerUrl('http://localhost:3210')
    mocks.fetch.mockClear()
    expect(await account.dexAccountAction('sso-info')).toBeNull()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('clears its own shared credential on logout and supports local-only forgetting', async () => {
    await signInWithShared()
    mocks.fetch.mockResolvedValueOnce(response({ ok: true }))
    await account.logoutDexAccount()
    await expect(access(sharedFile())).rejects.toMatchObject({ code: 'ENOENT' })
    await signInWithShared()
    mocks.fetch.mockClear()
    expect(await account.dexAccountAction('sso-forget')).toEqual({ ok: true })
    expect(mocks.fetch).not.toHaveBeenCalled()
    await expect(access(sharedFile())).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(vaultFile())).resolves.toBeUndefined()
  })
  it('uses unauthenticated desktop recovery routes and never creates a session on completion', async () => {
    for (const action of ['recovery-info', 'recovery-request', 'recovery-complete'] as const) {
      mocks.fetch.mockResolvedValueOnce(response({ ok: true }))
      await account.dexAccountAction(action, {
        recoveryToken: 'R'.repeat(43),
        contact: 'new@example.com',
        code: '123456',
        newPassword: 'new-password'
      })
      const [url, options] = mocks.fetch.mock.calls[mocks.fetch.mock.calls.length - 1]
      expect(url).toBe(`${origin}/api/v1/desktop/recovery/${action.slice('recovery-'.length)}`)
      expect(options.headers.get('Authorization')).toBeNull()
      expect(options.headers.get('x-dex-client')).toBe('desktop')
    }
    await assertNoVault()
  })
  it('sends account proof when explicitly unlinking an old product account', async () => {
    await login()
    mocks.fetch.mockClear()
    mocks.fetch.mockResolvedValueOnce(response({ ok: true }))
    await account.dexAccountAction('mystery-unlink', { currentPassword: 'local-proof' })
    const [url, options] = mocks.fetch.mock.calls[0]
    expect(url).toBe(origin + '/api/v1/account/mystery')
    expect(options.method).toBe('DELETE')
    expect(JSON.parse(options.body)).toMatchObject({ currentPassword: 'local-proof' })
  })
})

beforeEach(async () => {
  vi.resetModules()
  vi.resetAllMocks()
  vi.stubEnv('DEX_ACCOUNT_URL', '')
  vi.stubGlobal('fetch', mocks.fetch)
  mocks.directory = await mkdtemp(join(tmpdir(), 'navio-account-unit-'))
  mocks.encryptionAvailable.mockReturnValue(true)
  mocks.encrypt.mockImplementation(encrypted)
  mocks.decrypt.mockImplementation((value: Buffer) => {
    const text = value.toString()
    if (!text.startsWith('TEST-ENCRYPTED:')) throw new Error('Bad encrypted fixture')
    return Buffer.from(text.slice('TEST-ENCRYPTED:'.length), 'base64').toString()
  })
  mocks.openExternal.mockResolvedValue(undefined)
  mocks.fetch.mockRejectedValue(new Error('Unexpected network request'))
  account = await import('./dex-account')
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  // Only remove the explicitly created temporary fixture, never an inferred project path.
  const directory = resolve(mocks.directory)
  if (
    dirname(directory) !== resolve(tmpdir()) ||
    !basename(directory).startsWith('navio-account-unit-')
  ) {
    throw new Error('Refusing to clean a path outside this test fixture')
  }
  await rm(directory, { recursive: true, force: true })
})

describe('Navio account origin boundary', () => {
  it.each([
    ['https://navio.mydex.top/', origin],
    ['https://NAVIO.MYDEX.TOP:443', origin],
    ['http://localhost:3210', 'http://localhost:3210'],
    ['http://127.0.0.1:3210/', 'http://127.0.0.1:3210'],
    ['http://[::1]:3210', 'http://[::1]:3210']
  ])('accepts complete trusted-format origins: %s', (input, expected) => {
    expect(account.validateDexServer(input)).toBe(expected)
  })

  it.each([
    'http://navio.mydex.top',
    'https://user:password@navio.mydex.top',
    'https://navio.mydex.top/account/',
    'https://navio.mydex.top?token=abc',
    'https://navio.mydex.top/#section',
    'file:///C:/account',
    'javascript:alert(1)',
    'not-a-domain',
    'http://localhost.evil.example'
  ])('rejects ambiguous, insecure or credential-bearing server URLs: %s', (input) => {
    expect(() => account.validateDexServer(input)).toThrow()
  })

  it('keeps a valid environment override explicit and does not pretend an ignored change succeeded', async () => {
    vi.stubEnv('DEX_ACCOUNT_URL', 'http://localhost:3210')
    expect(await account.dexServerUrl()).toBe('http://localhost:3210')
    await expect(account.setDexServerUrl('https://another.example')).rejects.toThrow('启动环境')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it.each([
    '@outside.example/api/v1/me',
    '//outside.example/api/v1/me',
    'https://outside.example/api/v1/me',
    '/api/v1/../../outside',
    '/api/v1/me#secret'
  ])('never sends an account request outside the API boundary: %s', async (endpoint) => {
    await expect(account.dexAccountRequest(endpoint, {}, false)).rejects.toThrow('API 路径')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})

describe('first use and durable device login', () => {
  it('starts signed out and never turns an unregistered offline device into a logged-in one', async () => {
    expect(await account.getDexAccount()).toEqual({ status: 'signed-out', serverUrl: origin })
    expect(mocks.fetch).not.toHaveBeenCalled()
    await assertNoVault()
  })

  it('requests Navio device authorization and opens only the returned same-origin portal', async () => {
    mocks.fetch.mockResolvedValueOnce(response(device))
    expect(await account.startDexLogin()).toEqual(device)
    expect(mocks.openExternal).toHaveBeenCalledWith(device.verificationUri)
    const [url, options] = mocks.fetch.mock.calls[0]
    expect(url).toBe(`${origin}/api/v1/device/start`)
    expect(JSON.parse(options.body)).toMatchObject({ appId: 'navio' })
    expect(options.redirect).toBe('error')
    expect(new Headers(options.headers).has('Authorization')).toBe(false)
    await assertNoVault()
  })

  it('writes the approved session through safeStorage and recovers it after module restart', async () => {
    await login()
    const bytes = await readFile(vaultFile())
    expect(bytes.toString()).not.toContain(accessToken)
    expect(mocks.encrypt).toHaveBeenCalledWith(expect.stringContaining(accessToken))
    expect(JSON.parse(mocks.decrypt(bytes))).toEqual({ serverUrl: origin, accessToken, user })
    vi.resetModules()
    account = await import('./dex-account')
    mocks.fetch.mockRejectedValueOnce(new TypeError('Network unavailable'))
    expect(await account.getDexAccount()).toEqual({ status: 'offline', serverUrl: origin, user })
  })

  it('keeps a pending request unauthenticated and does not write a vault', async () => {
    mocks.fetch.mockResolvedValueOnce(response(device))
    await account.startDexLogin()
    mocks.fetch.mockResolvedValueOnce(response({ status: 'pending' }))
    expect(await account.pollDexLogin(device.deviceCode)).toEqual({ status: 'pending' })
    expect(await account.getDexAccount()).toEqual({ status: 'signed-out', serverUrl: origin })
    await assertNoVault()
  })

  it('expires unknown and elapsed device requests without sending their codes to the network', async () => {
    expect(await account.pollDexLogin('unknown')).toEqual({ status: 'expired' })
    mocks.fetch.mockResolvedValueOnce(response({ ...device, expiresIn: 1 }))
    const time = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(time)
    await account.startDexLogin()
    vi.mocked(Date.now).mockReturnValue(time + 1000)
    mocks.fetch.mockClear()
    expect(await account.pollDexLogin(device.deviceCode)).toEqual({ status: 'expired' })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it.each([
    'https://outside.example/account/',
    'http://navio.mydex.top/account/',
    '//outside.example/account/',
    'https://name:password@navio.mydex.top/account/'
  ])('does not open an unsafe verification return URL: %s', async (verificationUri) => {
    mocks.fetch.mockResolvedValueOnce(response({ ...device, verificationUri }))
    await expect(account.startDexLogin()).rejects.toThrow('来源不一致')
    expect(mocks.openExternal).not.toHaveBeenCalled()
    expect(await account.pollDexLogin(device.deviceCode)).toEqual({ status: 'expired' })
  })

  it.each([0, -1, '600', null])('rejects an invalid device lifetime: %s', async (expiresIn) => {
    mocks.fetch.mockResolvedValueOnce(response({ ...device, expiresIn }))
    await expect(account.startDexLogin()).rejects.toThrow('无效的登录请求')
    expect(mocks.openExternal).not.toHaveBeenCalled()
  })

  it('bounds device lifetime and normalizes an invalid polling interval', async () => {
    mocks.fetch.mockResolvedValueOnce(
      response({ ...device, expiresIn: 10000, interval: 'invalid' })
    )
    expect(await account.startDexLogin()).toMatchObject({ expiresIn: 1800, interval: 5 })
  })

  it.each([403, 404, 410])('stops polling terminal server rejection %s', async (status) => {
    mocks.fetch.mockResolvedValueOnce(response(device))
    await account.startDexLogin()
    mocks.fetch.mockResolvedValueOnce(
      response({ error: { message: 'Request unavailable' } }, status)
    )
    expect(await account.pollDexLogin(device.deviceCode)).toEqual({ status: 'expired' })
    mocks.fetch.mockClear()
    expect(await account.pollDexLogin(device.deviceCode)).toEqual({ status: 'expired' })
    expect(mocks.fetch).not.toHaveBeenCalled()
    await assertNoVault()
  })

  it('invalidates an attempt when opening the browser fails', async () => {
    mocks.fetch.mockResolvedValueOnce(response(device))
    mocks.openExternal.mockRejectedValueOnce(new Error('Browser unavailable'))
    await expect(account.startDexLogin()).rejects.toThrow('Browser unavailable')
    expect(await account.pollDexLogin(device.deviceCode)).toEqual({ status: 'expired' })
  })

  it('refuses to claim a completed login when Windows credential encryption is unavailable', async () => {
    mocks.fetch.mockResolvedValueOnce(response(device))
    await account.startDexLogin()
    mocks.encryptionAvailable.mockReturnValue(false)
    mocks.fetch.mockResolvedValueOnce(response({ status: 'approved', accessToken, user }))
    await expect(account.pollDexLogin(device.deviceCode)).rejects.toThrow('安全凭据存储不可用')
    await assertNoVault()
  })

  it('requires the approved protocol status before treating a token as a completed login', async () => {
    mocks.fetch.mockResolvedValueOnce(response(device))
    await account.startDexLogin()
    mocks.fetch.mockResolvedValueOnce(response({ status: 'pending', accessToken, user }))
    expect(await account.pollDexLogin(device.deviceCode)).toEqual({ status: 'pending' })
    await assertNoVault()
  })
})

describe('in-app account operations', () => {
  it('stores a native password login securely and never gives its token to the renderer', async () => {
    mocks.fetch.mockResolvedValueOnce(response({ accessToken, user }))
    const result = await account.dexAccountAction('login', {
      identifier: 'navio_test',
      password: 'local-test-password'
    })
    expect(result).toEqual({ status: 'online', serverUrl: origin, user })
    expect(JSON.stringify(result)).not.toContain(accessToken)
    const [url, options] = mocks.fetch.mock.calls[0]
    expect(url).toBe(`${origin}/api/v1/desktop/auth/login`)
    expect(new Headers(options.headers).get('x-dex-client')).toBe('desktop')
    expect(new Headers(options.headers).has('Cookie')).toBe(false)
    expect(JSON.parse(mocks.decrypt(await readFile(vaultFile()))).accessToken).toBe(accessToken)
  })

  it('requests password recovery without a session and never claims that recovery logged in', async () => {
    mocks.fetch.mockResolvedValueOnce(response({ ok: true }))
    expect(
      await account.dexAccountAction('password-reset', {
        contact: 'test@example.com',
        code: '123456',
        newPassword: 'replacement-test-password'
      })
    ).toEqual({ ok: true })
    expect(mocks.fetch.mock.calls[0][0]).toBe(`${origin}/api/v1/desktop/auth/password/reset`)
    await assertNoVault()
  })

  it('requires a logged-in session for binding codes and account security actions', async () => {
    await expect(
      account.dexAccountAction('otp-request', { purpose: 'bind', contact: 'test@example.com' })
    ).rejects.toThrow('请先登录')
    await expect(
      account.dexAccountAction('otp-request', { purpose: 'security', contact: 'test@example.com' })
    ).rejects.toThrow('请先登录')
    await expect(account.dexAccountAction('security')).rejects.toThrow('请先登录')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('rejects arbitrary routes and path traversal in operation targets before any network request', async () => {
    await expect(account.dexAccountAction('/api/v1/admin/users' as never)).rejects.toThrow('不支持')
    await expect(account.dexAccountAction('revoke-device', { target: '../users' })).rejects.toThrow(
      '目标无效'
    )
    await expect(account.dexAccountAction('toString' as never)).rejects.toThrow('不支持')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('does not revive a native login that completed after local logout', async () => {
    let finish!: (r: Response) => void
    let started!: () => void
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    mocks.fetch.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve
          started()
        })
    )
    const pending = account.dexAccountAction('login', {
      identifier: 'navio_test',
      password: 'local-test-password'
    })
    await ready
    await account.logoutDexAccount()
    finish(response({ accessToken, user }))
    await expect(pending).rejects.toThrow('登录状态已更改')
    await assertNoVault()
  })
})

describe('verified account unlinking', () => {
  const updatedUser = { ...user, email: null, phone: '+8613800000000', hasPassword: true }

  it('sends security OTP requests with the current session through the desktop wrapper', async () => {
    await login()
    mocks.fetch.mockClear()
    mocks.fetch.mockResolvedValueOnce(response({ ok: true }))
    await account.dexAccountAction('otp-request', {
      purpose: 'security',
      contact: 'bound@example.com'
    })
    const [url, options] = mocks.fetch.mock.calls[0]
    expect(url).toBe(`${origin}/api/v1/desktop/auth/otp/request`)
    expect(new Headers(options.headers).get('Authorization')).toBe(`Bearer ${accessToken}`)
    expect(JSON.parse(options.body)).toMatchObject({
      purpose: 'security',
      contact: 'bound@example.com'
    })
  })

  it.each([
    ['unlink-contact', 'email', 'contacts/email'],
    ['unlink-contact', 'phone', 'contacts/phone'],
    ['unlink-provider', 'google', 'providers/google'],
    ['unlink-provider', 'github', 'providers/github']
  ] as const)(
    'sends password proof in the DELETE body for %s/%s and saves only the returned user',
    async (action, target, path) => {
      await login()
      mocks.fetch.mockClear()
      mocks.encrypt.mockClear()
      mocks.fetch.mockResolvedValueOnce(response({ ok: true, user: updatedUser }))
      const proof = { currentPassword: ' isolated-password-for-unlink ' }
      const result = await account.dexAccountAction(action, { target, ...proof, extra: 'ignored' })
      expect(result).toEqual({ ok: true, user: updatedUser })
      expect(JSON.stringify(result)).not.toContain(accessToken)
      const [url, options] = mocks.fetch.mock.calls[0]
      expect(url).toBe(`${origin}/api/v1/account/${path}`)
      expect(options.method).toBe('DELETE')
      expect(JSON.parse(options.body)).toEqual(proof)
      expect(new Headers(options.headers).get('Authorization')).toBe(`Bearer ${accessToken}`)
      const stored = JSON.parse(mocks.decrypt(await readFile(vaultFile())))
      expect(stored).toEqual({ serverUrl: origin, accessToken, user: updatedUser })
      expect(JSON.stringify(stored)).not.toContain(proof.currentPassword)
      expect(mocks.encrypt).not.toHaveBeenCalledWith(expect.stringContaining(proof.currentPassword))
      mocks.fetch.mockRejectedValueOnce(new TypeError('Offline after unlink'))
      expect(await account.getDexAccount()).toEqual({
        status: 'offline',
        serverUrl: origin,
        user: updatedUser
      })
    }
  )

  it.each(['unlink-contact', 'unlink-provider'] as const)(
    'sends only the bound-contact code proof for %s',
    async (action) => {
      await login()
      mocks.fetch.mockClear()
      mocks.fetch.mockResolvedValueOnce(response({ ok: true, user: updatedUser }))
      await account.dexAccountAction(action, {
        target: action === 'unlink-contact' ? 'email' : 'google',
        contact: ' bound@example.com ',
        code: '473921'
      })
      expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toEqual({
        contact: 'bound@example.com',
        code: '473921'
      })
      const stored = mocks.decrypt(await readFile(vaultFile()))
      expect(stored).not.toContain('473921')
      expect(stored).not.toContain('bound@example.com')
    }
  )

  it.each([
    { target: 'email' },
    { target: 'email', currentPassword: '' },
    { target: 'email', currentPassword: 'x'.repeat(129) },
    { target: 'email', currentPassword: 'password', contact: 'bound@example.com', code: '123456' },
    { target: 'email', contact: 'bound@example.com', code: '12345' },
    { target: 'email', contact: 'bound@example.com', code: 'abc123' },
    { target: 'email', contact: '', code: '123456' },
    { target: 'email', contact: 123, code: '123456' }
  ])('rejects missing, mixed or invalid verification proof before sending: %#', async (payload) => {
    await expect(account.dexAccountAction('unlink-contact', payload)).rejects.toThrow('完成验证')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it.each([
    ['unlink-contact', 'google'],
    ['unlink-contact', '../email'],
    ['unlink-provider', 'email'],
    ['unlink-provider', 'microsoft']
  ] as const)('rejects unsupported unlink targets %s/%s', async (action, target) => {
    await expect(
      account.dexAccountAction(action, { target, currentPassword: 'password' })
    ).rejects.toThrow('目标无效')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('does not unlink without a current session even with valid-shaped proof', async () => {
    await expect(
      account.dexAccountAction('unlink-contact', {
        target: 'email',
        currentPassword: 'password'
      })
    ).rejects.toThrow('请先登录')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('preserves the cached user when the server refuses removal of the last contact', async () => {
    await login()
    const original = await readFile(vaultFile())
    mocks.fetch.mockResolvedValueOnce(
      response(
        {
          error: { code: 'LAST_CONTACT', message: '至少保留一个已验证的联系方式。' }
        },
        409
      )
    )
    await expect(
      account.dexAccountAction('unlink-contact', {
        target: 'email',
        currentPassword: 'password'
      })
    ).rejects.toThrow('至少保留')
    expect(await readFile(vaultFile())).toEqual(original)
  })

  it.each([{ ok: true }, { ok: true, user: { ...user, id: 'different-account' } }])(
    'does not replace the cached account with an invalid unlink response: %#',
    async (result) => {
      await login()
      const original = await readFile(vaultFile())
      mocks.fetch.mockResolvedValueOnce(response(result))
      await expect(
        account.dexAccountAction('unlink-provider', {
          target: 'github',
          currentPassword: 'password'
        })
      ).rejects.toThrow('无效的账号资料')
      expect(await readFile(vaultFile())).toEqual(original)
    }
  )

  it('does not recreate the vault when unlinking completes after logout', async () => {
    await login()
    let finish!: (value: Response) => void
    let started!: () => void
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    mocks.fetch.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve
          started()
        })
    )
    const pending = account.dexAccountAction('unlink-provider', {
      target: 'google',
      currentPassword: 'password'
    })
    await ready
    await account.logoutDexAccount()
    finish(response({ ok: true, user: updatedUser }))
    await expect(pending).rejects.toThrow('登录状态已更改')
    await assertNoVault()
  })

  it.each(['old-user', 'unauthorized', 'offline'] as const)(
    'does not restore stale bindings or sign out when a pre-unlink /me finishes with %s',
    async (completion) => {
      await login()
      let finish!: (value: Response) => void
      let fail!: (error: Error) => void
      let started!: () => void
      const ready = new Promise<void>((resolve) => {
        started = resolve
      })
      mocks.fetch.mockImplementationOnce(
        () =>
          new Promise<Response>((resolve, reject) => {
            finish = resolve
            fail = reject
            started()
          })
      )
      const refresh = account.getDexAccount()
      await ready
      mocks.fetch.mockResolvedValueOnce(response({ ok: true, user: updatedUser }))
      await account.dexAccountAction('unlink-contact', {
        target: 'email',
        currentPassword: 'password'
      })
      if (completion === 'old-user')
        finish(response({ user: { ...user, email: 'old@example.com' } }))
      else if (completion === 'unauthorized') finish(response({ error: 'Old response' }, 401))
      else fail(new TypeError('Earlier request lost connection'))
      expect(await refresh).toEqual({ status: 'online', serverUrl: origin, user: updatedUser })
      expect(JSON.parse(mocks.decrypt(await readFile(vaultFile())))).toEqual({
        serverUrl: origin,
        accessToken,
        user: updatedUser
      })
      mocks.fetch.mockRejectedValueOnce(new TypeError('Offline'))
      expect(await account.getDexAccount()).toEqual({
        status: 'offline',
        serverUrl: origin,
        user: updatedUser
      })
    }
  )
})

describe('native OAuth bridge', () => {
  const oauth = {
    requestCode: 'native-oauth-request',
    authorizationUrl: `${origin}/api/v1/desktop/oauth/google/authorize?launch=test-launch`,
    expiresIn: 600,
    interval: 5
  }

  it('opens only the same-origin launch endpoint in the system browser', async () => {
    mocks.fetch.mockResolvedValueOnce(response(oauth))
    expect(await account.startDexOAuth('google')).toEqual(oauth)
    expect(mocks.openExternal).toHaveBeenCalledWith(oauth.authorizationUrl)
    expect(mocks.fetch.mock.calls[0][0]).toBe(`${origin}/api/v1/desktop/oauth/start`)
  })

  it.each([
    'https://outside.example/start',
    `${origin}/account/`,
    `${origin}/api/v1/desktop/oauth/google/authorize#secret`
  ])('rejects an unexpected launch URL %s', async (authorizationUrl) => {
    mocks.fetch.mockResolvedValueOnce(response({ ...oauth, authorizationUrl }))
    await expect(account.startDexOAuth('google')).rejects.toThrow('授权地址')
    expect(mocks.openExternal).not.toHaveBeenCalled()
  })

  it('completes first-time third-party registration in the app and hides the issued token', async () => {
    mocks.fetch.mockResolvedValueOnce(response(oauth))
    await account.startDexOAuth('google')
    mocks.fetch.mockResolvedValueOnce(
      response({
        status: 'registration_required',
        provider: 'google',
        suggestedEmail: 'test@example.com',
        emailVerified: true
      })
    )
    expect(await account.finishDexOAuth(oauth.requestCode)).toMatchObject({
      status: 'registration_required',
      emailVerified: true
    })
    await assertNoVault()
    mocks.fetch.mockResolvedValueOnce(response({ status: 'approved', accessToken, user }))
    const result = await account.finishDexOAuth(oauth.requestCode, { username: 'native_test' })
    expect(result).toEqual({
      status: 'approved',
      account: { status: 'online', serverUrl: origin, user }
    })
    expect(JSON.stringify(result)).not.toContain(accessToken)
    expect(mocks.fetch.mock.calls.at(-1)?.[0]).toBe(`${origin}/api/v1/desktop/oauth/complete`)
  })

  it('cancels an OAuth request locally even when the server is unavailable', async () => {
    mocks.fetch.mockResolvedValueOnce(response(oauth))
    await account.startDexOAuth('google')
    await account.cancelDexOAuth(oauth.requestCode)
    mocks.fetch.mockClear()
    expect(await account.finishDexOAuth(oauth.requestCode)).toEqual({ status: 'expired' })
    expect(mocks.fetch).not.toHaveBeenCalled()
    await assertNoVault()
  })
})

describe('account offline and revocation behavior', () => {
  it('returns verified user data online and sends the opaque token only in the Authorization header', async () => {
    await login()
    mocks.fetch.mockClear()
    const updated = { ...user, displayName: 'Updated profile' }
    mocks.fetch.mockResolvedValueOnce(response({ user: updated }))
    expect(await account.getDexAccount()).toEqual({
      status: 'online',
      serverUrl: origin,
      user: updated
    })
    const [url, options] = mocks.fetch.mock.calls[0]
    expect(url).toBe(`${origin}/api/v1/me`)
    expect(url).not.toContain(accessToken)
    expect(new Headers(options.headers).get('Authorization')).toBe(`Bearer ${accessToken}`)
    expect(JSON.parse(mocks.decrypt(await readFile(vaultFile()))).user).toEqual(updated)
  })

  it('preserves a previously signed-in account and its encrypted vault during network loss', async () => {
    await login()
    const before = await readFile(vaultFile())
    mocks.fetch.mockRejectedValueOnce(new TypeError('fetch failed'))
    expect(await account.getDexAccount()).toEqual({ status: 'offline', serverUrl: origin, user })
    expect(await readFile(vaultFile())).toEqual(before)
  })

  it('treats a temporary server error as offline without clearing the account', async () => {
    await login()
    mocks.fetch.mockResolvedValueOnce(response({ error: { message: 'Temporary failure' } }, 503))
    expect(await account.getDexAccount()).toMatchObject({ status: 'offline', user })
    await expect(access(vaultFile())).resolves.toBeUndefined()
  })

  it.each([401, 403])('clears a remotely revoked session on HTTP %s', async (status) => {
    await login()
    mocks.fetch.mockResolvedValueOnce(response({ error: { message: 'Session revoked' } }, status))
    expect(await account.getDexAccount()).toEqual({ status: 'signed-out', serverUrl: origin })
    await assertNoVault()
    mocks.fetch.mockClear()
    expect(await account.getDexAccount()).toMatchObject({ status: 'signed-out' })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('does not treat a corrupt vault as an offline entitlement', async () => {
    await writeFile(vaultFile(), 'not-encrypted-session-data')
    expect(await account.getDexAccount()).toEqual({ status: 'signed-out', serverUrl: origin })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('logs out locally even when the server is unreachable and cancels pending authorization', async () => {
    await login()
    mocks.fetch.mockResolvedValueOnce(response({ ...device, deviceCode: 'second-device' }))
    await account.startDexLogin()
    mocks.fetch.mockRejectedValueOnce(new TypeError('offline'))
    await account.logoutDexAccount()
    await assertNoVault()
    expect(await account.pollDexLogin('second-device')).toEqual({ status: 'expired' })
    expect(await account.getDexAccount()).toMatchObject({ status: 'signed-out' })
  })

  it('invalidates the old account and attempts before changing server origin', async () => {
    await login()
    mocks.fetch.mockResolvedValueOnce(response({ ...device, deviceCode: 'second-device' }))
    await account.startDexLogin()
    mocks.fetch.mockResolvedValueOnce(response({ ok: true }))
    await account.setDexServerUrl('http://localhost:3210/')
    expect(await account.dexServerUrl()).toBe('http://localhost:3210')
    expect(await account.getDexAccount()).toEqual({
      status: 'signed-out',
      serverUrl: 'http://localhost:3210'
    })
    expect(await account.pollDexLogin('second-device')).toEqual({ status: 'expired' })
    expect(mocks.fetch.mock.calls.at(-1)?.[0]).toBe(`${origin}/api/v1/auth/logout`)
    await assertNoVault()
  })

  it('does not revive an old origin vault when a different server is configured', async () => {
    await login()
    await writeFile(
      join(mocks.directory, 'dex-account-server.json'),
      JSON.stringify({ serverUrl: 'https://another.example' })
    )
    mocks.fetch.mockClear()
    expect(await account.getDexAccount()).toEqual({
      status: 'signed-out',
      serverUrl: 'https://another.example'
    })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('does not write back a late account refresh after the user logs out', async () => {
    await login()
    let finish!: (r: Response) => void
    let started!: () => void
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    mocks.fetch.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve
          started()
        })
    )
    const refresh = account.getDexAccount()
    await ready
    mocks.fetch.mockResolvedValueOnce(response({ ok: true }))
    await account.logoutDexAccount()
    finish(response({ user }))
    expect(await refresh).toMatchObject({ status: 'signed-out' })
    await assertNoVault()
  })

  it('does not clear a replacement login when an older refresh returns unauthorized', async () => {
    await login()
    let finish!: (r: Response) => void
    let started!: () => void
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    mocks.fetch.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve
          started()
        })
    )
    const refresh = account.getDexAccount()
    await ready
    mocks.fetch.mockResolvedValueOnce(response(device))
    await account.startDexLogin()
    mocks.fetch.mockResolvedValueOnce(
      response({ status: 'approved', accessToken: 'replacement-session-token', user })
    )
    expect(await account.pollDexLogin(device.deviceCode)).toMatchObject({ status: 'complete' })
    finish(response({ error: { message: 'Old session expired' } }, 401))
    await refresh
    expect(JSON.parse(mocks.decrypt(await readFile(vaultFile()))).accessToken).toBe(
      'replacement-session-token'
    )
  })

  it('ignores an approved poll arriving after the server was changed', async () => {
    mocks.fetch.mockResolvedValueOnce(response(device))
    await account.startDexLogin()
    let finish!: (r: Response) => void
    let started!: () => void
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    mocks.fetch.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve
          started()
        })
    )
    const pending = account.pollDexLogin(device.deviceCode)
    await ready
    await account.setDexServerUrl('http://localhost:3210')
    finish(response({ status: 'approved', accessToken, user }))
    expect(await pending).toEqual({ status: 'expired' })
    await assertNoVault()
    expect(await account.getDexAccount()).toEqual({
      status: 'signed-out',
      serverUrl: 'http://localhost:3210'
    })
  })
})
