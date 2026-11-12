import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useControledMihomoConfig } from '@renderer/hooks/use-controled-mihomo-config'
import { useNavioMotion } from '@renderer/hooks/use-navio-motion'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import {
  officialThemeDefinition,
  defaultOfficialSettings,
  type OfficialThemeSettings
} from '../../../../shared/official-themes'
import { validateDexTheme, type DexTheme } from '../../../../shared/dex-theme'
import { themeAssetUrl } from '../../../../shared/theme-media'
import { OfficialThemeScene } from './official-theme-scene'

export function ThemeCanvas({
  theme,
  playback = false,
  className = '',
  officialSettings = defaultOfficialSettings()
}: {
  theme: DexTheme
  playback?: boolean
  className?: string
  officialSettings?: OfficialThemeSettings
}): React.JSX.Element | null {
  const { appConfig } = useAppConfig()
  const motion = useNavioMotion()
  const definition = officialThemeDefinition(theme.id)
  const container = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const [visible, setVisible] = useState(!document.hidden)
  const [inView, setInView] = useState(true)
  const [reduced, setReduced] = useState(matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [failed, setFailed] = useState(false)
  const bg = theme.background
  const assetKey = bg && 'asset' in bg ? bg.asset.sha256 : ''
  const moving =
    playback &&
    visible &&
    inView &&
    !reduced &&
    !appConfig?.disableAnimations &&
    !failed &&
    motion.backgroundPlaying &&
    motion.quality === 'full'
  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)')
    const visibility = (): void => setVisible(!document.hidden)
    const motion = (): void => setReduced(preference.matches)
    document.addEventListener('visibilitychange', visibility)
    preference.addEventListener('change', motion)
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting))
    if (container.current) observer.observe(container.current)
    return () => {
      document.removeEventListener('visibilitychange', visibility)
      preference.removeEventListener('change', motion)
      observer.disconnect()
    }
  }, [])
  useEffect(() => {
    setFailed(false)
  }, [assetKey])
  useEffect(() => {
    const element = video.current
    if (!element) return
    if (moving) void element.play().catch(() => setFailed(true))
    else element.pause()
  }, [moving, bg])
  if (definition)
    return (
      <OfficialThemeScene
        definition={definition}
        theme={theme}
        settings={officialSettings}
        playback={playback}
      />
    )
  if (!bg) return null
  const style: CSSProperties = {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
    overflow: 'hidden',
    background: theme.colors.bg
  }
  if (bg.type === 'solid' || bg.type === 'gradient')
    return (
      <div
        ref={container}
        aria-hidden="true"
        className={className}
        style={{
          ...style,
          background:
            bg.type === 'solid'
              ? bg.colors[0]
              : `linear-gradient(${bg.angle ?? 135}deg,${bg.colors.join(',')})`
        }}
      />
    )
  if (!('asset' in bg)) return null
  const image = bg.type === 'video' ? bg.poster : bg.asset
  const mediaStyle: CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit: bg.fit || 'cover',
    opacity: bg.opacity ?? 0.35,
    position: 'absolute',
    inset: 0
  }
  return (
    <div ref={container} aria-hidden="true" className={className} style={style}>
      <img
        src={themeAssetUrl(image)}
        alt=""
        style={mediaStyle}
        draggable={false}
        onError={(event) => {
          event.currentTarget.style.visibility = 'hidden'
        }}
      />
      {bg.type === 'video' && playback && (
        <video
          ref={video}
          src={moving ? themeAssetUrl(bg.asset) : undefined}
          poster={themeAssetUrl(bg.poster)}
          muted
          loop
          playsInline
          preload="none"
          style={{ ...mediaStyle, visibility: moving ? 'visible' : 'hidden' }}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  )
}

export default function ThemeBackground(): React.JSX.Element | null {
  const { appConfig } = useAppConfig()
  const [theme, setTheme] = useState<DexTheme | null>(null)
  const [settings, setSettings] = useState<OfficialThemeSettings>(defaultOfficialSettings())
  const [settingsId, setSettingsId] = useState('')
  const syncedAppearance = useRef('')
  const { controledMihomoConfig } = useControledMihomoConfig()
  useEffect(() => {
    let active = true,
      sequence = 0
    const load = async (): Promise<void> => {
      const seq = ++sequence
      const value = await window.electron.ipcRenderer.invoke('dexThemes', 'activeBackground')
      if (active && seq === sequence)
        setTheme(
          value && typeof value === 'object' && !('invokeError' in value)
            ? validateDexTheme(value)
            : null
        )
    }
    const off = window.electron.ipcRenderer.on('dexThemeBackground', (_event, value) => {
      if (!value) {
        void load().catch(() => setTheme(null))
        return
      }
      sequence++
      try {
        setTheme(validateDexTheme(value))
      } catch {
        setTheme(null)
      }
    })
    void load().catch(() => setTheme(null))
    return () => {
      active = false
      off()
    }
  }, [appConfig?.customTheme])
  useEffect(() => {
    let active = true
    const definition = theme && officialThemeDefinition(theme.id)
    if (definition)
      void window.electron.ipcRenderer
        .invoke('dexThemes', 'officialSettings', { id: definition.id })
        .then((value) => {
          if (active && value && typeof value === 'object' && !('invokeError' in value)) {
            setSettings(value as OfficialThemeSettings)
            setSettingsId(definition.id)
          }
        })
        .catch(() => {})
    return () => {
      active = false
    }
  }, [theme])
  useEffect(() => {
    if (
      !theme ||
      settingsId !== theme.id ||
      !officialThemeDefinition(theme.id) ||
      settings.appearance !== 'system'
    )
      return
    const media = matchMedia('(prefers-color-scheme: dark)')
    const sync = (): void => {
      const key = `${theme.id}:${media.matches}`
      if (syncedAppearance.current === key) return
      syncedAppearance.current = key
      void window.electron.ipcRenderer
        .invoke('dexThemes', 'officialSettings', {
          id: theme.id,
          settings,
          appearance: media.matches ? 'dark' : 'light'
        })
        .catch(() => {})
    }
    media.addEventListener('change', sync)
    sync()
    return () => media.removeEventListener('change', sync)
  }, [theme, settings, settingsId])
  const definition = theme && officialThemeDefinition(theme.id)
  if (theme && definition)
    return (
      <OfficialThemeScene
        definition={definition}
        theme={theme}
        settings={settings}
        wallpaper
        playback
        connected={Boolean(appConfig?.sysProxy?.enable || controledMihomoConfig?.tun?.enable)}
      />
    )
  return theme?.background ? (
    <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
      <ThemeCanvas theme={theme} playback />
    </div>
  ) : null
}
