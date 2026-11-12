export const THEME_IMAGE_LIMIT = 8 * 1024 * 1024
export const THEME_VIDEO_LIMIT = 32 * 1024 * 1024
export type ThemeAssetMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'video/mp4' | 'video/webm'
export interface ThemeAsset {
  sha256: string
  mime: ThemeAssetMime
  size: number
}
export type ThemeBackground =
  | { type: 'solid' | 'gradient'; colors: string[]; angle?: number }
  | { type: 'image'; asset: ThemeAsset; opacity?: number; fit?: 'cover' | 'contain' }
  | {
      type: 'video'
      asset: ThemeAsset
      poster: ThemeAsset
      opacity?: number
      fit?: 'cover' | 'contain'
    }

export function validateThemeAsset(value: unknown, kind?: 'image' | 'video'): ThemeAsset {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('媒体资源信息无效')
  const asset = value as ThemeAsset
  if (
    Object.keys(asset).sort().join(',') !== 'mime,sha256,size' ||
    !/^[a-f0-9]{64}$/.test(asset.sha256) ||
    !['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm'].includes(asset.mime) ||
    !Number.isSafeInteger(asset.size) ||
    asset.size < 1 ||
    asset.size > (asset.mime.startsWith('video/') ? THEME_VIDEO_LIMIT : THEME_IMAGE_LIMIT) ||
    (kind && !asset.mime.startsWith(`${kind}/`))
  )
    throw new Error('媒体需要有效的文件校验、类型与大小')
  return { sha256: asset.sha256, mime: asset.mime, size: asset.size }
}

export function validateThemeBackground(value: unknown): ThemeBackground {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('背景参数无效')
  const bg = value as ThemeBackground
  if (bg.type === 'solid' || bg.type === 'gradient') {
    if (
      Object.keys(bg).some((key) => !['type', 'colors', 'angle'].includes(key)) ||
      !Array.isArray(bg.colors) ||
      bg.colors.length < (bg.type === 'solid' ? 1 : 2) ||
      bg.colors.length > (bg.type === 'solid' ? 1 : 4) ||
      bg.colors.some((color) => typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) ||
      (bg.angle !== undefined && (!Number.isFinite(bg.angle) || bg.angle < 0 || bg.angle > 360))
    )
      throw new Error('纯色或渐变参数无效')
  } else if (bg.type === 'image' || bg.type === 'video') {
    if (
      Object.keys(bg).some(
        (key) =>
          !['type', 'asset', 'opacity', 'fit', ...(bg.type === 'video' ? ['poster'] : [])].includes(
            key
          )
      ) ||
      (bg.opacity !== undefined &&
        (!Number.isFinite(bg.opacity) || bg.opacity < 0 || bg.opacity > 1)) ||
      (bg.fit !== undefined && !['cover', 'contain'].includes(bg.fit))
    )
      throw new Error('媒体背景参数无效')
    validateThemeAsset(bg.asset, bg.type)
    if (bg.type === 'video') validateThemeAsset(bg.poster, 'image')
  } else throw new Error('不支持的背景类型')
  return structuredClone(bg)
}

export function themeAssets(theme: { background?: ThemeBackground }): ThemeAsset[] {
  const bg = theme.background
  return bg?.type === 'image' ? [bg.asset] : bg?.type === 'video' ? [bg.asset, bg.poster] : []
}
export function themeAssetUrl(asset: ThemeAsset): string {
  return `navio-theme://asset/${validateThemeAsset(asset).sha256}`
}
