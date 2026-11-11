import { createHash } from 'crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { basename, dirname, join, resolve } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parse, stringify } from '../utils/yaml'
import {
  applyProfileLocal,
  getProfileChanges,
  removeProfileLocal,
  resolveProfileChanges,
  saveProfileLocal
} from './profile-local'

let testDir = ''
vi.mock('../utils/dirs', () => ({
  dataDir: () => testDir,
  profilePath: (id: string) => join(testDir, 'profiles', `${id}.yaml`)
}))

const id = 'remote'
const sourcePath = (): string => join(testDir, 'profiles', `${id}.yaml`)
const localDirectory = (): string => join(testDir, 'profile-local')
const overlayPath = (): string => join(localDirectory(), `${id}.json`)
const pendingPath = (): string => join(localDirectory(), `${id}.pending.yaml`)
const node = (name: string, port = 80, server = 'old.example'): object => ({
  name,
  type: 'http',
  server,
  port
})
const base = (): object => ({
  'mixed-port': 7890,
  proxies: [node('A')],
  rules: ['MATCH,DIRECT']
})
const local = (): object => ({ ...base(), proxies: [node('A', 443)] })
const incoming = (): object => ({
  ...base(),
  'mixed-port': 7891,
  proxies: [node('A', 8080, 'new.example'), node('B')]
})
const expectedMerged = (): object => ({
  ...incoming(),
  proxies: [node('A', 443, 'new.example'), node('B')]
})
const source = (): string => readFileSync(sourcePath(), 'utf8')
const overlay = (): unknown => JSON.parse(readFileSync(overlayPath(), 'utf8'))

async function prepareConflict(): Promise<void> {
  await saveProfileLocal(id, stringify(local()))
  await expect(applyProfileLocal(id, stringify(incoming()), true)).rejects.toThrow(
    '/proxies[A]/port'
  )
}

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'navio-profile-local-test-'))
  mkdirSync(join(testDir, 'profiles'))
  writeFileSync(sourcePath(), `# original subscription\n${stringify(base())}`)
})

afterEach(() => {
  const target = resolve(testDir)
  if (
    dirname(target) !== resolve(tmpdir()) ||
    !basename(target).startsWith('navio-profile-local-test-')
  )
    throw new Error('Refusing to remove an unexpected test directory')
  rmSync(target, { recursive: true, force: true })
})

describe('subscription local changes on disk', () => {
  it('passes untouched subscriptions through without creating local state', async () => {
    const original = source()
    expect(await applyProfileLocal(id, original, true)).toBe(original)
    expect(await getProfileChanges(id)).toEqual({
      base: original,
      local: original,
      incoming: original,
      conflicts: [],
      hasChanges: false,
      hasPending: false
    })
    expect(existsSync(localDirectory())).toBe(false)
  })

  it('merges independent upstream changes without replacing the stored base or local edits', async () => {
    await saveProfileLocal(id, stringify(local()))
    const before = readFileSync(overlayPath(), 'utf8')
    const update = { ...incoming(), proxies: [node('A', 80, 'new.example'), node('B')] }
    expect(parse(await applyProfileLocal(id, stringify(update), true))).toEqual(expectedMerged())
    expect(readFileSync(overlayPath(), 'utf8')).toBe(before)
    expect(parse(source())).toEqual(base())
    expect(existsSync(pendingPath())).toBe(false)
  })

  it('keeps the original profile and overlay byte-for-byte when an update conflicts', async () => {
    const original = source()
    await saveProfileLocal(id, stringify(local()))
    const originalOverlay = readFileSync(overlayPath(), 'utf8')
    const update = `# incoming subscription\n${stringify(incoming())}`

    await expect(applyProfileLocal(id, update, true)).rejects.toThrow('现有配置已保留')

    expect(source()).toBe(original)
    expect(readFileSync(overlayPath(), 'utf8')).toBe(originalOverlay)
    expect(readFileSync(pendingPath(), 'utf8')).toBe(update)
    const report = await getProfileChanges(id)
    expect(report).toMatchObject({
      incoming: update,
      conflicts: ['/proxies[A]/port'],
      hasChanges: true,
      hasPending: true
    })
    expect(parse(report.base)).toEqual(base())
    expect(parse(report.local)).toEqual(local())
  })

  it.each(['keep-local', 'use-incoming'] as const)(
    'leaves every file unchanged when validation rejects %s',
    async (resolution) => {
      await prepareConflict()
      const paths = [sourcePath(), overlayPath(), pendingPath()]
      const before = paths.map((path) => readFileSync(path, 'utf8'))
      const validate = vi.fn(async (_content: string) => {
        throw new Error('core validation rejected the candidate')
      })

      await expect(resolveProfileChanges(id, resolution, validate)).rejects.toThrow(
        'core validation rejected the candidate'
      )

      expect(validate).toHaveBeenCalledOnce()
      expect(parse(validate.mock.calls[0][0])).toEqual(
        resolution === 'keep-local' ? expectedMerged() : incoming()
      )
      expect(paths.map((path) => readFileSync(path, 'utf8'))).toEqual(before)
      expect(readdirSync(localDirectory()).sort()).toEqual([`${id}.json`, `${id}.pending.yaml`])
    }
  )

  it('keeps local conflicting fields, adopts upstream additions, and rebases the saved overlay', async () => {
    await prepareConflict()
    const update = readFileSync(pendingPath(), 'utf8')
    const validate = vi.fn(async (_content: string) => undefined)

    await resolveProfileChanges(id, 'keep-local', validate)

    expect(parse(validate.mock.calls[0][0])).toEqual(expectedMerged())
    expect(source()).toBe(update)
    expect(overlay()).toEqual({ version: 1, base: incoming(), local: expectedMerged() })
    expect(existsSync(pendingPath())).toBe(false)
    expect(parse(await applyProfileLocal(id, source(), true))).toEqual(expectedMerged())
    expect(await getProfileChanges(id)).toMatchObject({
      hasChanges: true,
      hasPending: false,
      conflicts: []
    })

    const nextUpdate = { ...incoming(), 'mixed-port': 7892 }
    expect(parse(await applyProfileLocal(id, stringify(nextUpdate), true))).toEqual({
      ...expectedMerged(),
      'mixed-port': 7892
    })
  })

  it('accepts the incoming profile and removes the superseded overlay and pending update', async () => {
    await prepareConflict()
    const update = readFileSync(pendingPath(), 'utf8')
    const validate = vi.fn(async (_content: string) => undefined)

    await resolveProfileChanges(id, 'use-incoming', validate)

    expect(parse(validate.mock.calls[0][0])).toEqual(incoming())
    expect(source()).toBe(update)
    expect(existsSync(overlayPath())).toBe(false)
    expect(existsSync(pendingPath())).toBe(false)
    expect(await applyProfileLocal(id, source(), true)).toBe(update)
    expect(await getProfileChanges(id)).toMatchObject({
      hasChanges: false,
      hasPending: false,
      conflicts: []
    })
  })

  it('removes only the deleted profile overlay, pending update, hashed draft and recovery drafts', async () => {
    await prepareConflict()
    const ownHash = createHash('sha256').update(id).digest('hex')
    const otherHash = createHash('sha256').update('other').digest('hex')
    const ownDrafts = [
      `${ownHash}.draft.json`,
      `${ownHash}.draft.json.recovery-1794355200000-12b00180-9966-4e2c-885c-9ed22c611860.json`,
      `${ownHash}.draft.json.recovery-1794355200001-12b00180-9966-4e2c-885c-9ed22c611861.json`
    ]
    const unrelated = [
      'other.json',
      'other.pending.yaml',
      `${otherHash}.draft.json`,
      `${otherHash}.draft.json.recovery-1794355200000-12b00180-9966-4e2c-885c-9ed22c611862.json`,
      `${ownHash}.draft.json.recovery-notes.txt`
    ]
    for (const file of [...ownDrafts, ...unrelated])
      writeFileSync(join(localDirectory(), file), `preserved text for ${file}`)
    const original = source()

    await removeProfileLocal(id)

    expect(readdirSync(localDirectory()).sort()).toEqual(unrelated.sort())
    for (const file of unrelated)
      expect(readFileSync(join(localDirectory(), file), 'utf8')).toBe(`preserved text for ${file}`)
    expect(source()).toBe(original)
    await expect(removeProfileLocal(id)).resolves.toBeUndefined()
  })

  it('allows deletion before any overlay exists and rejects IDs that could escape the data directory', async () => {
    await expect(removeProfileLocal(id)).resolves.toBeUndefined()
    await expect(removeProfileLocal('../remote')).rejects.toThrow('无效配置 ID')
    expect(parse(source())).toEqual(base())
    expect(existsSync(localDirectory())).toBe(false)
  })
})
