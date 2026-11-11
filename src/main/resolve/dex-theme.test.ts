import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { BUILTIN_THEMES } from '../dex-legacy/themes.cjs'

const mocks = vi.hoisted(() => {
  const frame = { url: 'file:///test/index.html' }
  const webContents = {
    mainFrame: frame,
    insertCSS: vi.fn(async () => 'preview-key'),
    removeInsertedCSS: vi.fn(async () => {}),
    send: vi.fn()
  }
  return {
    directory: '',
    config: { appTheme: 'system', customTheme: 'default.css' },
    frame,
    webContents,
    writeTheme: vi.fn(async () => {}),
    applyTheme: vi.fn(async () => {}),
    accountRequest: vi.fn()
  }
})
vi.mock('electron', () => ({ dialog: {} }))
vi.mock('../utils/dirs', () => ({ dataDir: () => mocks.directory }))
vi.mock('../window', () => ({
  mainWindow: { webContents: mocks.webContents, isDestroyed: () => false }
}))
vi.mock('./theme', () => ({ writeTheme: mocks.writeTheme, applyTheme: mocks.applyTheme }))
vi.mock('./dex-account', () => ({
  dexServerUrl: async () => 'https://navio.mydex.top',
  dexAccountRequest: mocks.accountRequest
}))
vi.mock('../config', () => ({
  getAppConfig: async () => mocks.config,
  patchAppConfig: async (patch: Record<string, string>) => {
    Object.assign(mocks.config, patch)
  }
}))

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.directory = await mkdtemp(path.join(os.tmpdir(), 'dex-theme-ipc-'))
  mocks.config = { appTheme: 'system', customTheme: 'default.css' }
})
afterEach(async () => {
  if (!mocks.directory.startsWith(path.join(os.tmpdir(), 'dex-theme-ipc-')))
    throw new Error('Unexpected test directory')
  await rm(mocks.directory, { recursive: true, force: true })
})
const event = (): IpcMainInvokeEvent =>
  ({ sender: mocks.webContents, senderFrame: mocks.frame }) as unknown as IpcMainInvokeEvent

describe('restricted D.E.X theme IPC adapter', () => {
  it('installs cloud publications under namespaced local ids instead of overwriting a built-in', async () => {
    const { dexThemes } = await import('./dex-theme')
    mocks.accountRequest.mockResolvedValueOnce({
      item: { theme: structuredClone(BUILTIN_THEMES[0]) }
    })
    const applied = (await dexThemes(event(), 'installCloud', {
      id: 'theme_test-publication'
    })) as { id: string }
    expect(applied.id).toMatch(/^cloud-[a-f0-9]{32}$/)
    expect(mocks.accountRequest).toHaveBeenCalledWith('/api/v1/themes/theme_test-publication')
    expect(mocks.writeTheme).toHaveBeenCalledWith(`dex-${applied.id}.css`, expect.any(String))
    expect(
      ((await dexThemes(event(), 'list')) as { builtins: { id: string }[] }).builtins[0].id
    ).toBe(BUILTIN_THEMES[0].id)
  })
  it('rejects cloud publication path traversal before sending credentials', async () => {
    const { dexThemes } = await import('./dex-theme')
    await expect(dexThemes(event(), 'installCloud', { id: '../../admin/users' })).rejects.toThrow(
      '主题标识'
    )
    expect(mocks.accountRequest).not.toHaveBeenCalled()
  })
  it('validates a cloud theme before applying its CSS', async () => {
    const { dexThemes } = await import('./dex-theme')
    mocks.accountRequest.mockResolvedValueOnce({
      item: { theme: { ...BUILTIN_THEMES[0], script: 'alert(1)' } }
    })
    await expect(dexThemes(event(), 'installCloud', { id: 'theme_bad' })).rejects.toThrow('不支持')
    expect(mocks.writeTheme).not.toHaveBeenCalled()
  })
  it('rejects another sender and actions outside the explicit allow-list', async () => {
    const { dexThemes } = await import('./dex-theme')
    await expect(dexThemes({ sender: {} } as IpcMainInvokeEvent, 'list')).rejects.toThrow('来源')
    await expect(dexThemes(event(), 'readAnyFile')).rejects.toThrow('不支持')
    await expect(dexThemes(event(), 'save', '../secret')).rejects.toThrow('参数')
  })
  it('applies a validated built-in using the existing CSS and app-config pipeline', async () => {
    const { dexThemes } = await import('./dex-theme')
    await dexThemes(event(), 'apply', { id: 'glacier' })
    expect(mocks.writeTheme).toHaveBeenCalledWith(
      'dex-glacier.css',
      expect.stringContaining('--heroui-primary:')
    )
    expect(mocks.config).toEqual({ appTheme: 'light', customTheme: 'dex-glacier.css' })
    expect(mocks.applyTheme).toHaveBeenCalledWith('dex-glacier.css')
    expect(mocks.webContents.send).toHaveBeenCalledWith('appConfigUpdated')
    expect(await dexThemes(event(), 'list')).toMatchObject({ selectedId: 'glacier' })
  })
  it('keeps preview transient and restores the committed appearance on cancellation', async () => {
    const { dexThemes } = await import('./dex-theme')
    await dexThemes(event(), 'preview', { theme: structuredClone(BUILTIN_THEMES[0]) })
    expect(mocks.webContents.insertCSS).toHaveBeenCalledWith(
      expect.stringContaining('--dex-sidebar:')
    )
    expect(mocks.writeTheme).not.toHaveBeenCalled()
    expect(mocks.config.customTheme).toBe('default.css')
    await dexThemes(event(), 'cancelPreview')
    expect(mocks.webContents.removeInsertedCSS).toHaveBeenCalledWith('preview-key')
    expect(mocks.config.appTheme).toBe('system')
  })
})
