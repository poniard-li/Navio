import { mkdtemp, mkdir, readFile, rm, writeFile, symlink, lstat, realpath } from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AdmZip from 'adm-zip'
import { parse, stringify } from '../utils/yaml'
import {
  ExternalBackupFiles,
  assertNoLinks,
  rewriteExternalRestore,
  type BackupDocument
} from './backup-external'

vi.mock('fs/promises', async (original) => {
  const actual = await original<typeof import('fs/promises')>()
  return { ...actual, lstat: vi.fn(actual.lstat), realpath: vi.fn(actual.realpath) }
})
const actualFs = await vi.importActual<typeof import('fs/promises')>('fs/promises')

function requireContent(entries: Map<string, Buffer>, name: string): Buffer {
  const content = entries.get(name)
  if (!content) throw new Error(`Missing test entry: ${name}`)
  return content
}

describe('explicit external backup scope', () => {
  let directory: string
  let root: string
  let outside: string
  let manager: ExternalBackupFiles
  const docs = (file: string, extra = {}): BackupDocument[] => [
    {
      name: 'profiles/test.yaml',
      base: path.join(root, 'work'),
      content: Buffer.from(
        stringify({ 'rule-providers': { custom: { type: 'file', path: file } }, ...extra })
      )
    }
  ]
  beforeEach(async () => {
    vi.mocked(lstat).mockImplementation(actualFs.lstat)
    vi.mocked(realpath).mockImplementation(actualFs.realpath)
    directory = await mkdtemp(path.join(os.tmpdir(), 'navio-external-test-'))
    root = path.join(directory, 'data')
    outside = path.join(directory, 'rules.yaml')
    await mkdir(root)
    await writeFile(outside, 'payload: [example.com]')
    manager = new ExternalBackupFiles(root)
  })

  async function shortNameFixture(): Promise<{
    source: string
    target: string
    sourceDirectory: string
    targetDirectory: string
  }> {
    const parent = await actualFs.realpath(directory)
    const sourceDirectory = path.join(parent, 'RUNNER~1')
    const targetDirectory = path.join(parent, 'Runner Account')
    const source = path.join(sourceDirectory, 'rules.yaml')
    const target = path.join(targetDirectory, 'rules.yaml')
    await mkdir(sourceDirectory)
    await writeFile(source, 'payload: [alias.example]')
    vi.mocked(lstat).mockImplementation((file, options) => {
      const requested = String(file)
      const mapped =
        requested === targetDirectory || requested.startsWith(targetDirectory + path.sep)
          ? sourceDirectory + requested.slice(targetDirectory.length)
          : file
      return actualFs.lstat(mapped, options)
    })
    vi.mocked(realpath).mockImplementation((file) =>
      String(file) === source || String(file) === target
        ? Promise.resolve(target)
        : actualFs.realpath(file)
    )
    return { source, target, sourceDirectory, targetDirectory }
  }
  afterEach(async () => {
    if (
      path.dirname(directory) !== os.tmpdir() ||
      !path.basename(directory).startsWith('navio-external-test-')
    )
      throw new Error('Unexpected test directory')
    await rm(directory, { recursive: true, force: true })
  })

  it('only lists recognized references, keeps exact approvals, and does not select new files', async () => {
    const other = path.join(directory, 'other.yaml')
    await writeFile(other, 'new file')
    const documents = docs(outside, {
      proxies: [{ name: 'node', 'ws-opts': { path: other }, 'private-key': 'inline-key-value' }],
      arbitrary: { path: other }
    })
    const initial = await manager.preview(documents)
    expect(initial.files).toHaveLength(1)
    expect(initial.files[0]).toMatchObject({ path: outside, approved: false, state: 'available' })
    await manager.approve(documents, initial.token, [initial.files[0].id])
    expect((await manager.preview(documents)).files[0].approved).toBe(true)
    expect((await manager.preview(docs(other))).files[0].approved).toBe(false)
    const changed = await manager.preview(docs(other))
    await manager.approve(docs(other), changed.token, [])
    expect((await manager.preview(documents)).files[0].approved).toBe(true)
    const revoke = await manager.preview(documents)
    await manager.approve(documents, revoke.token, [])
    expect((await manager.preview(documents)).files[0].approved).toBe(false)
  })

  it('rejects stale configuration and invented selections before granting access', async () => {
    const documents = docs(outside)
    const preview = await manager.preview(documents)
    await expect(
      manager.approve(docs(outside, { mode: 'global' }), preview.token, [preview.files[0].id])
    ).rejects.toThrow('已变化')
    await expect(manager.approve(documents, preview.token, ['invented'])).rejects.toThrow('列表')
    expect((await manager.preview(documents)).files[0].approved).toBe(false)
  })

  it('omits unapproved/missing files and includes only approved bytes with checksums', async () => {
    const documents = docs(outside)
    const unapproved = new AdmZip()
    await manager.append(unapproved, documents)
    expect(JSON.parse(unapproved.readAsText('external-files.json')).omitted).toHaveLength(1)
    expect(
      unapproved.getEntries().filter((e) => e.entryName.startsWith('restored-resources/'))
    ).toHaveLength(0)
    const preview = await manager.preview(documents)
    await manager.approve(documents, preview.token, [preview.files[0].id])
    const approved = new AdmZip()
    await manager.append(approved, documents)
    const manifest = JSON.parse(approved.readAsText('external-files.json'))
    expect(approved.readAsText(manifest.files[0].entry)).toBe('payload: [example.com]')
    await rm(outside)
    const missing = await manager.preview(documents)
    expect(missing.files[0]).toMatchObject({ state: 'missing', approved: true })
    const incomplete = new AdmZip()
    await manager.append(incomplete, documents)
    expect(JSON.parse(incomplete.readAsText('external-files.json')).omitted[0].reason).toBe(
      '文件不存在'
    )
  })

  it('rewrites YAML and local overlay references to contained restored resources', async () => {
    const documents = docs(outside)
    documents.push({
      name: 'profile-local/test.json',
      base: root,
      content: Buffer.from(
        JSON.stringify({
          version: 1,
          base: { 'rule-providers': { custom: { path: outside } } },
          local: { 'rule-providers': { custom: { path: outside } } }
        })
      )
    })
    const preview = await manager.preview(documents)
    await manager.approve(documents, preview.token, [preview.files[0].id])
    const zip = new AdmZip()
    for (const document of documents) zip.addFile(document.name, document.content)
    await manager.append(zip, documents)
    const entries = new Map(zip.getEntries().map((e) => [e.entryName, e.getData()]))
    const destination = path.join(directory, 'new-data')
    expect(rewriteExternalRestore(entries, destination)).toEqual([])
    const result = parse<Record<string, Record<string, { path: string }>>>(
      requireContent(entries, documents[0].name).toString()
    )
    expect(
      result['rule-providers'].custom.path.startsWith(
        path.join(destination, 'restored-resources') + path.sep
      )
    ).toBe(true)
    const overlay = JSON.parse(requireContent(entries, documents[1].name).toString())
    expect(overlay.local['rule-providers'].custom.path).toBe(result['rule-providers'].custom.path)
    expect(entries.has('external-files.json')).toBe(false)
    expect(await readFile(outside, 'utf8')).toBe('payload: [example.com]')
  })

  it('rejects traversal, corrupt resource bytes, and non-file reference rewrites', async () => {
    const documents = docs(outside, { password: outside })
    const preview = await manager.preview(documents)
    await manager.approve(documents, preview.token, [preview.files[0].id])
    const zip = new AdmZip()
    zip.addFile(documents[0].name, documents[0].content)
    await manager.append(zip, documents)
    const original = new Map(zip.getEntries().map((e) => [e.entryName, e.getData()]))
    const manifest = JSON.parse(requireContent(original, 'external-files.json').toString())
    const altered = (value: unknown): Map<string, Buffer> =>
      new Map([...original, ['external-files.json', Buffer.from(JSON.stringify(value))]])
    expect(() =>
      rewriteExternalRestore(
        altered({ ...manifest, files: [{ ...manifest.files[0], entry: '../../outside' }] }),
        root
      )
    ).toThrow('路径')
    const corrupt = new Map(original)
    corrupt.set(manifest.files[0].entry, Buffer.from('corrupted'))
    expect(() => rewriteExternalRestore(corrupt, root)).toThrow('校验')
    manifest.files[0].references[0].pointer = ['password']
    expect(() => rewriteExternalRestore(altered(manifest), root)).toThrow('引用与配置')
  })

  it('does not follow junctions for backup or restore destinations', async () => {
    const actual = path.join(directory, 'actual')
    const linked = path.join(root, 'linked')
    await mkdir(actual)
    await writeFile(path.join(actual, 'secret.yaml'), 'do not follow')
    await symlink(actual, linked, 'junction')
    await expect(assertNoLinks(path.join(linked, 'secret.yaml'))).rejects.toThrow('链接')
    const externalLink = path.join(directory, 'external-link')
    await symlink(actual, externalLink, 'junction')
    expect(
      (await manager.preview(docs(path.join(externalLink, 'secret.yaml')))).files[0].state
    ).toBe('blocked')
  })

  it('accepts verified Windows short names without approving their other spelling', async () => {
    const { source, target } = await shortNameFixture()
    const documents = docs(source)
    const preview = await manager.preview(documents)
    if (process.platform !== 'win32') {
      expect(preview.files[0].state).toBe('blocked')
      return
    }
    expect(preview.files[0]).toMatchObject({ path: source, state: 'available', approved: false })
    await manager.approve(documents, preview.token, [preview.files[0].id])
    expect((await manager.preview(docs(target))).files[0].approved).toBe(false)
    const zip = new AdmZip()
    await manager.append(zip, documents)
    const manifest = JSON.parse(zip.readAsText('external-files.json'))
    expect(manifest.omitted).toEqual([])
    expect(manifest.files).toHaveLength(1)
    expect(manifest.files[0].path).toBe(source)
    expect(zip.readAsText(manifest.files[0].entry)).toBe('payload: [alias.example]')
  })

  it.each(['file', 'large-file', 'parent', 'unknown-file', 'unknown-parent', 'unknown-device'])(
    'rejects a short-name expansion with mismatched or unknown %s identity',
    async (kind) => {
      const { source, target, sourceDirectory, targetDirectory } = await shortNameFixture()
      const previous = vi.mocked(lstat).getMockImplementation()
      if (!previous) throw new Error('Missing filesystem mock')
      vi.mocked(lstat).mockImplementation(async (file, options) => {
        const result = await previous(file, options)
        if (options?.bigint) {
          const current = String(file)
          if (
            (kind === 'file' && current === target) ||
            (kind === 'parent' && current === targetDirectory)
          )
            result.ino += 1n
          if (kind === 'large-file' && [source, target].includes(current))
            result.ino = 9007199254740992n + (current === target ? 1n : 0n)
          if (
            (kind === 'unknown-file' && [source, target].includes(current)) ||
            (kind === 'unknown-parent' && [sourceDirectory, targetDirectory].includes(current))
          )
            result.ino = 0n
          if (kind === 'unknown-device') result.dev = 0n
        }
        return result
      })
      expect((await manager.preview(docs(source))).files[0].state).toBe('blocked')
    }
  )

  it('rejects a link in the canonical path of a short-name expansion', async () => {
    const { source, targetDirectory } = await shortNameFixture()
    const previous = vi.mocked(lstat).getMockImplementation()
    if (!previous) throw new Error('Missing filesystem mock')
    vi.mocked(lstat).mockImplementation(async (file, options) => {
      const result = await previous(file, options)
      if (String(file) === targetDirectory) result.isSymbolicLink = () => true
      return result
    })
    expect((await manager.preview(docs(source))).files[0].state).toBe('blocked')
  })

  it('rechecks alias identity against the open file after reading', async () => {
    const { source, target } = await shortNameFixture()
    const documents = docs(source)
    const preview = await manager.preview(documents)
    if (process.platform !== 'win32') {
      expect(preview.files[0].state).toBe('blocked')
      return
    }
    await manager.approve(documents, preview.token, [preview.files[0].id])
    const previous = vi.mocked(lstat).getMockImplementation()
    if (!previous) throw new Error('Missing filesystem mock')
    let canonicalFileChecks = 0
    vi.mocked(lstat).mockImplementation(async (file, options) => {
      const result = await previous(file, options)
      if (String(file) === target && options?.bigint && ++canonicalFileChecks > 1) result.ino += 1n
      return result
    })
    const zip = new AdmZip()
    await manager.append(zip, documents)
    const manifest = JSON.parse(zip.readAsText('external-files.json'))
    expect(manifest.files).toEqual([])
    expect(manifest.omitted[0].reason).toContain('文件路径已变化')
  })
})
