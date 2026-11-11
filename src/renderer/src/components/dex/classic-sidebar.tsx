import { Suspense, lazy, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LuPalette, LuPanelLeftClose, LuPanelLeftOpen, LuSettings2, LuSearch } from 'react-icons/lu'
import MihomoIcon from '../base/mihomo-icon'
import OutboundModeSwitcher from '../sider/outbound-mode-switcher'
import { PRODUCT_NAME } from '../../../../shared/product'
import FeatureSearch from './feature-search'

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
  const [searchOpen, setSearchOpen] = useState(false)
  useEffect(() => {
    const openSearch = (): void => {
      if (!document.querySelector('[role="dialog"][aria-modal="true"]')) setSearchOpen(true)
    }
    const shortcut = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        if (document.querySelector('[role="dialog"][aria-modal="true"]')) return
        event.preventDefault()
        openSearch()
      }
    }
    window.addEventListener('dex-open-search', openSearch)
    window.addEventListener('keydown', shortcut)
    return () => {
      window.removeEventListener('dex-open-search', openSearch)
      window.removeEventListener('keydown', shortcut)
    }
  }, [])
  return (
    <aside className="side dex-sidebar dex-classic-sidebar sider-rail" data-expanded={!collapsed}>
      <div className="dex-brand app-drag">
        <span className="dex-brand-symbol">
          <MihomoIcon size={25} />
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
        onClick={() => setSearchOpen(true)}
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
          <button
            className="dex-nav-item"
            data-active={pathname === '/dex-themes'}
            type="button"
            title={chinese ? '主题工坊' : 'Appearance'}
            onClick={() => {
              void navigate('/dex-themes')
            }}
          >
            <LuPalette className="dex-nav-icon" />
            <span className="dex-nav-label">{chinese ? '主题工坊' : 'Appearance'}</span>
          </button>
          <button
            className="dex-nav-item"
            data-active={pathname === '/settings'}
            type="button"
            title={t('common.settings')}
            onClick={() => {
              void navigate('/settings')
            }}
          >
            <LuSettings2 className="dex-nav-icon" />
            <span className="dex-nav-label">{t('common.settings')}</span>
          </button>
        </div>
      </div>
      {searchOpen && <FeatureSearch onClose={() => setSearchOpen(false)} />}
    </aside>
  )
}
