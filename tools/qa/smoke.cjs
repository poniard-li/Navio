const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const http = require('node:http')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const {
  closeServer,
  commonHelp,
  delay,
  listen,
  mainError,
  preflight,
  readOptions,
  repository,
  requirePath,
  runCheck,
  until
} = require('./common.cjs')

// Synthetic fixture identity. Never replace this with a production account.
const fixture = { identifier: 'smoke-owner', password: 'isolated-smoke-password-123' }

async function main() {
  const options = readOptions({
    platform: { type: 'string' },
    'theme-packages': { type: 'string' },
    'download-themes': { type: 'boolean', default: false }
  })
  if (options.help) {
    console.log(`Usage: node tools/qa/smoke.cjs --exe PATH --platform DIRECTORY
${commonHelp()}
  --platform DIR       Private D.E.X platform source (or NAVIO_QA_PLATFORM; required)
  --theme-packages DIR  Local theme fixtures (default: scripts/theme-packages in this checkout)
  --download-themes     Download themes through production IPC instead of seeding local fixtures

Requires a compatible private platform checkout; it is not included in this repository.
This starts an isolated application and local core. System proxy and TUN stay disabled.`)
    return
  }
  const platformInput = options.platform || process.env.NAVIO_QA_PLATFORM
  if (!platformInput)
    throw new Error(
      'Full smoke requires --platform DIRECTORY or NAVIO_QA_PLATFORM. The private platform is not bundled. Use download-themes.cjs or electron-network.cjs for checks without it.'
    )
  const platform = await requirePath(
    path.resolve(platformInput),
    'directory',
    'Private platform source'
  )
  for (const name of ['app.mjs', 'database.mjs', 'config.mjs', 'security.mjs']) {
    await requirePath(
      path.join(platform, 'server', name),
      'file',
      `Private platform server/${name}`
    )
  }
  const publicDirectory = await requirePath(
    path.join(platform, 'public'),
    'directory',
    'Private platform public assets'
  )
  const prepared = await preflight(options)
  const load = (name) => import(pathToFileURL(path.join(platform, 'server', name)).href)
  // Resolve private dependencies before creating artifacts or launching Electron.
  const [{ createApp }, { openDatabase }, { configFromEnv }, { passwordHash, now }] =
    await Promise.all([
      load('app.mjs'),
      load('database.mjs'),
      load('config.mjs'),
      load('security.mjs')
    ])
  for (const value of [createApp, openDatabase, configFromEnv, passwordHash, now])
    assert.equal(typeof value, 'function', 'Private platform API is incompatible')
  const packages = options['download-themes']
    ? null
    : await requirePath(
        path.resolve(options['theme-packages'] || path.join(repository, 'scripts/theme-packages')),
        'directory',
        'Local theme packages'
      )

  await runCheck(options, prepared, 'smoke', async ({ data, output, checked, cleanup, launch }) => {
    const db = openDatabase(':memory:')
    let server,
      serverClosed = false
    cleanup(async () => {
      if (serverClosed) return
      if (server) await server.close()
      else db.close()
    })
    // Explicit object: never load .env or inherit real provider/relay credentials.
    const config = configFromEnv({
      DEX_DATA_DIR: path.join(data, 'server'),
      DEX_DOWNLOADS_DIR: path.join(data, 'server/downloads'),
      DEX_PUBLIC_DIR: publicDirectory
    })
    db.prepare(
      'INSERT INTO users(id,username,display_name,email,password_hash,role,created_at) VALUES(?,?,?,?,?,?,?)'
    ).run(
      'smoke-owner',
      fixture.identifier,
      'Navio 验证账号',
      'smoke@example.test',
      await passwordHash(fixture.password),
      'owner',
      now()
    )
    server = createApp({ db, config })
    const origin = await listen(server.server)
    config.allowedOrigins.add(origin)
    config.accountOrigin = origin
    const subscription = `hosts:
  direct.navio.test: 127.0.0.1
  proxied.navio.test: 127.0.0.1
proxies: []
proxy-groups:
  - name: LOCAL-CHECK
    type: select
    proxies: [DIRECT, REJECT]
rules:
  - MATCH,LOCAL-CHECK
dns:
  enable: false
`
    const echo = http.createServer((request, response) =>
      response.end(request.url === '/subscription' ? subscription : 'Navio real forwarding passed')
    )
    const echoOrigin = await listen(echo)
    cleanup(() => closeServer(echo))
    const { app, page, ipc } = await launch(origin)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.locator('.navio-auth').waitFor()
    checked.push('First launch requires a D.E.X account')
    await ipc('dexAccountAction', 'login', fixture)
    await page.evaluate(() => window.dispatchEvent(new Event('dex-account-updated')))
    await page.locator('.dex-shell').waitFor()
    assert.equal((await ipc('getDexAccount')).status, 'online')
    checked.push('Synthetic account logs in against an isolated local platform')
    await until(async () => (await ipc('mihomoProxies')).proxies?.DIRECT, 'initial core')
    await delay(500)
    await ipc('addProfileItem', {
      name: '本地功能验证',
      type: 'remote',
      url: `${echoOrigin}/subscription`,
      autoUpdate: false,
      interval: 0
    })
    const profile = await ipc('getProfileConfig')
    assert.ok(profile.items.length)
    if (!profile.current) await ipc('changeCurrentProfile', profile.items[0].id)
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.send('profileConfigUpdated')
    )
    await until(
      async () => (await ipc('mihomoProxies')).proxies?.['LOCAL-CHECK'],
      'fixture subscription'
    )
    const core = await ipc('getControledMihomoConfig')
    assert.equal(core.tun.enable, false)
    assert.equal((await ipc('getAppConfig')).sysProxy.enable, false)
    const requestVia = (host) =>
      new Promise((resolve, reject) => {
        const target = new URL(echoOrigin)
        target.hostname = host
        target.pathname = '/check'
        const request = http.get(
          {
            host: '127.0.0.1',
            port: core['mixed-port'],
            path: target.href,
            headers: { Host: target.host },
            timeout: 5000
          },
          (response) => {
            let body = ''
            response.on('data', (chunk) => {
              body += chunk
            })
            response.on('error', reject)
            response.on('end', () =>
              response.statusCode === 200
                ? resolve(body)
                : reject(new Error(`Fixture HTTP ${response.statusCode}`))
            )
          }
        )
        request.on('error', reject)
        request.on('timeout', () => request.destroy(new Error('Fixture forwarding timeout')))
      })
    assert.equal(await requestVia('127.0.0.1'), 'Navio real forwarding passed')
    checked.push('Real Mihomo subscription import and loopback forwarding; TUN/system proxy off')
    await ipc('patchControledMihomoConfig', { mode: 'global' })
    await ipc('mihomoChangeProxy', 'GLOBAL', 'REJECT')
    await ipc('saveDexBypass', {
      enabled: true,
      presets: [],
      processes: [],
      domains: ['direct.navio.test']
    })
    assert.equal(await requestVia('direct.navio.test'), 'Navio real forwarding passed')
    await assert.rejects(requestVia('proxied.navio.test'))
    assert.equal((await ipc('getControledMihomoConfig')).mode, 'global')
    await ipc('patchControledMihomoConfig', { mode: 'rule' })
    assert.equal(await requestVia('proxied.navio.test'), 'Navio real forwarding passed')
    await ipc('saveDexBypass', { enabled: false, presets: [], processes: [], domains: [] })
    checked.push('Global exception DIRECT vs non-exception REJECT; rule routing restored')
    const go = async (route) => {
      await page.evaluate((route) => {
        location.hash = route
      }, route)
      await delay(350)
      assert.equal(
        (await page.locator('body').innerText()).includes('Unexpected Application Error'),
        false,
        route
      )
    }
    const screenshot = (name) => page.screenshot({ path: path.join(output, `${name}.png`) })
    await go('/home')
    await screenshot('home')
    for (const route of [
      '/proxies',
      '/profiles',
      '/rules',
      '/connections',
      '/logs',
      '/sysproxy',
      '/tun',
      '/mihomo',
      '/dns',
      '/sniffer',
      '/resources',
      '/override',
      '/traffic',
      '/settings',
      '/network',
      '/help',
      '/bypass',
      '/dex-themes',
      '/account'
    ])
      await go(route)
    checked.push('19 feature routes render without route errors')
    const { themes } = await ipc('dexThemes', 'officialCatalog')
    assert.equal(themes.length, 24)
    assert.equal(themes.filter((theme) => theme.builtIn).length, 6)
    const themeDirectory = path.join(data, 'dex-library/official')
    await fs.mkdir(themeDirectory, { recursive: true })
    for (const theme of themes.filter((theme) => !theme.builtIn)) {
      if (options['download-themes']) await ipc('dexThemes', 'installOfficial', { id: theme.id })
      else {
        assert.match(theme.id, /^[a-z0-9-]+$/)
        assert.equal(path.basename(theme.filename), theme.filename)
        await fs.copyFile(
          path.join(packages, theme.filename),
          path.join(themeDirectory, `${theme.id}.json`)
        )
      }
    }
    const cached = await ipc('dexThemes', 'officialCatalog')
    assert.equal(cached.themes.filter((theme) => theme.installed && !theme.cacheError).length, 24)
    checked.push(
      options['download-themes']
        ? '18 themes downloaded and validated through production IPC'
        : '18 repository theme fixtures seeded and validated; no download claim'
    )
    const original = (await ipc('getAppConfig')).customTheme
    for (const theme of cached.themes) {
      await ipc('dexThemes', 'trial', { id: theme.id })
      await go('/home')
      assert.equal((await ipc('dexThemes', 'trialState')).id, theme.id)
      await ipc('dexThemes', 'restoreTrial')
      assert.equal((await ipc('getAppConfig')).customTheme, original)
    }
    checked.push('24 whole-window theme trials restore the original theme')
    await ipc('dexThemes', 'trial', { id: cached.themes[0].id })
    await ipc('dexThemes', 'keepTrial')
    await go('/dex-themes')
    await delay(700)
    await screenshot('theme-workshop')
    await go('/home')
    await page.keyboard.press('Control+k')
    await page.getByPlaceholder('搜索功能、节点、订阅或操作').waitFor()
    await page.keyboard.press('Escape')
    checked.push('Ctrl+K palette opens and dismisses')
    await page.evaluate(() => window.dispatchEvent(new Event('navio:open-material')))
    await page.getByRole('dialog').waitFor()
    await delay(700)
    await screenshot('material-settings')
    await page.keyboard.press('Escape')
    assert.ok(await ipc('getMotionEnvironment'))
    assert.ok((await ipc('getNavioTrafficState')).timestamp)
    checked.push('Live traffic and motion IPC available')
    await go('/help')
    await screenshot('help')
    await ipc('setOperationMode', 'simple')
    await go('/home')
    assert.equal((await ipc('getProfileConfig')).current, profile.current || profile.items[0].id)
    assert.ok((await ipc('getSimpleConfig')).published)
    await ipc('setOperationMode', 'standard')
    checked.push('Simple and standard modes preserve the active subscription')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 600))
    await go('/home')
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await screenshot('small-window')
    checked.push('800x600 home has no horizontal overflow')
    assert.deepEqual(errors, [])
    await server.close()
    serverClosed = true
    assert.equal((await ipc('getDexAccount')).status, 'offline')
    checked.push('Local server outage preserves offline login')
    return { routeCount: 19, themeCount: 24 }
  })
}

main().catch(mainError)
