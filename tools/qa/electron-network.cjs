const assert = require('node:assert/strict')
const { commonHelp, mainError, preflight, readOptions, runCheck } = require('./common.cjs')

function httpsUrl(input) {
  const url = new URL(input)
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new Error('Network targets must be HTTPS URLs without credentials or fragments.')
  }
  return url.href
}

async function main() {
  const options = readOptions({ url: { type: 'string' }, 'redirect-url': { type: 'string' } })
  if (options.help) {
    console.log(`Usage: node tools/qa/electron-network.cjs --exe PATH
${commonHelp()}
  --url HTTPS_URL           Reachability target (default: Navio GitHub releases)
  --redirect-url HTTPS_URL  URL expected to redirect (default: a Beta7 theme release asset)

Compares Node fetch with Electron net.fetch and net.request redirect behavior.
Electron reachability and a valid net.request HTTPS redirect are required.
Node fetch and net.fetch manual redirect are diagnostic.
No private platform source or account is needed. Requests use the current machine's network.`)
    return
  }
  const url = httpsUrl(options.url || 'https://github.com/poniard-li/Navio/releases')
  const redirectUrl = httpsUrl(
    options['redirect-url'] ||
      'https://github.com/poniard-li/Navio/releases/download/v1.0.0-beta.7/Navio-Theme-orbit-1.json'
  )
  const prepared = await preflight(options)
  await runCheck(options, prepared, 'network', async ({ checked, launch }) => {
    const { app } = await launch()
    const result = await app.evaluate(
      async ({ net, session }, { url, redirectUrl }) => {
        const check = async (name, fetcher, target, redirect = 'follow') => {
          const start = Date.now()
          try {
            const response = await fetcher(target, {
              method: 'GET',
              redirect,
              credentials: 'omit',
              signal: AbortSignal.timeout(20000)
            })
            const location = response.headers.get('location')
            let httpsRedirect = false
            if (location) {
              const destination = new URL(location, target)
              httpsRedirect =
                destination.protocol === 'https:' && !destination.username && !destination.password
            }
            await response.body?.cancel()
            return { name, status: response.status, httpsRedirect, ms: Date.now() - start }
          } catch (error) {
            // Do not emit signed redirect URLs, raw proxy settings or credential-bearing errors.
            return { name, error: error.name, code: error.cause?.code, ms: Date.now() - start }
          }
        }
        const nativeRedirect = () =>
          new Promise((resolve) => {
            const start = Date.now()
            const request = net.request({
              url: redirectUrl,
              method: 'GET',
              redirect: 'manual',
              credentials: 'omit',
              useSessionCookies: false
            })
            let finished = false
            const finish = (value) => {
              if (finished) return
              finished = true
              clearTimeout(timer)
              resolve({
                name: 'electron-request-manual-redirect',
                ms: Date.now() - start,
                ...value
              })
              request.abort()
            }
            const timer = setTimeout(() => finish({ error: 'TimeoutError' }), 20000)
            request.on('redirect', (status, _method, target) => {
              try {
                const destination = new URL(target, redirectUrl)
                finish({
                  status,
                  httpsRedirect:
                    destination.protocol === 'https:' &&
                    !destination.username &&
                    !destination.password
                })
              } catch {
                finish({ error: 'InvalidRedirect' })
              }
            })
            request.on('response', (response) => {
              response.on('error', () => {})
              finish({ status: response.statusCode, httpsRedirect: false })
            })
            request.on('error', (error) => finish({ error: error.name }))
            request.end()
          })
        const proxy = await session.defaultSession.resolveProxy(url)
        return {
          versions: {
            electron: process.versions.electron,
            node: process.versions.node,
            chrome: process.versions.chrome
          },
          systemProxyRoute: proxy.trim() === 'DIRECT' ? 'direct' : 'configured',
          checks: await Promise.all([
            check('node-fetch', globalThis.fetch, url),
            check('electron-fetch', (target, init) => net.fetch(target, init), url),
            check(
              'electron-fetch-manual-redirect',
              (target, init) => net.fetch(target, init),
              redirectUrl,
              'manual'
            ),
            nativeRedirect()
          ])
        }
      },
      { url, redirectUrl }
    )
    // Print diagnostic results before assertions so a failed network check remains actionable.
    console.log(JSON.stringify(result, null, 2))
    const electron = result.checks.find((check) => check.name === 'electron-fetch')
    assert.ok(
      electron.status >= 200 && electron.status < 300,
      'Electron could not reach the HTTPS target'
    )
    const redirect = result.checks.find(
      (check) => check.name === 'electron-request-manual-redirect'
    )
    assert.ok(
      [301, 302, 303, 307, 308].includes(redirect.status) && redirect.httpsRedirect,
      'Release asset did not return an HTTPS redirect'
    )
    checked.push('Electron HTTPS request succeeds; release asset returns an HTTPS manual redirect')
    checked.push(
      'Node fetch and net.fetch manual redirect recorded for comparison; neither is the native redirect success criterion'
    )
    return result
  })
}

main().catch(mainError)
