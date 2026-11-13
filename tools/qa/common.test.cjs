const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const test = require('node:test')
const { isWithin, requirePath } = require('./common.cjs')

const env = { ...process.env, NAVIO_TEST_EXE: '', NAVIO_QA_PLATFORM: '', NAVIO_QA_PLAYWRIGHT: '' }
const invoke = (name, args = []) =>
  spawnSync(process.execPath, [path.join(__dirname, name), ...args], {
    env,
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true
  })

test('output containment distinguishes siblings and parent traversal', () => {
  const base = path.resolve('qa-repository')
  assert.equal(isWithin(base, base), true)
  assert.equal(isWithin(base, path.join(base, 'reports')), true)
  assert.equal(isWithin(base, `${base}-other`), false)
  assert.equal(isWithin(base, path.dirname(base)), false)
})

test('path validation checks the requested file type without creating anything', async () => {
  assert.equal(await requirePath(__filename, 'file', 'Fixture'), __filename)
  await assert.rejects(requirePath(__filename, 'directory', 'Fixture'), /not a directory/)
  await assert.rejects(
    requirePath(path.join(__dirname, 'not-a-real-qa-fixture'), 'file', 'Fixture'),
    /missing/
  )
})

for (const name of ['smoke.cjs', 'download-themes.cjs', 'electron-network.cjs']) {
  test(`${name} help needs neither executable nor private service`, () => {
    const result = invoke(name, ['--help'])
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Usage:/)
  })
  test(`${name} fails fast without required input`, () => {
    const result = invoke(name)
    assert.equal(result.status, 1, result.stderr)
    assert.match(
      result.stderr,
      name === 'smoke.cjs' ? /Full smoke requires --platform/ : /Provide --exe|require Windows/
    )
    assert.equal(result.stdout, '')
  })
}
