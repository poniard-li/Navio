// D.E.X STUDIO: repackage the pinned, supplied Windows runtime with rebuilt code.
const fs = require('node:fs/promises')
const fss = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const asar = require('@electron/asar')
const ResEdit = require('resedit')
const PE = require('pe-library')
const root = path.resolve(__dirname, '..')
const [referenceArg, outputArg, stageArg] = process.argv.slice(2)
if (!referenceArg || !outputArg || !stageArg)
  throw new Error(
    'Usage: node scripts/package-pinned.cjs <extracted-party-portable> <new-output-dir> <work-dir>'
  )
const reference = path.resolve(referenceArg),
  output = path.resolve(outputArg),
  stage = path.resolve(stageArg)
const isInside = (base, target) => {
  const rel = path.relative(base, target)
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel)
}
if (
  reference === output ||
  isInside(reference, output) ||
  root === output ||
  isInside(root, output)
)
  throw new Error('Output must be separate from reference and source')
if (
  stage === root ||
  stage === reference ||
  stage === output ||
  isInside(stage, root) ||
  isInside(stage, reference) ||
  isInside(stage, output)
)
  throw new Error('Unsafe staging directory')
const excludedData = new Set([
  'ASN.mmdb',
  'country.mmdb',
  'geoip.dat',
  'geoip.metadb',
  'geosite.dat',
  'BundleMRS.7z'
])
const hash = (p) => crypto.createHash('sha256').update(fss.readFileSync(p)).digest('hex')
;(async () => {
  const pins = JSON.parse(await fs.readFile(path.join(root, 'PINNED-RESOURCES.json'), 'utf8'))
  if (hash(path.join(reference, 'resources/app.asar')) !== pins.sourceRuntimeAsarSha256)
    throw new Error('Reference runtime does not match the pinned Clash Party 2.0.4 package')
  for (const pin of pins.sidecars) {
    if (hash(path.join(root, 'extra/sidecar', pin.file)) !== pin.sha256)
      throw new Error(`Pinned resource mismatch: ${pin.file}`)
  }
  if (!fss.existsSync(path.join(root, 'out/main/index.js')))
    throw new Error('Build the application first')
  await fs.mkdir(stage, { recursive: true })
  const appStage = path.join(stage, 'app')
  if (!isInside(stage, appStage)) throw new Error('Invalid app staging path')
  if (!fss.existsSync(appStage))
    asar.extractAll(path.join(reference, 'resources/app.asar'), appStage)
  const oldOut = path.join(appStage, 'out')
  if (!isInside(appStage, oldOut)) throw new Error('Invalid out path')
  await fs.rm(oldOut, { recursive: true, force: true })
  await fs.cp(path.join(root, 'out'), oldOut, { recursive: true })
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
  delete pkg.devDependencies
  delete pkg.scripts
  await fs.writeFile(path.join(appStage, 'package.json'), JSON.stringify(pkg, null, 2))
  for (const file of [
    'LICENSE',
    'DEX-THIRD-PARTY-NOTICES.txt',
    'DEX-BUILD.txt',
    'NATIVE-BUILD.txt',
    'PINNED-RESOURCES.json',
    'Navio-使用说明.txt',
    'Navio-验证记录.txt'
  ]) {
    if (fss.existsSync(path.join(root, file)))
      await fs.copyFile(path.join(root, file), path.join(appStage, file))
  }
  await fs.mkdir(output, { recursive: true })
  if (fss.existsSync(path.join(root, 'third-party'))) {
    await fs.cp(path.join(root, 'third-party'), path.join(appStage, 'third-party'), {
      recursive: true
    })
    await fs.cp(path.join(root, 'third-party'), path.join(output, 'third-party'), {
      recursive: true
    })
  }
  for (const entry of await fs.readdir(reference, { withFileTypes: true })) {
    if (['resources', 'data', 'DEX-STUDIO-NEXT', 'Clash Party.exe'].includes(entry.name)) continue
    await fs.cp(path.join(reference, entry.name), path.join(output, entry.name), {
      recursive: true
    })
  }
  await fs.mkdir(path.join(output, 'resources'), { recursive: true })
  for (const dir of ['files', 'sidecar']) {
    await fs.cp(path.join(root, 'extra', dir), path.join(output, 'resources', dir), {
      recursive: true,
      filter: (source) => dir !== 'files' || !excludedData.has(path.basename(source))
    })
  }
  // Refuse stale files when reusing an output directory; never publish archived Geo snapshots.
  for (const file of excludedData) {
    const target = path.join(output, 'resources/files', file)
    if (fss.existsSync(target))
      throw new Error(
        `Output contains excluded archived data: ${file}; use a fresh output directory`
      )
  }
  if (fss.existsSync(path.join(reference, 'resources/app.asar.unpacked')))
    await fs.cp(
      path.join(reference, 'resources/app.asar.unpacked'),
      path.join(output, 'resources/app.asar.unpacked'),
      { recursive: true }
    )
  await asar.createPackage(appStage, path.join(output, 'resources/app.asar'))
  const exe = PE.NtExecutable.from(await fs.readFile(path.join(reference, 'Clash Party.exe')), {
    ignoreCert: true
  })
  const resources = PE.NtExecutableResource.from(exe)
  const icon = ResEdit.Data.IconFile.from(await fs.readFile(path.join(root, 'resources/icon.ico')))
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries)
  for (const group of groups)
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
      resources.entries,
      group.id,
      group.lang,
      icon.icons.map((i) => i.data)
    )
  for (const vi of ResEdit.Resource.VersionInfo.fromEntries(resources.entries)) {
    const versionParts = pkg.version
      .split(/[.-]/)
      .filter((part) => /^\d+$/.test(part))
      .map(Number)
    vi.setFileVersion(...versionParts.slice(0, 4))
    vi.setProductVersion(...versionParts.slice(0, 4))
    for (const lang of vi.getAvailableLanguages())
      vi.setStringValues(lang, {
        CompanyName: 'D.E.X Studio',
        FileDescription: pkg.productName,
        ProductName: pkg.productName,
        InternalName: pkg.productName,
        OriginalFilename: `${pkg.productName}.exe`,
        LegalCopyright: 'D.E.X STUDIO; Clash Party and other open-source contributors',
        ProductVersion: pkg.version
      })
    vi.outputToResourceEntries(resources.entries)
  }
  resources.outputResource(exe)
  await fs.writeFile(path.join(output, `${pkg.productName}.exe`), Buffer.from(exe.generate()))
  const sidecars = []
  for (const file of await fs.readdir(path.join(output, 'resources/sidecar')))
    sidecars.push({ file, sha256: hash(path.join(output, 'resources/sidecar', file)) })
  const manifest = {
    product: pkg.productName,
    version: pkg.version,
    upstreamClient: 'Clash Party 2.0.4',
    stableCore: 'Mihomo v1.19.32',
    optionalCores: pins.optionalCores,
    sourceRuntimeAsarSha256: hash(path.join(reference, 'resources/app.asar')),
    sidecars,
    excludedArchivedData: [...excludedData],
    dataProvisioning:
      'User-initiated HTTPS download from configured geox-url sources; no historic GeoIP/ASN/domain data bundled'
  }
  await fs.writeFile(
    path.join(output, 'DEX-BUILD-MANIFEST.json'),
    JSON.stringify(manifest, null, 2)
  )
  for (const file of [
    'LICENSE',
    'DEX-THIRD-PARTY-NOTICES.txt',
    'DEX-BUILD.txt',
    'NATIVE-BUILD.txt',
    'PINNED-RESOURCES.json',
    'Navio-使用说明.txt',
    'Navio-验证记录.txt'
  ])
    if (fss.existsSync(path.join(root, file)))
      await fs.copyFile(path.join(root, file), path.join(output, file))
  console.log(JSON.stringify({ output, version: pkg.version, sidecars: sidecars.length }))
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
