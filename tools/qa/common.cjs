const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs/promises')
const http = require('node:http')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { parseArgs } = require('node:util')

const repository = path.resolve(__dirname, '../..')
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function readOptions(extra = {}) {
  return parseArgs({
    options: {
      exe: { type: 'string' },
      playwright: { type: 'string' },
      output: { type: 'string' },
      'keep-data': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      ...extra
    },
    strict: true,
    allowPositionals: false
  }).values
}

function commonHelp() {
  return `  --exe PATH          Packaged Navio.exe (or NAVIO_TEST_EXE; required)
  --playwright PATH   Playwright package directory (or NAVIO_QA_PLAYWRIGHT)
                      Otherwise resolves the installed playwright package
  --output DIRECTORY Parent for a NEW run directory (default: OS temporary directory)
                      Must be outside this repository
  --keep-data         Retain the isolated user profile for local investigation
  --help              Show help without launching the application`
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child)
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  )
}

async function requirePath(filename, type, label) {
  const info = await fs.stat(filename).catch(() => null)
  if (!info || !(type === 'directory' ? info.isDirectory() : info.isFile())) {
    throw new Error(`${label} is missing or is not a ${type}: ${filename}`)
  }
  return fs.realpath(filename)
}

async function preflight(options) {
  if (process.platform !== 'win32') throw new Error('These packaged-app checks require Windows.')
  const input = options.exe || process.env.NAVIO_TEST_EXE
  if (!input)
    throw new Error(
      'Provide --exe PATH or NAVIO_TEST_EXE; no installed profile is selected automatically.'
    )
  const exe = await requirePath(path.resolve(input), 'file', 'Packaged executable')
  if (path.extname(exe).toLowerCase() !== '.exe') throw new Error('--exe must name Navio.exe.')
  const modulePath = options.playwright || process.env.NAVIO_QA_PLAYWRIGHT
  let electron
  try {
    electron = require(modulePath ? path.resolve(modulePath) : 'playwright')._electron
  } catch {
    throw new Error(
      'Playwright could not be loaded. Provide --playwright PATH or NAVIO_QA_PLAYWRIGHT.'
    )
  }
  if (typeof electron?.launch !== 'function')
    throw new Error('The Playwright package must expose _electron.launch.')
  // Resolve junctions before deciding where artifacts may be written.
  const output = await requirePath(
    path.resolve(options.output || os.tmpdir()),
    'directory',
    'Output parent'
  )
  if (isWithin(await fs.realpath(repository), output)) {
    throw new Error(
      'Choose an output parent outside the repository; generated profiles and screenshots are private.'
    )
  }
  return { exe, electron, output }
}

function proxyRegistry() {
  // Compare in memory only. This value can contain private proxy addresses.
  return execFileSync(
    'reg.exe',
    ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', '/s'],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000
    }
  )
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
  return `http://127.0.0.1:${server.address().port}`
}

async function closeServer(server) {
  if (!server.listening) return
  server.closeAllConnections?.()
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  )
}

async function writeIsolatedConfig(data) {
  const reservation = net.createServer()
  await listen(reservation)
  const port = reservation.address().port
  await closeServer(reservation)
  await fs.writeFile(
    path.join(data, 'config.yaml'),
    `dexOnboarding: {version: 1, status: completed}
modeSelected: true
operationMode: standard
core: mihomo
useSubStore: false
autoUpdateProfileOnStart: false
autoCheckUpdate: false
silentUpdate: false
showTraffic: false
language: zh-CN
appTheme: light
sysProxy:
  enable: false
  mode: manual
`
  )
  await fs.writeFile(
    path.join(data, 'mihomo.yaml'),
    `mixed-port: ${port}
port: 0
socks-port: 0
tun:
  enable: false
`
  )
}

async function until(fn, label, timeout = 24000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      const result = await fn()
      if (result) return result
    } catch {
      // Startup IPC can fail while the core is not ready; retry until the deadline.
    }
    await delay(200)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function runCheck(options, prepared, name, check) {
  const output = await fs.mkdtemp(path.join(prepared.output, `navio-qa-${name}-`))
  const data = path.join(output, 'user-data')
  const checked = []
  const cleanup = []
  let app,
    page,
    before,
    failure,
    details = {},
    applicationClosed = true
  try {
    before = proxyRegistry()
    await fs.mkdir(data)
    await writeIsolatedConfig(data)
    const context = {
      data,
      output,
      checked,
      cleanup: (fn) => cleanup.push(fn),
      launch: async (accountOrigin) => {
        if (app) throw new Error('An application is already running in this check.')
        if (!accountOrigin) {
          const offline = http.createServer((_request, response) => {
            response.writeHead(503, { 'Content-Type': 'application/json' })
            response.end(JSON.stringify({ error: 'QA account service is offline' }))
          })
          accountOrigin = await listen(offline)
          cleanup.push(() => closeServer(offline))
        }
        const appData = path.join(data, 'app-data')
        const localAppData = path.join(data, 'local-app-data')
        await fs.mkdir(appData)
        await fs.mkdir(localAppData)
        const env = {
          ...process.env,
          DEX_TEST_MODE: '1',
          DEX_USER_DATA: data,
          DEX_ACCOUNT_URL: accountOrigin,
          APPDATA: appData,
          LOCALAPPDATA: localAppData
        }
        delete env.ELECTRON_RUN_AS_NODE
        app = await prepared.electron.launch({ executablePath: prepared.exe, env, timeout: 30000 })
        applicationClosed = false
        const actualData = await app.evaluate(({ app, shell }, appData) => {
          // Shared SSO uses appData rather than userData. Redirect it before any login.
          app.setPath('appData', appData)
          // UI checks must never open the user's browser or an external application.
          shell.openExternal = async () => {}
          return app.getPath('userData')
        }, appData)
        assert.equal(
          path.resolve(actualData).toLowerCase(),
          path.resolve(data).toLowerCase(),
          'Application ignored DEX_USER_DATA'
        )
        page = await app.firstWindow()
        page.setDefaultTimeout(20000)
        await page.waitForFunction(() => Boolean(window.electron?.ipcRenderer))
        const ipc = async (channel, ...args) => {
          const result = await page.evaluate(
            ([channel, args]) => window.electron.ipcRenderer.invoke(channel, ...args),
            [channel, args]
          )
          if (result?.invokeError) throw new Error(result.invokeError)
          return result
        }
        return { app, page, ipc }
      }
    }
    details = (await check(context)) || {}
  } catch (error) {
    failure = error
    if (page)
      await page
        .screenshot({ path: path.join(output, 'failure.png'), timeout: 5000 })
        .catch(() => {})
  } finally {
    if (app) {
      try {
        await app.close()
        applicationClosed = true
      } catch {
        failure ||= new Error(
          'Application could not be closed; the isolated profile has been retained.'
        )
      }
    }
    for (const close of cleanup.reverse()) {
      try {
        await close()
      } catch {
        failure ||= new Error('A local test fixture could not be closed.')
      }
    }
    if (before !== undefined) {
      try {
        assert.equal(
          proxyRegistry() === before,
          true,
          'Windows system proxy registry changed during the check'
        )
        checked.push('Windows system proxy registry unchanged')
      } catch (error) {
        failure ||= error
      }
    }
    if (!options['keep-data'] && applicationClosed) {
      // Delete only this exact child of our own newly generated directory.
      assert.equal(path.dirname(data), output)
      try {
        await fs.rm(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
      } catch {
        failure ||= new Error(
          'Could not remove the isolated profile; remove it after closing the test process.'
        )
      }
    }
  }
  const report = {
    passed: !failure,
    checked,
    ...details,
    ...(failure ? { error: failure.message } : {})
  }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ ...report, output }, null, 2))
  if (failure) process.exitCode = 1
}

function mainError(error) {
  console.error(`QA check failed: ${error.message}`)
  process.exitCode = 1
}

module.exports = {
  commonHelp,
  delay,
  isWithin,
  listen,
  closeServer,
  mainError,
  preflight,
  readOptions,
  repository,
  requirePath,
  runCheck,
  until
}
