import { describe, expect, it } from 'vitest'
import {
  DEFAULT_NAVIO_MATERIAL,
  deriveNavioMotion,
  navioMaterialVariables,
  normalizeNavioMaterial,
  type NavioMotionEnvironment
} from './navio-material'

const environment: NavioMotionEnvironment = {
  onBattery: null,
  windowVisible: true,
  suspended: false,
  speedLimit: null
}
const preferences = { hidden: false, reducedMotion: false, disabled: false }

describe('independent material settings', () => {
  it('normalizes untrusted settings without mutating defaults or accepting invalid modes', () => {
    const value = normalizeNavioMaterial({
      regions: {
        sidebar: { mode: '__proto__', transparency: 1000, blur: -10, sheen: 23.7 },
        cards: { mode: 'solid', transparency: '25', blur: Infinity, sheen: NaN },
        dialogs: null
      },
      flow: -1,
      motionPolicy: 'unexpected'
    })
    expect(value.regions.sidebar).toEqual({ mode: 'glass', transparency: 65, blur: 0, sheen: 24 })
    expect(value.regions.cards).toEqual({ ...DEFAULT_NAVIO_MATERIAL.regions.cards, mode: 'solid' })
    expect(value.regions.dialogs).toEqual(DEFAULT_NAVIO_MATERIAL.regions.dialogs)
    expect(value.flow).toBe(0)
    expect(value.motionPolicy).toBe('balanced')
    value.regions.dialogs.transparency = 60
    expect(DEFAULT_NAVIO_MATERIAL.regions.dialogs.transparency).toBe(12)
  })

  it.each([null, [], 'glass', { version: 2, flow: 99 }])(
    'rejects unsupported shapes: %j',
    (value) => {
      expect(normalizeNavioMaterial(value)).toEqual(DEFAULT_NAVIO_MATERIAL)
    }
  )

  it('keeps each region independent and makes solid surfaces opaque without destroying saved detail', () => {
    const material = normalizeNavioMaterial({
      regions: { cards: { mode: 'solid', transparency: 60, blur: 40, sheen: 90 } },
      flow: 25
    })
    const variables = navioMaterialVariables(material)
    expect(variables['--navio-cards-opacity']).toBe('100%')
    expect(variables['--navio-cards-blur']).toBe('0px')
    expect(variables['--navio-cards-shine']).toBe('0')
    expect(variables['--navio-sidebar-opacity']).toBe('60%')
    expect(variables['--navio-dialogs-opacity']).toBe('88%')
    expect(variables['--navio-flow']).toBe('0.25')
    expect(material.regions.cards.transparency).toBe(60)
    expect(material.regions.sidebar).toEqual(DEFAULT_NAVIO_MATERIAL.regions.sidebar)
  })
})

describe('motion uses actual environment signals', () => {
  it('does not invent power-saving status when power information is unknown', () => {
    expect(deriveNavioMotion(DEFAULT_NAVIO_MATERIAL, environment, preferences)).toMatchObject({
      playing: true,
      backgroundPlaying: true,
      quality: 'full',
      durationScale: 1,
      overrideAllowed: true
    })
  })

  it.each([{ onBattery: true }, { speedLimit: 65 }])(
    'reduces work in balanced mode for %j',
    (signal) => {
      expect(
        deriveNavioMotion(DEFAULT_NAVIO_MATERIAL, { ...environment, ...signal }, preferences)
      ).toMatchObject({
        quality: 'reduced',
        durationScale: 2,
        playing: true
      })
      const full = { ...DEFAULT_NAVIO_MATERIAL, motionPolicy: 'full' as const }
      expect(deriveNavioMotion(full, { ...environment, ...signal }, preferences).quality).toBe(
        'full'
      )
    }
  )

  it.each([
    { environment: { ...environment, windowVisible: false }, preferences },
    { environment: { ...environment, suspended: true }, preferences },
    { environment, preferences: { ...preferences, hidden: true } },
    { environment, preferences: { ...preferences, disabled: true } }
  ])('always pauses hidden, suspended or globally disabled motion', (input) => {
    const full = { ...DEFAULT_NAVIO_MATERIAL, motionPolicy: 'full' as const }
    expect(deriveNavioMotion(full, input.environment, input.preferences)).toMatchObject({
      playing: false,
      backgroundPlaying: false,
      overrideAllowed: false,
      quality: 'paused'
    })
  })

  it('respects reduced motion by default, allowing only a visible explicit preview', () => {
    expect(
      deriveNavioMotion(DEFAULT_NAVIO_MATERIAL, environment, {
        ...preferences,
        reducedMotion: true
      })
    ).toMatchObject({
      playing: false,
      backgroundPlaying: false,
      overrideAllowed: true
    })
    expect(
      deriveNavioMotion(
        DEFAULT_NAVIO_MATERIAL,
        { ...environment, suspended: true },
        { ...preferences, reducedMotion: true }
      ).overrideAllowed
    ).toBe(false)
    expect(
      deriveNavioMotion({ ...DEFAULT_NAVIO_MATERIAL, motionPolicy: 'off' }, environment, {
        ...preferences,
        reducedMotion: true
      }).overrideAllowed
    ).toBe(false)
  })

  it('pauses only background flow at zero and stops everything with the off policy', () => {
    expect(
      deriveNavioMotion({ ...DEFAULT_NAVIO_MATERIAL, flow: 0 }, environment, preferences)
    ).toMatchObject({
      playing: true,
      backgroundPlaying: false,
      flow: 0
    })
    expect(
      deriveNavioMotion(
        { ...DEFAULT_NAVIO_MATERIAL, motionPolicy: 'off' },
        environment,
        preferences
      )
    ).toMatchObject({
      playing: false,
      backgroundPlaying: false,
      overrideAllowed: false
    })
  })
})
