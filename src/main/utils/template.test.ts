import { describe, expect, it } from 'vitest'
import { defaultConfig, defaultControledMihomoConfig } from './template'

describe('DEX first-start defaults', () => {
  it('requires an initial mode choice without taking over the network', () => {
    expect(defaultConfig.modeSelected).toBe(false)
    expect(defaultConfig.operationMode).toBe('standard')
    expect(defaultConfig.sysProxy.enable).toBe(false)
    expect(defaultControledMihomoConfig.tun?.enable).toBe(false)
    expect(defaultControledMihomoConfig['allow-lan']).toBe(false)
    expect(defaultConfig.autoCheckUpdate).toBe(false)
    expect(defaultConfig.silentUpdate).toBe(false)
    expect(defaultControledMihomoConfig['geo-auto-update']).toBe(false)
  })
})
