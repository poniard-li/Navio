import { createHash, randomUUID } from 'crypto'
import { lstat, open, readFile, realpath } from 'fs/promises'
import path from 'path'
import type AdmZip from 'adm-zip'
import type {
  BackupExternalFile,
  BackupExternalPreview,
  BackupFileReference
} from '../../shared/backup-external'
import { atomicWriteFile, WriteQueue } from '../utils/safeFile'
import { parse, stringify } from '../utils/yaml'

const MAX_FILE = 32 * 1024 * 1024
const MAX_TOTAL = 128 * 1024 * 1024
const MANIFEST = 'external-files.json'
const RESOURCE_ROOT = 'restored-resources'
const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor'])
const certificateKeys = new Set([
  'certificate',
  'private-key',
  'ca-cert',
  'ca-file',
  'cert-file',
  'key-file',
  'client-certificate',
  'client-key'
])
const hash = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')
const normalized = (value: string): string =>
  process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value)

export function insideDirectory(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  )
}

/** Never follow a link/junction, including links above a file or restore destination. */
export async function assertNoLinks(file: string): Promise<void> {
  const absolute = path.resolve(file)
  let current = path.parse(absolute).root
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part)
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error('不支持符号链接或目录联接')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
  }
}

function configDocument(name: string): boolean {
  return (
    /^(?:mihomo|simple-config)\.yaml$/.test(name) ||
    /^(?:profiles|override|work)\/.+\.ya?ml$/.test(name) ||
    /^profile-local\/[\w-]+\.(?:json|pending\.yaml)$/.test(name)
  )
}

function decodeDocument(name: string, content: Buffer): unknown {
  return name.endsWith('.json')
    ? JSON.parse(content.toString('utf8'))
    : parse(content.toString('utf8'))
}

/** Only Mihomo file-bearing fields; arbitrary `path` fields and inline keys are not files. */
function referencesInDocument(document: string, value: unknown): BackupFileReference[] {
  const result: BackupFileReference[] = []
  function visit(node: unknown, pointer: string[], ancestors: Set<object>): void {
    if (!node || typeof node !== 'object' || ancestors.has(node) || pointer.length > 50) return
    const next = new Set(ancestors).add(node)
    for (const [key, child] of Object.entries(node)) {
      if (unsafeKeys.has(key)) continue
      const location = [...pointer, key]
      const providerPath =
        key === 'path' && ['proxy-providers', 'rule-providers'].includes(pointer.at(-2) || '')
      const certificatePath =
        certificateKeys.has(key) &&
        typeof child === 'string' &&
        /^(?:[A-Za-z]:[\\/]|[./\\~])/.test(child)
      if (
        (providerPath || certificatePath) &&
        typeof child === 'string' &&
        child.trim() &&
        !/[\r\n]/.test(child) &&
        !/^https?:\/\//i.test(child)
      )
        result.push({ document, pointer: location, value: child })
      visit(child, location, next)
    }
  }
  visit(value, [], new Set())
  return result
}

export interface BackupDocument {
  name: string
  content: Buffer
  base: string
}

interface ManifestFile {
  id: string
  path: string
  entry: string
  sha256: string
  bytes: number
  references: BackupFileReference[]
}
interface Manifest {
  version: 1
  files: ManifestFile[]
  omitted: { path: string; reason: string }[]
  warnings: string[]
}

export class ExternalBackupFiles {
  private previews = new Map<string, { fingerprint: string; expires: number }>()
  private queue = new WriteQueue()
  constructor(private root: string) {}

  private async approvals(): Promise<Set<string>> {
    try {
      const file = path.join(this.root, 'backup-external-approvals.json')
      await assertNoLinks(file)
      const value = JSON.parse(await readFile(file, 'utf8'))
      if (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
        throw new Error('外部文件批准范围无效')
      return new Set(value)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Set()
      throw error
    }
  }

  private async scan(
    documents: BackupDocument[]
  ): Promise<{ files: BackupExternalFile[]; warnings: string[]; fingerprint: string }> {
    const approved = await this.approvals()
    const files = new Map<string, BackupExternalFile>()
    const warnings: string[] = []
    for (const document of documents) {
      if (!configDocument(document.name)) continue
      let references: BackupFileReference[]
      try {
        references = referencesInDocument(
          document.name,
          decodeDocument(document.name, document.content)
        )
      } catch {
        warnings.push(`${document.name} 无法解析，未收集其中的外部文件。`)
        continue
      }
      for (const reference of references) {
        const absolute = path.resolve(document.base, reference.value)
        if (insideDirectory(this.root, absolute)) continue
        const key = normalized(absolute)
        const existing = files.get(key)
        if (existing) {
          existing.references.push(reference)
          continue
        }
        const item: BackupExternalFile = {
          id: hash(key),
          path: absolute,
          references: [reference],
          state: 'available',
          approved: approved.has(key)
        }
        files.set(key, item)
        try {
          if (/^(?:\\\\|\/\/|~)/.test(reference.value))
            throw new Error('网络、设备和波浪线路径不自动访问，请改用本机普通文件的绝对路径。')
          await assertNoLinks(absolute)
          const stat = await lstat(absolute)
          if (!stat.isFile()) throw new Error('只备份明确引用的普通文件，不收集目录。')
          if (stat.size > MAX_FILE) throw new Error('单个外部文件超过 32 MB。')
          if (normalized(await realpath(absolute)) !== key)
            throw new Error('路径指向其他位置，请使用真实文件路径。')
          item.bytes = stat.size
        } catch (error) {
          item.state = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'blocked'
          item.reason = item.state === 'missing' ? '文件不存在' : (error as Error).message
        }
      }
    }
    const values = [...files.values()].sort((a, b) => a.path.localeCompare(b.path))
    return {
      files: values,
      warnings,
      fingerprint: hash(
        JSON.stringify([
          documents
            .filter((d) => configDocument(d.name))
            .map((d) => [d.name, d.base, hash(d.content)]),
          values.map((f) => [f.id, f.state, f.approved])
        ])
      )
    }
  }

  async preview(documents: BackupDocument[]): Promise<BackupExternalPreview> {
    const report = await this.scan(documents)
    for (const [token, value] of this.previews)
      if (value.expires < Date.now()) this.previews.delete(token)
    const oldest = this.previews.keys().next().value
    if (this.previews.size >= 10 && oldest) this.previews.delete(oldest)
    const token = randomUUID()
    this.previews.set(token, {
      fingerprint: report.fingerprint,
      expires: Date.now() + 10 * 60 * 1000
    })
    return { token, files: report.files, warnings: report.warnings }
  }

  async approve(documents: BackupDocument[], token: string, ids: string[]): Promise<void> {
    return this.queue.run(async () => {
      const preview = this.previews.get(token)
      const report = await this.scan(documents)
      if (!preview || preview.expires < Date.now() || preview.fingerprint !== report.fingerprint)
        throw new Error('配置或批准范围已变化，请重新查看文件列表后确认。')
      if (
        !Array.isArray(ids) ||
        ids.some((id) => typeof id !== 'string') ||
        new Set(ids).size !== ids.length
      )
        throw new Error('无效文件选择')
      if (
        ids.some(
          (id) => !report.files.some((f) => f.id === id && (f.state === 'available' || f.approved))
        )
      )
        throw new Error('只能批准列表中可读取的文件。')
      const approved = await this.approvals()
      for (const file of report.files) {
        approved.delete(normalized(file.path))
        if (ids.includes(file.id)) approved.add(normalized(file.path))
      }
      const destination = path.join(this.root, 'backup-external-approvals.json')
      await assertNoLinks(destination)
      await atomicWriteFile(destination, JSON.stringify([...approved].sort()), { mode: 0o600 })
      this.previews.delete(token)
    })
  }

  async append(zip: AdmZip, documents: BackupDocument[], warnings: string[] = []): Promise<void> {
    const report = await this.scan(documents)
    const manifest: Manifest = {
      version: 1,
      files: [],
      omitted: [],
      warnings: [...warnings, ...report.warnings]
    }
    let total = 0
    for (const file of report.files) {
      if (!file.approved || file.state !== 'available') {
        manifest.omitted.push({
          path: file.path,
          reason: file.reason || '尚未批准，不包含在备份中'
        })
        continue
      }
      try {
        await assertNoLinks(file.path)
        const before = await lstat(file.path)
        const handle = await open(file.path, 'r')
        let content: Buffer
        try {
          const opened = await handle.stat()
          if (
            !opened.isFile() ||
            before.ino !== opened.ino ||
            before.dev !== opened.dev ||
            opened.size > MAX_FILE ||
            total + opened.size > MAX_TOTAL
          )
            throw new Error('文件已变化或超过 128 MB 外部文件总限额')
          content = Buffer.alloc(opened.size)
          let offset = 0
          while (offset < content.length) {
            const { bytesRead } = await handle.read(
              content,
              offset,
              content.length - offset,
              offset
            )
            if (!bytesRead) throw new Error('读取时文件已变化')
            offset += bytesRead
          }
          const after = await handle.stat()
          if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs)
            throw new Error('读取时文件已变化')
          await assertNoLinks(file.path)
          if (normalized(await realpath(file.path)) !== normalized(file.path))
            throw new Error('文件路径已变化')
        } finally {
          await handle.close()
        }
        const basename =
          path
            .basename(file.path)
            .replace(/[^\p{L}\p{N}._-]/gu, '_')
            .slice(0, 120) || 'resource'
        const entry = `${RESOURCE_ROOT}/${file.id}/${basename}`
        zip.addFile(entry, content)
        total += content.length
        manifest.files.push({
          id: file.id,
          path: file.path,
          entry,
          sha256: hash(content),
          bytes: content.length,
          references: file.references
        })
      } catch (error) {
        manifest.omitted.push({ path: file.path, reason: `未备份：${(error as Error).message}` })
      }
    }
    zip.addFile(MANIFEST, Buffer.from(JSON.stringify(manifest)))
  }
}

/** Restore resources inside the data directory; never write to an archived original path. */
export function rewriteExternalRestore(entries: Map<string, Buffer>, root: string): string[] {
  const manifestContent = entries.get(MANIFEST)
  if (!manifestContent) return []
  const manifest = JSON.parse(manifestContent.toString('utf8')) as Manifest
  if (
    manifest.version !== 1 ||
    !Array.isArray(manifest.files) ||
    manifest.files.length > 10000 ||
    !Array.isArray(manifest.omitted) ||
    !Array.isArray(manifest.warnings)
  )
    throw new Error('外部文件清单无效')
  const decoded = new Map<string, unknown>()
  const seen = new Set<string>()
  for (const file of manifest.files) {
    if (
      !file ||
      typeof file.path !== 'string' ||
      !/^[a-f0-9]{64}$/.test(file.id) ||
      !new RegExp(`^${RESOURCE_ROOT}/${file.id}/[^/\\\\:]+$`).test(file.entry) ||
      file.entry.split('/').some((p) => p === '.' || p === '..') ||
      seen.has(file.entry) ||
      !Array.isArray(file.references)
    )
      throw new Error('外部文件路径无效')
    seen.add(file.entry)
    const content = entries.get(file.entry)
    if (!content || content.length !== file.bytes || hash(content) !== file.sha256)
      throw new Error('外部文件缺失或校验失败')
    for (const reference of file.references) {
      if (
        !reference ||
        !configDocument(reference.document) ||
        !Array.isArray(reference.pointer) ||
        reference.pointer.some((part) => typeof part !== 'string' || unsafeKeys.has(part))
      )
        throw new Error('外部文件引用无效')
      const source = entries.get(reference.document)
      if (!source) throw new Error('外部文件引用的配置缺失')
      if (!decoded.has(reference.document))
        decoded.set(reference.document, decodeDocument(reference.document, source))
      const document = decoded.get(reference.document)
      // Validate against the original document, so only known file fields can be rewritten.
      const valid = referencesInDocument(
        reference.document,
        decodeDocument(reference.document, source)
      ).some(
        (r) =>
          JSON.stringify(r.pointer) === JSON.stringify(reference.pointer) &&
          r.value === reference.value
      )
      if (!valid) throw new Error('外部文件引用与配置不一致')
      let parent = document as Record<string, unknown>
      for (const part of reference.pointer.slice(0, -1)) {
        if (!parent || typeof parent !== 'object' || !Object.hasOwn(parent, part))
          throw new Error('外部文件引用无效')
        parent = parent[part] as Record<string, unknown>
      }
      const key = reference.pointer.at(-1)
      if (!key) throw new Error('外部文件引用无效')
      parent[key] = path.resolve(root, file.entry)
    }
  }
  for (const [name, value] of decoded)
    entries.set(
      name,
      Buffer.from(name.endsWith('.json') ? JSON.stringify(value) : stringify(value))
    )
  entries.delete(MANIFEST)
  return [
    ...manifest.omitted.map((item) => `${String(item.path)}：${String(item.reason)}`),
    ...manifest.warnings.map(String)
  ]
}
