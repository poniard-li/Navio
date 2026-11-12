import { validateThemeBackground, type ThemeBackground } from './theme-media'
export const DEX_COLOR_KEYS = [
  'bg',
  'surface',
  'surfaceRaised',
  'border',
  'text',
  'muted',
  'accent',
  'accentText',
  'success'
] as const
export type DexColorKey = (typeof DEX_COLOR_KEYS)[number]
export interface DexTheme {
  id: string
  name: string
  author: string
  description: string
  appearance: 'dark' | 'light'
  radius: number
  colors: Record<DexColorKey, string>
  fontFamily?: string
  background?: ThemeBackground
}
export interface DexThemeCatalog {
  builtins: DexTheme[]
  local: DexTheme[]
  remote: DexTheme[]
  selectedId: string
  serverUrl: string
  remoteError: string | null
}
export const DEX_THEME_ACTIONS = [
  'list',
  'save',
  'apply',
  'import',
  'export',
  'configure',
  'refresh',
  'publish',
  'preview',
  'cancelPreview',
  'installCloud',
  'reviewPublication',
  'editPublication',
  'importMedia',
  'loadMedia',
  'pruneMedia',
  'activeBackground',
  'officialCatalog',
  'installOfficial',
  'removeOfficial',
  'officialSettings',
  'officialFavorite',
  'trial',
  'trialState',
  'keepTrial',
  'restoreTrial'
] as const
export type DexThemeAction = (typeof DEX_THEME_ACTIONS)[number]

export function validateDexTheme(input: unknown): DexTheme {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('主题必须是 JSON 对象')
  const value = input as Record<string, unknown>
  const fields = ['id', 'name', 'author', 'description', 'appearance', 'radius', 'colors']
  if (
    fields.some((key) => !(key in value)) ||
    Object.keys(value).some((key) => ![...fields, 'fontFamily', 'background'].includes(key))
  )
    throw new Error('主题字段不完整或包含不支持的字段')
  if (typeof value.id !== 'string' || !/^[a-z][a-z0-9-]{2,47}$/.test(value.id))
    throw new Error('主题 ID 格式不正确')
  for (const [key, max] of [
    ['name', 48],
    ['author', 64],
    ['description', 240]
  ] as const) {
    const text = value[key]
    if (
      typeof text !== 'string' ||
      text.length > max ||
      (key !== 'description' && !text.trim()) ||
      [...text].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
      /[<>]|(?:https?|data|javascript|file):|url\s*\(/i.test(text)
    )
      throw new Error(`${key} 需要有效的纯文本`)
  }
  if (!['dark', 'light'].includes(String(value.appearance))) throw new Error('主题外观格式不正确')
  if (!Number.isInteger(value.radius) || Number(value.radius) < 8 || Number(value.radius) > 24)
    throw new Error('圆角范围是 8–24')
  if (!value.colors || typeof value.colors !== 'object' || Array.isArray(value.colors))
    throw new Error('缺少主题颜色')
  const colors = value.colors as Record<string, unknown>
  if (
    Object.keys(colors).length !== DEX_COLOR_KEYS.length ||
    Object.keys(colors).some((key) => !DEX_COLOR_KEYS.includes(key as DexColorKey))
  )
    throw new Error('主题颜色字段不完整')
  for (const key of DEX_COLOR_KEYS)
    if (typeof colors[key] !== 'string' || !/^#[0-9a-f]{6}$/i.test(colors[key]))
      throw new Error(`${key} 必须使用 #RRGGBB 颜色`)
  if (
    value.fontFamily !== undefined &&
    (typeof value.fontFamily !== 'string' || !/^[\p{L}\p{N} ,._-]{1,100}$/u.test(value.fontFamily))
  )
    throw new Error('字体名称需要 1–100 个字母、数字或常用文字，不接受 CSS 代码')
  if (value.background !== undefined) {
    validateThemeBackground(value.background)
  }
  return structuredClone(input) as DexTheme
}

function rgb(hex: string): number[] {
  return [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16))
}
export function hexToHsl(hex: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error('无效颜色')
  const [r, g, b] = rgb(hex).map((value) => value / 255)
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    delta = max - min
  const lightness = (max + min) / 2
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1))
  const hue =
    delta === 0
      ? 0
      : max === r
        ? ((g - b) / delta) % 6
        : max === g
          ? (b - r) / delta + 2
          : (r - g) / delta + 4
  return `${((hue * 60 + 360) % 360).toFixed(2)} ${(saturation * 100).toFixed(2)}% ${(lightness * 100).toFixed(2)}%`
}
function blend(a: string, b: string, amount: number): string {
  const av = rgb(a),
    bv = rgb(b)
  return (
    '#' +
    av
      .map((value, index) =>
        Math.round(value * (1 - amount) + bv[index] * amount)
          .toString(16)
          .padStart(2, '0')
      )
      .join('')
  )
}

/** CSS is generated only from validated hex values and bounded numbers. No user CSS is accepted. */
export function dexThemeCss(input: unknown): string {
  const theme = validateDexTheme(input),
    c = theme.colors
  const hexVariables: Record<string, string> = {
    'dex-bg': c.bg,
    'dex-background': c.bg,
    'dex-sidebar': c.surface,
    'dex-surface': c.surface,
    'dex-surface-raised': c.surfaceRaised,
    'dex-border': c.border,
    'dex-text': c.text,
    'dex-muted': c.muted,
    'dex-accent': c.accent,
    'dex-accent-text': c.accentText,
    'dex-success': c.success
  }
  hexVariables['dex-sidebar-text'] = c.text
  hexVariables['dex-sidebar-muted'] = c.muted
  hexVariables['dex-sidebar-active'] = blend(c.surface, c.accent, 0.14)
  hexVariables['dex-sidebar-line'] = c.border
  const hero: Record<string, string> = {
    background: c.bg,
    foreground: c.text,
    divider: c.border,
    focus: c.accent,
    content1: c.surface,
    content2: c.surfaceRaised,
    content3: c.border,
    content4: c.muted,
    primary: c.accent,
    'primary-foreground': c.accentText,
    secondary: c.accent,
    'secondary-foreground': c.accentText,
    success: c.success,
    'success-foreground': c.bg,
    default: c.surfaceRaised,
    'default-foreground': c.text
  }
  for (const content of ['content1', 'content2', 'content3', 'content4'])
    hero[`${content}-foreground`] = c.text
  for (const [index, amount] of [
    [50, 0.05],
    [100, 0.1],
    [200, 0.2],
    [300, 0.35],
    [400, 0.6],
    [500, 1],
    [600, 0.85],
    [700, 0.7],
    [800, 0.55],
    [900, 0.4]
  ] as const) {
    hero[`primary-${index}`] = blend(c.bg, c.accent, amount)
    hero[`secondary-${index}`] = hero[`primary-${index}`]
    hero[`default-${index}`] = blend(c.bg, c.text, index / 1000)
  }
  hero['default-500'] = c.muted
  const properties = [
    ...Object.entries(hexVariables).map(([key, value]) => `--${key}: ${value};`),
    ...Object.entries(hero).map(([key, value]) => `--heroui-${key}: ${hexToHsl(value)};`),
    `--dex-radius: ${theme.radius}px;`,
    `--heroui-radius-large: ${theme.radius}px;`,
    `--heroui-radius-medium: ${Math.max(8, theme.radius - 4)}px;`,
    `--heroui-radius-small: ${Math.max(4, theme.radius - 8)}px;`,
    '--heroui-divider-opacity: 1;',
    `color-scheme: ${theme.appearance};`
  ]
  const font = theme.fontFamily
    ? `font-family: ${theme.fontFamily
        .split(',')
        .map((f) => JSON.stringify(f.trim()))
        .join(',')}, sans-serif;`
    : ''
  const bg = theme.background
  const background =
    bg && (bg.type === 'solid' || bg.type === 'gradient')
      ? `background: ${bg.type === 'solid' || bg.colors.length === 1 ? bg.colors[0] : `linear-gradient(${bg.angle ?? 135}deg,${bg.colors.join(',')})`};`
      : ''
  return `/* D.E.X ${theme.id} */\n:root, html.light, html.dark, .light, .dark {\n  ${properties.join('\n  ')}\n}\nbody { ${font} ${background} }\n${bg ? '.dex-shell,.dex-main { background: transparent !important; }' : ''}\n`
}
