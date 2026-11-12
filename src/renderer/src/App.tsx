import { useTheme } from 'next-themes'
import { Suspense, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { useLocation, useNavigate, useRoutes } from 'react-router-dom'
import routes, { useDeferredRoutePreload } from '@renderer/routes'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import ThemeBackground from '@renderer/components/dex/theme-background'
import {
  applyTheme,
  setNativeTheme,
  setOperationMode,
  setTitleBarOverlay
} from '@renderer/utils/ipc'
import { platform } from '@renderer/utils/init'
import { TitleBarOverlayOptions } from 'electron'
import { useTrafficLogger } from '@renderer/hooks/use-traffic-logger'
import { useDnsOverrideAutoDisabledNotice } from '@renderer/hooks/use-dns-override-notice'
import { hasPendingPluginFile, subscribePluginFile } from '@renderer/utils/plugin-file-open'
import { DEFAULT_ENABLE_TRAFFIC_LOGGER } from '../../shared/appConfig'
import DexSidebar from './components/dex/sidebar'
import ClassicSidebar from './components/dex/classic-sidebar'
import ModeSelection from './components/dex/mode-selection'
import DexOnboarding from './components/dex/onboarding'
import AccountGate from './components/dex/account-gate'
import { getSiderCardByPath } from './utils/sider'
import { markInitialContentPartReady } from './utils/startup'

function FirstContentReady(): null {
  const { appConfig } = useAppConfig()
  const location = useLocation()
  const sent = useRef(false)
  useEffect(() => {
    if (!appConfig || location.pathname === '/' || sent.current) return
    sent.current = true
    markInitialContentPartReady('route')
  }, [appConfig, location.pathname])
  return null
}

const App: React.FC = () => {
  const { appConfig, patchAppConfig } = useAppConfig()
  const {
    enableTrafficLogger = DEFAULT_ENABLE_TRAFFIC_LOGGER,
    appTheme = 'system',
    customTheme,
    useWindowFrame = false,
    siderWidth = 244,
    disableAnimations = false,
    lastSelectedSiderCard = 'proxy',
    rememberSelectedSiderCard = false
  } = appConfig || {}
  useTrafficLogger(enableTrafficLogger)
  useDnsOverrideAutoDisabledNotice()
  useDeferredRoutePreload()
  const { setTheme, systemTheme } = useTheme()
  const navigate = useNavigate()
  const location = useLocation()
  const page = useRoutes(routes)
  const [showModeSelection, setShowModeSelection] = useState(false)
  const [collapsed, setCollapsed] = useState(siderWidth <= 70)
  const [sidebarWidth, setSidebarWidth] = useState(Math.min(320, Math.max(220, siderWidth)))
  const widthRef = useRef(sidebarWidth)
  const resizeRef = useRef(false)

  useEffect(() => {
    setCollapsed(siderWidth <= 70)
    if (siderWidth > 70) setSidebarWidth(Math.min(320, Math.max(220, siderWidth)))
  }, [siderWidth])

  const setSidebarCollapsed = useCallback(
    (value: boolean): void => {
      setCollapsed(value)
      void patchAppConfig({ siderWidth: value ? 68 : sidebarWidth })
    },
    [patchAppConfig, sidebarWidth]
  )

  useEffect(() => {
    const openPluginImport = (): void => {
      void navigate('/profiles')
    }
    const unsubscribe = subscribePluginFile(openPluginImport)
    if (hasPendingPluginFile()) openPluginImport()
    return unsubscribe
  }, [navigate])

  const setTitlebar = useCallback((): void => {
    if (useWindowFrame || platform === 'darwin') return
    const options = { height: 47 } as TitleBarOverlayOptions
    try {
      const rootStyle = window.getComputedStyle(document.documentElement)
      options.color = rootStyle.backgroundColor
      options.symbolColor = rootStyle.color
      void setTitleBarOverlay(options)
    } catch {
      /* The native overlay may not be available on every window host. */
    }
  }, [useWindowFrame])

  useEffect(() => {
    if (!appConfig || !rememberSelectedSiderCard) return
    const currentCard = getSiderCardByPath(location.pathname)
    if (currentCard && currentCard !== lastSelectedSiderCard) {
      void patchAppConfig({ lastSelectedSiderCard: currentCard })
    }
  }, [
    appConfig,
    rememberSelectedSiderCard,
    lastSelectedSiderCard,
    location.pathname,
    patchAppConfig
  ])

  useEffect(() => {
    void setNativeTheme(appTheme)
    setTheme(appTheme)
    setTitlebar()
  }, [appTheme, systemTheme, setTheme, setTitlebar])

  useEffect(() => {
    void applyTheme(customTheme || 'default.css').then(setTitlebar)
  }, [customTheme, setTitlebar])

  return (
    <AccountGate>
      <ThemeBackground />
      <div
        className="dex-shell"
        data-collapsed={collapsed}
        data-animations={!disableAnimations}
        data-platform={platform}
        data-frameless={!useWindowFrame}
        style={
          {
            '--dex-sidebar-width': `${collapsed ? 68 : sidebarWidth}px`,
            position: 'relative',
            zIndex: 1
          } as CSSProperties
        }
      >
        {appConfig?.dexNavigation === 'classic' ? (
          <ClassicSidebar
            collapsed={collapsed}
            onCollapsedChange={setSidebarCollapsed}
            onOpenMode={() => setShowModeSelection(true)}
          />
        ) : (
          <DexSidebar
            collapsed={collapsed}
            onCollapsedChange={setSidebarCollapsed}
            onOpenMode={() => setShowModeSelection(true)}
          />
        )}
        {!collapsed && (
          <div
            className="dex-sidebar-resizer"
            role="separator"
            aria-label="调整导航栏宽度"
            aria-orientation="vertical"
            aria-valuenow={sidebarWidth}
            aria-valuemin={220}
            aria-valuemax={320}
            tabIndex={0}
            onPointerDown={(event) => {
              resizeRef.current = true
              widthRef.current = sidebarWidth
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={(event) => {
              if (!resizeRef.current) return
              const next = Math.min(320, Math.max(220, event.clientX))
              widthRef.current = next
              setSidebarWidth(next)
            }}
            onPointerUp={(event) => {
              if (!resizeRef.current) return
              resizeRef.current = false
              event.currentTarget.releasePointerCapture(event.pointerId)
              void patchAppConfig({ siderWidth: widthRef.current })
            }}
            onPointerCancel={() => {
              resizeRef.current = false
            }}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
              event.preventDefault()
              const next = Math.min(
                320,
                Math.max(220, sidebarWidth + (event.key === 'ArrowLeft' ? -10 : 10))
              )
              setSidebarWidth(next)
              void patchAppConfig({ siderWidth: next })
            }}
          />
        )}
        <main className="main dex-main" id="dex-main-content">
          <Suspense
            fallback={
              <div className="dex-page-loading" role="status">
                <span />
                正在载入…
              </div>
            }
          >
            {page}
            <FirstContentReady />
          </Suspense>
        </main>
        {appConfig && (!appConfig.modeSelected || showModeSelection) && (
          <ModeSelection
            canDismiss={Boolean(appConfig.modeSelected)}
            currentMode={appConfig.operationMode}
            onClose={() => setShowModeSelection(false)}
            onSelect={async (mode) => {
              await setOperationMode(mode)
              navigate('/home')
            }}
          />
        )}
        <DexOnboarding blocked={!appConfig?.modeSelected || showModeSelection} />
      </div>
    </AccountGate>
  )
}

export default App
