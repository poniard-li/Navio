import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProxyOwnership } from './proxyOwnership'

let directory: string
let filename: string
let state: { enable: boolean; server: string; bypass: string; pac: string | null }
let original: typeof state
let ownership: ProxyOwnership<typeof state>
const read = vi.fn(() => structuredClone(state))
const restore = vi.fn((value: typeof state) => {
  state = structuredClone(value)
})
const apply = async (): Promise<void> => {
  state = { enable: true, server: '127.0.0.1:17890', bypass: '<local>', pac: null }
}

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-proxy-test-'))
  filename = path.join(directory, 'proxy.json')
  state = {
    enable: true,
    server: 'http=other:8080;https=secure:8443',
    bypass: 'original',
    pac: 'https://example.invalid/proxy.pac'
  }
  original = structuredClone(state)
  read.mockClear()
  restore.mockReset().mockImplementation((value) => {
    state = structuredClone(value)
  })
  ownership = new ProxyOwnership(() => filename, read, restore)
})

afterEach(() => fs.rmSync(directory, { recursive: true, force: true }))

describe('system proxy ownership', () => {
  it('does not read or change system settings without a takeover record', () => {
    ownership.release()
    expect(read).not.toHaveBeenCalled()
    expect(restore).not.toHaveBeenCalled()
    expect(state).toEqual(original)
  })

  it('restores the original settings after repeated updates', async () => {
    await ownership.acquire(apply)
    await ownership.acquire(async () => {
      state.server = '127.0.0.1:17891'
    })
    ownership.release()
    expect(state).toEqual(original)
    expect(fs.existsSync(filename)).toBe(false)
  })

  it.each(['enable', 'server', 'bypass', 'pac'] as const)(
    'preserves external changes to %s',
    async (field) => {
      await ownership.acquire(apply)
      const external = {
        enable: false,
        server: 'another:9000',
        bypass: 'new',
        pac: 'https://new.invalid/pac'
      }
      Object.assign(state, { [field]: external[field] })
      const expected = structuredClone(state)
      ownership.release()
      expect(restore).not.toHaveBeenCalled()
      expect(state).toEqual(expected)
    }
  )

  it('records a new baseline when the user explicitly takes over again', async () => {
    await ownership.acquire(apply)
    state.pac = 'https://new.invalid/pac'
    const external = structuredClone(state)
    await ownership.acquire(apply)
    ownership.release()
    expect(state).toEqual(external)
  })

  it('rolls back an apply failure after a partial change', async () => {
    await expect(
      ownership.acquire(async () => {
        state.enable = false
        throw new Error('apply failed')
      })
    ).rejects.toThrow('apply failed')
    expect(state).toEqual(original)
  })

  it('keeps a retryable record after a partial restore failure', async () => {
    await ownership.acquire(apply)
    restore.mockImplementationOnce(() => {
      state.enable = false
      throw new Error('restore failed')
    })
    expect(() => ownership.release()).toThrow('restore failed')
    expect(fs.existsSync(filename)).toBe(true)
    ownership.release()
    expect(state).toEqual(original)
    expect(fs.existsSync(filename)).toBe(false)
  })

  it('restores a completed takeover after an app restart', async () => {
    await ownership.acquire(apply)
    const restarted = new ProxyOwnership(() => filename, read, restore)
    restarted.release()
    expect(state).toEqual(original)
  })
})
