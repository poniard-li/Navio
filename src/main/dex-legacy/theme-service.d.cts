import type { BrowserWindow, Dialog } from 'electron'
import type { DexTheme, DexThemeCatalog } from '../../shared/dex-theme'
export class ThemeService {
  constructor(options: {
    userData: string
    dialog?: Dialog
    getWindow?: () => BrowserWindow | undefined
    fetchImpl?: typeof fetch
  })
  selectedId: string
  list(): Promise<DexThemeCatalog>
  setRemote(themes: DexTheme[] | null, error?: string | null): Promise<DexThemeCatalog>
  find(id: string): Promise<DexTheme>
  apply(payload: { id: string }): Promise<DexTheme>
  save(payload: { theme: DexTheme }): Promise<DexTheme>
  handle(action: string, payload?: unknown): Promise<unknown>
}
