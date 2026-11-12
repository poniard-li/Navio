const fs = require('node:fs/promises')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')

async function buildWindowsService() {
  if (process.platform !== 'win32') throw new Error('Build the Windows service on Windows.')
  const output = path.join(root, 'extra/windows-service')
  const compiler = path.join(
    process.env.WINDIR || 'C:/Windows',
    'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
  )
  const pins = JSON.parse(await fs.readFile(path.join(root, 'PINNED-RESOURCES.json'), 'utf8'))
  const hashes = pins.sidecars.filter((entry) => /^mihomo(?:-alpha|-smart)?\.exe$/.test(entry.file))
  if (hashes.length !== 3 || hashes.some((entry) => !/^[a-f0-9]{64}$/.test(entry.sha256)))
    throw new Error('Invalid service core pins.')
  await fs.mkdir(output, { recursive: true })
  const generated = path.join(output, 'ServiceCoreHashes.cs')
  await fs.writeFile(
    generated,
    'using System.Collections.Generic;\ninternal static class ServiceCoreHashes { internal static readonly Dictionary<string, string> Values = new Dictionary<string, string> {\n' +
      hashes.map((entry) => `{ "${entry.file}", "${entry.sha256}" }`).join(',\n') +
      '\n}; }\n'
  )
  const executable = path.join(output, 'NavioService.exe')
  const result = spawnSync(
    compiler,
    [
      '/nologo',
      '/optimize+',
      '/target:exe',
      '/platform:x64',
      '/out:' + executable,
      '/reference:System.ServiceProcess.dll',
      '/reference:System.Web.Extensions.dll',
      path.join(root, 'src/native/windows-service/NavioService.cs'),
      generated
    ],
    { stdio: 'inherit', windowsHide: true }
  )
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error('Windows service compilation failed.')
  await fs.unlink(generated)
  const tests = spawnSync(executable, ['self-test'], { stdio: 'inherit', windowsHide: true })
  if (tests.error) throw tests.error
  if (tests.status !== 0) throw new Error('Windows service policy tests failed.')
  return executable
}

if (require.main === module)
  buildWindowsService().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
module.exports = { buildWindowsService }
