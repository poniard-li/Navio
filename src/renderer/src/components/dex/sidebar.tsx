import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { IconType } from 'react-icons'
import {
  LuActivity,
  LuArrowDownUp,
  LuBlocks,
  LuBookOpen,
  LuChevronDown,
  LuChevronRight,
  LuCpu,
  LuFileSliders,
  LuFolderOpen,
  LuGlobe,
  LuLayers,
  LuListFilter,
  LuNetwork,
  LuPalette,
  LuPanelLeftClose,
  LuPanelLeftOpen,
  LuRadio,
  LuSearch,
  LuSettings2,
  LuShieldCheck,
  LuSlidersHorizontal,
  LuTerminal,
  LuWaypoints,
  LuX
} from 'react-icons/lu'
import { DndContext } from '@dnd-kit/core'
import { SortableContext } from '@dnd-kit/sortable'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { useProfileConfig } from '@renderer/hooks/use-profile-config'
import { markInitialContentPartReady } from '@renderer/utils/startup'
import { platform } from '@renderer/utils/init'
import MihomoIcon from '../base/mihomo-icon'
import OutboundModeSwitcher from '../sider/outbound-mode-switcher'
import SysproxySwitcher from '../sider/sysproxy-switcher'
import TunSwitcher from '../sider/tun-switcher'
import { PRODUCT_NAME } from '../../../../shared/product'

export interface NavigationItem {
  path: string
  key: string
  fallback: string
  english: string
  keywords: string
  icon: IconType
  tourClass?: string
}

export const navigationGroups: {
  id: string
  label: string
  english: string
  items: NavigationItem[]
}[] = [
  {
    id: 'workspace',
    label: '工作区',
    english: 'Workspace',
    items: [
      {
        path: '/proxies',
        key: 'sider.cards.proxies',
        fallback: '代理组',
        english: 'Proxies',
        keywords: '节点 线路 延迟 测速 proxy groups nodes latency',
        icon: LuWaypoints
      },
      {
        path: '/profiles',
        key: 'sider.cards.profiles',
        fallback: '订阅管理',
        english: 'Profiles',
        keywords: '配置 导入 更新 插件 链接 subscriptions profiles import plugins',
        icon: LuFolderOpen,
        tourClass: 'profile-card'
      },
      {
        path: '/connections',
        key: 'sider.cards.connections',
        fallback: '连接',
        english: 'Connections',
        keywords: '连接活动 进程 实时 connections process',
        icon: LuActivity
      },
      {
        path: '/bypass',
        key: 'dex.bypass',
        fallback: '直连例外',
        english: 'Direct exceptions',
        keywords: '全局 微信 抖音 应用 网站 绕过 直连 bypass global exceptions',
        icon: LuShieldCheck
      },
      {
        path: '/rules',
        key: 'sider.cards.rules',
        fallback: '规则',
        english: 'Rules',
        keywords: '分流 路由 rules routing',
        icon: LuListFilter
      },
      {
        path: '/traffic',
        key: 'sider.cards.traffic',
        fallback: '用量',
        english: 'Traffic',
        keywords: '统计 流量 上传 下载 traffic usage statistics',
        icon: LuArrowDownUp
      },
      {
        path: '/logs',
        key: 'sider.cards.logs',
        fallback: '日志',
        english: 'Logs',
        keywords: '日志 调试 错误 logs debug error',
        icon: LuTerminal
      }
    ]
  },
  {
    id: 'configuration',
    label: '配置与资源',
    english: 'Configuration',
    items: [
      {
        path: '/override',
        key: 'sider.cards.override',
        fallback: '覆写',
        english: 'Overrides',
        keywords: '覆写 合并 脚本 yaml merge javascript override',
        icon: LuFileSliders,
        tourClass: 'override-card'
      },
      {
        path: '/dns',
        key: 'sider.cards.dns',
        fallback: 'DNS 覆写',
        english: 'DNS',
        keywords: '域名 解析 dns nameserver',
        icon: LuGlobe,
        tourClass: 'dns-card'
      },
      {
        path: '/sniffer',
        key: 'sider.cards.sniff',
        fallback: '嗅探覆写',
        english: 'Sniffer',
        keywords: '嗅探 流量 sniff sniffer',
        icon: LuRadio
      },
      {
        path: '/resources',
        key: 'sider.cards.resources',
        fallback: '外部资源',
        english: 'Resources',
        keywords: '资源 规则集 代理集 providers resources',
        icon: LuLayers
      },
      {
        path: '/substore',
        key: 'sider.cards.substore',
        fallback: 'Sub-Store',
        english: 'Sub-Store',
        keywords: '转换 合并 订阅 substore subscription',
        icon: LuBlocks
      },
      {
        path: '/simple',
        key: 'settings.operationMode.simple.label',
        fallback: '简易模式',
        english: 'Simple configuration',
        keywords: '简易 节点 订阅 规则 编辑 simple configuration',
        icon: LuSlidersHorizontal
      }
    ]
  },
  {
    id: 'system',
    label: '网络与内核',
    english: 'Network & core',
    items: [
      {
        path: '/sysproxy',
        key: 'sider.cards.systemProxy',
        fallback: '系统代理',
        english: 'System proxy',
        keywords: '系统代理 端口 绕过 bypass port system proxy',
        icon: LuGlobe,
        tourClass: 'sysproxy-card'
      },
      {
        path: '/tun',
        key: 'sider.cards.tun',
        fallback: '虚拟网卡',
        english: 'TUN',
        keywords: '虚拟网卡 tun vpn stack 路由',
        icon: LuShieldCheck,
        tourClass: 'tun-card'
      },
      {
        path: '/mihomo',
        key: 'sider.cards.core',
        fallback: '内核设置',
        english: 'Core settings',
        keywords: '内核 mihomo clash 重启 core restart',
        icon: LuCpu
      },
      {
        path: '/network',
        key: 'sider.cards.network',
        fallback: '网络信息',
        english: 'Network',
        keywords: '网卡 IP 地址 网络 network interface',
        icon: LuNetwork
      }
    ]
  }
]

export const utilityItems: NavigationItem[] = [
  {
    path: '/help',
    key: 'dex.help',
    fallback: '使用指南',
    english: 'Help',
    keywords: '帮助 解释 术语 隐私 新手 ISP ASN Smart 引导 help guide privacy',
    icon: LuBookOpen
  },
  {
    path: '/dex-themes',
    key: 'dex.themes',
    fallback: '主题工坊',
    english: 'Appearance',
    keywords: '外观 主题 颜色 上传 下载 设计 theme appearance design',
    icon: LuPalette
  },
  {
    path: '/settings',
    key: 'common.settings',
    fallback: '设置',
    english: 'Settings',
    keywords: '设置 备份 快捷键 启动 关于 更新 settings backup shortcut update',
    icon: LuSettings2
  }
]

interface SidebarProps {
  collapsed: boolean
  onCollapsedChange: (value: boolean) => void
  onOpenMode: () => void
}

export default function DexSidebar({
  collapsed,
  onCollapsedChange,
  onOpenMode
}: SidebarProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const chinese = i18n.language.startsWith('zh')
  const text = (zh: string, en: string): string => (chinese ? zh : en)
  const { appConfig } = useAppConfig()
  const { profileConfig } = useProfileConfig()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ workspace: true })
  const searchRef = useRef<HTMLInputElement>(null)
  const navigationRef = useRef<HTMLElement>(null)
  const pendingSearchFocus = useRef(false)
  const search = query.trim().toLocaleLowerCase()
  const title = (item: NavigationItem): string =>
    t(item.key, { defaultValue: text(item.fallback, item.english) })
  const matches = (item: NavigationItem): boolean =>
    !search ||
    `${title(item)} ${item.english} ${item.path} ${item.keywords}`
      .toLocaleLowerCase()
      .includes(search)
  const allItems = useMemo(
    () => [...navigationGroups.flatMap((group) => group.items), ...utilityItems],
    []
  )
  const filteredItems = allItems.filter(matches)
  const selectedProfile = profileConfig?.items?.find((item) => item.id === profileConfig.current)
  const simpleMode = appConfig?.operationMode === 'simple'
  const simplePaths = ['/proxies', '/profiles', '/simple', '/connections', '/bypass']

  useEffect(() => {
    setShowAdvanced(false)
  }, [simpleMode])

  useEffect(() => {
    // A tour can visit advanced pages without changing the user's simple navigation.
    if (document.body.classList.contains('driver-active')) return
    if (
      simpleMode &&
      navigationGroups.some((group) => group.items.some((item) => item.path === pathname)) &&
      !['/proxies', '/profiles', '/simple', '/connections', '/bypass'].includes(pathname)
    )
      setShowAdvanced(true)
  }, [pathname, simpleMode])

  useLayoutEffect(() => {
    markInitialContentPartReady('sider')
  }, [])

  useEffect(() => {
    const group = navigationGroups.find((group) =>
      group.items.some((item) => pathname === item.path || pathname.startsWith(`${item.path}/`))
    )
    if (group)
      setOpenGroups((previous) =>
        previous[group.id] ? previous : { ...previous, [group.id]: true }
      )
  }, [pathname])

  useEffect(() => {
    if (!collapsed && pendingSearchFocus.current) {
      pendingSearchFocus.current = false
      searchRef.current?.focus()
      searchRef.current?.select()
    }
  }, [collapsed])

  useEffect(() => {
    const focusSearch = (): void => {
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return
      if (collapsed) {
        pendingSearchFocus.current = true
        onCollapsedChange(false)
      } else {
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    const handleShortcut = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        // A modal owns its keyboard until dismissed; do not move focus behind it.
        if (document.querySelector('[role="dialog"][aria-modal="true"]')) return
        event.preventDefault()
        focusSearch()
      }
    }
    window.addEventListener('keydown', handleShortcut)
    window.addEventListener('dex-open-search', focusSearch)
    return () => {
      window.removeEventListener('keydown', handleShortcut)
      window.removeEventListener('dex-open-search', focusSearch)
    }
  }, [collapsed, onCollapsedChange])

  const visit = (path: string): void => {
    navigate(path)
    setQuery('')
  }

  const renderItem = (item: NavigationItem): React.JSX.Element => {
    const active = pathname === item.path || pathname.startsWith(`${item.path}/`)
    const Icon = item.icon
    return (
      <button
        key={item.path}
        type="button"
        className={`dex-nav-item ${item.tourClass || ''}`}
        data-active={active}
        data-dex-route={item.path}
        aria-current={active ? 'page' : undefined}
        title={collapsed ? title(item) : undefined}
        onClick={() => visit(item.path)}
      >
        <Icon aria-hidden="true" className="dex-nav-icon" />
        <span className="dex-nav-label">{title(item)}</span>
        {active && <span className="dex-nav-marker" aria-hidden="true" />}
      </button>
    )
  }

  return (
    <aside className="side dex-sidebar" aria-label={text('主导航', 'Main navigation')}>
      <div className="dex-brand app-drag">
        <span className="dex-brand-symbol">
          <MihomoIcon size={25} />
        </span>
        <span className="dex-brand-word">{PRODUCT_NAME}</span>
        <button
          className="dex-collapse app-nodrag"
          type="button"
          title={text(
            collapsed ? '展开导航' : '收起导航',
            collapsed ? 'Expand navigation' : 'Collapse navigation'
          )}
          aria-label={text(
            collapsed ? '展开导航' : '收起导航',
            collapsed ? 'Expand navigation' : 'Collapse navigation'
          )}
          onClick={() => onCollapsedChange(!collapsed)}
        >
          {collapsed ? <LuPanelLeftOpen /> : <LuPanelLeftClose />}
        </button>
      </div>

      <div className="dex-search-wrap">
        {collapsed ? (
          <button
            className="dex-search-trigger"
            type="button"
            aria-label={text('搜索功能', 'Search features')}
            title={`${text('搜索功能', 'Search features')} · ${platform === 'darwin' ? '⌘' : 'Ctrl'} K`}
            onClick={() => {
              pendingSearchFocus.current = true
              onCollapsedChange(false)
            }}
          >
            <LuSearch />
          </button>
        ) : (
          <div className="dex-search-field">
            <LuSearch aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              placeholder={text('搜索全部功能', 'Search all features')}
              aria-label={text('搜索全部功能', 'Search all features')}
              aria-controls="dex-navigation"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setQuery('')
                }
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  navigationRef.current
                    ?.querySelector<HTMLButtonElement>('[data-dex-route]')
                    ?.focus()
                }
                if (event.key === 'Enter' && search && filteredItems[0]) {
                  event.preventDefault()
                  visit(filteredItems[0].path)
                }
              }}
            />
            {query ? (
              <button
                type="button"
                aria-label={text('清除搜索', 'Clear search')}
                onClick={() => {
                  setQuery('')
                  searchRef.current?.focus()
                }}
              >
                <LuX />
              </button>
            ) : (
              <kbd>{platform === 'darwin' ? '⌘ K' : 'Ctrl K'}</kbd>
            )}
          </div>
        )}
      </div>

      <nav
        ref={navigationRef}
        id="dex-navigation"
        className="dex-navigation custom-scrollbar"
        aria-label={text('功能', 'Features')}
        onKeyDown={(event) => {
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape'].includes(event.key)) return
          const buttons = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-dex-route]')
          )
          const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
          if (event.key === 'Escape') {
            setQuery('')
            searchRef.current?.focus()
            event.preventDefault()
            return
          }
          if (current < 0) return
          event.preventDefault()
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? buttons.length - 1
                : current + (event.key === 'ArrowDown' ? 1 : -1)
          if (next < 0) searchRef.current?.focus()
          else buttons[Math.min(next, buttons.length - 1)]?.focus()
        }}
      >
        {navigationGroups.map((group) => {
          const items = group.items.filter(
            (item) =>
              matches(item) &&
              (!simpleMode || showAdvanced || search || simplePaths.includes(item.path))
          )
          if (!items.length) return null
          const expanded = collapsed || Boolean(search) || openGroups[group.id]
          return (
            <section className="dex-nav-group" key={group.id}>
              {!collapsed && (
                <button
                  className="dex-nav-heading"
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={`dex-group-${group.id}`}
                  onClick={() =>
                    setOpenGroups((previous) => ({ ...previous, [group.id]: !expanded }))
                  }
                  disabled={Boolean(search)}
                >
                  <span>{text(group.label, group.english)}</span>
                  <LuChevronDown data-expanded={expanded} aria-hidden="true" />
                </button>
              )}
              {expanded && (
                <div id={`dex-group-${group.id}`} className="dex-nav-items">
                  {items.map(renderItem)}
                </div>
              )}
            </section>
          )
        })}
        {simpleMode && !search && (
          <button
            type="button"
            className="dex-nav-heading mt-3"
            aria-expanded={showAdvanced}
            title={text('展开或收起高级功能', 'Toggle advanced features')}
            onClick={() => setShowAdvanced((value) => !value)}
          >
            <span>
              {collapsed
                ? '···'
                : text(
                    showAdvanced ? '收起更多功能' : '更多功能',
                    showAdvanced ? 'Fewer features' : 'More features'
                  )}
            </span>
            {!collapsed && <LuChevronDown data-expanded={showAdvanced} aria-hidden="true" />}
          </button>
        )}
        {search && utilityItems.filter(matches).length > 0 && (
          <section className="dex-nav-group">
            <div className="dex-search-section-label">{text('应用', 'Application')}</div>
            {utilityItems.filter(matches).map(renderItem)}
          </section>
        )}
        {search && (
          <p className="dex-search-result" role="status">
            {filteredItems.length
              ? text(`${filteredItems.length} 项功能`, `${filteredItems.length} features`)
              : text('没有找到匹配功能', 'No matching features')}
          </p>
        )}
      </nav>

      <div className="dex-sidebar-bottom">
        {!collapsed && (
          <>
            <button
              className="dex-active-profile"
              type="button"
              onClick={() => visit(simpleMode ? '/simple' : '/profiles')}
              title={selectedProfile?.name}
            >
              <LuFolderOpen aria-hidden="true" />
              <span>
                <small>{text('当前配置', 'Current configuration')}</small>
                <strong>
                  {simpleMode
                    ? text('简易配置', 'Simple configuration')
                    : selectedProfile?.name || text('尚未选择配置', 'No profile selected')}
                </strong>
              </span>
              <LuChevronRight aria-hidden="true" />
            </button>
            <div className="dex-routing-controls">
              <div className="dex-control-label">
                <span>{t('sider.cards.outbound.title')}</span>
                <button type="button" onClick={onOpenMode}>
                  {t(`settings.operationMode.${simpleMode ? 'simple' : 'standard'}.label`)}
                  <LuChevronDown />
                </button>
              </div>
              <OutboundModeSwitcher />
            </div>
            <div className="dex-quick-controls">
              <DndContext>
                <SortableContext items={['sysproxy', 'tun']}>
                  <SysproxySwitcher iconOnly expanded />
                  <TunSwitcher iconOnly expanded />
                </SortableContext>
              </DndContext>
            </div>
          </>
        )}
        <div className="dex-utilities">{utilityItems.map(renderItem)}</div>
      </div>
    </aside>
  )
}
