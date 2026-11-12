import { Suspense, lazy } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LuPanelLeftClose, LuPanelLeftOpen, LuSearch } from 'react-icons/lu'
import NavioIcon from '../base/navio-icon'
import OutboundModeSwitcher from '../sider/outbound-mode-switcher'
import { PRODUCT_NAME } from '../../../../shared/product'
import { utilityItems } from './sidebar'

const SiderCards = lazy(() => import('../sider/sider-cards'))

interface ClassicSidebarProps {
  collapsed: boolean
  onCollapsedChange: (value: boolean) => void
  onOpenMode: () => void
}

export default function ClassicSidebar({
  collapsed,
  onCollapsedChange,
  onOpenMode
}: ClassicSidebarProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const chinese = i18n.language.startsWith('zh')
  const navigate = useNavigate()
  const { pathname } = useLocation()
  return (
    <aside className="side dex-sidebar dex-classic-sidebar sider-rail" data-expanded={!collapsed}>
      <div className="dex-brand app-drag">
        <span className="dex-brand-symbol">
          <NavioIcon size={25} />
        </span>
        <button
          className="dex-brand-word app-nodrag"
          onClick={() => navigate('/home')}
          title="返回概览"
        >
          {PRODUCT_NAME}
        </button>
        <button
          type="button"
          className="dex-collapse app-nodrag"
          aria-label={chinese ? '收起或展开导航' : 'Toggle navigation'}
          onClick={() => onCollapsedChange(!collapsed)}
        >
          {collapsed ? <LuPanelLeftOpen /> : <LuPanelLeftClose />}
        </button>
      </div>
      <button
        className="dex-classic-search"
        type="button"
        onClick={() => window.dispatchEvent(new Event('dex-open-search'))}
        aria-label={chinese ? '搜索全部功能' : 'Search all features'}
      >
        <LuSearch />
        {!collapsed && <span>{chinese ? '搜索全部功能' : 'Search all features'}</span>}
      </button>
      <div className="dex-classic-mode">
        <OutboundModeSwitcher iconOnly={collapsed} expanded={!collapsed} />
      </div>
      <div className="dex-classic-cards custom-scrollbar">
        <Suspense fallback={null}>
          <SiderCards iconOnly={collapsed} expanded={!collapsed} />
        </Suspense>
      </div>
      <div className="dex-sidebar-bottom">
        {!collapsed && (
          <button className="dex-classic-config-mode" type="button" onClick={onOpenMode}>
            {t('settings.operationMode.title')}
          </button>
        )}
        <div className="dex-utilities">
          {utilityItems.map((item) => {
            const Icon = item.icon
            const label = t(item.key, { defaultValue: chinese ? item.fallback : item.english })
            return (
              <button
                key={item.path}
                className="dex-nav-item"
                type="button"
                data-active={pathname === item.path}
                title={label}
                aria-current={pathname === item.path ? 'page' : undefined}
                onClick={() => navigate(item.path)}
              >
                <Icon className="dex-nav-icon" aria-hidden="true" />
                <span className="dex-nav-label">{label}</span>
              </button>
            )
          })}
        </div>
      </div>
    </aside>
  )
}
