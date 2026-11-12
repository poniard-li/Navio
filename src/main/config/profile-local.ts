import { mkdir, readFile, readdir, unlink } from 'fs/promises'
import { createHash } from 'crypto'
import { join } from 'path'
import { dataDir, profilePath } from '../utils/dirs'
import { atomicWriteFile, WriteQueue } from '../utils/safeFile'
import { parse, stringify } from '../utils/yaml'
import {
  mergeProfileChanges,
  type ProfileConflict,
  type ProfileResolution
} from '../../shared/profile-patch'
const mutationQueues = new Map<string, WriteQueue>()
function mutationQueue(id: string): WriteQueue {
  filename(id)
  let queue = mutationQueues.get(id)
  if (!queue) {
    queue = new WriteQueue()
    mutationQueues.set(id, queue)
  }
  return queue
}
interface LocalChange {
  version: 1
  base: unknown
  local: unknown
}
function filename(id: string, suffix = 'json'): string {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error('无效配置 ID')
  return join(dataDir(), 'profile-local', `${id}.${suffix}`)
}
async function record(id: string): Promise<LocalChange | undefined> {
  try {
    return JSON.parse(await readFile(filename(id), 'utf8')) as LocalChange
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
}
export async function applyProfileLocal(
  id: string,
  source: string,
  blockConflicts = false
): Promise<string> {
  if (blockConflicts)
    return mutationQueue(id).run(() => applyProfileLocalInternal(id, source, true))
  return applyProfileLocalInternal(id, source, false)
}
async function applyProfileLocalInternal(
  id: string,
  source: string,
  blockConflicts: boolean
): Promise<string> {
  const patch = await record(id)
  if (!patch) return source
  const merged = mergeProfileChanges(patch.base, patch.local, parse(source))
  if (blockConflicts && merged.conflicts.length) {
    await atomicWriteFile(filename(id, 'pending.yaml'), source)
    throw new Error(
      `订阅更新与本地修改冲突：${merged.conflicts.slice(0, 6).join('、')}。请在“本地修改”中比较并处理，现有配置已保留。`
    )
  }
  return stringify(merged.value)
}
export async function saveProfileLocal(id: string, content: string): Promise<void> {
  return mutationQueue(id).run(async () => {
    const base = parse(await readFile(profilePath(id), 'utf8')),
      local = parse(content)
    if (!local || typeof local !== 'object' || Array.isArray(local))
      throw new Error('配置必须是 YAML 对象')
    await mkdir(join(dataDir(), 'profile-local'), { recursive: true })
    await atomicWriteFile(filename(id), JSON.stringify({ version: 1, base, local }))
  })
}
export async function getProfileChanges(id: string): Promise<{
  base: string
  local: string
  incoming: string
  conflicts: string[]
  details: ProfileConflict[]
  revision: string
  hasChanges: boolean
  hasPending: boolean
}> {
  const source = await readFile(profilePath(id), 'utf8'),
    patch = await record(id)
  let incoming = source,
    hasPending = false
  try {
    incoming = await readFile(filename(id, 'pending.yaml'), 'utf8')
    hasPending = true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const details: ProfileConflict[] = []
  const merged = patch
    ? mergeProfileChanges(patch.base, patch.local, parse(incoming), '', {}, details)
    : { conflicts: [] }
  return {
    base: patch ? stringify(patch.base) : source,
    local: await applyProfileLocal(id, source),
    incoming,
    conflicts: merged.conflicts,
    details,
    revision: createHash('sha256')
      .update(JSON.stringify([source, patch, incoming]))
      .digest('hex'),
    hasChanges: !!patch,
    hasPending
  }
}
export async function resolveProfileChanges(
  id: string,
  resolution: ProfileResolution,
  validate: (content: string) => Promise<void>
): Promise<void> {
  return mutationQueue(id).run(async () => {
    const perConflict = resolution && typeof resolution === 'object' && !Array.isArray(resolution)
    if (!perConflict && !['keep-local', 'use-incoming'].includes(resolution as string))
      throw new Error('无效处理方式')
    const report = await getProfileChanges(id),
      patch = await record(id)
    if (perConflict) {
      if (resolution.revision !== report.revision)
        throw new Error('订阅或本地修改已变化，请刷新后重新确认。')
      const choices = resolution.choices
      if (
        !choices ||
        typeof choices !== 'object' ||
        Array.isArray(choices) ||
        Object.keys(choices).length !== report.conflicts.length ||
        report.conflicts.some(
          (key) => !Object.hasOwn(choices, key) || !['local', 'incoming'].includes(choices[key])
        )
      )
        throw new Error('请为每一项冲突选择本地或订阅内容。')
      if (!report.hasPending) throw new Error('没有待确认的订阅更新，请刷新状态。')
    }
    const base = parse(report.incoming)
    const local =
      resolution !== 'use-incoming' && patch
        ? mergeProfileChanges(
            patch.base,
            patch.local,
            base,
            '',
            perConflict ? resolution.choices : {}
          ).value
        : base
    await validate(stringify(local))
    if ((await getProfileChanges(id)).revision !== report.revision)
      throw new Error('校验期间订阅或本地修改已变化，请刷新后重新确认。')
    const oldSource = await readFile(profilePath(id), 'utf8')
    try {
      if (resolution !== 'use-incoming' && patch) {
        await atomicWriteFile(filename(id), JSON.stringify({ version: 1, base, local }))
      } else
        await unlink(filename(id)).catch((error) => {
          if (error.code !== 'ENOENT') throw error
        })
      if (report.hasPending) await atomicWriteFile(profilePath(id), report.incoming)
      await unlink(filename(id, 'pending.yaml')).catch((error) => {
        if (error.code !== 'ENOENT') throw error
      })
    } catch (error) {
      await atomicWriteFile(profilePath(id), oldSource)
      if (patch) await atomicWriteFile(filename(id), JSON.stringify(patch))
      else
        await unlink(filename(id)).catch((err) => {
          if (err.code !== 'ENOENT') throw err
        })
      throw error
    }
  })
}
export async function removeProfileLocal(id: string): Promise<void> {
  return mutationQueue(id).run(async () => {
    const files = [filename(id), filename(id, 'pending.yaml')]
    const directory = join(dataDir(), 'profile-local')
    const draftName = `${createHash('sha256').update(id).digest('hex')}.draft.json`
    files.push(join(directory, draftName))
    const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
      if (error.code !== 'ENOENT') throw error
      return []
    })
    // Expired editor drafts may still contain subscription credentials after the profile is removed.
    for (const entry of entries) {
      if (
        (entry.isFile() || entry.isSymbolicLink()) &&
        entry.name.startsWith(`${draftName}.recovery-`) &&
        entry.name.endsWith('.json')
      )
        files.push(join(directory, entry.name))
    }
    for (const file of files) {
      await unlink(file).catch((error) => {
        if (error.code !== 'ENOENT') throw error
      })
    }
  })
}
