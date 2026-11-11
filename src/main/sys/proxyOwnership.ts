import fs from 'fs'
import path from 'path'
import { isDeepStrictEqual } from 'util'

interface OwnershipRecord<T> {
  version: 1
  platform: string
  original: T
  applied: T
}

// State access is supplied by the platform adapter. Unit tests use an in-memory
// adapter; the production path always reads and writes the actual OS settings.
export class ProxyOwnership<T> {
  private record: OwnershipRecord<T> | undefined
  private loaded = false

  constructor(
    private readonly filename: () => string,
    private readonly read: () => T,
    private readonly restore: (state: T) => void,
    private readonly platform = process.platform
  ) {}

  private load(): void {
    if (this.loaded) return
    const filename = this.filename()
    if (fs.existsSync(filename)) {
      const parsed = JSON.parse(fs.readFileSync(filename, 'utf8')) as OwnershipRecord<T>
      if (
        parsed.version !== 1 ||
        parsed.platform !== this.platform ||
        !parsed.original ||
        !parsed.applied
      ) {
        throw new Error(
          'Invalid D.E.X system proxy recovery record. Original settings were retained on disk.'
        )
      }
      this.record = parsed
    }
    this.loaded = true
  }

  private save(): void {
    const filename = this.filename()
    if (!this.record) {
      fs.rmSync(filename, { force: true })
      return
    }
    fs.mkdirSync(path.dirname(filename), { recursive: true })
    const temporary = `${filename}.tmp`
    fs.writeFileSync(temporary, JSON.stringify(this.record), { mode: 0o600 })
    fs.renameSync(temporary, filename)
  }

  async acquire(apply: () => Promise<void>): Promise<void> {
    this.load()
    const current = this.read()
    const original =
      this.record && isDeepStrictEqual(current, this.record.applied)
        ? this.record.original
        : current
    this.record = { version: 1, platform: this.platform, original, applied: current }
    // Store the original settings before taking ownership, including failure paths.
    this.save()
    try {
      await apply()
      this.record.applied = this.read()
      this.save()
    } catch (error) {
      this.record.applied = this.read()
      this.save()
      try {
        this.release()
      } catch (restoreError) {
        throw new Error(
          `System proxy setup failed (${String(error)}); restoring the previous settings also failed (${String(restoreError)}). Retry disabling the proxy before exiting.`
        )
      }
      throw error
    }
  }

  release(): void {
    this.load()
    if (!this.record) return
    const current = this.read()
    if (isDeepStrictEqual(current, this.record.applied)) {
      try {
        this.restore(this.record.original)
      } catch (error) {
        // A partial restore is still ours. Preserve a retryable record instead
        // of mistaking our partial result for a user's subsequent edit.
        this.record.applied = this.read()
        this.save()
        throw error
      }
    }
    // An external edit relinquishes ownership. Never overwrite another client.
    this.record = undefined
    this.save()
  }
}
