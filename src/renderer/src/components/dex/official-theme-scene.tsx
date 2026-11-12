import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useNavioMotion } from '@renderer/hooks/use-navio-motion'
import type { DexTheme } from '../../../../shared/dex-theme'
import type {
  OfficialThemeDefinition,
  OfficialThemeSettings
} from '../../../../shared/official-themes'
import {
  OFFICIAL_SCENE_ARTWORK,
  OFFICIAL_CAT_ARTWORK,
  OFFICIAL_GIFT_ARTWORK
} from './official-theme-artwork'
import '../../assets/official-themes.css'

export function officialSceneStyle(
  theme: DexTheme,
  settings: OfficialThemeSettings
): CSSProperties {
  const c = theme.colors
  return {
    '--it-bg': c.bg,
    '--it-side': c.surface,
    '--it-top': c.surface,
    '--it-panel': c.surface,
    '--it-text': c.text,
    '--it-muted': c.muted,
    '--it-accent': c.accent,
    '--it-edge': c.border,
    '--it-line': c.border,
    '--it-wash1': c.accent,
    '--it-wash2': c.surfaceRaised,
    '--nt-intensity': settings.intensity / 100,
    '--nt-theme-strength': settings.intensity / 100,
    '--n-accent': c.accent,
    colorScheme: theme.appearance
  } as CSSProperties
}
export function OfficialThemeScene({
  definition,
  theme,
  settings,
  playback = false,
  wallpaper = false,
  connected = true
}: {
  definition: OfficialThemeDefinition
  theme: DexTheme
  settings: OfficialThemeSettings
  playback?: boolean
  wallpaper?: boolean
  connected?: boolean
}): React.JSX.Element {
  const motion = useNavioMotion(),
    container = useRef<HTMLDivElement>(null),
    actor = useRef<HTMLButtonElement>(null)
  const [inView, setInView] = useState(true),
    [reaction, setReaction] = useState(''),
    [position, setPosition] = useState<{ x: number; y: number } | null>(null)
  const enabled =
    playback &&
    inView &&
    definition.dynamic &&
    settings.intensity > 0 &&
    settings.playback !== 'paused'
  const override = settings.playback === 'always' && motion.overrideAllowed
  const playing = enabled && (motion.playing || override),
    backgroundPlaying = playing && motion.flow > 0
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting))
    if (container.current) observer.observe(container.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!wallpaper) return
    const html = document.documentElement
    html.dataset.navioOfficialTheme = definition.scene
    return () => {
      delete html.dataset.navioOfficialTheme
    }
  }, [wallpaper, definition.scene])
  useEffect(() => {
    if (!wallpaper || !playing || !settings.feedback) return
    let frame = 0,
      timer: ReturnType<typeof setTimeout> | undefined
    const move = (event: PointerEvent): void => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const element = container.current
        if (!element) return
        element.style.setProperty(
          '--nt-look-x',
          String((event.clientX / Math.max(innerWidth, 1)) * 2 - 1)
        )
        element.style.setProperty(
          '--nt-look-y',
          String((event.clientY / Math.max(innerHeight, 1)) * 2 - 1)
        )
        actor.current?.style.setProperty(
          '--nt-look-x',
          String((event.clientX / Math.max(innerWidth, 1)) * 2 - 1)
        )
        actor.current?.style.setProperty(
          '--nt-look-y',
          String((event.clientY / Math.max(innerHeight, 1)) * 2 - 1)
        )
      })
    }
    const respond = (event: Event): void => {
      const detail = (event as CustomEvent).detail
      if (['connect', 'node', 'latency', 'pet'].includes(detail)) {
        setReaction(detail)
        clearTimeout(timer)
        timer = setTimeout(() => setReaction(''), 1600)
      }
    }
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('navio-theme-feedback', respond)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('navio-theme-feedback', respond)
      cancelAnimationFrame(frame)
      clearTimeout(timer)
    }
  }, [wallpaper, playing, settings.feedback])
  useEffect(() => {
    if (!wallpaper || !definition.character || !settings.character) {
      setPosition(null)
      return
    }
    let frame = 0
    const place = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const card = document.querySelector('.navio-v7-connection'),
          rect = card?.getBoundingClientRect()
        if (!card || !rect || rect.width < 620) {
          setPosition(null)
          return
        }
        const occupied: Array<DOMRect> = []
        for (const el of card.querySelectorAll(
          'button,a,input,select,label,h1,h2,h3,strong,p,[data-live-metric]'
        )) {
          const box = el.getBoundingClientRect()
          if (box.width && box.height) occupied.push(box)
        }
        for (const candidate of [0.52, 0.62, 0.72, 0.82]) {
          const x = rect.left + rect.width * candidate - 43,
            y = rect.top + 14
          if (
            !occupied.some(
              (box) =>
                x < box.right + 8 &&
                x + 86 > box.left - 8 &&
                y < box.bottom + 6 &&
                y + 64 > box.top - 6
            )
          ) {
            setPosition({ x, y })
            return
          }
        }
        setPosition(null)
      })
    }
    const observer = new MutationObserver(place)
    observer.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    place()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      cancelAnimationFrame(frame)
    }
  }, [wallpaper, definition.character, settings.character, definition.id])
  const style = {
    ...officialSceneStyle(theme, settings),
    ...(wallpaper
      ? {
          '--it-bg': 'var(--dex-bg)',
          '--it-side': 'var(--dex-surface)',
          '--it-top': 'var(--dex-surface)',
          '--it-panel': 'var(--dex-surface)',
          '--it-text': 'var(--dex-text)',
          '--it-muted': 'var(--dex-muted)',
          '--it-accent': 'var(--dex-accent)',
          '--it-edge': 'var(--dex-border)',
          '--it-line': 'var(--dex-border)',
          '--it-wash1': 'var(--dex-accent)',
          '--it-wash2': 'var(--dex-surface-raised)',
          colorScheme: 'inherit'
        }
      : {}),
    '--nm-flow': motion.flow,
    '--nm-flow-duration': `${24 * motion.durationScale}s`
  } as CSSProperties
  const artwork = OFFICIAL_SCENE_ARTWORK[definition.scene] || ''
  const character = definition.category === 'collab' ? OFFICIAL_GIFT_ARTWORK : OFFICIAL_CAT_ARTWORK
  return (
    <>
      <div
        ref={container}
        className="navio-theme-scope"
        style={style}
        data-wallpaper={wallpaper}
        data-background={settings.background}
        data-character={settings.character && definition.character}
        data-playing={backgroundPlaying}
        data-fx-override={override}
        data-quality={motion.quality}
        data-connected={connected}
        data-react={reaction}
        aria-hidden={!wallpaper || !position ? true : undefined}
      >
        <div
          className={wallpaper ? 'n-window' : 'nt-art'}
          data-art-theme={definition.scene}
          data-fx-override={override}
        >
          <div className="fx-wallpaper" data-fx-wallpaper={definition.scene} aria-hidden="true">
            <i className="fx-wash fx-wash-one" />
            <i className="fx-wash fx-wash-two" />
            <i className="fx-wash fx-wash-three" />
            <div className="nt-wall-pattern" />
            <div className="navio-scene-drawing" dangerouslySetInnerHTML={{ __html: artwork }} />
          </div>
        </div>
      </div>
      {wallpaper &&
        position &&
        settings.character &&
        definition.character &&
        createPortal(
          <div
            className="navio-theme-scope navio-theme-actor-layer"
            style={style}
            data-react={reaction}
            data-connected={connected}
            data-fx-override={override}
          >
            <button
              ref={actor}
              className={`navio-theme-character ${definition.scene === 'fox' ? 'nt-fox' : ''}`}
              type="button"
              aria-label={definition.category === 'collab' ? '轻触礼盒' : '逗一逗角色'}
              style={{
                left: position.x,
                top: position.y,
                animationPlayState: playing ? 'running' : 'paused'
              }}
              onClick={() =>
                window.dispatchEvent(new CustomEvent('navio-theme-feedback', { detail: 'pet' }))
              }
              data-playing={playing}
            >
              <span dangerouslySetInnerHTML={{ __html: character }} />
            </button>
          </div>,
          document.body
        )}
    </>
  )
}
