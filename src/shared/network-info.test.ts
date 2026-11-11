import { describe, expect, it } from 'vitest'
import { IP_INFO_ENDPOINTS, ipInfoProviderForUrl, normalizeNetworkIPInfo } from './network-info'

describe('network information privacy boundary', () => {
  it('rejects endpoints outside the explicitly offered query services', () => {
    for (const [provider, endpoint] of Object.entries(IP_INFO_ENDPOINTS)) {
      expect(ipInfoProviderForUrl(endpoint)).toBe(provider)
    }
    expect(() => ipInfoProviderForUrl('https://example.com/')).toThrow()
    expect(() => ipInfoProviderForUrl('https://api.ip.sb/geoip?ip=1.2.3.4')).toThrow()
  })

  it.each([
    [
      'ip.sb',
      {
        ip: '203.0.113.2',
        country: 'Example',
        country_code: 'us',
        asn: 'AS64500',
        asn_organization: 'Example network',
        latitude: 12,
        longitude: 34,
        city: 'Private',
        timezone: 'Private'
      }
    ],
    [
      'ipwho.is',
      {
        ip: '203.0.113.2',
        country: 'Example',
        country_code: 'us',
        connection: { asn: 64500, org: 'Example network' },
        latitude: 12,
        longitude: 34,
        city: 'Private'
      }
    ],
    [
      'ipapi.is',
      {
        ip: '203.0.113.2',
        location: {
          country: 'Example',
          country_code: 'us',
          latitude: 12,
          longitude: 34,
          city: 'Private'
        },
        asn: { asn: 64500, org: 'Example network' },
        other: { secret: 'Private' }
      }
    ]
  ] as const)(
    'drops precise location and unknown fields from %s before IPC',
    (provider, payload) => {
      expect(normalizeNetworkIPInfo(provider, payload)).toEqual({
        ip: '203.0.113.2',
        country: 'Example',
        countryCode: 'US',
        asn: 64500,
        org: 'Example network'
      })
    }
  )

  it('rejects failed/malformed responses instead of presenting an empty IP as a result', () => {
    expect(() =>
      normalizeNetworkIPInfo('ipwho.is', { success: false, ip: '203.0.113.2' })
    ).toThrow()
    expect(() => normalizeNetworkIPInfo('ip.sb', null)).toThrow()
    expect(() => normalizeNetworkIPInfo('ipapi.is', { error: 'rate limited' })).toThrow()
  })
})
