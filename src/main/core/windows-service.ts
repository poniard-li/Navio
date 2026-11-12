import { execFile, spawn, type ChildProcess } from 'child_process'
import { promisify } from 'util'
import { createConnection } from 'net'
import { createHash } from 'crypto'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { dialog } from 'electron'
import { resourcesDir, mihomoCorePath } from '../utils/dirs'
import { parse } from '../utils/yaml'
import { prepareWindowsServiceConfig } from './windows-service-config'

const execFileAsync = promisify(execFile)
const protocol = 1
type Identity = { sid: string; id: string; pipe: string; apiPipe: string }
export interface WindowsServiceStatus {
  supported: boolean
  available: boolean
  installed: boolean
  running: boolean
  active: boolean
  changed?: boolean
  detail?: string
}
let identity: Identity | undefined
let ready = false
let active = false
let hashes: Record<string, string> = {}
let pendingOperation: Promise<WindowsServiceStatus> | undefined

function helperPath(): string {
  return path.join(resourcesDir(), 'windows-service', 'NavioService.exe')
}

async function getIdentity(): Promise<Identity> {
  if (identity) return identity
  const { stdout } = await execFileAsync(helperPath(), ['identity'], {
    windowsHide: true,
    timeout: 5000
  })
  const parsed = JSON.parse(stdout) as Identity
  if (!/^S-1-5-/.test(parsed.sid) || !/^[a-f0-9]{16}$/.test(parsed.id)) {
    throw new Error('后台服务身份信息无效。')
  }
  identity = parsed
  return parsed
}

async function request(action: string): Promise<Record<string, unknown>> {
  const owner = await getIdentity()
  return new Promise((resolve, reject) => {
    const connection = createConnection(`\\\\.\\pipe\\${owner.pipe}`)
    let data = ''
    const timer = setTimeout(
      () => {
        connection.destroy()
        reject(new Error('后台服务没有响应。'))
      },
      action === 'stop' ? 15000 : 3000
    )
    connection.once('connect', () => connection.write(`${JSON.stringify({ action })}\n`))
    connection.on('data', (chunk) => {
      data += chunk.toString('utf8')
      if (data.length > 65536) {
        connection.destroy(new Error('后台服务响应过大。'))
        return
      }
      if (!data.includes('\n')) return
      clearTimeout(timer)
      connection.end()
      try {
        const response = JSON.parse(data.split('\n')[0])
        if (response.type === 'error') reject(new Error(response.message))
        else resolve(response)
      } catch (error) {
        reject(error)
      }
    })
    connection.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    connection.once('close', () => {
      clearTimeout(timer)
      if (!data.includes('\n')) reject(new Error('后台服务连接已关闭。'))
    })
  })
}

export function isWindowsServiceReady(): boolean {
  return process.platform === 'win32' && ready
}

export function isWindowsServiceActive(): boolean {
  return process.platform === 'win32' && active
}

export function windowsServiceApiPipe(): string | undefined {
  return active && identity ? `\\\\.\\pipe\\${identity.apiPipe}` : undefined
}

export async function getWindowsServiceStatus(): Promise<WindowsServiceStatus> {
  const supported = process.platform === 'win32'
  const available = supported && existsSync(helperPath())
  if (!available) return { supported, available, installed: false, running: false, active: false }
  try {
    const response = await request('status')
    ready = response.protocol === protocol && response.ready === true
    hashes = (response.coreHashes as Record<string, string>) || {}
    return {
      supported,
      available,
      installed: true,
      running: ready,
      active,
      detail: ready ? undefined : '服务协议版本不匹配，请重新安装后台服务。'
    }
  } catch {
    ready = false
    const owner = await getIdentity()
    const result = await execFileAsync('sc.exe', ['query', `NavioCore-${owner.id}`], {
      windowsHide: true,
      timeout: 5000
    }).then(
      () => true,
      () => false
    )
    return {
      supported,
      available,
      installed: result,
      running: false,
      active,
      detail: result ? '后台服务未运行，可重新安装修复。' : undefined
    }
  }
}

export async function canUseWindowsService(core: string): Promise<boolean> {
  if (!isWindowsServiceReady()) return false
  const expected = hashes[`${core}.exe`]
  if (!expected) return false
  const actual = createHash('sha256')
    .update(await readFile(mihomoCorePath(core)))
    .digest('hex')
  if (actual !== expected)
    throw new Error(
      '当前内核与后台服务版本不一致。请重新安装服务，或使用“仅本次以管理员方式运行”。'
    )
  return true
}

export async function manageWindowsService(
  action: 'install' | 'uninstall'
): Promise<WindowsServiceStatus> {
  if (action !== 'install' && action !== 'uninstall') throw new Error('无效的后台服务操作。')
  if (pendingOperation) return pendingOperation
  pendingOperation = (async () => {
    if (process.platform !== 'win32' || !existsSync(helperPath()))
      throw new Error('当前程序包不包含 Windows 后台服务。')
    const choice = await dialog.showMessageBox({
      type: 'question',
      title: action === 'install' ? '安装 TUN 后台服务' : '卸载 TUN 后台服务',
      message: action === 'install' ? '允许 Navio 安装本机后台服务？' : '卸载本机后台服务？',
      detail:
        action === 'install'
          ? '安装需要一次管理员授权。此后主界面以普通权限运行，由服务启动网络内核。服务会保留在 Windows 中，不会随免安装版文件夹删除；可在此页面卸载。服务模式使用本机专用控制接口，外部 Web 面板请使用管理员运行方式。'
          : '这会停止正在运行的服务内核，并删除服务的缓存副本。订阅、账号和本地配置保留；以后仍可仅本次以管理员方式开启 TUN。',
      buttons: [action === 'install' ? '安装服务' : '卸载服务', '取消'],
      defaultId: 1,
      cancelId: 1
    })
    if (choice.response !== 0) return { ...(await getWindowsServiceStatus()), changed: false }
    const owner = await getIdentity()
    const executable = helperPath().replace(/'/g, "''")
    const command = `$p = Start-Process -FilePath '${executable}' -ArgumentList '${action}', '${owner.sid}' -Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode`
    await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(command, 'utf16le').toString('base64')
      ],
      { windowsHide: true, timeout: 180000 }
    )
    if (action === 'uninstall') {
      active = false
      ready = false
      const { patchControledMihomoConfig } = await import('../config')
      await patchControledMihomoConfig({ tun: { enable: false } })
    }
    return { ...(await getWindowsServiceStatus()), changed: true }
  })().finally(() => {
    pendingOperation = undefined
  })
  return pendingOperation
}

export async function spawnWindowsServiceCore(options: {
  corePath: string
  workDir: string
  safePath?: string
  ageSecretKey?: string
  detached: boolean
}): Promise<ChildProcess> {
  const owner = await getIdentity()
  const source = parse(await readFile(path.join(options.workDir, 'config.yaml'), 'utf8')) as Record<
    string,
    unknown
  >
  const prepared = await prepareWindowsServiceConfig(source, options.workDir, options.safePath)
  const child = spawn(helperPath(), ['bridge', owner.sid], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  child.stdin?.on('error', () => undefined)
  child.stdin?.write(
    `${JSON.stringify({ action: 'start', core: path.basename(options.corePath), ...prepared, ageSecretKey: options.ageSecretKey || '', detached: options.detached })}\n`
  )
  active = true
  return child
}

export async function stopWindowsServiceCore(): Promise<void> {
  if (!active) return
  await request('stop')
  active = false
}
