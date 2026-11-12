import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { validateDexTheme, type DexTheme } from '../../shared/dex-theme'
import {
  OFFICIAL_THEMES,
  OFFICIAL_THEME_RELEASE,
  officialThemeDefinition,
  normalizeOfficialSettings,
  type OfficialThemeEntry,
  type OfficialThemePackage,
  type OfficialThemeSettings
} from '../../shared/official-themes'

const MAX_PACKAGE = 32 * 1024
const MAX_PREFERENCES = 32 * 1024
interface Preferences {
  favorites: string[]
  settings: Record<string, OfficialThemeSettings>
}

export function validateOfficialPackage(bytes: Uint8Array, id: string): OfficialThemePackage {
  const definition = officialThemeDefinition(id)
  if (!definition || bytes.byteLength > MAX_PACKAGE) throw new Error('官方主题包无效')
  if (createHash('sha256').update(bytes).digest('hex') !== definition.sha256)
    throw new Error('主题包 SHA256 不一致，请重新下载')
  const value = JSON.parse(Buffer.from(bytes).toString('utf8')) as OfficialThemePackage
  if (
    !value ||
    typeof value !== 'object' ||
    Object.keys(value).sort().join(',') !== 'revision,scene,schema,variants' ||
    value.schema !== 1 ||
    value.scene !== definition.scene ||
    value.revision !== definition.revision ||
    !value.variants ||
    Object.keys(value.variants).sort().join(',') !== 'dark,light'
  )
    throw new Error('主题包格式不受支持')
  for (const mode of ['light', 'dark'] as const) {
    const theme = validateDexTheme(value.variants[mode])
    if (
      theme.id !== id ||
      theme.appearance !== mode ||
      theme.author !== 'D.E.X Studio' ||
      theme.background?.type !== 'solid'
    )
      throw new Error('主题包内容与目录不一致')
  }
  return value
}
function allowedDownload(url: URL): boolean {
  return (
    url.protocol === 'https:' &&
    !url.username &&
    !url.password &&
    !url.hash &&
    [
      'github.com',
      'release-assets.githubusercontent.com',
      'objects.githubusercontent.com'
    ].includes(url.hostname)
  )
}
export async function downloadOfficialPackage(
  id: string,
  fetchImpl: typeof fetch = fetch
): Promise<Uint8Array> {
  const definition = officialThemeDefinition(id)
  if (!definition || definition.builtIn) throw new Error('请选择可下载的官方主题')
  let url = new URL(OFFICIAL_THEME_RELEASE + definition.filename)
  const signal = AbortSignal.timeout(60000)
  for (let count = 0; count < 6; count++) {
    if (!allowedDownload(url)) throw new Error('主题下载被重定向到不受信任的地址')
    const response = await fetchImpl(url, {
      redirect: 'manual',
      signal,
      credentials: 'omit',
      headers: { Accept: 'application/json' }
    })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      await response.body?.cancel()
      if (!location) throw new Error('主题下载重定向缺少目标')
      url = new URL(location, url)
      continue
    }
    if (!response.ok) throw new Error(`主题下载失败（HTTP ${response.status}），请稍后重试`)
    if (Number(response.headers.get('content-length')) > MAX_PACKAGE) {
      await response.body?.cancel()
      throw new Error('主题包超过大小限制')
    }
    if (!response.body) throw new Error('主题下载没有返回内容')
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = []
    let size = 0
    try {
      for (;;) {
        const part = await reader.read()
        if (part.done) break
        size += part.value.byteLength
        if (size > MAX_PACKAGE) {
          await reader.cancel()
          throw new Error('主题包超过大小限制')
        }
        chunks.push(part.value)
      }
    } finally {
      reader.releaseLock()
    }
    const bytes = Buffer.concat(chunks)
    validateOfficialPackage(bytes, id)
    return bytes
  }
  throw new Error('主题下载重定向次数过多')
}
async function atomicWrite(filename: string, bytes: string | Uint8Array): Promise<void> {
  await mkdir(path.dirname(filename), { recursive: true })
  const temporary = `${filename}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 })
    await rename(temporary, filename)
  } finally {
    await rm(temporary, { force: true }).catch(() => {})
  }
}
export class OfficialThemeStore {
  constructor(
    private directory: string,
    private fetchImpl: typeof fetch = fetch
  ) {}
  private filename(id: string): string {
    if (!officialThemeDefinition(id)) throw new Error('未知的官方主题')
    return path.join(this.directory, id + '.json')
  }
  async preferences(): Promise<Preferences> {
    try {
      const filename = path.join(this.directory, 'preferences.json')
      if ((await stat(filename)).size > MAX_PREFERENCES) return { favorites: [], settings: {} }
      const value = JSON.parse(await readFile(filename, 'utf8')) as Preferences
      const settings: Record<string, OfficialThemeSettings> = {}
      for (const theme of OFFICIAL_THEMES)
        if (value.settings?.[theme.id])
          settings[theme.id] = normalizeOfficialSettings(value.settings[theme.id])
      return {
        favorites: Array.isArray(value.favorites)
          ? value.favorites.filter((id) => !!officialThemeDefinition(id)).slice(0, 24)
          : [],
        settings
      }
    } catch {
      return { favorites: [], settings: {} }
    }
  }
  async settings(id: string, input?: unknown): Promise<OfficialThemeSettings> {
    this.filename(id)
    const prefs = await this.preferences()
    if (input !== undefined) {
      prefs.settings[id] = normalizeOfficialSettings(input)
      await atomicWrite(path.join(this.directory, 'preferences.json'), JSON.stringify(prefs) + '\n')
    }
    return prefs.settings[id] || normalizeOfficialSettings(undefined)
  }
  async restoreSettings(settings: Record<string, OfficialThemeSettings>): Promise<void> {
    const prefs = await this.preferences()
    prefs.settings = {}
    for (const [id, value] of Object.entries(settings))
      if (officialThemeDefinition(id)) prefs.settings[id] = normalizeOfficialSettings(value)
    await atomicWrite(path.join(this.directory, 'preferences.json'), JSON.stringify(prefs) + '\n')
  }
  async favorite(id: string, value: boolean): Promise<void> {
    this.filename(id)
    const prefs = await this.preferences()
    prefs.favorites = prefs.favorites.filter((item) => item !== id)
    if (value) prefs.favorites.push(id)
    await atomicWrite(path.join(this.directory, 'preferences.json'), JSON.stringify(prefs) + '\n')
  }
  async package(id: string): Promise<OfficialThemePackage> {
    const definition = officialThemeDefinition(id)
    if (!definition) throw new Error('未知的官方主题')
    if (definition.package) return structuredClone(definition.package)
    const filename = this.filename(id)
    if ((await stat(filename)).size > MAX_PACKAGE) throw new Error('主题缓存损坏，请重新下载')
    return validateOfficialPackage(await readFile(filename), id)
  }
  async list(): Promise<OfficialThemeEntry[]> {
    const prefs = await this.preferences()
    return Promise.all(
      OFFICIAL_THEMES.map(async (definition) => {
        let installed = definition.builtIn,
          cacheError: string | undefined
        if (!installed)
          try {
            await this.package(definition.id)
            installed = true
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
              cacheError = '缓存校验失败，重新下载后可用'
          }
        const { package: _package, ...meta } = definition
        void _package
        return {
          ...meta,
          installed,
          favorite: prefs.favorites.includes(definition.id),
          settings: prefs.settings[definition.id] || normalizeOfficialSettings(undefined),
          cacheError
        }
      })
    )
  }
  async install(id: string): Promise<void> {
    const definition = officialThemeDefinition(id)
    if (!definition) throw new Error('未知的官方主题')
    if (definition.builtIn) return
    try {
      await this.package(id)
      return
    } catch {
      // Only a verified cache entry can skip the download.
    }
    const bytes = await downloadOfficialPackage(id, this.fetchImpl)
    await atomicWrite(this.filename(id), bytes)
  }
  async theme(id: string, appearance: 'dark' | 'light'): Promise<DexTheme> {
    return structuredClone((await this.package(id)).variants[appearance])
  }
  async remove(id: string): Promise<void> {
    if (officialThemeDefinition(id)?.builtIn) throw new Error('内置主题不能移除')
    await rm(this.filename(id), { force: true })
  }
}
