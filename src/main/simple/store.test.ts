import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultSimpleDraft, type SimpleState } from '../../shared/simple-config'
import { parse, stringify } from '../utils/yaml'
import { commitSimpleState } from './store'

const mocks = vi.hoisted(() => ({ check: vi.fn(), reload: vi.fn(), root: '' }))
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../utils/dirs', () => ({
  simpleConfigPath: () => path.join(mocks.root, 'simple.yaml'),
  simpleOutputPath: () => path.join(mocks.root, 'work', 'simple.yaml'),
  mihomoWorkConfigPath: () => path.join(mocks.root, 'work', 'config.yaml'),
  mihomoWorkDir: () => path.join(mocks.root, 'work'),
  mihomoTestDir: () => path.join(mocks.root, 'test')
}))
vi.mock('../config/app', () => ({
  getAppConfig: async () => ({ core: 'mihomo', operationMode: 'simple' })
}))
vi.mock('../config/controledMihomo', () => ({
  getControledMihomoConfig: async () => ({}),
  writeSimpleSharedConfig: vi.fn()
}))
vi.mock('../config/profile', () => ({
  getProfileConfig: async () => ({ items: [] }),
  getProfile: vi.fn()
}))
vi.mock('../core/manager', () => ({ checkProfileConfig: mocks.check }))
vi.mock('../core/mihomoApi', () => ({ mihomoHotReloadConfig: mocks.reload }))

function state(): SimpleState {
  const draft = defaultSimpleDraft()
  draft.modules['proxy-providers'] = stringify({
    local: { type: 'file', path: './providers/local.yaml' },
    remote: {
      type: 'http',
      url: 'https://example.test/proxies.yaml',
      path: path.join(mocks.root, 'work', 'providers', 'remote.yaml')
    }
  })
  draft.modules['rule-providers'] = stringify({
    local: { type: 'file', behavior: 'domain', path: './rules/local.yaml' },
    remote: {
      type: 'http',
      behavior: 'domain',
      url: 'https://example.test/rules.yaml',
      path: '../work/rules/remote.yaml'
    }
  })
  return { version: 2, revision: 1, draft, published: structuredClone(draft) }
}

beforeEach(async () => {
  vi.clearAllMocks()
  mocks.root = await mkdtemp(path.join(os.tmpdir(), 'navio-simple-check-'))
  await mkdir(path.join(mocks.root, 'work'))
  await writeFile(path.join(mocks.root, 'work', 'geoip.metadb'), 'live-core-file')
  mocks.reload.mockResolvedValue(undefined)
})
afterEach(async () => {
  await rm(mocks.root, { recursive: true, force: true })
})

describe('simple configuration validation isolation', () => {
  it('uses the test home, preserves file-provider sources, and isolates HTTP caches without rewriting runtime configuration', async () => {
    const next = state()
    let candidatePath = ''
    mocks.check.mockImplementation(async (file: string, _core, _key, options) => {
      candidatePath = file
      expect(path.dirname(file)).toBe(path.join(mocks.root, 'test'))
      expect(options.workDir).toBe(path.join(mocks.root, 'test'))
      expect(options.safePath).toBe(path.join(mocks.root, 'work'))
      const candidate = parse(await readFile(file, 'utf8'))
      expect(candidate['proxy-providers'].local.path).toBe(
        path.join(mocks.root, 'work', 'providers', 'local.yaml')
      )
      expect(candidate['rule-providers'].local.path).toBe(
        path.join(mocks.root, 'work', 'rules', 'local.yaml')
      )
      for (const kind of ['proxy-providers', 'rule-providers']) {
        expect(path.dirname(candidate[kind].remote.path)).toBe(
          path.join(mocks.root, 'test', 'simple-providers')
        )
      }
      expect(candidate['proxy-providers'].remote.path).not.toBe(
        candidate['rule-providers'].remote.path
      )
      expect(await readdir(path.join(mocks.root, 'work'))).toEqual(['geoip.metadb'])
    })
    const result = await commitSimpleState(next, next)
    expect(result.errors).toEqual([])
    expect(mocks.check).toHaveBeenCalledOnce()
    const runtime = parse(result.yaml)
    expect(runtime['proxy-providers'].local.path).toBe('./providers/local.yaml')
    expect(runtime['proxy-providers'].remote.path).toBe(
      path.join(mocks.root, 'work', 'providers', 'remote.yaml')
    )
    expect(runtime['rule-providers'].remote.path).toBe('../work/rules/remote.yaml')
    expect(parse(await readFile(path.join(mocks.root, 'simple.yaml'), 'utf8')).published).toEqual(
      next.published
    )
    await expect(readFile(candidatePath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(path.join(mocks.root, 'work', 'geoip.metadb'), 'utf8')).toBe(
      'live-core-file'
    )
    expect(mocks.reload).toHaveBeenCalledOnce()
  })

  it('uses distinct candidates for overlapping edits and cleans them after validation fails', async () => {
    const next = state()
    const candidates: string[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    mocks.check.mockImplementation(async (file: string) => {
      candidates.push(file)
      await gate
      expect(parse(await readFile(file, 'utf8')).rules).toEqual(['MATCH,PROXY'])
      throw new Error('configuration rejected')
    })
    const first = commitSimpleState(next, next)
    await vi.waitFor(() => expect(candidates).toHaveLength(1))
    const second = commitSimpleState(next, next)
    await vi.waitFor(() => expect(candidates).toHaveLength(2))
    expect(new Set(candidates).size).toBe(2)
    release()
    for (const result of await Promise.all([first, second])) {
      expect(result.errors[0]).toContain('configuration rejected')
    }
    expect(await readdir(path.join(mocks.root, 'test'))).toEqual([])
    expect(mocks.reload).not.toHaveBeenCalled()
    await expect(readFile(path.join(mocks.root, 'simple.yaml'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })
})
