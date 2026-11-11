import { execFile, type ChildProcess } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { isIP } from 'node:net'
import { homedir } from 'node:os'
import { dirname, extname, isAbsolute, join } from 'node:path'
import { getAppConfig } from '../config/app'
import { getControledMihomoConfig } from '../config/controledMihomo'
import { DEFAULT_MIHOMO_PORTS } from '../../shared/appConfig'

const windowsSystem = (): string => join(process.env.SystemRoot || 'C:\\Windows', 'System32')
const powershell = (): string =>
  join(windowsSystem(), 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const children = new Map<string, ChildProcess>()
const runs = new Map<string, INavioScriptRun>()
const outputLimit = 24000

const validPort = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 65536

export function proxyTerminalEnvironment(
  config: Partial<IMihomoConfig>,
  current: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const bind = config['bind-address'] || '*'
  const hostname = bind === '*' || bind === '0.0.0.0' ? '127.0.0.1' : bind === '::' ? '::1' : bind
  if (!isIP(hostname)) throw new Error('内核监听地址不是有效 IP，无法创建代理终端')
  const host = isIP(hostname) === 6 ? `[${hostname}]` : hostname
  const mixed = config['mixed-port'] ?? DEFAULT_MIHOMO_PORTS.mixed
  const http = validPort(mixed) ? mixed : config.port
  const socks = validPort(mixed) ? mixed : config['socks-port']
  if (!validPort(http) && !validPort(socks)) throw new Error('请先启用混合、HTTP 或 SOCKS 监听端口')
  const httpUrl = validPort(http) ? `http://${host}:${http}` : `socks5h://${host}:${socks}`
  const allUrl = validPort(socks) ? `socks5h://${host}:${socks}` : httpUrl
  return {
    ...current,
    HTTP_PROXY: httpUrl,
    HTTPS_PROXY: httpUrl,
    ALL_PROXY: allUrl,
    http_proxy: httpUrl,
    https_proxy: httpUrl,
    all_proxy: allUrl
  }
}

export async function launchProxyTerminal(): Promise<void> {
  if (process.platform !== 'win32') throw new Error('此入口当前支持 Windows PowerShell')
  const env = proxyTerminalEnvironment(await getControledMihomoConfig())
  // A fixed broker command creates a real console with interactive input. Proxy
  // values stay in the child environment; no user text is interpolated as code.
  const command =
    "Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList '-NoLogo','-NoProfile','-NoExit' -WorkingDirectory $env:USERPROFILE -WindowStyle Normal"
  await new Promise<void>((resolve, reject) =>
    execFile(
      powershell(),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command],
      { env, cwd: homedir(), windowsHide: true, shell: false, timeout: 15000 },
      (error) => (error ? reject(error) : resolve())
    )
  )
}

export function validateNavioTrayScript(value: unknown): INavioTrayScript {
  if (!value || typeof value !== 'object') throw new Error('脚本配置无效')
  const input = value as Partial<INavioTrayScript>
  if (typeof input.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(input.id))
    throw new Error('脚本 ID 无效')
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100)
    throw new Error('请填写脚本名称（最多 100 字符）')
  if (
    typeof input.path !== 'string' ||
    !isAbsolute(input.path) ||
    /[\0\r\n]/.test(input.path) ||
    !['.ps1', '.exe'].includes(extname(input.path).toLowerCase())
  )
    throw new Error('请选择绝对路径的 .ps1 或 .exe 文件')
  if (
    !Array.isArray(input.args) ||
    input.args.length > 64 ||
    input.args.some((arg) => typeof arg !== 'string' || arg.length > 8192 || /\0/.test(arg))
  )
    throw new Error('脚本参数必须是字符串数组（最多 64 项）')
  return { id: input.id, name: input.name.trim(), path: input.path, args: [...input.args] }
}

export function navioScriptCommand(script: INavioTrayScript): { file: string; args: string[] } {
  return extname(script.path).toLowerCase() === '.ps1'
    ? {
        file: powershell(),
        args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', script.path, ...script.args]
      }
    : { file: script.path, args: [...script.args] }
}

function appendOutput(run: INavioScriptRun, text: string): void {
  run.output = (run.output + text).slice(-outputLimit)
}

async function terminateChild(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null) return
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) =>
      execFile(
        join(windowsSystem(), 'taskkill.exe'),
        ['/PID', String(child.pid), '/T', '/F'],
        { windowsHide: true, shell: false },
        () => resolve()
      )
    )
  } else child.kill('SIGTERM')
}

export async function runNavioTrayScript(id: string): Promise<void> {
  if (process.platform !== 'win32') throw new Error('托盘脚本当前支持 Windows')
  const config = await getAppConfig()
  if (config.navioTrayScriptsEnabled !== true) throw new Error('请先在高级设置中主动启用托盘脚本')
  const script = validateNavioTrayScript(config.navioTrayScripts?.find((entry) => entry.id === id))
  if (children.has(script.id)) throw new Error('该脚本正在运行，请等待完成或停止')
  const file = await stat(script.path)
  if (!file.isFile()) throw new Error('脚本路径不是普通文件')
  const command = navioScriptCommand(script)
  const run: INavioScriptRun = {
    id: script.id,
    name: script.name,
    status: 'running',
    startedAt: Date.now(),
    output: ''
  }
  runs.set(script.id, run)
  const child = execFile(
    command.file,
    command.args,
    { cwd: dirname(script.path), windowsHide: true, shell: false, maxBuffer: 128 * 1024 },
    (error) => {
      if (run.status === 'running') {
        run.status = error ? 'failed' : 'success'
        run.finishedAt = Date.now()
        run.exitCode = child.exitCode ?? undefined
        if (error) appendOutput(run, `\n${error.message}`)
      }
    }
  )
  children.set(script.id, child)
  child.stdout?.on('data', (chunk) => appendOutput(run, String(chunk)))
  child.stderr?.on('data', (chunk) => appendOutput(run, String(chunk)))
  const timer = setTimeout(() => {
    if (run.status !== 'running') return
    run.status = 'failed'
    run.finishedAt = Date.now()
    appendOutput(run, '\n运行超过 60 秒，已请求停止。')
    void terminateChild(child)
  }, 60000)
  timer.unref()
  child.once('close', () => {
    clearTimeout(timer)
    if (children.get(script.id) === child) children.delete(script.id)
  })
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', (error) => {
      run.status = 'failed'
      run.finishedAt = Date.now()
      appendOutput(run, error.message)
      children.delete(script.id)
      clearTimeout(timer)
      reject(error)
    })
  })
}

export async function stopNavioTrayScript(id: string): Promise<void> {
  const child = children.get(id)
  const run = runs.get(id)
  if (!child) return
  if (run) {
    run.status = 'stopped'
    run.finishedAt = Date.now()
    appendOutput(run, '\n已由用户停止。')
  }
  await terminateChild(child)
}

export function getNavioScriptRuns(): INavioScriptRun[] {
  return [...runs.values()].map((run) => ({ ...run }))
}
export async function stopAllNavioScripts(): Promise<void> {
  await Promise.all([...children.keys()].map(stopNavioTrayScript))
}
