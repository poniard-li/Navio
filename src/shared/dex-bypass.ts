export interface DexBypassConfig {
  enabled: boolean
  presets: string[]
  processes: string[]
  domains: string[]
}

export const DEX_BYPASS_PRESETS = [
  {
    id: 'wechat',
    name: '微信',
    description: '桌面微信与常用微信网页',
    processes: ['WeChat.exe', 'Weixin.exe', 'WeChatAppEx.exe'],
    domains: ['weixin.qq.com', 'wechat.com', 'weixinbridge.com']
  },
  {
    id: 'douyin',
    name: '抖音',
    description: '抖音客户端、网页与常用视频域名',
    processes: ['douyin.exe'],
    domains: ['douyin.com', 'douyinvod.com', 'douyincdn.com']
  },
  {
    id: 'bilibili',
    name: '哔哩哔哩',
    description: '哔哩哔哩网页与常用视频域名',
    processes: [],
    domains: ['bilibili.com', 'bilivideo.com']
  },
  {
    id: 'cloudmusic',
    name: '网易云音乐',
    description: '桌面网易云音乐与音乐域名',
    processes: ['cloudmusic.exe'],
    domains: ['music.163.com', 'music.126.net']
  }
] as const

function unique(values: string[]): string[] {
  const seen = new Set<string>()
  return values.filter((value) => {
    const key = value.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function list(value: unknown, label: string): string[] {
  if (value === undefined) return []
  if (
    !Array.isArray(value) ||
    value.length > 100 ||
    value.some((entry) => typeof entry !== 'string')
  )
    throw new Error(`${label}最多支持 100 条文本项目`)
  return value.map((entry: string) => entry.trim()).filter(Boolean)
}

export function normalizeBypass(value?: unknown): DexBypassConfig {
  if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value)))
    throw new Error('直连例外配置格式无效')
  const input = (value || {}) as Partial<DexBypassConfig>
  const presets = unique(list(input.presets, '内建项目'))
  if (presets.some((id) => !DEX_BYPASS_PRESETS.some((item) => item.id === id)))
    throw new Error('包含未知的内建直连项目')
  const processes = unique(list(input.processes, '应用进程'))
  for (const process of processes) {
    if (
      process.length > 128 ||
      /[,\\/:*?"<>|]/.test(process) ||
      Array.from(process).some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
      ) ||
      process === '.' ||
      process === '..'
    )
      throw new Error(`应用进程名称无效：${process}。请只填写进程文件名，例如 WeChat.exe`)
  }
  const domains = unique(
    list(input.domains, '网站域名').map((domain) => {
      if (domain.length > 253 || /[\s,/:*?#@\\]/.test(domain))
        throw new Error(`网站域名无效：${domain}。请填写不含网址前缀或路径的域名`)
      const hostname = new URL(`https://${domain}`).hostname.toLowerCase().replace(/\.$/, '')
      if (
        !hostname.includes('.') ||
        /^\d+(\.\d+)+$/.test(hostname) ||
        hostname.split('.').some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
      )
        throw new Error(`网站域名无效：${domain}。此处不接受 IP 地址、通配符或单独的顶级域名`)
      return hostname
    })
  )
  return { enabled: input.enabled === true, presets, processes, domains }
}

export function bypassRules(value?: unknown): string[] {
  const config = normalizeBypass(value)
  if (!config.enabled) return []
  const presets = DEX_BYPASS_PRESETS.filter((item) => config.presets.includes(item.id))
  const processes = unique([...presets.flatMap((item) => [...item.processes]), ...config.processes])
  const domains = unique([...presets.flatMap((item) => [...item.domains]), ...config.domains])
  return [
    ...processes.map((name) => `PROCESS-NAME,${name},DIRECT`),
    ...domains.map((domain) => `DOMAIN-SUFFIX,${domain},DIRECT`)
  ]
}

export function usesGlobalBypass(mode: string | undefined, value?: unknown): boolean {
  return mode === 'global' && bypassRules(value).length > 0
}

/** Keep the user's selected mode in their source settings; transform only the runtime copy. */
export function applyGlobalBypass<
  T extends { mode?: string; rules?: unknown; 'find-process-mode'?: string }
>(profile: T, value?: unknown): T {
  const rules = bypassRules(value)
  if (profile.mode !== 'global' || rules.length === 0) return profile
  return {
    ...profile,
    mode: 'rule',
    rules: [...rules, 'MATCH,GLOBAL'],
    ...(rules.some((rule) => rule.startsWith('PROCESS-NAME,'))
      ? { 'find-process-mode': 'always' }
      : {})
  }
}
