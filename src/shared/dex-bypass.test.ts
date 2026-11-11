import { describe, expect, it } from 'vitest'
import { applyGlobalBypass, bypassRules, normalizeBypass, usesGlobalBypass } from './dex-bypass'

const enabled = { enabled: true, presets: [], processes: ['WeChat.exe'], domains: ['example.com'] }

describe('global direct exceptions', () => {
  it('is off by default and leaves empty or disabled policies untouched', () => {
    expect(normalizeBypass()).toEqual({ enabled: false, presets: [], processes: [], domains: [] })
    const original = { mode: 'global', rules: ['MATCH,REJECT'] }
    expect(applyGlobalBypass(original)).toBe(original)
    expect(applyGlobalBypass(original, { ...enabled, enabled: false })).toBe(original)
    expect(applyGlobalBypass(original, { ...enabled, processes: [], domains: [] })).toBe(original)
  })

  it('gives only explicit exceptions priority, sends everything else through GLOBAL and never mutates source', () => {
    const original = {
      mode: 'global',
      rules: ['DOMAIN,blocked.test,REJECT', 'MATCH,DIRECT'],
      'find-process-mode': 'off',
      proxies: ['retained']
    }
    const result = applyGlobalBypass(original, enabled)
    expect(result).toEqual({
      mode: 'rule',
      rules: ['PROCESS-NAME,WeChat.exe,DIRECT', 'DOMAIN-SUFFIX,example.com,DIRECT', 'MATCH,GLOBAL'],
      'find-process-mode': 'always',
      proxies: ['retained']
    })
    expect(original.mode).toBe('global')
    expect(original.rules).toEqual(['DOMAIN,blocked.test,REJECT', 'MATCH,DIRECT'])
    expect(original['find-process-mode']).toBe('off')
  })

  it.each(['rule', 'direct'])('preserves all existing %s rules and process settings', (mode) => {
    const original = { mode, rules: ['MATCH,REJECT'], 'find-process-mode': 'off' }
    expect(applyGlobalBypass(original, enabled)).toBe(original)
    expect(usesGlobalBypass(mode, enabled)).toBe(false)
  })

  it('does not enable process discovery for a website-only exception', () => {
    expect(
      applyGlobalBypass(
        { mode: 'global', 'find-process-mode': 'off' },
        { ...enabled, processes: [] }
      )['find-process-mode']
    ).toBe('off')
  })

  it('deduplicates processes and normalizes IDN domains without changing suffix boundaries', () => {
    const value = normalizeBypass({
      ...enabled,
      processes: ['WeChat.exe', 'wechat.EXE'],
      domains: ['EXAMPLE.com.', 'example.com', '例子.中国']
    })
    expect(value.processes).toEqual(['WeChat.exe'])
    expect(value.domains).toEqual(['example.com', 'xn--fsqu00a.xn--fiqs8s'])
    expect(bypassRules(value).filter((rule) => rule.includes('example.com'))).toEqual([
      'DOMAIN-SUFFIX,example.com,DIRECT'
    ])
  })

  it('curates explicit opt-in presets without a broad China or qq.com exception', () => {
    const rules = bypassRules({
      ...enabled,
      presets: ['wechat', 'douyin'],
      domains: [],
      processes: []
    })
    expect(rules).toContain('PROCESS-NAME,WeChat.exe,DIRECT')
    expect(rules).toContain('DOMAIN-SUFFIX,douyin.com,DIRECT')
    expect(rules).not.toContain('DOMAIN-SUFFIX,qq.com,DIRECT')
    expect(rules.every((rule) => /^(PROCESS-NAME|DOMAIN-SUFFIX),/.test(rule))).toBe(true)
  })

  it.each(['x.exe,DIRECT\nMATCH,REJECT', 'C:\\Apps\\x.exe', '*.exe', 'bad\nname.exe'])(
    'rejects invalid process input %s',
    (process) => {
      expect(() => normalizeBypass({ ...enabled, processes: [process] })).toThrow()
    }
  )

  it.each([
    'https://example.com/path',
    '*.com',
    'com',
    '127.0.0.1',
    'example.com,DIRECT',
    'example.com:443',
    'example.com\nMATCH,REJECT',
    '.example.com'
  ])('rejects invalid or overly broad domain input %s', (domain) => {
    expect(() => normalizeBypass({ ...enabled, domains: [domain] })).toThrow()
  })

  it('rejects invalid schema and excessive rules', () => {
    expect(() => normalizeBypass([])).toThrow()
    expect(() => normalizeBypass({ presets: ['unknown'] })).toThrow()
    expect(() => normalizeBypass({ domains: ['example.com', 5] })).toThrow()
    expect(() => normalizeBypass({ processes: Array(101).fill('x.exe') })).toThrow()
  })
})
