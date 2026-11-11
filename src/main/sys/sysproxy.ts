import { promisify } from 'util'
import { exec, execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import {
  triggerAutoProxy,
  triggerManualProxy,
  getSystemProxy,
  getAutoProxy,
  setSystemProxy,
  setAutoProxy,
  type SysproxyInfo,
  type AutoproxyInfo
} from 'sysproxy-rs'
import { net } from 'electron'
import axios from 'axios'
import { getAppConfig, getControledMihomoConfig } from '../config'
import { DEFAULT_MIHOMO_PORTS } from '../../shared/appConfig'
import { pacPort, startPacServer, stopPacServer } from '../resolve/server'
import { proxyLogger } from '../utils/logger'
import { dataDir, resourcesFilesDir } from '../utils/dirs'
import { setAppliedSystemProxy } from '../core/runtime-state'
import { ProxyOwnership } from './proxyOwnership'
import {
  readWindowsProxyState,
  restoreWindowsProxyState,
  type WindowsProxyState
} from './windowsProxy'

let triggerSysProxyTimer: NodeJS.Timeout | null = null
let triggerSysProxyQueue: Promise<void> = Promise.resolve()
let triggerSysProxySequence = 0
let shuttingDown = false

type ProxyState = WindowsProxyState | { manual: SysproxyInfo; auto: AutoproxyInfo }
const ownership = new ProxyOwnership<ProxyState>(
  () => path.join(dataDir(), 'system-proxy-recovery.json'),
  () =>
    process.platform === 'win32'
      ? readWindowsProxyState()
      : { manual: getSystemProxy(), auto: getAutoProxy() },
  (state) => {
    if ('internet' in state) restoreWindowsProxyState(state)
    else {
      setSystemProxy(state.manual)
      setAutoProxy(state.auto)
    }
  }
)
const helperSocketPath = '/tmp/mihomo-party-helper.sock'
const helperPath = '/Library/PrivilegedHelperTools/party.mihomo.helper'
const helperPlistPath = '/Library/LaunchDaemons/party.mihomo.helper.plist'
const helperService = 'system/party.mihomo.helper'

const defaultBypass: string[] = (() => {
  switch (process.platform) {
    case 'linux':
      return ['localhost', '127.0.0.1', '192.168.0.0/16', '10.0.0.0/8', '172.16.0.0/12', '::1']
    case 'darwin':
      return [
        '127.0.0.1',
        '192.168.0.0/16',
        '10.0.0.0/8',
        '172.16.0.0/12',
        'localhost',
        '*.local',
        '*.crashlytics.com',
        '<local>'
      ]
    case 'win32':
      return [
        'localhost',
        '127.*',
        '192.168.*',
        '10.*',
        '172.16.*',
        '172.17.*',
        '172.18.*',
        '172.19.*',
        '172.20.*',
        '172.21.*',
        '172.22.*',
        '172.23.*',
        '172.24.*',
        '172.25.*',
        '172.26.*',
        '172.27.*',
        '172.28.*',
        '172.29.*',
        '172.30.*',
        '172.31.*',
        '<local>'
      ]
    default:
      return ['localhost', '127.0.0.1', '192.168.0.0/16', '10.0.0.0/8', '172.16.0.0/12', '::1']
  }
})()

interface TriggerSysProxyOptions {
  helperTimeout?: number
  force?: boolean
}

function helperAxiosOptions(helperTimeout?: number): { socketPath: string; timeout?: number } {
  return helperTimeout === undefined
    ? { socketPath: helperSocketPath }
    : { socketPath: helperSocketPath, timeout: helperTimeout }
}

export async function triggerSysProxy(
  enable: boolean,
  options: TriggerSysProxyOptions = {}
): Promise<void> {
  if (shuttingDown) throw new Error('D.E.X STUDIO is restoring the system proxy for exit.')
  const sequence = ++triggerSysProxySequence

  if (triggerSysProxyTimer) {
    clearTimeout(triggerSysProxyTimer)
    triggerSysProxyTimer = null
  }

  const operation = triggerSysProxyQueue.then(async () => {
    if (shuttingDown || sequence !== triggerSysProxySequence) return
    // Restoring local OS settings does not depend on an internet connection.
    if (!enable || net.isOnline() || options.force) {
      if (enable) {
        try {
          await ownership.acquire(() => enableSysProxy(options.helperTimeout))
          setAppliedSystemProxy(true)
        } catch (error) {
          setAppliedSystemProxy(null)
          throw error
        }
      } else {
        await disableSysProxy(options.helperTimeout)
      }
      return
    }

    if (sequence !== triggerSysProxySequence) return
    triggerSysProxyTimer = setTimeout(() => {
      triggerSysProxyTimer = null
      if (sequence !== triggerSysProxySequence) return
      void triggerSysProxy(enable, options).catch((error) => {
        void proxyLogger.error('Failed to retry system proxy', error)
      })
    }, 5000)
  })

  triggerSysProxyQueue = operation.catch(() => {})
  return operation
}

async function enableSysProxy(helperTimeout?: number): Promise<void> {
  await startPacServer()
  const { sysProxy } = await getAppConfig()
  const { mode, host, bypass = defaultBypass } = sysProxy
  const { 'mixed-port': port = DEFAULT_MIHOMO_PORTS.mixed } = await getControledMihomoConfig()
  const proxyHost = host || '127.0.0.1'
  const formattedBypass = bypass
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join(process.platform === 'win32' ? ';' : ',')

  if (process.platform === 'darwin') {
    // macOS 需要 helper 提权
    await helperRequest(() => axios.get('http://localhost/off', helperAxiosOptions(helperTimeout)))
    if (mode === 'auto') {
      await helperRequest(() =>
        axios.post(
          'http://localhost/pac',
          { url: `http://${proxyHost}:${pacPort}/pac` },
          helperAxiosOptions(helperTimeout)
        )
      )
    } else {
      await helperRequest(() =>
        axios.post(
          'http://localhost/global',
          { host: proxyHost, port: port.toString(), bypass: formattedBypass },
          helperAxiosOptions(helperTimeout)
        )
      )
    }
  } else {
    // Windows / Linux 直接使用 sysproxy-rs
    try {
      triggerAutoProxy(false, '')
      triggerManualProxy(false, '', 0, '')
      if (mode === 'auto') {
        triggerAutoProxy(true, `http://${proxyHost}:${pacPort}/pac`)
      } else {
        triggerManualProxy(true, proxyHost, port, formattedBypass)
      }
    } catch (error) {
      await proxyLogger.error('Failed to enable system proxy', error)
      throw error
    }
  }
}

async function disableSysProxy(_helperTimeout?: number): Promise<void> {
  try {
    ownership.release()
    setAppliedSystemProxy(false)
  } catch (error) {
    setAppliedSystemProxy(null)
    throw error
  }
  await stopPacServer()
}

export function disableSysProxySync(): void {
  shuttingDown = true
  ++triggerSysProxySequence
  if (triggerSysProxyTimer) clearTimeout(triggerSysProxyTimer)
  triggerSysProxyTimer = null
  try {
    ownership.release()
    setAppliedSystemProxy(false)
  } catch (error) {
    setAppliedSystemProxy(null)
    shuttingDown = false
    throw error
  }
}

export async function restoreSysProxyForExit(): Promise<void> {
  shuttingDown = true
  ++triggerSysProxySequence
  if (triggerSysProxyTimer) clearTimeout(triggerSysProxyTimer)
  triggerSysProxyTimer = null
  try {
    // Finish any in-flight takeover before restoring, so it cannot enable the
    // proxy after cleanup has already completed.
    await triggerSysProxyQueue
    await disableSysProxy()
  } catch (error) {
    shuttingDown = false
    throw error
  }
}

function isSocketFileExists(): boolean {
  try {
    return fs.existsSync(helperSocketPath)
  } catch {
    return false
  }
}

async function isHelperRunning(): Promise<boolean> {
  try {
    const execPromise = promisify(exec)
    const { stdout } = await execPromise('pgrep -f party.mihomo.helper')
    return stdout.trim().length > 0
  } catch {
    return false
  }
}

async function isHelperServiceRegistered(): Promise<boolean> {
  try {
    const execPromise = promisify(exec)
    await execPromise(`/bin/launchctl print ${helperService}`)
    return true
  } catch {
    return false
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

async function startHelperService(forceRepair = false): Promise<void> {
  const sourceHelper = shellQuote(path.join(resourcesFilesDir(), 'party.mihomo.helper'))
  const sourcePlist = shellQuote(path.join(resourcesFilesDir(), 'party.mihomo.helper.plist'))
  const installedHelper = shellQuote(helperPath)
  const installedPlist = shellQuote(helperPlistPath)
  const shell =
    `if ${forceRepair ? 'true' : 'false'} || [ ! -x ${installedHelper} ] || [ ! -f ${installedPlist} ] || ! /bin/launchctl print ${helperService} >/dev/null 2>&1; then ` +
    `[ -f ${sourceHelper} ] && [ -f ${sourcePlist} ] || exit 1; ` +
    `/bin/launchctl bootout ${helperService} >/dev/null 2>&1 || true; ` +
    `/bin/mkdir -p /Library/PrivilegedHelperTools /Library/LaunchDaemons; ` +
    `/bin/rm -f ${shellQuote(helperSocketPath)}; ` +
    `/usr/bin/install -o root -g wheel -m 544 ${sourceHelper} ${installedHelper}; ` +
    `/usr/bin/install -o root -g wheel -m 644 ${sourcePlist} ${installedPlist}; ` +
    `/bin/launchctl enable ${helperService} >/dev/null 2>&1 || true; ` +
    `/bin/launchctl bootstrap system ${installedPlist}; ` +
    `else /bin/launchctl kickstart -k ${helperService}; fi`
  const command = `do shell script ${JSON.stringify(shell)} with administrator privileges`
  const execFilePromise = promisify(execFile)
  await execFilePromise('/usr/bin/osascript', ['-e', command])
  await new Promise((resolve) => setTimeout(resolve, 1500))
}

async function requestSocketRecreation(): Promise<void> {
  try {
    const execPromise = promisify(exec)
    const shell = `pkill -USR1 -f party.mihomo.helper`
    const command = `do shell script "${shell}" with administrator privileges`
    await execPromise(`osascript -e '${command}'`)
    await new Promise((resolve) => setTimeout(resolve, 1000))
  } catch (error) {
    await proxyLogger.error('Failed to send signal to helper', error)
    throw error
  }
}

async function helperRequest(requestFn: () => Promise<unknown>, maxRetries = 2): Promise<unknown> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await requestFn()
    } catch (error) {
      lastError = error as Error
      const errCode = (error as NodeJS.ErrnoException).code
      const errMsg = (error as Error).message || ''

      if (
        attempt < maxRetries &&
        (errCode === 'ECONNREFUSED' ||
          errCode === 'ENOENT' ||
          errMsg.includes('connect ECONNREFUSED') ||
          errMsg.includes('ENOENT'))
      ) {
        await proxyLogger.info(
          `Helper request failed (attempt ${attempt + 1}/${maxRetries + 1}), checking helper status...`
        )

        const helperRunning = await isHelperRunning()
        const helperRegistered = await isHelperServiceRegistered()
        const socketExists = isSocketFileExists()

        if (!helperRunning || !helperRegistered || !fs.existsSync(helperPlistPath)) {
          await proxyLogger.info('Helper service unavailable, repairing...')
          try {
            await startHelperService(!helperRunning)
            await proxyLogger.info('Helper service started, retrying...')
            continue
          } catch (startError) {
            await proxyLogger.warn('Failed to start helper service', startError)
          }
        } else if (!socketExists) {
          await proxyLogger.info('Socket file missing but helper running, requesting recreation...')
          try {
            await requestSocketRecreation()
            await proxyLogger.info('Socket recreation requested, retrying...')
            continue
          } catch (signalError) {
            await proxyLogger.warn('Failed to request socket recreation', signalError)
          }
        } else {
          await proxyLogger.info('Helper socket is unresponsive, restarting service...')
          try {
            await startHelperService()
            await proxyLogger.info('Helper service restarted, retrying...')
            continue
          } catch (restartError) {
            await proxyLogger.warn('Failed to restart helper service', restartError)
          }
        }
      }

      if (attempt === maxRetries) {
        throw lastError
      }
    }
  }

  throw lastError
}
