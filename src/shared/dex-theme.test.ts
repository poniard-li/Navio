import { describe, expect, it } from 'vitest'
import { BUILTIN_THEMES, validateTheme } from '../main/dex-legacy/themes.cjs'
import { dexThemeCss, hexToHsl, validateDexTheme } from './dex-theme'

describe('D.E.X theme schema and generated CSS', () => {
  it('keeps all six existing JSON themes compatible with the server schema', () => {
    expect(BUILTIN_THEMES).toHaveLength(6)
    for (const theme of BUILTIN_THEMES) {
      expect(validateDexTheme(theme)).toEqual(validateTheme(theme))
      const css = dexThemeCss(theme)
      expect(css).toContain('--heroui-primary:')
      expect(css).toContain('--heroui-background:')
      expect(css).toContain('--dex-sidebar-text:')
      expect(css).toContain(`--dex-radius: ${theme.radius}px`)
      expect(css).not.toMatch(/https?:|url\(|@import|javascript:/i)
    }
  })
  it('rejects executable and external CSS payloads before generating any CSS', () => {
    const original = structuredClone(BUILTIN_THEMES[0])
    expect(() => dexThemeCss({ ...original, css: '@import url(https://invalid.test)' })).toThrow()
    expect(() => dexThemeCss({ ...original, id: '../escape' })).toThrow()
    expect(() => dexThemeCss({ ...original, radius: '20px; color:red' })).toThrow()
    expect(() =>
      dexThemeCss({
        ...original,
        colors: { ...original.colors, accent: '#fff; background:url(https://invalid.test)' }
      })
    ).toThrow()
    expect(() => validateDexTheme({ ...original, author: 'invalid\0author' })).toThrow()
  })
  it('converts RGB colors to the HSL channel format HeroUI consumes', () => {
    expect(hexToHsl('#ff0000')).toBe('0.00 100.00% 50.00%')
    expect(hexToHsl('#00ff00')).toBe('120.00 100.00% 50.00%')
    expect(hexToHsl('#000000')).toBe('0.00 0.00% 0.00%')
    expect(hexToHsl('#ffffff')).toBe('0.00 0.00% 100.00%')
  })
  it('never interpolates a display name into executable CSS', () => {
    const css = dexThemeCss({ ...BUILTIN_THEMES[0], name: '*/ body { display: none } /*' })
    expect(css).not.toContain('display: none')
  })
})
