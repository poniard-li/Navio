import { describe, expect, it } from 'vitest'
import { redactLogText } from './log-export'

describe('log export privacy', () => {
  it('removes credentials, query secrets, addresses and email without hiding useful errors', () => {
    const source =
      'timeout https://alice:secret@example.com/api?token=private&mode=rule Authorization: Bearer abc\npassword: hunter2 192.168.1.2 2001:db8::2 user@example.com'
    const result = redactLogText(source)
    for (const value of [
      'alice',
      'secret@',
      'private',
      'abc',
      'hunter2',
      '192.168.1.2',
      '2001:db8::2',
      'user@example.com'
    ])
      expect(result).not.toContain(value)
    expect(result).toContain('timeout')
    expect(result).toContain('mode=rule')
  })
  it('preserves timestamps and hides compressed loopback addresses', () => {
    expect(redactLogText('2026-11-13 12:30:45 connection refused [::1]:9090')).toBe(
      '2026-11-13 12:30:45 connection refused [[IP]]:9090'
    )
  })
  it('hides quoted JSON and YAML values, including spaces and escaped quotes', () => {
    const source = String.raw`{"token":"json-token", "password": "two words", "api_key":"escaped\"secret", "Authorization":"Bearer header-token", "status":"timeout"}
    'secret': 'yaml secret'
    refreshToken = refresh-value`
    const result = redactLogText(source)
    for (const secret of [
      'json-token',
      'two words',
      'escaped',
      'header-token',
      'yaml secret',
      'refresh-value'
    ])
      expect(result).not.toContain(secret)
    expect(result).toContain('"status":"timeout"')
  })
  it('hides common subscription query credentials while retaining ordinary parameters', () => {
    const source =
      'https://example.test/sub?auth-key=auth-value&accessKey=access-value&api_key=api-value&refresh-token=refresh-value&mode=rule&interval=60'
    const result = redactLogText(source)
    for (const secret of ['auth-value', 'access-value', 'api-value', 'refresh-value'])
      expect(result).not.toContain(secret)
    expect(result).toContain('mode=rule&interval=60')
  })
})
