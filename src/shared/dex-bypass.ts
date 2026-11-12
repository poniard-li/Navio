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
    category: '社交通讯',
    description: '桌面微信与常用微信网页',
    processes: ['WeChat.exe', 'Weixin.exe', 'WeChatAppEx.exe'],
    domains: ['weixin.qq.com', 'wechat.com', 'weixinbridge.com']
  },
  {
    id: 'douyin',
    name: '抖音',
    category: '视频直播',
    description: '抖音客户端、网页与常用视频域名',
    processes: ['douyin.exe'],
    domains: ['douyin.com', 'douyinvod.com', 'douyincdn.com']
  },
  {
    id: 'bilibili',
    name: '哔哩哔哩',
    category: '视频直播',
    description: '哔哩哔哩网页与常用视频域名',
    processes: [],
    domains: ['bilibili.com', 'bilivideo.com']
  },
  {
    id: 'cloudmusic',
    name: '网易云音乐',
    category: '音乐音频',
    description: '桌面网易云音乐与音乐域名',
    processes: ['cloudmusic.exe'],
    domains: ['music.163.com', 'music.126.net']
  },
  {
    id: 'qq',
    name: 'QQ',
    category: '社交通讯',
    description: '所列客户端进程与官网域名',
    processes: ['QQ.exe', 'QQNT.exe'],
    domains: ['im.qq.com', 'qzone.qq.com', 'qlogo.cn']
  },
  {
    id: 'wecom',
    name: '企业微信',
    category: '办公会议',
    description: '所列客户端进程与官网域名',
    processes: ['WXWork.exe'],
    domains: ['work.weixin.qq.com']
  },
  {
    id: 'meeting',
    name: '腾讯会议',
    category: '办公会议',
    description: '所列客户端进程与官网域名',
    processes: ['WeMeet.exe', 'wemeetapp.exe'],
    domains: ['meeting.tencent.com', 'meeting.qq.com']
  },
  {
    id: 'dingtalk',
    name: '钉钉',
    category: '办公会议',
    description: '所列客户端进程与官网域名',
    processes: ['DingTalk.exe'],
    domains: ['dingtalk.com', 'dingding.xin']
  },
  {
    id: 'feishu',
    name: '飞书',
    category: '办公会议',
    description: '所列客户端进程与官网域名',
    processes: ['Feishu.exe'],
    domains: ['feishu.cn', 'feishucdn.com']
  },
  {
    id: 'wps',
    name: 'WPS Office',
    category: '办公会议',
    description: '所列客户端进程与官网域名',
    processes: ['wps.exe', 'et.exe', 'wpp.exe'],
    domains: ['wps.cn', 'wps.com', 'kdocs.cn']
  },
  {
    id: 'tencentdocs',
    name: '腾讯文档',
    category: '办公会议',
    description: '所列客户端进程与官网域名',
    processes: [],
    domains: ['docs.qq.com']
  },
  {
    id: 'wegame',
    name: 'WeGame',
    category: '游戏',
    description: '所列客户端进程与官网域名',
    processes: ['wegame.exe', 'WeGameLauncher.exe', 'tgp_daemon.exe'],
    domains: ['wegame.com.cn', 'wegame.com']
  },
  {
    id: 'tencentgames',
    name: '腾讯国内游戏服务',
    category: '游戏',
    description: '所列客户端进程与官网域名',
    processes: [],
    domains: ['lol.qq.com', 'dnf.qq.com', 'cf.qq.com', 'speed.qq.com', 'game.qq.com']
  },
  {
    id: 'qqmusic',
    name: 'QQ 音乐',
    category: '音乐音频',
    description: '所列客户端进程与官网域名',
    processes: ['QQMusic.exe'],
    domains: ['y.qq.com', 'qqmusic.qq.com', 'gtimg.cn']
  },
  {
    id: 'kugou',
    name: '酷狗音乐',
    category: '音乐音频',
    description: '所列客户端进程与官网域名',
    processes: ['KuGou.exe'],
    domains: ['kugou.com']
  },
  {
    id: 'kuwo',
    name: '酷我音乐',
    category: '音乐音频',
    description: '所列客户端进程与官网域名',
    processes: ['KwMusic.exe'],
    domains: ['kuwo.cn']
  },
  {
    id: 'ximalaya',
    name: '喜马拉雅',
    category: '音乐音频',
    description: '所列客户端进程与官网域名',
    processes: ['Ximalaya.exe'],
    domains: ['ximalaya.com', 'xmcdn.com']
  },
  {
    id: 'tencentvideo',
    name: '腾讯视频',
    category: '视频直播',
    description: '所列客户端进程与官网域名',
    processes: ['QQLive.exe'],
    domains: ['v.qq.com', 'video.qq.com']
  },
  {
    id: 'iqiyi',
    name: '爱奇艺',
    category: '视频直播',
    description: '所列客户端进程与官网域名',
    processes: ['QyClient.exe', 'QyVideo.exe'],
    domains: ['iqiyi.com', 'iqiyipic.com', 'qiyi.com']
  },
  {
    id: 'youku',
    name: '优酷',
    category: '视频直播',
    description: '所列客户端进程与官网域名',
    processes: ['Youku.exe'],
    domains: ['youku.com', 'ykimg.com']
  },
  {
    id: 'mango',
    name: '芒果 TV',
    category: '视频直播',
    description: '所列客户端进程与官网域名',
    processes: [],
    domains: ['mgtv.com', 'hitv.com']
  },
  {
    id: 'kuaishou',
    name: '快手',
    category: '视频直播',
    description: '所列客户端进程与官网域名',
    processes: [],
    domains: ['kuaishou.com', 'gifshow.com']
  },
  {
    id: 'huya',
    name: '虎牙直播',
    category: '视频直播',
    description: '所列客户端进程与官网域名',
    processes: ['HuyaClient.exe'],
    domains: ['huya.com']
  },
  {
    id: 'douyu',
    name: '斗鱼直播',
    category: '视频直播',
    description: '所列客户端进程与官网域名',
    processes: ['DouyuLive.exe'],
    domains: ['douyu.com', 'douyucdn.cn']
  },
  {
    id: 'jd',
    name: '京东',
    category: '购物生活',
    description: '所列客户端进程与官网域名',
    processes: [],
    domains: ['jd.com', '360buyimg.com']
  },
  {
    id: 'taobao',
    name: '淘宝 / 天猫',
    category: '购物生活',
    description: '所列客户端进程与官网域名',
    processes: [],
    domains: ['taobao.com', 'tmall.com', 'tb.cn']
  },
  {
    id: 'pdd',
    name: '拼多多',
    category: '购物生活',
    description: '所列客户端进程与官网域名',
    processes: [],
    domains: ['pinduoduo.com', 'yangkeduo.com']
  },
  {
    id: 'vip',
    name: '唯品会',
    category: '购物生活',
    description: '所列客户端进程与官网域名',
    processes: [],
    domains: ['vip.com', 'vipstatic.com']
  },
  {
    id: 'suning',
    name: '苏宁易购',
    category: '购物生活',
    description: '所列客户端进程与官网域名',
    processes: [],
    domains: ['suning.com', 'suning.cn']
  },
  {
    id: 'meituan',
    name: '美团 / 大众点评',
    category: '购物生活',
    description: '所列客户端进程与官网域名',
    processes: [],
    domains: ['meituan.com', 'dianping.com']
  },
  {
    id: 'eleme',
    name: '饿了么',
    category: '购物生活',
    description: '所列客户端进程与官网域名',
    processes: [],
    domains: ['ele.me']
  },
  {
    id: 'alipay',
    name: '支付宝',
    category: '购物生活',
    description: '所列客户端进程与官网域名',
    processes: [],
    domains: ['alipay.com']
  },
  {
    id: 'xiaohongshu',
    name: '小红书',
    category: '社交通讯',
    description: '所列客户端进程与官网域名',
    processes: [],
    domains: ['xiaohongshu.com', 'xhscdn.com']
  },
  {
    id: 'weibo',
    name: '微博',
    category: '社交通讯',
    description: '所列客户端进程与官网域名',
    processes: [],
    domains: ['weibo.com', 'weibo.cn']
  },
  {
    id: 'baidupan',
    name: '百度网盘',
    category: '网盘工具',
    description: '所列客户端进程与官网域名',
    processes: ['BaiduNetdisk.exe'],
    domains: ['pan.baidu.com', 'yun.baidu.com']
  },
  {
    id: 'aliyundrive',
    name: '阿里云盘',
    category: '网盘工具',
    description: '所列客户端进程与官网域名',
    processes: ['aDrive.exe'],
    domains: ['aliyundrive.com', 'alipan.com']
  },
  {
    id: 'quark',
    name: '夸克网盘',
    category: '网盘工具',
    description: '所列客户端进程与官网域名',
    processes: ['QuarkCloudDrive.exe'],
    domains: ['pan.quark.cn']
  },
  {
    id: 'tencentcloud',
    name: '腾讯微云 / 邮箱',
    category: '网盘工具',
    description: '所列客户端进程与官网域名',
    processes: [],
    domains: ['weiyun.com', 'mail.qq.com', 'exmail.qq.com']
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
    throw new Error('全局例外配置格式无效')
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
