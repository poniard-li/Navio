import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { ThemeService } from '../dex-legacy/theme-service.cjs'
import { BUILTIN_THEMES } from '../dex-legacy/themes.cjs'
import type { DexTheme, DexThemeCatalog } from '../../shared/dex-theme'

const temporaryDirectories: string[] = []
afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    if (!directory.startsWith(path.join(os.tmpdir(), 'dex-theme-next-')))
      throw new Error('Unexpected test directory')
    await rm(directory, { recursive: true, force: true })
  }
})
async function fixture(
  fetchImpl?: typeof fetch
): Promise<{ service: ThemeService; directory: string }> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dex-theme-next-'))
  temporaryDirectories.push(directory)
  return { service: new ThemeService({ userData: directory, fetchImpl }), directory }
}
const customTheme = (): DexTheme => ({
  ...structuredClone(BUILTIN_THEMES[0]),
  id: 'custom-blue',
  name: 'My blue'
})

describe('migrated D.E.X JSON theme library', () => {
  it('supports creation, edits, selected-theme persistence and offline restart', async () => {
    const { service, directory } = await fixture()
    await service.save({ theme: customTheme() })
    await service.save({ theme: { ...customTheme(), name: 'Updated blue', radius: 18 } })
    await service.apply({ id: 'custom-blue' })
    const restored = new ThemeService({ userData: directory })
    const list = await restored.list()
    expect(list.builtins).toHaveLength(6)
    expect(list.local).toHaveLength(1)
    expect(list.local[0].name).toBe('Updated blue')
    expect(list.local[0].radius).toBe(18)
    expect(list.selectedId).toBe('custom-blue')
  })
  it('only reads the remote catalog after refresh and reports failures honestly', async () => {
    let calls = 0
    const { service } = await fixture(async () => {
      calls++
      return Response.json({ themes: [customTheme()], nextOffset: null })
    })
    await service.handle('themes.configure', { url: 'https://themes.example.test/dex-api' })
    expect(calls).toBe(0)
    const list = (await service.handle('themes.refresh')) as DexThemeCatalog
    expect(calls).toBe(1)
    expect(list.remote[0].id).toBe('custom-blue')
    expect(list.remoteError).toBeNull()
    const failed = await fixture(async () => {
      throw new Error('offline')
    })
    await failed.service.handle('themes.configure', { url: 'https://themes.example.test' })
    expect(((await failed.service.handle('themes.refresh')) as DexThemeCatalog).remoteError).toBe(
      'offline'
    )
  })
  it('publishes only theme JSON with an ephemeral separate token', async () => {
    const requests: RequestInit[] = []
    const token = 'test-only-token-012345678901234567890123456789'
    const { service, directory } = await fixture(async (_url, options) => {
      requests.push(options || {})
      return Response.json({ theme: customTheme() })
    })
    await service.save({ theme: customTheme() })
    await service.handle('themes.configure', { url: 'https://themes.example.test/dex-api' })
    await service.handle('themes.publish', { id: 'custom-blue', token })
    expect((requests[0].headers as Record<string, string>).Authorization).toBe(`Bearer ${token}`)
    expect(JSON.parse(String(requests[0].body))).toEqual(customTheme())
    const settings = await readFile(path.join(directory, 'theme-settings.json'), 'utf8')
    const theme = await readFile(path.join(directory, 'themes', 'custom-blue.json'), 'utf8')
    expect(settings + theme).not.toContain(token)
    expect(await readdir(directory)).toEqual(
      expect.arrayContaining(['themes', 'theme-settings.json'])
    )
  })
  it('rejects unsafe servers, invalid operations and built-in overwrites', async () => {
    const { service } = await fixture()
    await expect(
      service.handle('themes.configure', { url: 'http://external.example.test' })
    ).rejects.toThrow()
    await expect(
      service.handle('themes.configure', { url: 'https://user:pass@example.test' })
    ).rejects.toThrow()
    await expect(
      service.handle('themes.configure', { url: 'https://example.test?secret=private' })
    ).rejects.toThrow()
    await expect(service.handle('themes.removeEverything')).rejects.toThrow()
    await expect(service.save({ theme: structuredClone(BUILTIN_THEMES[0]) })).rejects.toThrow()
  })
})
