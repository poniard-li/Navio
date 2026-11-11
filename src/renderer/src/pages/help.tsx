import { useState } from 'react'
import { Button, Input } from '@heroui/react'
import { LuArrowUpRight, LuBookOpen, LuSearch, LuShieldCheck } from 'react-icons/lu'
import { useNavigate } from 'react-router-dom'
import BasePage from '@renderer/components/base/base-page'

const topics = [
  {
    title: '全局代理与直连例外',
    tag: '日常使用',
    route: '/bypass',
    summary: '默认使用 GLOBAL 中选定的线路，让你指定的软件或网站直接联网。',
    detail:
      '开启例外后，客户端会先匹配直连清单，其余连接交给 GLOBAL。界面仍显示你的全局策略，内核通过规则模式执行例外。直连网站会看到本地网络的公网出口 IP。修改通常影响新连接；已有连接可能需要重新连接。'
  },
  {
    title: '系统代理与 TUN',
    tag: '网络接管',
    route: '/tun',
    summary: '系统代理适合遵循系统代理设置的软件；TUN 可以接管更多应用的流量。',
    detail:
      '有些游戏或应用不遵循系统代理设置，这时可以考虑 TUN 虚拟网卡。TUN 可能需要管理员权限，并改变系统路由。首次使用保持关闭，确认订阅可用后再按需启用。应用直连规则依赖内核能够识别进程，无法识别时可补充网站规则。'
  },
  {
    title: '外部资源',
    tag: '配置管理',
    route: '/resources',
    summary: '订阅配置引用的节点集合、规则集合，集中查看更新状态。',
    detail:
      '代理集合提供可用节点；规则集合提供域名、IP 等匹配清单。更新会从相应来源重新下载内容，影响选点或分流结果。通常由你的订阅维护，无需逐个修改。“外部”指配置之外的资源来源，并不是你的私人文件。'
  },
  {
    title: '嗅探覆写',
    tag: '流量识别',
    route: '/sniffer',
    summary: '从连接的协议特征中补充目标域名，帮助域名规则判断。',
    detail:
      '有的连接只提供 IP；嗅探可从 HTTP、TLS、QUIC 的可见信息中识别主机名。“覆写”表示用客户端设置替换订阅中的对应配置。它不等于解密 HTTPS 正文；但会处理目标域名等连接信息。遇到兼容问题时可以关闭或排除特定域名。'
  },
  {
    title: 'Sub-Store',
    tag: '订阅整理',
    route: '/substore',
    summary: '用于合并订阅、筛选节点、批量重命名和转换输出格式。',
    detail:
      '单个订阅能正常使用时，可以不启用。订阅链接经常包含访问凭据；若使用远程服务转换，服务方将接触这些链接。内置本地服务在本机处理，但仍需连接订阅来源下载节点。只使用你信任的脚本和服务。'
  },
  {
    title: '内核设置',
    tag: '高级功能',
    route: '/mihomo',
    summary: '内核承担代理协议、DNS、规则匹配与转发；界面负责管理和交互。',
    detail:
      '稳定版是日常使用的默认选择。Alpha 用于试用较新的改动，兼容性可能变化。更换内核会重启网络转发，现有连接可能中断。客户端版本与内核版本分别管理，更新其中一个不代表另一个也更新。'
  },
  {
    title: 'Smart 内核',
    tag: '高级功能',
    route: '/mihomo',
    summary: '在 Mihomo 的扩展分支中加入 Smart 策略组，自动选择线路。',
    detail:
      '它参考连接成功率、耗时等表现来选节点，可选 LightGBM 模型辅助判断；并不是聊天 AI，也不保证所有网络都更快。模型可能需要下载。训练数据收集会增加本地记录，不懂模型训练可以保持关闭。日常使用先选稳定版。'
  },
  {
    title: '公网 IP、ISP 与 ASN',
    tag: '隐私说明',
    route: '/network',
    summary: '这些字段用于确认出口网络与排查线路问题，不是你的 GPS 位置。',
    detail:
      '公网 IP 是网站看到的出口地址，属于需谨慎分享的网络信息。ISP 是互联网服务提供商或出口机房；ASN 是管理一组网络路由的组织编号，通常由很多用户共享。它们本身不能精确定位个人。IP 数据库的归属信息可能不准确，使用代理后通常显示代理出口。'
  },
  {
    title: '网络信息如何查询',
    tag: '隐私说明',
    route: '/network',
    summary: '公网信息只在主动查询时向所选第三方请求，不显示经纬度坐标。',
    detail:
      '查询服务会看到该次请求的公网出口 IP，并可能按其隐私政策记录请求。该查询不读取 GPS，也不需要精确位置权限。网络诊断与连接日志同样可能包含 IP 或域名；分享截图、日志之前请检查并遮盖敏感内容。'
  },
  {
    title: '标准模式与简易模式',
    tag: '界面偏好',
    route: '/settings',
    summary: '标准模式使用完整订阅配置；简易模式提供可视化配置和精简导航。',
    detail:
      '首次选择会保存在本机，之后按你的选择启动。两种模式使用各自的配置工作流程，不只是页面密度变化；切换会重新生成并加载配置。简易模式的更多功能可以展开，设置中也能随时切换模式。'
  }
]

export default function Help(): React.JSX.Element {
  const [query, setQuery] = useState('')
  const navigate = useNavigate()
  const filtered = topics.filter((topic) =>
    `${topic.title} ${topic.tag} ${topic.summary} ${topic.detail}`
      .toLowerCase()
      .includes(query.trim().toLowerCase())
  )
  return (
    <BasePage title="使用指南">
      <div className="mx-auto max-w-5xl p-5 sm:p-7 space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="text-xs text-primary font-medium tracking-wide">从容上手</span>
            <h1 className="text-2xl font-semibold tracking-tight mt-2">知道每一步，改变了什么。</h1>
            <p className="text-sm text-default-500 leading-relaxed mt-2">
              先了解常用功能，再按需要展开高级设置。
            </p>
          </div>
          <Button
            color="primary"
            variant="flat"
            startContent={<LuBookOpen />}
            onPress={() => window.dispatchEvent(new Event('dex-open-guide'))}
          >
            重新查看引导
          </Button>
        </div>
        <div className="flex gap-3 rounded-xl border border-default-200 bg-default-50 p-4">
          <LuShieldCheck className="shrink-0 text-primary mt-0.5" size={19} />
          <p className="text-sm leading-relaxed text-default-600">
            订阅提供线路，软件负责连接与管理。主题工坊及将来的软件账号与代理订阅相互独立，使用订阅不需要登录软件账号。
          </p>
        </div>
        <Input
          aria-label="搜索使用说明"
          placeholder="搜索功能或术语，例如 ISP、Smart、嗅探"
          value={query}
          onValueChange={setQuery}
          startContent={<LuSearch className="text-default-400" />}
          isClearable
          onClear={() => setQuery('')}
        />
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {filtered.map((topic) => (
            <article
              key={topic.title}
              className="rounded-xl border border-default-200 p-5 flex flex-col items-start"
            >
              <span className="text-xs text-default-500">{topic.tag}</span>
              <h2 className="font-semibold text-base mt-2">{topic.title}</h2>
              <p className="text-sm leading-relaxed mt-2">{topic.summary}</p>
              <p className="text-sm leading-relaxed text-default-500 mt-3 flex-1">{topic.detail}</p>
              <Button
                size="sm"
                variant="light"
                className="mt-4 -ml-2"
                endContent={<LuArrowUpRight />}
                onPress={() => navigate(topic.route)}
              >
                前往设置
              </Button>
            </article>
          ))}
        </div>
        {filtered.length === 0 && (
          <p className="py-10 text-center text-default-500" role="status">
            没有找到对应说明，请换一个关键词。
          </p>
        )}
        <p className="text-xs leading-relaxed text-default-400">
          高级功能资料：
          <a
            className="underline"
            href="https://wiki.metacubex.one/config/"
            target="_blank"
            rel="noreferrer"
          >
            Mihomo 配置文档
          </a>{' '}
          ·{' '}
          <a
            className="underline"
            href="https://clashparty.org/docs/guide/smart-core"
            target="_blank"
            rel="noreferrer"
          >
            Smart 说明
          </a>
          。打开链接会访问相应网站。
        </p>
      </div>
    </BasePage>
  )
}
