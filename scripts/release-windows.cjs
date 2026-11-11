const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { createInstallerSafetyFiles } = require('./release-windows-safety.cjs')

const projectRoot = path.resolve(__dirname, '..')

function overlaps(left, right) {
  const contains = (base, target) => {
    const relative = path.relative(base, target)
    return (
      relative === '' ||
      (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
    )
  }
  return contains(left, right) || contains(right, left)
}

async function resolveFuturePath(value) {
  const absolute = path.resolve(value)
  try {
    return await fs.realpath(absolute)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    return path.join(await resolveFuturePath(path.dirname(absolute)), path.basename(absolute))
  }
}

async function validatePaths(referenceArg, outputArg, workArg) {
  const [reference, output, work, root] = await Promise.all(
    [referenceArg, outputArg, workArg, projectRoot].map(resolveFuturePath)
  )
  for (const target of [output, work]) {
    if (overlaps(target, reference) || overlaps(target, root))
      throw new Error(
        'Release and work directories must be separate from the source and reference runtime.'
      )
    try {
      await fs.lstat(target)
      throw new Error(`Use a new directory; this path already exists: ${target}`)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  if (overlaps(output, work)) throw new Error('Release and work directories must be separate.')
  await fs.access(path.join(reference, 'resources/app.asar'))
  return { reference, output, work }
}

function builderConfig(output, version, safetyInclude) {
  return {
    appId: 'studio.dex.desktop',
    productName: 'Navio',
    directories: { output, buildResources: path.join(projectRoot, 'resources') },
    npmRebuild: false,
    forceCodeSigning: false,
    publish: [],
    win: {
      icon: path.join(projectRoot, 'resources/icon.ico'),
      executableName: 'Navio',
      signExecutable: false,
      artifactName: `Navio-v${version}-Windows-x64-portable.zip`
    },
    nsis: {
      include: safetyInclude || path.join(projectRoot, 'resources/navio-installer.nsh'),
      artifactName: `Navio-v${version}-Windows-x64-setup.exe`,
      oneClick: false,
      perMachine: false,
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: 'always',
      deleteAppDataOnUninstall: false,
      runAfterFinish: false,
      packElevateHelper: false,
      useZip: false,
      preCompressedFileExtensions: []
    }
  }
}

function run(script, args = []) {
  const result = spawnSync(process.execPath, [path.join(projectRoot, script), ...args], {
    cwd: projectRoot,
    stdio: 'inherit',
    windowsHide: true
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${script} failed with exit code ${result.status}.`)
}

async function sha256(file) {
  return crypto
    .createHash('sha256')
    .update(await fs.readFile(file))
    .digest('hex')
}

async function main(args) {
  if (process.platform !== 'win32')
    throw new Error('Windows release packaging must run on Windows.')
  const skipBuild = args.includes('--skip-build')
  const positional = args.filter((arg) => arg !== '--skip-build')
  if (positional.length !== 3 || positional.some((arg) => arg.startsWith('--')))
    throw new Error(
      'Usage: node scripts/release-windows.cjs <extracted-party-portable> <new-release-dir> <new-work-dir> [--skip-build]'
    )
  const { reference, output, work } = await validatePaths(...positional)
  const pkg = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8'))
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(pkg.version)) throw new Error('Invalid release version.')
  if (!skipBuild) run('scripts/build-native.mjs')
  await fs.mkdir(work, { recursive: true })
  const portable = path.join(work, 'portable')
  const installer = path.join(work, 'installer')
  const artifacts = path.join(work, 'artifacts')
  run('scripts/package-pinned.cjs', [reference, portable, path.join(work, 'runtime')])
  await fs.writeFile(path.join(portable, 'PORTABLE'), '')
  await fs.cp(portable, installer, {
    recursive: true,
    filter: (source) => source !== path.join(portable, 'PORTABLE')
  })
  for (const directory of [portable, installer]) {
    for (const name of ['data', 'DEX-STUDIO-NEXT']) {
      try {
        await fs.lstat(path.join(directory, name))
        throw new Error(`User data must not be packaged: ${name}`)
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
    }
  }
  const { build, Platform, Arch } = require('electron-builder')
  const safety = await createInstallerSafetyFiles(installer, path.join(work, 'installer-safety'))
  const config = builderConfig(artifacts, pkg.version, safety.includePath)
  await build({
    projectDir: projectRoot,
    prepackaged: installer,
    targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64),
    publish: 'never',
    config
  })
  await build({
    projectDir: projectRoot,
    prepackaged: portable,
    targets: Platform.WINDOWS.createTarget(['zip'], Arch.x64),
    publish: 'never',
    config
  })
  const names = [
    `Navio-v${pkg.version}-Windows-x64-setup.exe`,
    `Navio-v${pkg.version}-Windows-x64-portable.zip`
  ]
  const AdmZip = require('adm-zip')
  const archive = new AdmZip(path.join(artifacts, names[1]))
  for (const name of ['PORTABLE', 'Navio.exe', 'resources/app.asar']) {
    if (!archive.getEntry(name)) throw new Error(`Portable archive is missing ${name}.`)
  }
  const exeHash = await sha256(path.join(portable, 'Navio.exe'))
  if (crypto.createHash('sha256').update(archive.readFile('Navio.exe')).digest('hex') !== exeHash)
    throw new Error('Portable executable does not match the packaged runtime.')
  if ((await sha256(path.join(installer, 'Navio.exe'))) !== exeHash)
    throw new Error('Installer and portable executables differ.')
  if (
    (await sha256(path.join(installer, 'resources/app.asar'))) !==
    (await sha256(path.join(portable, 'resources/app.asar')))
  )
    throw new Error('Installer and portable application archives differ.')
  const setupHeader = await fs.open(path.join(artifacts, names[0]), 'r')
  try {
    const header = Buffer.alloc(2)
    await setupHeader.read(header, 0, 2, 0)
    if (header.toString() !== 'MZ') throw new Error('Installer is not a Windows executable.')
  } finally {
    await setupHeader.close()
  }
  const files = await Promise.all(
    names.map(async (name) => ({
      name,
      size: (await fs.stat(path.join(artifacts, name))).size,
      sha256: await sha256(path.join(artifacts, name))
    }))
  )
  const manifest = {
    product: 'Navio',
    version: pkg.version,
    signed: false,
    architecture: 'x64',
    createdAt: new Date().toISOString(),
    applicationSha256: exeHash,
    installerDataDirectory: '%APPDATA%\\DEX-STUDIO-NEXT',
    portableDataDirectory: '<program directory>\\DEX-STUDIO-NEXT',
    files
  }
  await fs.mkdir(path.dirname(output), { recursive: true })
  await fs.mkdir(output)
  for (const name of names) await fs.copyFile(path.join(artifacts, name), path.join(output, name))
  await fs.writeFile(
    path.join(output, 'SHA256SUMS.txt'),
    files.map((file) => `${file.sha256}  ${file.name}`).join('\n') + '\n'
  )
  await fs.writeFile(
    path.join(output, 'RELEASE-MANIFEST.json'),
    JSON.stringify(manifest, null, 2) + '\n'
  )
  console.log(JSON.stringify({ output, ...manifest }, null, 2))
}

module.exports = { overlaps, validatePaths, builderConfig }
if (require.main === module)
  main(process.argv.slice(2)).catch((error) => {
    console.error(error)
    process.exitCode = 1
    // Preserve the failure status through electron-builder's cleanup handlers.
    process.on('exit', () => {
      process.exitCode = 1
    })
  })
