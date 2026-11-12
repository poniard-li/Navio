import { mkdtemp, mkdir, readFile, rm, writeFile, symlink } from 'fs/promises'
import os from 'os'
import path from 'path'
import AdmZip from 'adm-zip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parse, stringify } from '../utils/yaml'
import {
  approveBackupExternalFiles,
  exportLocalBackup,
  importLocalBackup,
  previewBackupExternalFiles
} from './backup'

const mocks = vi.hoisted(() => ({
  root: '',
  archive: '',
  save: vi.fn(),
  open: vi.fn(),
  message: vi.fn()
}))
vi.mock('electron', () => ({
  dialog: { showSaveDialog: mocks.save, showOpenDialog: mocks.open, showMessageBox: mocks.message }
}))
vi.mock('../utils/dirs', () => ({
  dataDir: () => mocks.root,
  appConfigPath: () => `${mocks.root}/config.yaml`,
  controledMihomoConfigPath: () => `${mocks.root}/mihomo.yaml`,
  overrideConfigPath: () => `${mocks.root}/override.yaml`,
  profileConfigPath: () => `${mocks.root}/profile.yaml`,
  overrideDir: () => `${mocks.root}/override`,
  profilesDir: () => `${mocks.root}/profiles`,
  rulesDir: () => `${mocks.root}/rules`,
  subStoreDir: () => `${mocks.root}/substore`,
  themesDir: () => `${mocks.root}/themes`
}))
vi.mock('../config', () => ({
  getAppConfig: async () => ({
    backupEncrypted: false,
    autoConnect: true,
    sysProxy: { enable: true },
    githubToken: 'test-secret'
  })
}))
vi.mock('./backup-password', () => ({ readBackupPassword: async () => '' }))
vi.mock('../utils/logger', () => ({ systemLogger: { info: vi.fn(), error: vi.fn() } }))
describe('backup export and restore integration', () => {
  let directory: string
  beforeEach(async () => {
    vi.clearAllMocks()
    directory = await mkdtemp(path.join(os.tmpdir(), 'navio-backup-test-'))
    mocks.root = path.join(directory, 'data')
    mocks.archive = path.join(directory, 'backup.zip')
    await mkdir(path.join(mocks.root, 'profiles'), { recursive: true })
    mocks.save.mockResolvedValue({ canceled: false, filePath: mocks.archive })
    mocks.open.mockResolvedValue({ canceled: false, filePaths: [mocks.archive] })
    await writeFile(path.join(mocks.root, 'mihomo.yaml'), 'tun:\n  enable: true\n')
  })
  afterEach(async () => {
    if (
      path.dirname(directory) !== os.tmpdir() ||
      !path.basename(directory).startsWith('navio-backup-test-')
    )
      throw new Error('Unexpected test directory')
    await rm(directory, { recursive: true, force: true })
  })

  it('round-trips approved external resources and keeps vaults, original paths and proxy startup out of restoration', async () => {
    const outside = path.join(directory, 'external.yaml')
    await writeFile(outside, 'payload: [example.com]')
    await writeFile(
      path.join(mocks.root, 'profiles/test.yaml'),
      stringify({ 'rule-providers': { custom: { path: outside } } })
    )
    await writeFile(path.join(mocks.root, 'dex-account-vault.bin'), 'test-vault')
    const preview = await previewBackupExternalFiles()
    await approveBackupExternalFiles(preview.token, [preview.files[0].id])
    expect(await exportLocalBackup()).toBe(true)
    const zip = new AdmZip(await readFile(mocks.archive))
    expect(zip.getEntry('backup-external-approvals.json')).toBeNull()
    expect(zip.getEntry('dex-account-vault.bin')).toBeNull()
    expect(zip.readAsText('config.yaml')).not.toContain('test-secret')
    await writeFile(outside, 'preserve current external file')
    expect(await importLocalBackup()).toBe(true)
    const restored = parse<{ 'rule-providers': { custom: { path: string } } }>(
      await readFile(path.join(mocks.root, 'profiles/test.yaml'), 'utf8')
    )
    expect(
      restored['rule-providers'].custom.path.startsWith(
        path.join(mocks.root, 'restored-resources') + path.sep
      )
    ).toBe(true)
    expect(await readFile(restored['rule-providers'].custom.path, 'utf8')).toBe(
      'payload: [example.com]'
    )
    expect(await readFile(outside, 'utf8')).toBe('preserve current external file')
    expect(parse(await readFile(path.join(mocks.root, 'config.yaml'), 'utf8'))).toMatchObject({
      autoConnect: false,
      webdavEnabled: false,
      sysProxy: { enable: false }
    })
    expect(parse(await readFile(path.join(mocks.root, 'mihomo.yaml'), 'utf8'))).toEqual({
      tun: { enable: false }
    })
  })

  it('rejects a linked restore directory before changing any config', async () => {
    const zip = new AdmZip()
    zip.addFile('config.yaml', Buffer.from('autoConnect: true'))
    zip.addFile('rules/injected.yaml', Buffer.from('unwanted'))
    await writeFile(mocks.archive, zip.toBuffer())
    const other = path.join(directory, 'other')
    await mkdir(other)
    await symlink(other, path.join(mocks.root, 'rules'), 'junction')
    await expect(importLocalBackup()).rejects.toThrow('链接')
    await expect(readFile(path.join(mocks.root, 'config.yaml'))).rejects.toThrow()
    await expect(readFile(path.join(other, 'injected.yaml'))).rejects.toThrow()
  })

  it('reports excluded external files when restoring a backup', async () => {
    await writeFile(
      path.join(mocks.root, 'profiles/test.yaml'),
      stringify({ 'rule-providers': { missing: { path: path.join(directory, 'missing.yaml') } } })
    )
    await exportLocalBackup()
    await importLocalBackup()
    expect(mocks.message).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '备份已恢复，部分外部文件未包含',
        detail: expect.stringContaining('文件不存在')
      })
    )
  })
})
