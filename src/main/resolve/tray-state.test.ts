import { describe, expect, it } from 'vitest'
import { buildTrayTooltip, calculateTrayIconStatus, getCustomTrayIconKey } from './tray-state'

describe('tray state meanings', () => {
  it.each([
    [false, false, 'white'],
    [true, false, 'green'],
    [false, true, 'blue'],
    [true, true, 'blue']
  ] as const)('maps proxy %s and TUN %s to %s', (proxy, tun, expected) => {
    expect(calculateTrayIconStatus(proxy, tun, 'running')).toBe(expected)
  })

  it('reserves red for a reported core failure, without inferring network health', () => {
    expect(calculateTrayIconStatus(false, false, 'error')).toBe('red')
    expect(calculateTrayIconStatus(true, true, 'starting')).toBe('blue')
    expect(calculateTrayIconStatus(null, false, 'running')).toBe('white')
  })

  it('keeps existing custom icons attached to their semantic switches', () => {
    expect(getCustomTrayIconKey('green')).toBe('sysProxy')
    expect(getCustomTrayIconKey('blue')).toBe('tun')
    expect(getCustomTrayIconKey('white')).toBe('off')
    expect(getCustomTrayIconKey('red')).toBeUndefined()
  })

  it('appends traffic without discarding mode and core status', () => {
    expect(buildTrayTooltip(['Navio', 'Mode: Rule', 'Core: Running'], '↑ 1 KB/s')).toBe(
      'Navio\nMode: Rule\nCore: Running\n↑ 1 KB/s'
    )
  })
})
