import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SimpleDraft, SimpleObject } from '../../shared/simple-config'
import { parse, stringify } from '../utils/yaml'
import { applyProfileLocal, saveProfileLocal } from '../config/profile-local'
import { setOperationMode } from './mode'
import {
  createSimpleNodes,
  createSimpleProxyGroup,
  getSimpleConfig,
  getSimpleNode,
  getSimpleProxyGroup,
  getSimpleRulesEditor,
  publishSimpleConfig,
  removeSimpleNode,
  removeSimpleProxyGroup,
  reorderSimpleProxyGroups,
  saveSimpleDraft,
  saveSimpleNode,
  saveSimpleProxyGroup,
  saveSimpleRuleProvider,
  saveSimpleRules
} from './active-profile'

let testDir = ''
let current: string | undefined
let mode = 'standard'
const mocks = vi.hoisted(() => ({ save: vi.fn(), send: vi.fn(), patch: vi.fn() }))
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [{ webContents: { send: mocks.send } }] },
  dialog: { showSaveDialog: vi.fn() }
}))
vi.mock('../utils/dirs', () => ({
  dataDir: () => testDir,
  profilePath: (id: string) => join(testDir, 'profiles', `${id}.yaml`)
}))
vi.mock('../config/app', () => ({ patchAppConfig: mocks.patch }))
vi.mock('../config/profile', () => ({
  getProfileConfig: async () => ({ current, items: [] }),
  getProfile: async (id: string) => {
    const { applyProfileLocal } = await import('../config/profile-local')
    const { parse } = await import('../utils/yaml')
    return parse(
      await applyProfileLocal(id, readFileSync(join(testDir, 'profiles', `${id}.yaml`), 'utf8'))
    )
  },
  saveProfileEdits: mocks.save,
  addProfileItem: vi.fn(),
  removeProfileItem: vi.fn()
}))

const node = (name: string, port = 8080): SimpleObject => ({
  name,
  type: 'http',
  server: '127.0.0.1',
  port
})
const fixture = (): SimpleObject => ({
  'mixed-port': 7890,
  'x-vendor': { proxy: 'A', unchanged: [1, 2] },
  proxies: [node('A'), node('B', 8081)],
  'proxy-groups': [{ name: 'Select', type: 'select', proxies: ['A', 'B'] }],
  'proxy-providers': { Remote: { type: 'inline', payload: [node('ProviderNode')] } },
  'rule-providers': { Domestic: { type: 'inline', behavior: 'domain', payload: ['+.cn'] } },
  rules: ['DOMAIN,example.test,A', 'RULE-SET,Domestic,DIRECT', 'MATCH,Select'],
  dns: { enable: true, nameserver: ['https://dns.example/dns-query'] },
  tun: { enable: false },
  sniffer: { enable: false }
})
const sourcePath = (id = 'remote'): string => join(testDir, 'profiles', `${id}.yaml`)
const source = (): SimpleObject => parse(readFileSync(sourcePath(), 'utf8'))
const effective = async (): Promise<SimpleObject> =>
  parse(await applyProfileLocal('remote', readFileSync(sourcePath(), 'utf8')))
const editGeneral = (draft: SimpleDraft, value: number): SimpleDraft => ({
  ...draft,
  modules: {
    ...draft.modules,
    general: stringify({ ...parse(draft.modules.general), 'mixed-port': value })
  }
})

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'navio-active-profile-'))
  mkdirSync(join(testDir, 'profiles'))
  writeFileSync(sourcePath(), stringify(fixture()))
  writeFileSync(
    sourcePath('other'),
    stringify({
      ...fixture(),
      proxies: [node('Other')],
      'proxy-groups': [],
      rules: ['MATCH,DIRECT']
    })
  )
  current = 'remote'
  mode = 'standard'
  vi.clearAllMocks()
  mocks.patch.mockImplementation(async (patch) => {
    mode = patch.operationMode
  })
  mocks.save.mockImplementation(async (id: string, content: string) => {
    await saveProfileLocal(id, content)
  })
})
afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('simple editors use the active profile and its local overlay', () => {
  it('reads the active overlay and switches only presentation mode', async () => {
    await saveProfileLocal('remote', stringify({ ...fixture(), 'mixed-port': 9001 }))
    const before = await getSimpleConfig()
    expect(parse(before.draft.modules.general)['mixed-port']).toBe(9001)
    await setOperationMode('simple')
    expect(mode).toBe('simple')
    expect((await getSimpleConfig()).published).toEqual(before.published)
    await setOperationMode('standard')
    expect(current).toBe('remote')
    expect(mocks.patch).toHaveBeenLastCalledWith({ operationMode: 'standard', modeSelected: true })
    expect(mocks.save).not.toHaveBeenCalled()
    expect(readFileSync(sourcePath(), 'utf8')).toBe(stringify(fixture()))
  })

  it('keeps drafts separate and publishes a remote edit as an overlay without losing upstream fields', async () => {
    const initial = await getSimpleConfig()
    expect((await saveSimpleDraft(editGeneral(initial.draft, 9002))).errors).toEqual([])
    expect(mocks.save).not.toHaveBeenCalled()
    expect((await effective())['mixed-port']).toBe(7890)
    const saved = await getSimpleConfig()
    expect(parse(saved.draft.modules.general)['mixed-port']).toBe(9002)
    expect((await publishSimpleConfig(saved.draft)).errors).toEqual([])
    expect(source()).toEqual(fixture())
    expect((await effective())['mixed-port']).toBe(9002)
    expect((await effective())['x-vendor']).toEqual(fixture()['x-vendor'])
    expect(mocks.save).toHaveBeenCalledWith(
      'remote',
      expect.any(String),
      expect.objectContaining({ currentId: 'remote', fingerprint: expect.any(String) })
    )
    expect(
      readdirSync(join(testDir, 'profile-local')).filter((file) => file.endsWith('.draft.json'))
    ).toEqual([])
  })

  it('rejects an open draft after subscription refresh instead of replacing newly received nodes', async () => {
    const original = (await getSimpleConfig()).draft
    writeFileSync(
      sourcePath(),
      stringify({ ...fixture(), proxies: [node('A'), node('B'), node('New')] })
    )
    expect((await saveSimpleDraft(editGeneral(original, 9003))).errors.join()).toContain('重新载入')
    expect((await publishSimpleConfig(original)).errors.join()).toContain('重新载入')
    expect(mocks.save).not.toHaveBeenCalled()
    expect((source().proxies as SimpleObject[]).map((entry) => entry.name)).toContain('New')
  })

  it('archives an outdated persisted draft, warns on reopening, and loads the new subscription', async () => {
    await saveSimpleDraft(editGeneral((await getSimpleConfig()).draft, 9004))
    writeFileSync(
      sourcePath(),
      stringify({ ...fixture(), proxies: [node('A'), node('B'), node('Fresh')] })
    )
    const reopened = await getSimpleConfig()
    expect(reopened.draftWarning).toContain('旧草稿保留')
    expect(parse(reopened.draft.modules.general)['mixed-port']).toBe(7890)
    expect(
      parse(reopened.draft.modules.proxies).map((entry: SimpleObject) => entry.name)
    ).toContain('Fresh')
    const recovery = readdirSync(join(testDir, 'profile-local')).find((file) =>
      file.includes('.recovery-')
    )
    expect(recovery).toBeDefined()
    expect(
      JSON.parse(readFileSync(join(testDir, 'profile-local', recovery || ''), 'utf8')).modules
        .general
    ).toContain('9004')
    expect((await getSimpleConfig()).draftWarning).toBeUndefined()
    expect((await publishSimpleConfig(editGeneral(reopened.draft, 9005))).errors).toEqual([])
    expect(((await effective()).proxies as SimpleObject[]).map((entry) => entry.name)).toContain(
      'Fresh'
    )
  })

  it('rejects a draft belonging to another subscription and isolates saved drafts by subscription', async () => {
    const remoteDraft = editGeneral((await getSimpleConfig()).draft, 9006)
    await saveSimpleDraft(remoteDraft)
    current = 'other'
    expect((await publishSimpleConfig(remoteDraft)).errors.join()).toContain('重新载入')
    expect(parse((await getSimpleConfig()).draft.modules.proxies)[0].name).toBe('Other')
    current = 'remote'
    expect(parse((await getSimpleConfig()).draft.modules.general)['mixed-port']).toBe(9006)
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('serializes concurrent publishers and refuses a second stale full-config write', async () => {
    const draft = (await getSimpleConfig()).draft
    const results = await Promise.all([
      publishSimpleConfig(editGeneral(draft, 9007)),
      publishSimpleConfig(editGeneral(draft, 9008))
    ])
    expect(results[0].errors).toEqual([])
    expect(results[1].errors.join()).toContain('重新载入')
    expect(mocks.save).toHaveBeenCalledTimes(1)
    expect((await effective())['mixed-port']).toBe(9007)
  })

  it('renames nodes and groups with their references, and retains node removal cleanup', async () => {
    const a = await getSimpleNode('A')
    await saveSimpleNode('A', { ...a, name: 'Renamed' }, a)
    expect((await effective()).rules).toContain('DOMAIN,example.test,Renamed')
    expect((await effective())['x-vendor']).toEqual(fixture()['x-vendor'])
    expect((await getSimpleProxyGroup('Select')).group.proxies).toContain('Renamed')
    const selected = (await getSimpleProxyGroup('Select')).group
    await saveSimpleProxyGroup('Select', { ...selected, name: 'Main' }, selected)
    expect((await effective()).rules).toContain('MATCH,Main')
    await removeSimpleNode('Renamed', await getSimpleNode('Renamed'))
    expect((await getSimpleProxyGroup('Main')).group.proxies).toEqual(['B'])
    expect((await effective()).rules).not.toContain('DOMAIN,example.test,Renamed')
    await removeSimpleNode('B', await getSimpleNode('B'))
    expect((await getSimpleProxyGroup('Main')).group.proxies).toEqual(['DIRECT'])
    await removeSimpleProxyGroup('Main', (await getSimpleProxyGroup('Main')).group)
    expect((await effective()).rules).not.toContain('MATCH,Main')
  })

  it('keeps group creation, ordering, rule edits and provider cleanup on the current overlay', async () => {
    await createSimpleNodes([node('C')])
    await createSimpleProxyGroup({ name: 'Second', type: 'select', proxies: ['C'] })
    await reorderSimpleProxyGroups(['Second', 'Select'])
    expect(
      ((await effective())['proxy-groups'] as SimpleObject[]).map((group) => group.name)
    ).toEqual(['Second', 'Select'])
    const editor = await getSimpleRulesEditor()
    await saveSimpleRules(
      { action: 'add', index: 0, value: 'DOMAIN,new.test,Second' },
      editor.rules
    )
    expect((await getSimpleRulesEditor()).rules[0]).toBe('DOMAIN,new.test,Second')
    await saveSimpleRuleProvider('Domestic', 'Domestic', null, editor.ruleProviders.Domestic)
    expect((await effective()).rules).not.toContain('RULE-SET,Domestic,DIRECT')
    expect((await getSimpleRulesEditor()).ruleProviders).toEqual({})
    expect(source()).toEqual(fixture())
  })

  it('refuses stale item edits, duplicate cross-resource names and invalid references without writing', async () => {
    const a = await getSimpleNode('A')
    await saveSimpleNode('A', { ...a, port: 9999 }, a)
    mocks.save.mockClear()
    await expect(saveSimpleNode('A', { ...a, port: 8888 }, a)).rejects.toThrow('修改')
    await expect(createSimpleNodes([node('Select')])).rejects.toThrow('名称重复')
    await expect(
      createSimpleProxyGroup({ name: 'Broken', type: 'select', proxies: ['Missing'] })
    ).rejects.toThrow('未定义出站')
    const draft = (await getSimpleConfig()).draft
    expect(
      (await publishSimpleConfig({ ...draft, modules: { ...draft.modules, rules: 'not-a-list' } }))
        .errors.length
    ).toBeGreaterThan(0)
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('preserves a pending module draft for recovery when another editor commits a node', async () => {
    await saveSimpleDraft(editGeneral((await getSimpleConfig()).draft, 9010))
    await createSimpleNodes([node('Added')])
    const reopened = await getSimpleConfig()
    expect(reopened.draftWarning).toContain('旧草稿保留')
    expect(
      parse(reopened.draft.modules.proxies).map((entry: SimpleObject) => entry.name)
    ).toContain('Added')
    expect(
      readdirSync(join(testDir, 'profile-local')).some((file) => file.includes('.recovery-'))
    ).toBe(true)
  })

  it('requires a current profile and refuses untracked legacy drafts', async () => {
    const draft = (await getSimpleConfig()).draft
    delete draft.navioBase
    expect((await publishSimpleConfig(draft)).errors.join()).toContain('重新载入')
    current = undefined
    await expect(getSimpleConfig()).rejects.toThrow('导入或创建')
    expect(mocks.save).not.toHaveBeenCalled()
  })
})
