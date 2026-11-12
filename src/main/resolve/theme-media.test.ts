import { mkdtemp, readFile, rm, writeFile, mkdir, symlink } from 'fs/promises'
import os from 'os'
import path from 'path'
import AdmZip from 'adm-zip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BUILTIN_THEMES, validateTheme } from '../dex-legacy/themes.cjs'
import { inspectThemeAsset } from '../dex-legacy/theme-assets.cjs'
import { validateDexTheme, dexThemeCss, type DexTheme } from '../../shared/dex-theme'
import { validateThemeAsset, themeAssetUrl } from '../../shared/theme-media'
import {
  cacheThemeAsset,
  readThemeAsset,
  ensureThemeAssets,
  exportThemePackage,
  importThemePackage,
  unpackThemePackage,
  importThemeMedia,
  registerThemeMediaScheme,
  handleThemeMediaScheme
} from './theme-media'

const mocks = vi.hoisted(() => ({
  directory: '',
  open: vi.fn(),
  save: vi.fn(),
  handle: vi.fn(),
  register: vi.fn()
}))
vi.mock('../utils/dirs', () => ({ dataDir: () => mocks.directory }))
vi.mock('electron', () => ({
  dialog: { showOpenDialog: mocks.open, showSaveDialog: mocks.save },
  protocol: { handle: mocks.handle, registerSchemesAsPrivileged: mocks.register }
}))

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
)
const asset = inspectThemeAsset(png)
const theme = (): DexTheme => ({
  ...structuredClone(BUILTIN_THEMES[0]),
  id: 'custom-media',
  background: { type: 'image', asset, opacity: 0.4, fit: 'cover' }
})
beforeEach(async () => {
  vi.clearAllMocks()
  mocks.directory = await mkdtemp(path.join(os.tmpdir(), 'navio-theme-media-'))
})
afterEach(async () => {
  if (
    path.dirname(mocks.directory) !== os.tmpdir() ||
    !path.basename(mocks.directory).startsWith('navio-theme-media-')
  )
    throw new Error('Unexpected test directory')
  await rm(mocks.directory, { recursive: true, force: true })
})

describe('theme media schema and complete offline packages', () => {
  it('keeps strict shared and legacy schemas aligned and emits no resource URLs into CSS', () => {
    expect(validateDexTheme(theme())).toEqual(validateTheme(theme()))
    expect(dexThemeCss(theme())).not.toContain(asset.sha256)
    expect(dexThemeCss(theme())).toContain('background: transparent')
    expect(themeAssetUrl(asset)).toBe(`navio-theme://asset/${asset.sha256}`)
    for (const background of [
      { type: 'image', asset: { ...asset, url: 'https://outside.test/x' } },
      { type: 'video', asset: { ...asset, mime: 'video/mp4' } },
      { type: 'image', asset, opacity: 2 },
      { type: 'image', asset: { ...asset, sha256: '../secret' } }
    ]) {
      expect(() => validateDexTheme({ ...theme(), background })).toThrow()
      expect(() => validateTheme({ ...theme(), background })).toThrow()
    }
  })
  it('checks actual signatures, size, animated image flags and content identity', () => {
    expect(asset).toMatchObject({ mime: 'image/png', size: png.length })
    expect(() => inspectThemeAsset(Buffer.from('<svg onload="alert(1)"></svg>'))).toThrow()
    expect(() => inspectThemeAsset(png, { ...asset, mime: 'image/jpeg' })).toThrow('不一致')
    expect(() => inspectThemeAsset(png.subarray(0, 30))).toThrow()
    expect(() => validateThemeAsset({ ...asset, size: 9 * 1024 * 1024 })).toThrow()
    const animation = Buffer.from(png)
    animation.write('acTL', 37)
    expect(() => inspectThemeAsset(animation)).toThrow('静态')
    const corruptCrc = Buffer.from(png)
    corruptCrc[50] ^= 1
    expect(() => inspectThemeAsset(corruptCrc)).toThrow('校验码')
    const missingIdat = Buffer.concat([png.subarray(0, 33), png.subarray(png.length - 12)])
    expect(() => inspectThemeAsset(missingIdat)).toThrow('不完整')
  })
  it('requires an MP4 video track and bounded container structure', () => {
    const box = (type: string, contents: Buffer): Buffer => {
      const header = Buffer.alloc(8)
      header.writeUInt32BE(contents.length + 8)
      header.write(type, 4)
      return Buffer.concat([header, contents])
    }
    const makeMp4 = (handler: string): Buffer =>
      Buffer.concat([
        box('ftyp', Buffer.from('isom\0\0\0\0isom', 'ascii')),
        box(
          'moov',
          box(
            'trak',
            box('mdia', box('hdlr', Buffer.concat([Buffer.alloc(8), Buffer.from(handler)])))
          )
        ),
        box('mdat', Buffer.from([0]))
      ])
    expect(inspectThemeAsset(makeMp4('vide')).mime).toBe('video/mp4')
    expect(() => inspectThemeAsset(makeMp4('soun'))).toThrow('视频')
    expect(() => inspectThemeAsset(makeMp4('vide').subarray(0, -1))).toThrow()
    const oversizedHeader = makeMp4('vide')
    oversizedHeader.writeUInt32BE(1)
    oversizedHeader.writeBigUInt64BE(8n, 8)
    expect(() => inspectThemeAsset(oversizedHeader)).toThrow('长度')
  })
  it('stores only hash-addressed assets and reloads a theme without any network', async () => {
    await cacheThemeAsset(png, asset)
    const fetcher = vi.fn()
    await ensureThemeAssets(theme(), fetcher)
    expect(fetcher).not.toHaveBeenCalled()
    expect(await readThemeAsset(asset)).toEqual(png)
    await writeFile(path.join(mocks.directory, 'dex-library/theme-assets', asset.sha256), 'corrupt')
    await expect(readThemeAsset(asset)).rejects.toThrow()
  })
  it('exports and imports the referenced resource and rejects missing/corrupt/traversal entries before caching', async () => {
    await cacheThemeAsset(png, asset)
    const target = path.join(mocks.directory, 'design.naviotheme')
    mocks.save.mockResolvedValue({ canceled: false, filePath: target })
    await exportThemePackage(theme())
    const zip = new AdmZip(await readFile(target))
    expect(
      zip
        .getEntries()
        .map((entry) => entry.entryName)
        .sort()
    ).toEqual([`assets/${asset.sha256}`, 'theme.json'])
    expect(await unpackThemePackage(zip.toBuffer())).toEqual(theme())
    mocks.open.mockResolvedValue({ canceled: false, filePaths: [target] })
    expect(await importThemePackage()).toEqual(theme())
    zip.deleteFile(`assets/${asset.sha256}`)
    await expect(unpackThemePackage(zip.toBuffer())).rejects.toThrow('缺少媒体')
    zip.addFile(`assets/${asset.sha256}`, Buffer.from('corrupt'))
    await expect(unpackThemePackage(zip.toBuffer())).rejects.toThrow()
    zip.addFile('assets/other-file', Buffer.from('outside'))
    await expect(unpackThemePackage(zip.toBuffer())).rejects.toThrow('路径')
  })
  it('accepts only a dialog-picked file with matching media kind and never follows cache junctions', async () => {
    const source = path.join(mocks.directory, 'picked.mp4')
    await writeFile(source, png)
    mocks.open.mockResolvedValue({ canceled: false, filePaths: [source] })
    await expect(importThemeMedia('video')).rejects.toThrow()
    expect(await importThemeMedia('image')).toEqual(asset)
    const other = path.join(mocks.directory, 'other')
    await mkdir(other)
    const linkRoot = path.join(mocks.directory, 'linked-data')
    await symlink(other, linkRoot, 'junction')
    const original = mocks.directory
    mocks.directory = linkRoot
    try {
      await expect(cacheThemeAsset(png)).rejects.toThrow('链接')
    } finally {
      mocks.directory = original
    }
  })
  it('serves only cached hashes through the local scheme and supports bounded byte ranges', async () => {
    await cacheThemeAsset(png)
    registerThemeMediaScheme()
    handleThemeMediaScheme()
    expect(mocks.register).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ scheme: 'navio-theme' })])
    )
    const handler = mocks.handle.mock.calls[0][1] as (req: Request) => Promise<Response>
    const response = await handler(
      new Request(themeAssetUrl(asset), { headers: { Range: 'bytes=0-7' } })
    )
    expect(response.status).toBe(206)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png.subarray(0, 8))
    expect(
      (await handler(new Request(`navio-theme://asset/${asset.sha256}?path=outside`))).status
    ).toBe(404)
    expect(
      (await handler(new Request(themeAssetUrl(asset), { headers: { Range: 'bytes=999999-' } })))
        .status
    ).toBe(416)
  })
})
