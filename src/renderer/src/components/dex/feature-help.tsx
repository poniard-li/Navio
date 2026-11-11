import { Tooltip } from '@heroui/react'
import { useState } from 'react'
import { IoHelpCircleOutline } from 'react-icons/io5'

export const FEATURE_HELP = {
  resources: {
    title: '外部资源是什么',
    summary: '节点列表、分流规则和分类数据库，让配置可以独立更新。',
    detail:
      'Proxy Provider 提供节点，Rule Provider 提供分流规则，GeoIP / GeoSite 将 IP 或域名归类。它们不是账号，也不增加订阅额度。更新时会访问所配置的来源；只使用可信来源，错误规则可能改变连接去向。'
  },
  sniffer: {
    title: '嗅探与覆写',
    summary: '帮助内核为只有 IP 的连接识别域名，以匹配正确的规则。',
    detail:
      '嗅探会读取连接中可见的 HTTP Host 或 TLS / QUIC 握手信息，不会因此解密 HTTPS 正文。「覆写目标」会用识别出的域名替换连接目标，可能改善分流，也可能影响部分应用。没有明确问题时保留默认值。设置覆写决定应用使用本页设置还是订阅中的设置。'
  },
  substore: {
    title: 'Sub-Store 订阅整理',
    summary: '合并订阅、筛选和重命名节点，再生成需要的订阅格式。',
    detail:
      '直接导入一个订阅通常不需要 Sub-Store。内置服务在本机运行，但拉取订阅仍会访问订阅地址。使用自定义远程后端、脚本或云同步时，链接和节点数据可能交给对应服务；订阅链接常含访问凭据，请勿分享。'
  },
  core: {
    title: '选择适合的内核',
    summary: '内核负责连接、协议、DNS 和分流；日常使用优先选择稳定版。',
    detail:
      '稳定版适合日常使用；Alpha 提前提供新变更，也可能出现回归；指定版本用于兼容或排错。Smart 是具有自动选路能力的分支。切换内核会重启连接，界面中的设置是否可用也取决于所选内核版本。'
  },
  smart: {
    title: 'Smart 自动选路',
    summary: '结合成功率、连接耗时、吞吐和历史表现选择节点。',
    detail:
      'Smart 并不是聊天 AI，也不保证所有网络都更快。只有使用 Smart 策略的分组才会采用这种选路方式；自动覆写可协助转换分组。可选 LightGBM 模型用于评分，下载和更新会联系模型来源。训练数据收集是另一个独立选项，默认关闭，可能在本机记录访问域名和连接统计。'
  },
  dns: {
    title: 'DNS 决定域名如何解析',
    summary: '把网站域名转换为地址，并帮助分流规则识别连接。',
    detail:
      'DNS 服务可能看到提交给它的域名。Fake-IP 使用本地虚拟地址帮助分流，不是伪装公网 IP；部分应用不兼容时可加入过滤列表。覆写会优先使用这里的 DNS 设置，配置错误可能导致网页无法打开。一般保留默认设置。'
  },
  tun: {
    title: 'TUN 接管更多应用连接',
    summary: '通过虚拟网卡接管不遵循系统代理的应用流量。',
    detail:
      'TUN 通常需要管理员权限，会调整系统路由与 DNS。它决定哪些流量进入内核，是否代理仍由分流模式决定。直连例外仅对进入内核且成功识别的连接生效。与其他 VPN 同时启用时，路由可能冲突；出现异常可先关闭 TUN。'
  },
  isp: {
    title: 'ISP · 网络服务商',
    summary: '公网出口所属的互联网服务商或机房提供商。',
    detail:
      '这里由 IP 数据库推测，可能是本地运营商，也可能是代理节点的机房。它不是账号、设备标识或精确住址。查询服务会看到本次查询使用的公网出口 IP，数据库也可能不准确。'
  },
  asn: {
    title: 'ASN · 自治系统编号',
    summary: '由 AS 加数字组成，用来标识互联网上的一组路由网络。',
    detail:
      '运营商、机房或大型机构通过 ASN 宣告路由。许多人和大量地址可以共享一个 ASN，它不是你的个人编号，也不是经纬度。展示的是出口 IP 对应的网络，适合排查出口变化或网络归属，数据可能有误。'
  },
  network: {
    title: '网络信息与隐私',
    summary: '仅在你点击查询后联系所选第三方；本页不请求设备定位。',
    detail:
      '查询服务会看到本次请求的公网出口 IP；应用只接收供界面使用的 IP、国家/地区、网络归属和分类字段，不向界面传递经纬度、城市或时区，也不将本次结果保存到配置。结果代表查询请求的出口，并不保证每个应用都使用相同出口。'
  }
} as const

export type HelpTopic = keyof typeof FEATURE_HELP

export function HelpTip({
  topic,
  title,
  content
}: {
  topic?: HelpTopic
  title?: string
  content?: string
}): React.JSX.Element {
  const entry = topic ? FEATURE_HELP[topic] : undefined
  const label = title ?? entry?.title ?? '功能说明'
  const description = content ?? entry?.detail ?? ''
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)

  return (
    <Tooltip
      isOpen={open}
      onOpenChange={(next) => {
        if (!pinned) setOpen(next)
      }}
      delay={250}
      closeDelay={100}
      placement="top"
      className="max-w-[min(360px,calc(100vw-32px))] px-3 py-2.5"
      content={
        <div className="text-left leading-relaxed">
          <strong className="mb-1 block text-xs">{label}</strong>
          <p className="text-xs text-foreground/80">{description}</p>
        </div>
      }
    >
      <button
        type="button"
        aria-label={`${label}：查看说明`}
        aria-pressed={pinned}
        className="app-nodrag ml-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full align-middle text-foreground/45 hover:bg-foreground/5 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        onClick={(event) => {
          event.stopPropagation()
          const next = !pinned
          setPinned(next)
          setOpen(next)
        }}
        onBlur={() => {
          setPinned(false)
          setOpen(false)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setPinned(false)
            setOpen(false)
          }
        }}
      >
        <IoHelpCircleOutline size={17} />
      </button>
    </Tooltip>
  )
}

export function FeatureIntro({ topic }: { topic: HelpTopic }): React.JSX.Element {
  const entry = FEATURE_HELP[topic]
  return (
    <section className="mx-2 mt-2 mb-3 flex items-start gap-3 rounded-xl border border-foreground/8 bg-content1/50 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center text-[13px] font-semibold">
          {entry.title}
          <HelpTip topic={topic} />
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-foreground/60">{entry.summary}</p>
      </div>
    </section>
  )
}
