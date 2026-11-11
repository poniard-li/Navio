import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve, sep } from 'path'
import { stringify } from '../utils/yaml'

const { writeProfile, updateProfiles, addOverride, chooseFolder } = vi.hoisted(() => ({
  writeProfile: vi.fn(),
  updateProfiles: vi.fn(),
  addOverride: vi.fn(),
  chooseFolder: vi.fn()
}))
vi.mock('electron', () => ({ dialog: { showOpenDialog: chooseFolder } }))
vi.mock('../config/profile', () => ({
  setProfileStr: writeProfile,
  updateProfileConfig: updateProfiles
}))
vi.mock('../config/override', () => ({ addOverrideItem: addOverride }))

import { inspectCfwDirectory, previewCfwMigration, applyCfwMigration } from './cfw-migration'

describe('CFW migration assistant', () => {
  let directory: string
  let profileConfig: IProfileConfig
  const content =
    'proxies:\n  - { name: test-node, type: socks5, server: 127.0.0.1, port: 1080 }\nproxy-groups:\n  - { name: Select, type: select, proxies: [test-node] }\nrules:\n  - MATCH,Select\n'
  beforeEach(async () => {
    vi.clearAllMocks()
    directory = await mkdtemp(join(tmpdir(), 'navio-cfw-migration-test-'))
    await mkdir(join(directory, 'profiles'))
    profileConfig = {
      current: 'existing',
      items: [{ id: 'existing', name: 'Existing', type: 'local' }]
    }
    writeProfile.mockResolvedValue(undefined)
    addOverride.mockResolvedValue(undefined)
    updateProfiles.mockImplementation(async (callback) => {
      profileConfig = await callback(profileConfig)
    })
  })
  afterEach(async () => {
    const root = resolve(tmpdir()) + sep
    if (!resolve(directory).startsWith(root) || !directory.includes('navio-cfw-migration-test-'))
      throw new Error('Unexpected test directory')
    await rm(directory, { recursive: true, force: true })
  })
  it('previews CFW list metadata and cached profiles without fetching, writing or leaking full URLs', async () => {
    await writeFile(
      join(directory, 'profiles', 'list.yml'),
      stringify({
        files: [
          {
            time: '123.yml',
            name: 'My subscription',
            url: 'https://example.com/sub?secret=private',
            interval: 24,
            selected: ['old']
          }
        ]
      })
    )
    await writeFile(join(directory, 'profiles', '123.yml'), content)
    const preview = await inspectCfwDirectory(directory)
    expect(preview.candidates).toHaveLength(1)
    expect(preview.candidates[0]).toMatchObject({
      name: 'My subscription',
      kind: 'remote',
      sourceHost: 'example.com',
      nodeCount: 1,
      groupCount: 1,
      ruleCount: 1
    })
    expect(JSON.stringify(preview)).not.toContain('private')
    expect(writeProfile).not.toHaveBeenCalled()
    expect(addOverride).not.toHaveBeenCalled()
  })
  it('imports reviewed snapshots preserving current config and disabling remote auto-update', async () => {
    await writeFile(
      join(directory, 'profiles', 'list.yml'),
      stringify({ files: [{ time: 123, name: 'Remote', url: 'https://example.com/sub' }] })
    )
    await writeFile(join(directory, 'profiles', '123.yaml'), content)
    await writeFile(join(directory, 'mixin.yml'), 'mixin:\n  dns:\n    enable: true\n')
    const preview = await inspectCfwDirectory(directory)
    await writeFile(join(directory, 'profiles', '123.yaml'), 'CHANGED AFTER REVIEW')
    const result = await applyCfwMigration(preview.planId)
    expect(result.importedProfiles).toHaveLength(1)
    expect(result.importedOverrides).toHaveLength(1)
    expect(writeProfile).toHaveBeenCalledWith(result.importedProfiles[0].id, content)
    expect(profileConfig.current).toBe('existing')
    expect(profileConfig.items[0].id).toBe('existing')
    expect(profileConfig.items[1]).toMatchObject({
      type: 'remote',
      url: 'https://example.com/sub',
      autoUpdate: false,
      override: [result.importedOverrides[0].id]
    })
    expect(addOverride).toHaveBeenCalledWith(
      expect.objectContaining({ global: false, type: 'local', ext: 'yaml' })
    )
    await expect(applyCfwMigration(preview.planId)).rejects.toThrow('预览已过期')
  })
  it('reports Parsers, JavaScript mixin and kernel Script independently and never executes them', async () => {
    await writeFile(
      join(directory, 'profiles', 'script.yml'),
      content + 'mode: script\nscript:\n  code: |\n    def main(ctx, metadata): return "DIRECT"\n'
    )
    await writeFile(join(directory, 'parsers.js'), 'throw new Error("THIS MUST NEVER RUN")')
    await writeFile(
      join(directory, 'cfw-settings.yaml'),
      stringify({
        mixinCode: 'globalThis.migrationExecuted = true',
        mixinText: 'mixin:\n  dns:\n    enable: false\n',
        parsers: { reg: '.*' }
      })
    )
    const preview = await inspectCfwDirectory(directory)
    expect(preview.unsupportedScripts).toHaveLength(3)
    expect(preview.candidates[0].warnings.join(' ')).toContain('Script')
    expect(preview.overrides).toHaveLength(1)
    expect((globalThis as Record<string, unknown>).migrationExecuted).toBeUndefined()
  })
  it('rejects traversal metadata, malformed YAML and absent remote cache without fetching', async () => {
    await writeFile(
      join(directory, 'profiles', 'list.yml'),
      stringify({
        files: [
          { time: '../../outside.yaml' },
          { time: 'absent.yml', name: 'No cache', url: 'https://example.com/no-cache' }
        ]
      })
    )
    await writeFile(join(directory, 'profiles', 'broken.yaml'), 'proxies: [broken')
    const preview = await inspectCfwDirectory(directory)
    expect(preview.candidates).toHaveLength(0)
    expect(preview.warnings.join(' ')).toContain('跨目录')
    expect(preview.warnings.join(' ')).toContain('没有可用缓存')
    expect(preview.warnings.join(' ')).toContain('YAML 格式无效')
  })
  it('applies only selected profiles and does not silently add unreviewed IDs', async () => {
    await writeFile(join(directory, 'profiles', 'one.yaml'), content)
    await writeFile(join(directory, 'profiles', 'two.yaml'), content)
    const preview = await inspectCfwDirectory(directory)
    await expect(
      applyCfwMigration(preview.planId, { profileIds: ['not-previewed'] })
    ).rejects.toThrow('清单')
    const result = await applyCfwMigration(preview.planId, {
      profileIds: [preview.candidates[0].id],
      overrideIds: []
    })
    expect(result.importedProfiles).toHaveLength(1)
    expect(profileConfig.items).toHaveLength(2)
  })
  it('keeps original settings on partial import failure and returns actionable warnings', async () => {
    await writeFile(join(directory, 'profiles', 'one.yaml'), content)
    writeProfile.mockRejectedValueOnce(new Error('disk full'))
    const preview = await inspectCfwDirectory(directory),
      result = await applyCfwMigration(preview.planId)
    expect(result.importedProfiles).toHaveLength(0)
    expect(result.warnings.join(' ')).toContain('导入失败')
    expect(profileConfig.items).toHaveLength(1)
    expect(profileConfig.current).toBe('existing')
  })
  it('native picker cancellation leaves no import action', async () => {
    chooseFolder.mockResolvedValue({ canceled: true, filePaths: [] })
    expect(await previewCfwMigration()).toBeNull()
    expect(writeProfile).not.toHaveBeenCalled()
  })
})
