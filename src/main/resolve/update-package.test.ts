import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import path from 'path'
import { tmpdir } from 'os'
import AdmZip from 'adm-zip'
import { afterEach, expect, it } from 'vitest'
import { stagePortableUpdate, selectUpdateArtifact } from './update-package'
let root: string
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true })
})
function archive(): AdmZip {
  const zip = new AdmZip(),
    exe = Buffer.alloc(128)
  exe.write('MZ')
  exe.writeUInt32LE(64, 60)
  exe.write('PE\0\0', 64)
  exe.writeUInt16LE(0x8664, 68)
  zip.addFile('Navio.exe', exe)
  zip.addFile('resources/app.asar', Buffer.from('app'))
  zip.addFile('PORTABLE', Buffer.alloc(0))
  return zip
}
async function stage(zip: AdmZip): Promise<void> {
  root = await mkdtemp(path.join(tmpdir(), 'navio-package-test-'))
  await writeFile(path.join(root, 'update.zip'), zip.toBuffer())
  return stagePortableUpdate(path.join(root, 'update.zip'), path.join(root, 'stage'))
}
it('extracts a valid root-level x64 package', async () => {
  await stage(archive())
  expect(await readFile(path.join(root, 'stage/resources/app.asar'), 'utf8')).toBe('app')
})
it('rejects a package containing user data', async () => {
  const zip = archive()
  zip.addFile('DEX-STUDIO-NEXT/config.yaml', Buffer.from('private'))
  await expect(stage(zip)).rejects.toThrow('不安全')
})
it('rejects a 32-bit or corrupt executable', async () => {
  const zip = archive()
  zip.updateFile('Navio.exe', Buffer.from('MZ'))
  await expect(stage(zip)).rejects.toThrow('有效')
})
it('rejects Windows device names', async () => {
  const zip = archive()
  zip.addFile('nul.txt', Buffer.from('bad'))
  await expect(stage(zip)).rejects.toThrow('不安全')
})
it('rejects an untrusted or mismatched artifact before download', () => {
  expect(() =>
    selectUpdateArtifact(
      {
        version: '1.0.0',
        notes: '',
        url: 'https://example.com/file.zip',
        sha256: '0'.repeat(64),
        size: 1
      },
      true
    )
  ).toThrow('地址')
})
