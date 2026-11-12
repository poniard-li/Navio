import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OFFICIAL_THEMES, defaultOfficialSettings } from '../../shared/official-themes'
import { validateDexTheme } from '../../shared/dex-theme'
import {
  OfficialThemeStore,
  downloadOfficialPackage,
  validateOfficialPackage
} from './official-themes'

let directory: string
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'navio-official-'))
})
afterEach(async () => {
  if (!directory.startsWith(path.join(os.tmpdir(), 'navio-official-')))
    throw new Error('Invalid fixture path')
  await rm(directory, { recursive: true, force: true })
})
const packet = async (scene = 'aurora'): Promise<Buffer> =>
  readFile(path.resolve('scripts/theme-packages', `Navio-Theme-${scene}-1.json`))
describe('official theme packages', () => {
  it('has 24 unique themes, six built-ins and eight distinct motion wallpapers', async () => {
    expect(OFFICIAL_THEMES).toHaveLength(24)
    expect(new Set(OFFICIAL_THEMES.map((t) => t.id)).size).toBe(24)
    expect(OFFICIAL_THEMES.filter((t) => t.builtIn)).toHaveLength(6)
    expect(OFFICIAL_THEMES.filter((t) => t.category === 'dynamic')).toHaveLength(8)
    for (const t of OFFICIAL_THEMES) {
      const value = t.package || validateOfficialPackage(await packet(t.scene), t.id)
      expect(validateDexTheme(value.variants.dark).id).toBe(t.id)
      expect(validateDexTheme(value.variants.light).id).toBe(t.id)
    }
  })
  it('rejects mismatched bytes, unknown identifiers and wrong theme packages', async () => {
    const bytes = await packet()
    expect(() =>
      validateOfficialPackage(Buffer.concat([bytes, Buffer.from(' ')]), 'navio-aurora')
    ).toThrow('SHA256')
    expect(() => validateOfficialPackage(bytes, '../escape')).toThrow()
    expect(() => validateOfficialPackage(bytes, 'navio-tide')).toThrow('SHA256')
  })
  it('downloads only from fixed GitHub release hosts and verifies the response', async () => {
    const bytes = await packet(),
      fetcher = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(null, {
            status: 302,
            headers: { location: 'https://release-assets.githubusercontent.com/example' }
          })
        )
        .mockResolvedValueOnce(new Response(bytes))
    expect(await downloadOfficialPackage('navio-aurora', fetcher)).toEqual(bytes)
    expect(String(fetcher.mock.calls[0][0])).toBe(
      'https://github.com/poniard-li/Navio/releases/download/v1.0.0-beta.7/Navio-Theme-aurora-1.json'
    )
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'manual', credentials: 'omit' })
  })
  it('rejects redirects to local or arbitrary hosts and oversized streams', async () => {
    for (const target of [
      'http://127.0.0.1/config',
      'https://example.com/file',
      'https://github.com.evil.invalid/file',
      'https://user:pass@github.com/file'
    ]) {
      const fetcher = vi
        .fn()
        .mockResolvedValue(new Response(null, { status: 302, headers: { location: target } }))
      await expect(downloadOfficialPackage('navio-aurora', fetcher)).rejects.toThrow()
      expect(fetcher).toHaveBeenCalledTimes(1)
    }
    await expect(
      downloadOfficialPackage(
        'navio-aurora',
        vi.fn().mockResolvedValue(new Response(new Uint8Array(33000)))
      )
    ).rejects.toThrow('大小')
  })
  it('uses verified cached packages offline and detects tampering before application', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(await packet())),
      store = new OfficialThemeStore(directory, fetcher)
    await store.install('navio-aurora')
    expect(fetcher).toHaveBeenCalledTimes(1)
    fetcher.mockRejectedValue(new Error('offline'))
    await store.install('navio-aurora')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect((await store.theme('navio-aurora', 'light')).appearance).toBe('light')
    await writeFile(path.join(directory, 'navio-aurora.json'), '{}')
    await expect(store.theme('navio-aurora', 'light')).rejects.toThrow('SHA256')
    expect((await store.list()).find((t) => t.id === 'navio-aurora')).toMatchObject({
      installed: false,
      cacheError: expect.any(String)
    })
  })
  it('preserves favorites while restoring independently saved theme settings', async () => {
    const store = new OfficialThemeStore(directory)
    const before = (await store.preferences()).settings
    await store.settings('navio-cat', {
      ...defaultOfficialSettings(),
      intensity: 89,
      appearance: 'light'
    })
    await store.favorite('navio-cat', true)
    await store.restoreSettings(before)
    expect(await store.settings('navio-cat')).toEqual(defaultOfficialSettings())
    expect((await store.list()).find((t) => t.id === 'navio-cat')?.favorite).toBe(true)
    await expect(store.remove('../../escape')).rejects.toThrow()
    await expect(store.remove('navio-liquid')).rejects.toThrow('内置')
  })
})
