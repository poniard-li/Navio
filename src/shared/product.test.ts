import { describe, expect, it } from 'vitest'
import { formatProductVersion } from './product'

describe('formatProductVersion', () => {
  it.each(['1.0.0-beta.6', 'v1.0.0-beta.6'])('formats the public beta label for %s', (version) => {
    expect(formatProductVersion(version)).toBe('Release 1.0.0 · Public Beta 6')
  })

  it('does not label a stable version as a beta', () => {
    expect(formatProductVersion('1.0.0')).toBe('Release 1.0.0')
  })

  it('preserves all version components and the beta sequence', () => {
    expect(formatProductVersion('12.34.567-beta.18')).toBe('Release 12.34.567 · Public Beta 18')
  })

  it.each(['1.0.0-rc.1', '1.0.0-beta.6+build.2', '1.0.0-beta.06', '01.0.0-beta.6', 'local', ''])(
    'preserves unsupported version strings without relabeling them: %s',
    (version) => {
      expect(formatProductVersion(version)).toBe(version)
    }
  )
})
