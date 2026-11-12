import { mkdir, lstat, readFile, readdir, unlink } from 'fs/promises'
import path from 'path'
import { dialog, protocol } from 'electron'
import AdmZip from 'adm-zip'
import { inspectThemeAsset } from '../dex-legacy/theme-assets.cjs'
import { dataDir } from '../utils/dirs'
import { atomicWriteFile } from '../utils/safeFile'
import {
  themeAssets,
  validateThemeAsset,
  THEME_VIDEO_LIMIT,
  type ThemeAsset
} from '../../shared/theme-media'
import { validateDexTheme, type DexTheme } from '../../shared/dex-theme'
import { assertNoLinks } from './backup-external'

const CACHE_LIMIT = 512 * 1024 * 1024
const PACKAGE_LIMIT = 42 * 1024 * 1024
function cacheDirectory(): string {
  return path.join(dataDir(), 'dex-library', 'theme-assets')
}
function cachePath(sha256: string): string {
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('媒体标识无效')
  return path.join(cacheDirectory(), sha256)
}

export async function pruneThemeMedia(themes: DexTheme[]): Promise<number> {
  const keep = new Set(themes.flatMap(themeAssets).map((asset) => asset.sha256))
  await assertNoLinks(cacheDirectory())
  const names = await readdir(cacheDirectory()).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  })
  let count = 0
  for (const name of names) {
    if (!/^[a-f0-9]{64}$/.test(name) || keep.has(name)) continue
    const file = cachePath(name)
    await assertNoLinks(file)
    if ((await lstat(file)).isFile()) {
      await unlink(file)
      count++
    }
  }
  return count
}

export async function readThemeAsset(asset: ThemeAsset): Promise<Buffer> {
  validateThemeAsset(asset)
  const file = cachePath(asset.sha256)
  await assertNoLinks(file)
  const stat = await lstat(file)
  if (!stat.isFile() || stat.size !== asset.size || stat.size > THEME_VIDEO_LIMIT)
    throw new Error('媒体文件大小不一致')
  const bytes = await readFile(file)
  inspectThemeAsset(bytes, asset)
  return bytes
}

export async function cacheThemeAsset(
  bytes: Uint8Array,
  expected?: ThemeAsset
): Promise<ThemeAsset> {
  const asset = inspectThemeAsset(bytes, expected)
  await assertNoLinks(cacheDirectory())
  await mkdir(cacheDirectory(), { recursive: true })
  const file = cachePath(asset.sha256)
  await assertNoLinks(file)
  try {
    await readThemeAsset(asset)
    return asset
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  let total = 0
  for (const name of await readdir(cacheDirectory()))
    if (/^[a-f0-9]{64}$/.test(name)) total += (await lstat(cachePath(name))).size
  if (total + asset.size > CACHE_LIMIT)
    throw new Error('本地主题媒体缓存超过 512 MB，请先清理不再使用的设计资源')
  await atomicWriteFile(file, bytes, { mode: 0o600 })
  return asset
}

export async function importThemeMedia(kind: unknown): Promise<ThemeAsset | null> {
  if (kind !== 'image' && kind !== 'video') throw new Error('请选择图片或视频')
  const result = await dialog.showOpenDialog({
    title: kind === 'image' ? '选择静态图片（最大 8 MB）' : '选择视频（最大 32 MB）',
    properties: ['openFile'],
    filters: [
      {
        name: kind === 'image' ? '静态图片' : '视频',
        extensions: kind === 'image' ? ['png', 'jpg', 'jpeg', 'webp'] : ['mp4', 'webm']
      }
    ]
  })
  if (result.canceled || !result.filePaths[0]) return null
  const file = result.filePaths[0]
  const stat = await lstat(file)
  if (!stat.isFile() || stat.size > THEME_VIDEO_LIMIT)
    throw new Error('请选择不超过 32 MB 的普通媒体文件')
  const bytes = await readFile(file)
  const asset = inspectThemeAsset(bytes)
  validateThemeAsset(asset, kind)
  return cacheThemeAsset(bytes, asset)
}

export async function ensureThemeAssets(
  theme: DexTheme,
  fetchAsset?: (asset: ThemeAsset) => Promise<Uint8Array>
): Promise<void> {
  for (const asset of themeAssets(theme)) {
    try {
      await readThemeAsset(asset)
    } catch (error) {
      if (!fetchAsset || (error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new Error('主题媒体文件缺失或损坏，请重新导入完整主题包。')
      await cacheThemeAsset(await fetchAsset(asset), asset)
    }
  }
}

export async function exportThemePackage(
  theme: DexTheme
): Promise<{ saved: true; filename: string } | null> {
  const safe = validateDexTheme(theme)
  const zip = new AdmZip()
  zip.addFile('theme.json', Buffer.from(JSON.stringify(safe)))
  for (const asset of themeAssets(safe))
    zip.addFile(`assets/${asset.sha256}`, await readThemeAsset(asset))
  const result = await dialog.showSaveDialog({
    title: '导出包含媒体的主题包',
    defaultPath: `${safe.id}.naviotheme`,
    filters: [{ name: 'Navio 完整主题包', extensions: ['naviotheme'] }]
  })
  if (result.canceled || !result.filePath) return null
  await atomicWriteFile(result.filePath, zip.toBuffer())
  return { saved: true, filename: path.basename(result.filePath) }
}

export async function importThemePackage(): Promise<DexTheme | null> {
  const result = await dialog.showOpenDialog({
    title: '导入 Navio 主题',
    properties: ['openFile'],
    filters: [{ name: 'Navio 主题', extensions: ['naviotheme', 'json'] }]
  })
  if (result.canceled || !result.filePaths[0]) return null
  const file = result.filePaths[0],
    stat = await lstat(file)
  if (!stat.isFile() || stat.size > PACKAGE_LIMIT)
    throw new Error('主题包超过 42 MB 或不是普通文件')
  const bytes = await readFile(file)
  if (path.extname(file).toLowerCase() === '.json') {
    if (bytes.length > 12288) throw new Error('主题 JSON 超过 12 KB')
    const theme = validateDexTheme(JSON.parse(bytes.toString('utf8')))
    await ensureThemeAssets(theme)
    return theme
  }
  return unpackThemePackage(bytes)
}

export async function unpackThemePackage(bytes: Buffer): Promise<DexTheme> {
  if (bytes.length > PACKAGE_LIMIT) throw new Error('主题包超过 42 MB')
  const zip = new AdmZip(bytes),
    entries = zip.getEntries()
  if (
    entries.length > 3 ||
    entries.some(
      (entry) =>
        entry.isDirectory ||
        (entry.entryName !== 'theme.json' && !/^assets\/[a-f0-9]{64}$/.test(entry.entryName)) ||
        ((entry.header.attr >>> 16) & 0o170000) === 0o120000
    ) ||
    new Set(entries.map((e) => e.entryName)).size !== entries.length ||
    entries.reduce((sum, entry) => sum + entry.header.size, 0) > PACKAGE_LIMIT
  )
    throw new Error('主题包包含不支持的路径或过大的资源')
  const definition = zip.getEntry('theme.json')
  if (!definition || definition.header.size > 12288) throw new Error('主题包缺少有效主题定义')
  const theme = validateDexTheme(JSON.parse(definition.getData().toString('utf8')))
  const assets = themeAssets(theme),
    expected = new Set(['theme.json', ...assets.map((asset) => `assets/${asset.sha256}`)])
  if (entries.some((entry) => !expected.has(entry.entryName)))
    throw new Error('主题包包含未引用的资源')
  const prepared = assets.map((asset) => {
    const entry = zip.getEntry(`assets/${asset.sha256}`)
    if (!entry || entry.header.size !== asset.size) throw new Error('主题包缺少媒体资源')
    const data = entry.getData()
    inspectThemeAsset(data, asset)
    return { asset, data }
  })
  for (const item of prepared) await cacheThemeAsset(item.data, item.asset)
  return theme
}

export function registerThemeMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'navio-theme',
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ])
}
export function handleThemeMediaScheme(): void {
  protocol.handle('navio-theme', async (request) => {
    try {
      const url = new URL(request.url)
      if (
        url.hostname !== 'asset' ||
        !/^\/[a-f0-9]{64}$/.test(url.pathname) ||
        url.search ||
        url.hash ||
        !['GET', 'HEAD'].includes(request.method)
      )
        return new Response(null, { status: 404 })
      const file = cachePath(url.pathname.slice(1))
      await assertNoLinks(file)
      const stat = await lstat(file)
      if (!stat.isFile() || stat.size > THEME_VIDEO_LIMIT)
        return new Response(null, { status: 404 })
      const bytes = await readFile(file),
        asset = inspectThemeAsset(bytes)
      if (asset.sha256 !== url.pathname.slice(1)) return new Response(null, { status: 404 })
      let start = 0,
        end = bytes.length - 1,
        status = 200
      const headers = new Headers({
        'content-type': asset.mime,
        'accept-ranges': 'bytes',
        'cache-control': 'private, max-age=3600',
        'x-content-type-options': 'nosniff'
      })
      const range = request.headers.get('range')
      if (range) {
        const parts = /^bytes=(\d+)-(\d*)$/.exec(range)
        if (
          !parts ||
          Number(parts[1]) >= bytes.length ||
          (parts[2] && Number(parts[2]) < Number(parts[1]))
        )
          return new Response(null, { status: 416 })
        start = Number(parts[1])
        end = parts[2] ? Math.min(end, Number(parts[2])) : end
        status = 206
        headers.set('content-range', `bytes ${start}-${end}/${bytes.length}`)
      }
      headers.set('content-length', String(end - start + 1))
      return new Response(
        request.method === 'HEAD' ? null : new Uint8Array(bytes.subarray(start, end + 1)),
        { status, headers }
      )
    } catch {
      return new Response(null, { status: 404 })
    }
  })
}
