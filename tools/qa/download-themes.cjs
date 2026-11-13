const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { commonHelp, mainError, preflight, readOptions, runCheck } = require('./common.cjs')

async function main() {
  const options = readOptions()
  if (options.help) {
    console.log(`Usage: node tools/qa/download-themes.cjs --exe PATH
${commonHelp()}

Downloads all non-built-in themes through the packaged application's production IPC.
Requires public GitHub access; no private platform source or account is needed.`)
    return
  }
  const prepared = await preflight(options)
  await runCheck(options, prepared, 'themes', async ({ data, checked, launch }) => {
    const { ipc } = await launch()
    const initial = await ipc('dexThemes', 'officialCatalog')
    assert.equal(initial.themes.length, 24, 'Beta7 catalog should contain 24 themes')
    assert.equal(initial.themes.filter((theme) => theme.builtIn).length, 6)
    const downloadable = initial.themes.filter((theme) => !theme.builtIn)
    assert.ok(
      downloadable.every((theme) => !theme.installed),
      'Fresh profile must not skip downloads using an existing cache'
    )
    for (let offset = 0; offset < downloadable.length; offset += 3) {
      await Promise.all(
        downloadable.slice(offset, offset + 3).map(async (theme) => {
          await ipc('dexThemes', 'installOfficial', { id: theme.id })
          assert.match(theme.id, /^[a-z0-9-]+$/)
          const value = JSON.parse(
            await fs.readFile(path.join(data, 'dex-library/official', `${theme.id}.json`), 'utf8')
          )
          assert.ok(
            value.variants?.dark && value.variants?.light,
            `${theme.id}: missing appearance variants`
          )
        })
      )
    }
    // list() reopens each cache entry and runs the application's size/hash/schema validation.
    const catalog = await ipc('dexThemes', 'officialCatalog')
    assert.equal(catalog.themes.length, initial.themes.length)
    assert.ok(catalog.themes.every((theme) => theme.installed && !theme.cacheError))
    checked.push('All 18 official packages downloaded through production IPC into an empty cache')
    checked.push(
      'All 24 entries available; downloaded package hashes/schema and light/dark variants validated'
    )
    return { downloaded: downloadable.length, available: catalog.themes.length }
  })
}

main().catch(mainError)
