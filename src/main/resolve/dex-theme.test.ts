import { mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { BUILTIN_THEMES } from '../dex-legacy/themes.cjs'
import { inspectThemeAsset } from '../dex-legacy/theme-assets.cjs'
import type { DexTheme } from '../../shared/dex-theme'

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
    accountRequest: vi.fn(),
    chromiumFetch: vi.fn()
  }
})
vi.mock('electron', () => ({
  dialog: {},
  nativeTheme: { shouldUseDarkColors: true },
  net: { fetch: mocks.chromiumFetch }
}))
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
  vi.unstubAllGlobals()
  if (!mocks.directory.startsWith(path.join(os.tmpdir(), 'dex-theme-ipc-')))
    throw new Error('Unexpected test directory')
  await rm(mocks.directory, { recursive: true, force: true })
})
const event = (): IpcMainInvokeEvent =>
  ({ sender: mocks.webContents, senderFrame: mocks.frame }) as unknown as IpcMainInvokeEvent

describe('restricted D.E.X theme IPC adapter', () => {
  it('downloads official themes through Chromium and reuses the verified cache without either network transport', async () => {
    const bytes = await readFile(path.resolve('scripts/theme-packages/Navio-Theme-aurora-1.json'))
    const directFetch = vi.fn().mockRejectedValue(new Error('Direct network unavailable'))
    vi.stubGlobal('fetch', directFetch)
    mocks.chromiumFetch.mockResolvedValueOnce(new Response(bytes))
    const { dexThemes } = await import('./dex-theme')
    await dexThemes(event(), 'installOfficial', { id: 'navio-aurora' })
    expect(mocks.chromiumFetch).toHaveBeenCalledWith(
      'https://github.com/poniard-li/Navio/releases/download/v1.0.0-beta.7/Navio-Theme-aurora-1.json',
      expect.objectContaining({
        redirect: 'manual',
        credentials: 'omit',
        signal: expect.any(AbortSignal)
      })
    )
    expect(
      await readFile(path.join(mocks.directory, 'dex-library/official/navio-aurora.json'))
    ).toEqual(bytes)
    mocks.chromiumFetch.mockRejectedValue(new Error('Offline'))
    await dexThemes(event(), 'installOfficial', { id: 'navio-aurora' })
    await dexThemes(event(), 'trial', { id: 'navio-aurora', appearance: 'light' })
    expect(await dexThemes(event(), 'activeBackground')).toMatchObject({
      id: 'navio-aurora',
      appearance: 'light'
    })
    expect(mocks.chromiumFetch).toHaveBeenCalledTimes(1)
    expect(directFetch).not.toHaveBeenCalled()
  })
  it('keeps cross-page trials temporary and restores settings without changing the persisted theme', async () => {
    const { dexThemes } = await import('./dex-theme')
    const original = { ...mocks.config }
    await dexThemes(event(), 'trial', { id: 'navio-liquid' })
    await dexThemes(event(), 'officialSettings', {
      id: 'navio-liquid',
      settings: { intensity: 80, appearance: 'light' }
    })
    await dexThemes(event(), 'cancelPreview')
    expect(await dexThemes(event(), 'trialState')).toMatchObject({ id: 'navio-liquid' })
    expect(await dexThemes(event(), 'activeBackground')).toMatchObject({
      id: 'navio-liquid',
      appearance: 'light'
    })
    expect(mocks.config).toEqual(original)
    await dexThemes(event(), 'restoreTrial')
    expect(await dexThemes(event(), 'trialState')).toBeNull()
    expect(await dexThemes(event(), 'officialSettings', { id: 'navio-liquid' })).toMatchObject({
      intensity: 45,
      appearance: 'system'
    })
    expect(mocks.config).toEqual(original)
  })
  it('commits a trial only after keep and prevents overriding official ids with imported designs', async () => {
    const { dexThemes } = await import('./dex-theme')
    await dexThemes(event(), 'trial', { id: 'navio-paper' })
    await dexThemes(event(), 'keepTrial')
    expect(mocks.config.customTheme).toBe('dex-navio-paper.css')
    expect(await dexThemes(event(), 'trialState')).toBeNull()
    expect(await dexThemes(event(), 'activeBackground')).toMatchObject({ id: 'navio-paper' })
    const official = await dexThemes(event(), 'activeBackground')
    await expect(dexThemes(event(), 'save', { theme: official })).rejects.toThrow('另存')
  })
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  )
  const asset = inspectThemeAsset(png)
  const mediaTheme = (): DexTheme => ({
    ...structuredClone(BUILTIN_THEMES[0]),
    id: 'custom-media',
    background: { type: 'image', asset }
  })
  it('uploads referenced assets separately before publishing a small theme definition', async () => {
    const { dexThemes } = await import('./dex-theme')
    const { cacheThemeAsset } = await import('./theme-media')
    await cacheThemeAsset(png)
    await dexThemes(event(), 'save', { theme: mediaTheme() })
    mocks.accountRequest
      .mockResolvedValueOnce({ asset })
      .mockResolvedValueOnce({ item: { theme: mediaTheme() } })
    await dexThemes(event(), 'publish', { id: 'custom-media' })
    expect(mocks.accountRequest.mock.calls[0][0]).toBe(`/api/v1/theme-assets/${asset.sha256}`)
    expect(mocks.accountRequest.mock.calls[0][1]).toMatchObject({
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' }
    })
    expect(Buffer.from(mocks.accountRequest.mock.calls[0][1].body)).toEqual(png)
    expect(JSON.parse(mocks.accountRequest.mock.calls[1][1].body)).toEqual({ theme: mediaTheme() })
    expect(mocks.accountRequest.mock.calls[1][1].body).not.toContain(png.toString('base64'))
  })
  it('downloads and validates assets before applying a cloud theme, then works offline', async () => {
    const { dexThemes } = await import('./dex-theme')
    mocks.accountRequest
      .mockResolvedValueOnce({ item: { theme: mediaTheme() } })
      .mockResolvedValueOnce(png)
    const result = (await dexThemes(event(), 'installCloud', { id: 'theme_media' })) as DexTheme
    expect(mocks.accountRequest.mock.calls[1]).toEqual([
      `/api/v1/theme-assets/${asset.sha256}`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      true,
      asset.size
    ])
    mocks.accountRequest.mockReset()
    mocks.accountRequest.mockRejectedValue(new Error('offline'))
    await dexThemes(event(), 'apply', { id: result.id })
    expect(mocks.accountRequest).not.toHaveBeenCalled()
    expect(await dexThemes(event(), 'activeBackground')).toEqual(result)
  })
  it('rejects corrupt cloud resources before saving or changing appearance', async () => {
    const { dexThemes } = await import('./dex-theme')
    mocks.accountRequest
      .mockResolvedValueOnce({ item: { theme: mediaTheme() } })
      .mockResolvedValueOnce(Buffer.from('corrupt'))
    await expect(dexThemes(event(), 'installCloud', { id: 'theme_media' })).rejects.toThrow()
    expect(mocks.writeTheme).not.toHaveBeenCalled()
    expect(((await dexThemes(event(), 'list')) as { local: DexTheme[] }).local).toHaveLength(0)
  })
  it('preserves the takedown review path while uploading a changed media draft', async () => {
    const { dexThemes } = await import('./dex-theme')
    const { cacheThemeAsset } = await import('./theme-media')
    await cacheThemeAsset(png)
    const edited = { ...mediaTheme(), name: 'Changed media draft' }
    await dexThemes(event(), 'save', { theme: edited })
    mocks.accountRequest
      .mockResolvedValueOnce({
        themes: [{ id: 'theme_mine', theme: mediaTheme(), status: 'removed' }]
      })
      .mockResolvedValueOnce({ asset })
      .mockResolvedValueOnce({ item: { theme: edited } })
    await dexThemes(event(), 'reviewPublication', { id: 'theme_mine' })
    expect(JSON.parse(mocks.accountRequest.mock.calls[2][1].body)).toEqual({
      theme: edited,
      submitReview: true
    })
  })
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
