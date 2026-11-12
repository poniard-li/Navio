import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  deriveNavioMotion,
  type NavioMotionEnvironment,
  type NavioMotionState
} from '../../../shared/navio-material'
import { useAppConfig } from './use-app-config'
import { useNavioMaterial } from './use-navio-material'

const UNKNOWN_ENVIRONMENT: NavioMotionEnvironment = {
  onBattery: null,
  windowVisible: true,
  suspended: false,
  speedLimit: null
}
const MotionContext = createContext<NavioMotionState | null>(null)
function environmentValue(value: unknown): NavioMotionEnvironment {
  const input = (value && typeof value === 'object' ? value : {}) as Partial<NavioMotionEnvironment>
  return {
    onBattery: typeof input.onBattery === 'boolean' ? input.onBattery : null,
    windowVisible: input.windowVisible !== false,
    suspended: input.suspended === true,
    speedLimit:
      typeof input.speedLimit === 'number' && Number.isFinite(input.speedLimit)
        ? Math.min(100, Math.max(0, input.speedLimit))
        : null
  }
}
export function NavioMotionProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { material } = useNavioMaterial()
  const { appConfig } = useAppConfig()
  const [environment, setEnvironment] = useState(UNKNOWN_ENVIRONMENT)
  const [hidden, setHidden] = useState(document.hidden)
  const [reducedMotion, setReducedMotion] = useState(
    () => matchMedia('(prefers-reduced-motion: reduce)').matches
  )
  useEffect(() => {
    let active = true
    let receivedUpdate = false
    const off = window.electron.ipcRenderer.on('motionEnvironmentUpdated', (_event, value) => {
      receivedUpdate = true
      if (active) setEnvironment(environmentValue(value))
    })
    void window.electron.ipcRenderer.invoke('getMotionEnvironment').then(
      (value) => {
        if (active && !receivedUpdate) setEnvironment(environmentValue(value))
      },
      () => {}
    )
    const preference = matchMedia('(prefers-reduced-motion: reduce)')
    const visibility = (): void => setHidden(document.hidden)
    const reduced = (): void => setReducedMotion(preference.matches)
    document.addEventListener('visibilitychange', visibility)
    preference.addEventListener('change', reduced)
    return () => {
      active = false
      off()
      document.removeEventListener('visibilitychange', visibility)
      preference.removeEventListener('change', reduced)
    }
  }, [])
  const motion = useMemo(
    () =>
      deriveNavioMotion(material, environment, {
        hidden,
        reducedMotion,
        disabled: appConfig?.disableAnimations === true
      }),
    [material, environment, hidden, reducedMotion, appConfig?.disableAnimations]
  )
  useEffect(() => {
    const root = document.documentElement
    root.dataset.navioMotion = motion.quality
    root.dataset.navioBackgroundPlaying = String(motion.backgroundPlaying)
    root.style.setProperty('--navio-motion-duration-scale', String(motion.durationScale))
    return () => {
      delete root.dataset.navioMotion
      delete root.dataset.navioBackgroundPlaying
      root.style.removeProperty('--navio-motion-duration-scale')
    }
  }, [motion])
  return <MotionContext.Provider value={motion}>{children}</MotionContext.Provider>
}
export function useNavioMotion(): NavioMotionState {
  const value = useContext(MotionContext)
  if (!value) throw new Error('NavioMotionProvider is required')
  return value
}
