import { mkdtemp, mkdir, readFile, rm, writeFile, symlink } from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import AdmZip from 'adm-zip'
import { parse, stringify } from '../utils/yaml'
import {
  ExternalBackupFiles,
  assertNoLinks,
  rewriteExternalRestore,
  type BackupDocument
} from './backup-external'

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
    directory = await mkdtemp(path.join(os.tmpdir(), 'navio-external-test-'))
    root = path.join(directory, 'data')
    outside = path.join(directory, 'rules.yaml')
    await mkdir(root)
    await writeFile(outside, 'payload: [example.com]')
    manager = new ExternalBackupFiles(root)
  })
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
})
