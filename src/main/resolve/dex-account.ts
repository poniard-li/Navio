import { readFile, unlink } from 'fs/promises'
import { join } from 'path'
import { safeStorage, shell } from 'electron'
import { dataDir } from '../utils/dirs'
import { atomicWriteFile, WriteQueue } from '../utils/safeFile'
import type {
  DexUser,
  DexAccountAction,
  DexOAuthRequest,
  DexOAuthResult
} from '../../shared/dex-account'
interface AccountVault {
  serverUrl: string
  accessToken: string
  user: DexUser
}
const queue = new WriteQueue()
const attempts = new Map<string, { serverUrl: string; expires: number; revision: number }>()
const oauthAttempts = new Map<
  string,
  { serverUrl: string; expires: number; revision: number; intent: 'login' | 'link' }
>()
let accountRevision = 0
let userRevision = 0
const defaultServer = 'https://navio.mydex.top'
const vaultPath = (): string => join(dataDir(), 'dex-account.vault')
const settingsPath = (): string => join(dataDir(), 'dex-account-server.json')

export function validateDexServer(value: string): string {
  const url = new URL(value)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (
    (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error('账号服务需要完整的 HTTPS 域名；本机调试可使用 HTTP。')
  }
  return url.origin
}
export async function dexServerUrl(): Promise<string> {
  if (process.env.DEX_ACCOUNT_URL) return validateDexServer(process.env.DEX_ACCOUNT_URL)
  try {
    return validateDexServer(JSON.parse(await readFile(settingsPath(), 'utf8')).serverUrl)
  } catch {
    return defaultServer
  }
}
async function readVault(): Promise<AccountVault | undefined> {
  try {
    if (!safeStorage.isEncryptionAvailable()) return undefined
    const value = JSON.parse(safeStorage.decryptString(await readFile(vaultPath()))) as AccountVault
    if (!value.accessToken || !value.user?.id || value.serverUrl !== (await dexServerUrl()))
      return undefined
    return value
  } catch {
    return undefined
  }
}
async function storeVault(
  value: AccountVault,
  revision: number,
  expectedUserRevision?: number
): Promise<boolean> {
  if (!safeStorage.isEncryptionAvailable())
    throw new Error('Windows 安全凭据存储不可用，未保存登录凭据。')
  return queue.run(async () => {
    const serverUrl = await dexServerUrl()
    if (
      revision !== accountRevision ||
      value.serverUrl !== serverUrl ||
      (expectedUserRevision !== undefined && expectedUserRevision !== userRevision)
    )
      return false
    await atomicWriteFile(vaultPath(), safeStorage.encryptString(JSON.stringify(value)))
    return true
  })
}
export async function dexAccountRequest(
  endpoint: string,
  options: RequestInit = {},
  authenticated = true
): Promise<unknown> {
  const server = await dexServerUrl()
  const target = new URL(endpoint, server)
  if (
    !endpoint.startsWith('/api/v1/') ||
    target.origin !== server ||
    !target.pathname.startsWith('/api/v1/') ||
    target.username ||
    target.password ||
    target.hash
  )
    throw new Error('账号请求必须使用当前服务的 API 路径。')
  const vault = authenticated ? await readVault() : undefined
  if (authenticated && !vault) throw new Error('请先登录 D.E.X 账号。')
  const headers = new Headers(options.headers)
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  if (vault) headers.set('Authorization', `Bearer ${vault.accessToken}`)
  const response = await fetch(target.href, {
    ...options,
    redirect: 'error',
    signal: AbortSignal.timeout(12000),
    headers
  })
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as {
      message?: string
      error?: string | { message?: string }
    }
    const detail = typeof data.error === 'string' ? data.error : data.error?.message
    throw Object.assign(
      new Error(data.message || detail || `账号服务暂不可用（${response.status}）`),
      { status: response.status }
    )
  }
  return response.status === 204 ? {} : response.json()
}
export async function getDexAccount(): Promise<{
  status: 'signed-out' | 'online' | 'offline'
  user?: DexUser
  serverUrl: string
}> {
  const revision = accountRevision
  const refreshUserRevision = userRevision
  const serverUrl = await dexServerUrl()
  const vault = await readVault()
  if (!vault) return { status: 'signed-out', serverUrl }
  // A completed mutation is newer than any /me request already in flight. Read
  // behind queued writes so an older response cannot restore removed bindings.
  const latestAccount = async (): Promise<Awaited<ReturnType<typeof getDexAccount>>> => {
    const latest = await queue.run(readVault)
    if (revision !== accountRevision || !latest)
      return { status: 'signed-out', serverUrl: await dexServerUrl() }
    return { status: 'online', user: latest.user, serverUrl: latest.serverUrl }
  }
  try {
    const data = (await dexAccountRequest('/api/v1/me')) as { user?: DexUser }
    if (revision !== accountRevision)
      return { status: 'signed-out', serverUrl: await dexServerUrl() }
    if (refreshUserRevision !== userRevision) return latestAccount()
    const user = data.user
    if (!user?.id) return { status: 'offline', user: vault.user, serverUrl }
    if (!(await storeVault({ ...vault, user }, revision, refreshUserRevision))) {
      if (refreshUserRevision !== userRevision) return latestAccount()
      return { status: 'signed-out', serverUrl: await dexServerUrl() }
    }
    return { status: 'online', user, serverUrl }
  } catch (error) {
    if (revision !== accountRevision)
      return { status: 'signed-out', serverUrl: await dexServerUrl() }
    if (refreshUserRevision !== userRevision) return latestAccount()
    if ([401, 403].includes((error as { status?: number }).status || 0)) {
      await queue.run(async () => {
        if (revision === accountRevision && refreshUserRevision === userRevision)
          await unlink(vaultPath()).catch(() => {})
      })
      if (refreshUserRevision !== userRevision) return latestAccount()
      return { status: 'signed-out', serverUrl }
    }
    return { status: 'offline', user: vault.user, serverUrl }
  }
}
export async function startDexLogin(): Promise<{
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresIn: number
  interval: number
}> {
  const revision = accountRevision
  const serverUrl = await dexServerUrl()
  const data = (await dexAccountRequest(
    '/api/v1/device/start',
    { method: 'POST', body: JSON.stringify({ appId: 'navio', deviceName: 'Navio · Windows' }) },
    false
  )) as {
    deviceCode: string
    userCode: string
    verificationUri: string
    expiresIn: number
    interval: number
  }
  if (
    typeof data?.deviceCode !== 'string' ||
    !data.deviceCode ||
    typeof data.userCode !== 'string' ||
    !data.userCode ||
    !Number.isFinite(data.expiresIn) ||
    data.expiresIn <= 0 ||
    typeof data.verificationUri !== 'string'
  )
    throw new Error('账号服务返回了无效的登录请求。')
  const verification = new URL(data.verificationUri, serverUrl)
  if (verification.origin !== serverUrl || verification.username || verification.password)
    throw new Error('登录页面与账号服务来源不一致。')
  if (revision !== accountRevision || serverUrl !== (await dexServerUrl()))
    throw new Error('账号服务已更改，请重新登录。')
  const expiresIn = Math.min(data.expiresIn, 1800)
  attempts.set(data.deviceCode, { serverUrl, expires: Date.now() + expiresIn * 1000, revision })
  try {
    await shell.openExternal(verification.href)
  } catch (error) {
    attempts.delete(data.deviceCode)
    throw error
  }
  return {
    ...data,
    expiresIn,
    verificationUri: verification.href,
    interval: Number.isFinite(data.interval) ? Math.max(3, data.interval) : 5
  }
}
export async function pollDexLogin(deviceCode: string): Promise<{
  status: 'pending' | 'complete' | 'expired'
  account?: Awaited<ReturnType<typeof getDexAccount>>
}> {
  const attempt = attempts.get(deviceCode)
  if (
    !attempt ||
    attempt.expires <= Date.now() ||
    attempt.revision !== accountRevision ||
    attempt.serverUrl !== (await dexServerUrl())
  ) {
    attempts.delete(deviceCode)
    return { status: 'expired' }
  }
  let data: { status?: string; accessToken?: string; user?: DexUser }
  try {
    data = (await dexAccountRequest(
      '/api/v1/device/poll',
      { method: 'POST', body: JSON.stringify({ deviceCode }) },
      false
    )) as typeof data
  } catch (error) {
    if ([403, 404, 410].includes((error as { status?: number }).status || 0)) {
      attempts.delete(deviceCode)
      return { status: 'expired' }
    }
    throw error
  }
  if (
    attempts.get(deviceCode) !== attempt ||
    attempt.revision !== accountRevision ||
    attempt.serverUrl !== (await dexServerUrl()) ||
    attempt.expires <= Date.now()
  ) {
    attempts.delete(deviceCode)
    return { status: 'expired' }
  }
  if (
    data.status === 'approved' &&
    typeof data.accessToken === 'string' &&
    data.accessToken &&
    data.user?.id
  ) {
    const revision = ++accountRevision
    attempts.clear()
    if (
      !(await storeVault(
        { serverUrl: attempt.serverUrl, accessToken: data.accessToken, user: data.user },
        revision
      ))
    )
      return { status: 'expired' }
    attempts.delete(deviceCode)
    return {
      status: 'complete',
      account: { status: 'online', serverUrl: attempt.serverUrl, user: data.user }
    }
  }
  if (data.status === 'expired') {
    attempts.delete(deviceCode)
    return { status: 'expired' }
  }
  if (data.status !== 'pending') throw new Error('账号服务返回了无效的登录结果。')
  return { status: 'pending' }
}
export async function logoutDexAccount(): Promise<void> {
  accountRevision++
  attempts.clear()
  oauthAttempts.clear()
  try {
    await dexAccountRequest('/api/v1/auth/logout', { method: 'POST', body: '{}' })
  } catch {
    /* Local logout works offline. */
  }
  await queue.run(async () => {
    await unlink(vaultPath()).catch(() => {})
  })
}
export async function setDexServerUrl(url: string): Promise<void> {
  const serverUrl = validateDexServer(url)
  if (serverUrl !== (await dexServerUrl())) {
    if (process.env.DEX_ACCOUNT_URL)
      throw new Error('当前账号服务由启动环境指定，请修改 DEX_ACCOUNT_URL 后重新启动。')
    await logoutDexAccount()
    attempts.clear()
    await atomicWriteFile(settingsPath(), JSON.stringify({ serverUrl }))
  }
}
/** Fixed operation map: the renderer never chooses an HTTP endpoint or receives a session token. */
export async function dexAccountAction(
  action: DexAccountAction,
  payload: Record<string, unknown> = {}
): Promise<unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    throw new Error('账号请求格式无效。')
  const routes: Record<string, [string, string, boolean]> = {
    status: ['/status', 'GET', false],
    login: ['/desktop/auth/login', 'POST', false],
    register: ['/desktop/auth/register', 'POST', false],
    'otp-request': [
      '/desktop/auth/otp/request',
      'POST',
      payload.purpose === 'bind' || payload.purpose === 'security'
    ],
    'otp-login': ['/desktop/auth/otp/login', 'POST', false],
    'password-reset': ['/desktop/auth/password/reset', 'POST', false],
    profile: ['/account/profile', 'PATCH', true],
    password: ['/account/password', 'POST', true],
    contact: ['/account/contact', 'POST', true],
    security: ['/account/security', 'GET', true],
    'my-themes': ['/account/themes', 'GET', true],
    'favorite-themes': ['/account/favorites', 'GET', true]
  }
  let route = Object.hasOwn(routes, action) ? routes[action] : undefined
  if (action === 'themes') {
    const page = Number(payload.page || 1)
    const q = typeof payload.q === 'string' ? payload.q.slice(0, 100) : ''
    if (!Number.isInteger(page) || page < 1 || page > 10000) throw new Error('主题页码无效。')
    route = [`/themes?${new URLSearchParams({ page: String(page), q })}`, 'GET', true]
  }
  if (['theme-favorite', 'theme-report', 'theme-delete'].includes(action)) {
    if (typeof payload.target !== 'string' || !/^[\w-]{1,128}$/.test(payload.target))
      throw new Error('主题标识无效。')
    const suffix =
      action === 'theme-favorite' ? '/favorite' : action === 'theme-report' ? '/report' : ''
    route = [
      `/themes/${payload.target}${suffix}`,
      action === 'theme-delete' ? 'DELETE' : 'POST',
      true
    ]
  }
  const unlinking = action === 'unlink-contact' || action === 'unlink-provider'
  let securityProof: Record<string, string> | undefined
  if (unlinking) {
    const allowed = action === 'unlink-contact' ? ['email', 'phone'] : ['google', 'github']
    if (typeof payload.target !== 'string' || !allowed.includes(payload.target))
      throw new Error('账号操作目标无效。')
    const password = payload.currentPassword
    const contact = payload.contact
    const code = payload.code
    if (
      typeof password === 'string' &&
      password.length > 0 &&
      password.length <= 128 &&
      contact === undefined &&
      code === undefined
    ) {
      securityProof = { currentPassword: password }
    } else if (
      password === undefined &&
      typeof contact === 'string' &&
      contact.trim().length > 0 &&
      contact.length <= 320 &&
      typeof code === 'string' &&
      /^\d{6}$/.test(code)
    ) {
      securityProof = { contact: contact.trim(), code }
    } else {
      throw new Error('请使用当前密码或已绑定联系方式的验证码完成验证。')
    }
    const kind = action === 'unlink-contact' ? 'contacts' : 'providers'
    route = [`/account/${kind}/${payload.target}`, 'DELETE', true]
  }
  if (['revoke-device', 'revoke-grant'].includes(action)) {
    const target = payload.target
    if (typeof target !== 'string' || !/^[\w.-]{1,128}$/.test(target))
      throw new Error('账号操作目标无效。')
    const kind = {
      'revoke-device': 'devices',
      'revoke-grant': 'grants'
    }[action]
    route = [`/account/${kind}/${encodeURIComponent(target)}`, 'DELETE', true]
  }
  if (!route) throw new Error('不支持此账号操作。')
  const [path, method, authenticated] = route
  const serverUrl = await dexServerUrl()
  const signingIn = ['login', 'register', 'otp-login'].includes(action)
  const revision = signingIn ? ++accountRevision : accountRevision
  const mutationVault = unlinking ? await readVault() : undefined
  if (unlinking && !mutationVault) throw new Error('请先登录 D.E.X 账号。')
  if (signingIn) attempts.clear()
  if (signingIn) oauthAttempts.clear()
  const data = await dexAccountRequest(
    `/api/v1${path}`,
    {
      method,
      headers: { 'x-dex-client': 'desktop' },
      ...(securityProof
        ? { body: JSON.stringify(securityProof) }
        : method !== 'GET' && method !== 'DELETE'
          ? { body: JSON.stringify({ ...payload, deviceName: 'Navio · Windows' }) }
          : {})
    },
    authenticated
  )
  if (unlinking && mutationVault) {
    const result = data as { ok?: boolean; user?: DexUser }
    if (result.ok !== true || result.user?.id !== mutationVault.user.id)
      throw new Error('账号服务返回了无效的账号资料，请刷新状态。')
    if (revision !== accountRevision || serverUrl !== (await dexServerUrl()))
      throw new Error('登录状态已更改，请刷新账号状态。')
    userRevision++
    if (!(await storeVault({ ...mutationVault, user: result.user }, revision)))
      throw new Error('登录状态已更改，请刷新账号状态。')
    return { ok: true, user: result.user }
  }
  if (!signingIn) return data
  const result = data as { accessToken?: string; user?: DexUser }
  if (typeof result.accessToken !== 'string' || !result.accessToken || !result.user?.id)
    throw new Error('账号服务没有返回有效的登录凭据。')
  if (revision !== accountRevision || serverUrl !== (await dexServerUrl()))
    throw new Error('登录状态已更改，请重新登录。')
  if (
    !(await storeVault({ serverUrl, accessToken: result.accessToken, user: result.user }, revision))
  )
    throw new Error('登录状态已更改，请重新登录。')
  return { status: 'online', serverUrl, user: result.user }
}

export async function startDexOAuth(
  provider: 'google' | 'github',
  intent: 'login' | 'link' = 'login'
): Promise<DexOAuthRequest> {
  if (!['google', 'github'].includes(provider) || !['login', 'link'].includes(intent))
    throw new Error('第三方登录方式无效。')
  const serverUrl = await dexServerUrl()
  const revision = accountRevision
  const data = (await dexAccountRequest(
    '/api/v1/desktop/oauth/start',
    {
      method: 'POST',
      headers: { 'x-dex-client': 'desktop' },
      body: JSON.stringify({ provider, intent, deviceName: 'Navio · Windows' })
    },
    intent === 'link'
  )) as DexOAuthRequest
  if (
    !data.requestCode ||
    !Number.isFinite(data.expiresIn) ||
    data.expiresIn <= 0 ||
    typeof data.authorizationUrl !== 'string'
  )
    throw new Error('无效的第三方授权请求。')
  const url = new URL(data.authorizationUrl, serverUrl)
  if (
    url.origin !== serverUrl ||
    !url.pathname.startsWith('/api/v1/desktop/oauth/') ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new Error('第三方授权地址与账号服务不一致。')
  if (revision !== accountRevision || serverUrl !== (await dexServerUrl()))
    throw new Error('账号服务已更改，请重试。')
  const expiresIn = Math.min(data.expiresIn, 600)
  oauthAttempts.set(data.requestCode, {
    serverUrl,
    revision,
    intent,
    expires: Date.now() + expiresIn * 1000
  })
  try {
    await shell.openExternal(url.href)
  } catch (err) {
    oauthAttempts.delete(data.requestCode)
    throw err
  }
  return {
    ...data,
    authorizationUrl: url.href,
    expiresIn,
    interval: Math.max(5, Number.isFinite(data.interval) ? data.interval : 5)
  }
}

export async function finishDexOAuth(
  requestCode: string,
  profile?: Record<string, unknown>
): Promise<DexOAuthResult> {
  const attempt = oauthAttempts.get(requestCode)
  if (
    !attempt ||
    attempt.expires <= Date.now() ||
    attempt.revision !== accountRevision ||
    attempt.serverUrl !== (await dexServerUrl())
  ) {
    oauthAttempts.delete(requestCode)
    return { status: 'expired' }
  }
  let data: {
    status: string
    accessToken?: string
    user?: DexUser
    provider?: string
    suggestedEmail?: string
    emailVerified?: boolean
  }
  try {
    data = (await dexAccountRequest(
      `/api/v1/desktop/oauth/${profile ? 'complete' : 'poll'}`,
      {
        method: 'POST',
        headers: { 'x-dex-client': 'desktop' },
        body: JSON.stringify({ ...(profile || {}), requestCode })
      },
      attempt.intent === 'link'
    )) as typeof data
  } catch (err) {
    if ([404, 410].includes((err as { status?: number }).status || 0)) {
      oauthAttempts.delete(requestCode)
      return { status: 'expired' }
    }
    throw err
  }
  if (
    oauthAttempts.get(requestCode) !== attempt ||
    attempt.revision !== accountRevision ||
    attempt.expires <= Date.now() ||
    attempt.serverUrl !== (await dexServerUrl())
  )
    return { status: 'expired' }
  if (data.status === 'pending') return { status: 'pending' }
  if (data.status === 'registration_required' && attempt.intent === 'login')
    return {
      status: 'registration_required',
      provider: data.provider || '',
      suggestedEmail: data.suggestedEmail,
      emailVerified: !!data.emailVerified
    }
  if (data.status === 'linked' && attempt.intent === 'link') {
    oauthAttempts.delete(requestCode)
    return { status: 'linked' }
  }
  if (
    data.status === 'approved' &&
    attempt.intent === 'login' &&
    data.accessToken &&
    data.user?.id
  ) {
    const revision = ++accountRevision
    attempts.clear()
    oauthAttempts.clear()
    if (
      !(await storeVault(
        { serverUrl: attempt.serverUrl, accessToken: data.accessToken, user: data.user },
        revision
      ))
    )
      return { status: 'expired' }
    return {
      status: 'approved',
      account: { status: 'online', serverUrl: attempt.serverUrl, user: data.user }
    }
  }
  throw new Error('第三方授权未完成，请重试。')
}

export async function cancelDexOAuth(requestCode: string): Promise<void> {
  const attempt = oauthAttempts.get(requestCode)
  oauthAttempts.delete(requestCode)
  if (!attempt || attempt.serverUrl !== (await dexServerUrl())) return
  await dexAccountRequest(
    '/api/v1/desktop/oauth/cancel',
    {
      method: 'POST',
      headers: { 'x-dex-client': 'desktop' },
      body: JSON.stringify({ requestCode })
    },
    attempt.intent === 'link'
  ).catch(() => {})
}
