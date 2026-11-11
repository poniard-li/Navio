export const IP_INFO_ENDPOINTS = {
  'ip.sb': 'https://api.ip.sb/geoip',
  'ipwho.is': 'https://ipwho.is/?fields=success,message,ip,country,country_code,connection',
  'ipapi.is': 'https://api.ipapi.is/'
} as const

export type IPInfoProvider = keyof typeof IP_INFO_ENDPOINTS

// Only this allowlisted shape may cross the main-process boundary. Provider
// payloads can include coordinates and other location data that we do not need.
export interface NetworkIPInfo {
  ip: string
  country?: string
  countryCode?: string
  asn?: number
  org?: string
  isp?: string
  isProxy?: boolean
  isVPN?: boolean
}

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : undefined
const asnNumber = (value: unknown): number | undefined => {
  const result = typeof value === 'string' ? Number(value.replace(/^AS/i, '')) : value
  return typeof result === 'number' && Number.isInteger(result) && result > 0 ? result : undefined
}

export function ipInfoProviderForUrl(url: string): IPInfoProvider {
  const entry = Object.entries(IP_INFO_ENDPOINTS).find(([, endpoint]) => endpoint === url)
  if (!entry) throw new Error('不支持的网络信息查询服务')
  return entry[0] as IPInfoProvider
}

export function normalizeNetworkIPInfo(provider: IPInfoProvider, payload: unknown): NetworkIPInfo {
  const data = record(payload)
  const ip = text(data.ip)
  if (!ip || data.success === false || data.error)
    throw new Error('查询服务未返回有效的公网 IP 信息')
  const connection = record(data.connection)
  const location = record(data.location)
  const asn = record(data.asn)
  const response: NetworkIPInfo = { ip }
  const country = text(provider === 'ipapi.is' ? location.country : data.country)
  const countryCode = text(provider === 'ipapi.is' ? location.country_code : data.country_code)
  const org = text(
    provider === 'ip.sb'
      ? data.asn_organization
      : provider === 'ipwho.is'
        ? connection.org
        : asn.org
  )
  const isp = text(provider === 'ipwho.is' ? connection.isp : data.isp)
  const asnValue = asnNumber(
    provider === 'ip.sb' ? data.asn : provider === 'ipwho.is' ? connection.asn : asn.asn
  )
  if (country) response.country = country
  if (countryCode && /^[a-z]{2}$/i.test(countryCode))
    response.countryCode = countryCode.toUpperCase()
  if (org) response.org = org
  if (isp) response.isp = isp
  if (asnValue !== undefined) response.asn = asnValue
  if (typeof data.is_proxy === 'boolean') response.isProxy = data.is_proxy
  if (typeof data.is_vpn === 'boolean') response.isVPN = data.is_vpn
  return response
}
