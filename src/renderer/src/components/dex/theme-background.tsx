import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { validateDexTheme, type DexTheme } from '../../../../shared/dex-theme'
import { themeAssetUrl } from '../../../../shared/theme-media'

export function ThemeCanvas({
  theme,
  playback = false,
  className = ''
}: {
  theme: DexTheme
  playback?: boolean
  className?: string
}): React.JSX.Element | null {
  const { appConfig } = useAppConfig()
  const container = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const [visible, setVisible] = useState(!document.hidden)
  const [inView, setInView] = useState(true)
  const [reduced, setReduced] = useState(matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [failed, setFailed] = useState(false)
  const bg = theme.background
  const assetKey = bg && 'asset' in bg ? bg.asset.sha256 : ''
  const moving =
    playback && visible && inView && !reduced && !appConfig?.disableAnimations && !failed
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
  return theme?.background ? (
    <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
      <ThemeCanvas theme={theme} playback />
    </div>
  ) : null
}
