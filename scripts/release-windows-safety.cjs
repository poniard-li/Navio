const fs = require('node:fs/promises')
const { createReadStream } = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const projectRoot = path.resolve(__dirname, '..')
// The override depends on these electron-builder 26.15.7 macro definitions and ordering.
const templateHashes = {
  'installer.nsi': '8811964416d122612c3e7601728af5d3f998d677918df829a4e8b4c739c8b9f8',
  'installSection.nsh': '74c4dbb4163cdd90ca4850b75d304e916235c882d6af7b5cdad63bffbc977072',
  'include/installer.nsh': '0e319437dd01dcbf911f3f48f664fde0cefbaef704f1cdb1739f63d563f5d4a0',
  'include/extractAppPackage.nsh':
    'e4174388a0f7a1df0b85a0742aa1ea7a4b2b18f9f29dccd6ef10a66212f68148',
  'include/allowOnlyOneInstallerInstance.nsh':
    '0d4ae12cf0bd177cb85cb77680add3135108ddd21ab5730426e4600e2aaad18f'
}

async function fileHash(file) {
  const hash = crypto.createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

async function verifyInstallerTemplates(templateRoot) {
  for (const [file, expected] of Object.entries(templateHashes)) {
    if ((await fileHash(path.join(templateRoot, file))) !== expected)
      throw new Error(
        `Review the Navio installer safety override before using changed NSIS template: ${file}`
      )
  }
}

async function createPayloadManifest(directory) {
  const files = []
  async function visit(relative) {
    const entries = await fs.readdir(path.join(directory, relative), { withFileTypes: true })
    entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))
    for (const entry of entries) {
      const child = path.join(relative, entry.name)
      if (entry.isSymbolicLink())
        throw new Error(`Installer payload cannot contain links: ${child}`)
      if (entry.isDirectory()) await visit(child)
      else if (entry.isFile()) {
        const absolute = path.join(directory, child)
        files.push({
          path: child.split(path.sep).join('/'),
          size: (await fs.stat(absolute)).size,
          sha256: await fileHash(absolute)
        })
      } else throw new Error(`Unsupported installer payload entry: ${child}`)
    }
  }
  await visit('')
  for (const required of ['Navio.exe', 'resources/app.asar'])
    if (!files.some((file) => file.path === required))
      throw new Error(`Installer payload is missing ${required}`)
  return { format: 1, payloadBytes: files.reduce((sum, file) => sum + file.size, 0), files }
}

function nsisPath(value) {
  if (/["\r\n]/.test(value)) throw new Error('Unsafe NSIS include path')
  return path.resolve(value).replace(/\$/g, () => '$$')
}

async function createInstallerSafetyFiles(payload, output) {
  const templateRoot = path.join(projectRoot, 'node_modules/app-builder-lib/templates/nsis')
  await verifyInstallerTemplates(templateRoot)
  const manifest = await createPayloadManifest(payload)
  await fs.mkdir(output, { recursive: false })
  const manifestPath = path.join(output, 'payload.json')
  const overridePath = path.join(output, 'extract-override.nsh')
  const includePath = path.join(output, 'navio-installer-generated.nsh')
  await fs.writeFile(manifestPath, JSON.stringify(manifest) + '\n')
  // This is included at customCheckAppRunning, after the original macros are defined
  // and before uninstallOldVersion. No upstream template is modified or copied.
  await fs.writeFile(
    overridePath,
    `!ifmacrondef installApplicationFiles
  !error "Expected electron-builder installApplicationFiles macro is missing"
!endif
!macroundef installApplicationFiles
!macro installApplicationFiles
  !insertmacro NavioRunSafety "Install"
  ClearErrors
  File "/oname=\${UNINSTALL_FILENAME}" "\${UNINSTALLER_OUT_FILE}"
  \${If} \${Errors}
    !insertmacro NavioInstallFailure "Unable to write the uninstaller. Check available space and retry."
  \${EndIf}
  !insertmacro NavioRunSafety "VerifyInstalled"
!macroend
`
  )
  await fs.writeFile(
    includePath,
    `!define NAVIO_PAYLOAD_MANIFEST "${nsisPath(manifestPath)}"
!define NAVIO_SAFETY_HELPER "${nsisPath(path.join(__dirname, 'release-windows-install.ps1'))}"
!define NAVIO_EXTRACTION_OVERRIDE "${nsisPath(overridePath)}"
!include "${nsisPath(path.join(projectRoot, 'resources/navio-installer.nsh'))}"
`
  )
  return { includePath, manifestPath, manifest }
}

module.exports = {
  createInstallerSafetyFiles,
  createPayloadManifest,
  verifyInstallerTemplates,
  templateHashes
}
