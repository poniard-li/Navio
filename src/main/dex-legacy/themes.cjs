'use strict'

const COLOR_KEYS = Object.freeze([
  'bg',
  'surface',
  'surfaceRaised',
  'border',
  'text',
  'muted',
  'accent',
  'accentText',
  'success'
])
const THEME_KEYS = Object.freeze([
  'id',
  'name',
  'author',
  'description',
  'appearance',
  'colors',
  'radius'
])
const MAX_THEME_BYTES = 8192

class ThemeValidationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ThemeValidationError'
    this.code = 'INVALID_THEME'
  }
}

function objectWithKeys(value, allowed, label) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new ThemeValidationError(`${label}必须是 JSON 对象`)
  }
  const keys = Object.keys(value)
  if (keys.length !== allowed.length || keys.some((key) => !allowed.includes(key))) {
    throw new ThemeValidationError(`${label}字段不完整或含有不支持的字段`)
  }
}

function plainText(value, field, max, optional = false) {
  if (typeof value !== 'string' || value.length > max || (!optional && !value.trim())) {
    throw new ThemeValidationError(`${field}长度必须为${optional ? 0 : 1}–${max}个字符`)
  }
  if (
    [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
    /[<>]|(?:https?|data|javascript|file):|url\s*\(/i.test(value)
  ) {
    throw new ThemeValidationError(`${field}只允许纯文本，不接受 HTML、链接或可执行内容`)
  }
  return value.trim()
}

/** Return a safe, independent theme object; throw ThemeValidationError on invalid input. */
function validateTheme(input) {
  const optional = ['fontFamily', 'background'].filter(
    (key) => input && Object.prototype.hasOwnProperty.call(input, key)
  )
  objectWithKeys(input, [...THEME_KEYS, ...optional], '主题')
  if (typeof input.id !== 'string' || !/^[a-z][a-z0-9-]{2,47}$/.test(input.id)) {
    throw new ThemeValidationError('主题 ID 必须为 3–48 位小写字母、数字或连字符，并以字母开头')
  }
  if (!['dark', 'light'].includes(input.appearance))
    throw new ThemeValidationError('appearance 仅支持 dark 或 light')
  if (!Number.isInteger(input.radius) || input.radius < 8 || input.radius > 24)
    throw new ThemeValidationError('圆角必须为 8–24 的整数')
  objectWithKeys(input.colors, COLOR_KEYS, '颜色')
  const colors = {}
  for (const key of COLOR_KEYS) {
    if (typeof input.colors[key] !== 'string' || !/^#[0-9a-f]{6}$/i.test(input.colors[key])) {
      throw new ThemeValidationError(`颜色 ${key} 必须为 #RRGGBB 十六进制格式`)
    }
    colors[key] = input.colors[key].toLowerCase()
  }
  const result = {
    id: input.id,
    name: plainText(input.name, '主题名称', 48),
    author: plainText(input.author, '作者', 64),
    description: plainText(input.description, '描述', 240, true),
    appearance: input.appearance,
    colors,
    radius: input.radius
  }
  if (input.fontFamily !== undefined) {
    if (
      typeof input.fontFamily !== 'string' ||
      !/^[\p{L}\p{N} ,._-]{1,100}$/u.test(input.fontFamily)
    )
      throw new ThemeValidationError('字体名称无效')
    result.fontFamily = input.fontFamily
  }
  if (input.background !== undefined) {
    const bg = input.background
    if (
      !bg ||
      !['solid', 'gradient'].includes(bg.type) ||
      Object.keys(bg).some((key) => !['type', 'colors', 'angle'].includes(key)) ||
      !Array.isArray(bg.colors) ||
      bg.colors.length < (bg.type === 'solid' ? 1 : 2) ||
      bg.colors.length > (bg.type === 'solid' ? 1 : 4) ||
      bg.colors.some((c) => typeof c !== 'string' || !/^#[0-9a-f]{6}$/i.test(c)) ||
      (bg.angle !== undefined && (!Number.isFinite(bg.angle) || bg.angle < 0 || bg.angle > 360))
    )
      throw new ThemeValidationError('背景参数无效')
    result.background = structuredClone(bg)
  }
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_THEME_BYTES)
    throw new ThemeValidationError('主题文件过大')
  return result
}

const definitions = [
  {
    id: 'glacier',
    name: '冰川白',
    author: 'D.E.X Studio',
    description: '通透的白色与清晰的蓝，留出专注的空间。',
    appearance: 'light',
    radius: 20,
    colors: {
      bg: '#f5f5f7',
      surface: '#ffffff',
      surfaceRaised: '#eceef2',
      border: '#dfe2e7',
      text: '#1d1d1f',
      muted: '#70757e',
      accent: '#007aff',
      accentText: '#ffffff',
      success: '#248a3d'
    }
  },
  {
    id: 'graphite',
    name: '石墨黑',
    author: 'D.E.X Studio',
    description: '柔和的石墨灰，配以明亮而沉静的蓝。',
    appearance: 'dark',
    radius: 20,
    colors: {
      bg: '#151618',
      surface: '#202124',
      surfaceRaised: '#2c2d31',
      border: '#393b40',
      text: '#f5f5f7',
      muted: '#a1a4ad',
      accent: '#5e9fff',
      accentText: '#0b1830',
      success: '#64d284'
    }
  },
  {
    id: 'obsidian',
    name: '曜石 · Obsidian',
    author: 'D.E.X Studio',
    description: '深曜黑与暖琥珀，安静而有力量。',
    appearance: 'dark',
    radius: 16,
    colors: {
      bg: '#0d0e10',
      surface: '#151619',
      surfaceRaised: '#1d1f23',
      border: '#2c2e33',
      text: '#f4f1ea',
      muted: '#92949d',
      accent: '#e9ad66',
      accentText: '#20170d',
      success: '#85caa6'
    }
  },
  {
    id: 'porcelain',
    name: '瓷白 · Porcelain',
    author: 'D.E.X Studio',
    description: '温润的瓷白，搭配明亮而克制的橙。',
    appearance: 'light',
    radius: 16,
    colors: {
      bg: '#f3f1ed',
      surface: '#ffffff',
      surfaceRaised: '#eae7e1',
      border: '#d9d6d0',
      text: '#242421',
      muted: '#77766f',
      accent: '#bf692d',
      accentText: '#ffffff',
      success: '#247754'
    }
  },
  {
    id: 'midnight',
    name: '深海 · Midnight',
    author: 'D.E.X Studio',
    description: '午夜蓝、冷青与清晰的层次。',
    appearance: 'dark',
    radius: 18,
    colors: {
      bg: '#0b111d',
      surface: '#121c2c',
      surfaceRaised: '#1a2940',
      border: '#2a3c53',
      text: '#e8f0fa',
      muted: '#91a2bb',
      accent: '#67cfdf',
      accentText: '#06252b',
      success: '#88d7ac'
    }
  },
  {
    id: 'rose',
    name: '暮玫 · Rose',
    author: 'D.E.X Studio',
    description: '暖灰色的背景，留下柔和的玫瑰余韵。',
    appearance: 'dark',
    radius: 20,
    colors: {
      bg: '#171416',
      surface: '#221d20',
      surfaceRaised: '#30272c',
      border: '#45373e',
      text: '#f6ecef',
      muted: '#b39ba6',
      accent: '#dda1b5',
      accentText: '#341a24',
      success: '#a2c9a9'
    }
  }
]
const BUILTIN_THEMES = Object.freeze(
  definitions.map((definition) => {
    const theme = validateTheme(definition)
    Object.freeze(theme.colors)
    return Object.freeze(theme)
  })
)

module.exports = {
  BUILTIN_THEMES,
  COLOR_KEYS,
  MAX_THEME_BYTES,
  ThemeValidationError,
  validateTheme
}
