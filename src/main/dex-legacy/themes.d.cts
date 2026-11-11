import type { DexTheme, DexColorKey } from '../../shared/dex-theme'
export const BUILTIN_THEMES: readonly DexTheme[]
export const COLOR_KEYS: readonly DexColorKey[]
export const MAX_THEME_BYTES: number
export class ThemeValidationError extends Error {}
export function validateTheme(input: unknown): DexTheme
