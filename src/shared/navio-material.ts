export const NAVIO_MATERIAL_REGIONS = ['sidebar', 'cards', 'dialogs'] as const
export type NavioMaterialRegion = (typeof NAVIO_MATERIAL_REGIONS)[number]
export type NavioMaterialMode = 'solid' | 'frosted' | 'glass'
export type NavioMotionPolicy = 'balanced' | 'full' | 'off'
export interface NavioMaterialSurface {
  mode: NavioMaterialMode
  transparency: number
  blur: number
  sheen: number
}
export interface NavioMaterialSettings {
  version: 1
  regions: Record<NavioMaterialRegion, NavioMaterialSurface>
  flow: number
  motionPolicy: NavioMotionPolicy
}
export interface NavioMotionEnvironment {
  onBattery: boolean | null
  windowVisible: boolean
  suspended: boolean
  speedLimit: number | null
}
export const NAVIO_MATERIAL_PRESETS: Record<NavioMaterialMode, NavioMaterialSurface> = {
  solid: { mode: 'solid', transparency: 0, blur: 0, sheen: 0 },
  frosted: { mode: 'frosted', transparency: 24, blur: 30, sheen: 22 },
  glass: { mode: 'glass', transparency: 40, blur: 18, sheen: 58 }
}
export const DEFAULT_NAVIO_MATERIAL: NavioMaterialSettings = {
  version: 1,
  regions: {
    sidebar: { ...NAVIO_MATERIAL_PRESETS.glass },
    cards: { ...NAVIO_MATERIAL_PRESETS.glass, transparency: 22 },
    dialogs: { ...NAVIO_MATERIAL_PRESETS.frosted, transparency: 12 }
  },
  flow: 50,
  motionPolicy: 'balanced'
}
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
const bounded = (value: unknown, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(0, Math.round(value)))
    : fallback

export function normalizeNavioMaterial(value: unknown): NavioMaterialSettings {
  const input = record(value)
  const regions = record(input.regions)
  const result = structuredClone(DEFAULT_NAVIO_MATERIAL)
  if (input.version !== undefined && input.version !== 1) return result
  for (const key of NAVIO_MATERIAL_REGIONS) {
    const region = record(regions[key])
    const defaults = result.regions[key]
    result.regions[key] = {
      mode:
        region.mode === 'solid' || region.mode === 'frosted' || region.mode === 'glass'
          ? region.mode
          : defaults.mode,
      transparency: bounded(region.transparency, 65, defaults.transparency),
      blur: bounded(region.blur, 40, defaults.blur),
      sheen: bounded(region.sheen, 100, defaults.sheen)
    }
  }
  result.flow = bounded(input.flow, 100, result.flow)
  if (input.motionPolicy === 'full' || input.motionPolicy === 'off')
    result.motionPolicy = input.motionPolicy
  return result
}

export function navioMaterialVariables(value: NavioMaterialSettings): Record<string, string> {
  const settings = normalizeNavioMaterial(value)
  const variables: Record<string, string> = { '--navio-flow': String(settings.flow / 100) }
  for (const key of NAVIO_MATERIAL_REGIONS) {
    const region = settings.regions[key]
    const solid = region.mode === 'solid'
    variables[`--navio-${key}-opacity`] = `${solid ? 100 : 100 - region.transparency}%`
    variables[`--navio-${key}-blur`] = `${solid ? 0 : region.blur}px`
    variables[`--navio-${key}-shine`] = String(solid ? 0 : region.sheen / 100)
  }
  return variables
}

export interface NavioMotionState {
  playing: boolean
  backgroundPlaying: boolean
  overrideAllowed: boolean
  quality: 'full' | 'reduced' | 'paused'
  reason: string
  flow: number
  durationScale: number
}
export function deriveNavioMotion(
  settings: NavioMaterialSettings,
  environment: NavioMotionEnvironment,
  preferences: { hidden: boolean; reducedMotion: boolean; disabled: boolean }
): NavioMotionState {
  const material = normalizeNavioMaterial(settings)
  const overrideAllowed = !(
    preferences.hidden ||
    !environment.windowVisible ||
    environment.suspended ||
    preferences.disabled ||
    material.motionPolicy === 'off'
  )
  const paused = (reason: string): NavioMotionState => ({
    playing: false,
    backgroundPlaying: false,
    overrideAllowed,
    quality: 'paused',
    reason,
    flow: material.flow / 100,
    durationScale: 1
  })
  if (preferences.hidden || !environment.windowVisible || environment.suspended)
    return paused('窗口不可见，动效已暂停')
  if (preferences.reducedMotion) return paused('系统减少动态效果已启用')
  if (preferences.disabled || material.motionPolicy === 'off') return paused('动效已关闭')
  const slowed =
    material.motionPolicy === 'balanced' &&
    (environment.onBattery === true ||
      (environment.speedLimit !== null && environment.speedLimit < 100))
  return {
    playing: true,
    backgroundPlaying: material.flow > 0,
    overrideAllowed,
    quality: slowed ? 'reduced' : 'full',
    reason: slowed
      ? environment.onBattery
        ? '电池供电，已自动降低动效负载'
        : '系统限制处理器性能，已降低动效负载'
      : material.flow === 0
        ? '背景流动已暂停，角色动效保持原设置'
        : material.motionPolicy === 'balanced'
          ? '自动平衡 · 当前正常播放'
          : '完整动效',
    flow: material.flow / 100,
    durationScale: slowed ? 2 : 1
  }
}
