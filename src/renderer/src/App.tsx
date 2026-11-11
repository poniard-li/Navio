import { useTheme } from 'next-themes'
import { Suspense, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { useLocation, useNavigate, useRoutes } from 'react-router-dom'
import { Button, Modal, ModalBody, ModalContent, ModalHeader } from '@heroui/react'
import { IoArrowForward } from 'react-icons/io5'
import { toast } from '@renderer/components/base/toast'
import routes, { useDeferredRoutePreload } from '@renderer/routes'
import { useAppConfig } from '@renderer/hooks/use-app-config'
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
import { createTourDriver, getDriver } from '@renderer/utils/tour'
import { hasPendingPluginFile, subscribePluginFile } from '@renderer/utils/plugin-file-open'
import 'driver.js/dist/driver.css'
import { useTranslation } from 'react-i18next'
import { DEFAULT_ENABLE_TRAFFIC_LOGGER } from '../../shared/appConfig'
import DexSidebar from './components/dex/sidebar'
import ClassicSidebar from './components/dex/classic-sidebar'
import MihomoIcon from './components/base/mihomo-icon'
import { getSiderCardByPath } from './utils/sider'
import { markInitialContentPartReady } from './utils/startup'

export { getDriver }

interface ModeSelectionProps {
  canDismiss: boolean
  onClose: () => void
  onSelect: (mode: 'standard' | 'simple') => Promise<void>
}

function ModeSelection({ canDismiss, onClose, onSelect }: ModeSelectionProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [selectingMode, setSelectingMode] = useState<'standard' | 'simple' | null>(null)
  const selecting = useRef(false)
  return (
    <Modal
      isOpen
      hideCloseButton={!canDismiss}
      isDismissable={canDismiss && selectingMode === null}
      isKeyboardDismissDisabled={!canDismiss || selectingMode !== null}
      onClose={onClose}
      size="lg"
      scrollBehavior="inside"
      classNames={{ base: 'dex-mode-modal' }}
    >
      <ModalContent dir={i18n.dir()}>
        <ModalHeader className="flex flex-col gap-4 px-7 pt-7 pb-3">
          <div className="dex-onboarding-brand">
            <MihomoIcon size={24} />
            <span>
              D.E.X <small>STUDIO</small>
            </span>
          </div>
          <span className="text-xl">{t('settings.operationMode.select.title')}</span>
        </ModalHeader>
        <ModalBody className="gap-5 px-7 pt-0 pb-7">
          <p className="text-small leading-relaxed text-default-500">
            {t('settings.operationMode.select.description')}
          </p>
          <div className="flex shrink-0 flex-col gap-3" aria-busy={selectingMode !== null}>
            {(['standard', 'simple'] as const).map((mode) => (
              <Button
                key={mode}
                variant="flat"
                className="dex-mode-choice h-auto min-h-24 w-full min-w-0 shrink-0 justify-start gap-4 px-4 py-4 whitespace-normal"
                aria-labelledby={`operation-mode-${mode}-label`}
                aria-describedby={`operation-mode-${mode}-description`}
                isDisabled={selectingMode !== null}
                isLoading={selectingMode === mode}
                onPress={async () => {
                  if (selecting.current) return
                  selecting.current = true
                  setSelectingMode(mode)
                  try {
                    await onSelect(mode)
                    onClose()
                  } catch (error) {
                    toast.error(String(error), t('settings.operationMode.error'))
                  } finally {
                    selecting.current = false
                    setSelectingMode(null)
                  }
                }}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-1.5 text-start wrap-break-word">
                  <span id={`operation-mode-${mode}-label`} className="text-base font-semibold">
                    {t(`settings.operationMode.${mode}.label`)}
                  </span>
                  <span
                    id={`operation-mode-${mode}-description`}
                    className="text-small leading-relaxed text-default-500"
                  >
                    {t(`settings.operationMode.${mode}.description`)}
                  </span>
                </span>
                <IoArrowForward aria-hidden="true" className="shrink-0 text-lg rtl:rotate-180" />
              </Button>
            ))}
          </div>
          <p className="border-t border-default-200 pt-4 text-small leading-relaxed text-default-500">
            {t('settings.operationMode.select.note')}
          </p>
        </ModalBody>
      </ModalContent>
    </Modal>
  )
}

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
  const { t, ready } = useTranslation()
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
    if (ready && appConfig?.modeSelected) createTourDriver(t, navigate)
  }, [t, ready, navigate, appConfig?.modeSelected])

  useEffect(() => {
    void setNativeTheme(appTheme)
    setTheme(appTheme)
    setTitlebar()
  }, [appTheme, systemTheme, setTheme, setTitlebar])

  useEffect(() => {
    void applyTheme(customTheme || 'default.css').then(setTitlebar)
  }, [customTheme, setTitlebar])

  return (
    <div
      className="dex-shell"
      data-collapsed={collapsed}
      data-animations={!disableAnimations}
      data-platform={platform}
      data-frameless={!useWindowFrame}
      style={{ '--dex-sidebar-width': `${collapsed ? 68 : sidebarWidth}px` } as CSSProperties}
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
          onClose={() => setShowModeSelection(false)}
          onSelect={async (mode) => {
            await setOperationMode(mode)
            navigate(mode === 'simple' ? '/simple' : '/profiles')
          }}
        />
      )}
    </div>
  )
}

export default App
