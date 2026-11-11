import { readFile, unlink } from 'fs/promises'
import { join } from 'path'
import { safeStorage, shell } from 'electron'
import { dataDir } from '../utils/dirs'
import { atomicWriteFile, WriteQueue } from '../utils/safeFile'

interface DexUser {
  id: string
  username: string
  displayName?: string
  email?: string
  phone?: string
}
interface AccountVault {
  serverUrl: string
  accessToken: string
  user: DexUser
}
const queue = new WriteQueue()
const attempts = new Map<string, { serverUrl: string; expires: number; revision: number }>()
let accountRevision = 0
const defaultServer = 'https://account.mydex.top'
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
async function storeVault(value: AccountVault, revision: number): Promise<boolean> {
  if (!safeStorage.isEncryptionAvailable())
    throw new Error('Windows 安全凭据存储不可用，未保存登录凭据。')
  return queue.run(async () => {
    if (revision !== accountRevision || value.serverUrl !== (await dexServerUrl())) return false
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
  const serverUrl = await dexServerUrl()
  const vault = await readVault()
  if (!vault) return { status: 'signed-out', serverUrl }
  try {
    const data = (await dexAccountRequest('/api/v1/me')) as { user?: DexUser }
    if (revision !== accountRevision)
      return { status: 'signed-out', serverUrl: await dexServerUrl() }
    const user = data.user
    if (!user?.id) return { status: 'offline', user: vault.user, serverUrl }
    if (!(await storeVault({ ...vault, user }, revision)))
      return { status: 'signed-out', serverUrl: await dexServerUrl() }
    return { status: 'online', user, serverUrl }
  } catch (error) {
    if (revision !== accountRevision)
      return { status: 'signed-out', serverUrl: await dexServerUrl() }
    if ([401, 403].includes((error as { status?: number }).status || 0)) {
      await queue.run(async () => {
        if (revision === accountRevision) await unlink(vaultPath()).catch(() => {})
      })
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
export async function openDexAccountPortal(): Promise<void> {
  await shell.openExternal(`${await dexServerUrl()}/account/`)
}
