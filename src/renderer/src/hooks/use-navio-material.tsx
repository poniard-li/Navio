import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { patchAppConfig } from '@renderer/utils/ipc'
import {
  navioMaterialVariables,
  normalizeNavioMaterial,
  type NavioMaterialSettings
} from '../../../shared/navio-material'
import { useAppConfig } from './use-app-config'

interface MaterialContextValue {
  material: NavioMaterialSettings
  updateMaterial: (update: (current: NavioMaterialSettings) => NavioMaterialSettings) => void
  saveMaterial: () => Promise<boolean>
  saving: boolean
  error: string
}
const MaterialContext = createContext<MaterialContextValue | null>(null)

export function NavioMaterialProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { appConfig } = useAppConfig()
  const [material, setMaterial] = useState(() => normalizeNavioMaterial(appConfig?.navioMaterial))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const current = useRef(material)
  const dirty = useRef(false)
  const editRevision = useRef(0)
  const saveRevision = useRef(0)
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    if (dirty.current) return
    const next = normalizeNavioMaterial(appConfig?.navioMaterial)
    current.current = next
    setMaterial(next)
  }, [appConfig?.navioMaterial])
  const updateMaterial = useCallback(
    (update: (value: NavioMaterialSettings) => NavioMaterialSettings): void => {
      const next = normalizeNavioMaterial(update(structuredClone(current.current)))
      current.current = next
      dirty.current = true
      editRevision.current++
      setMaterial(next)
      setError('')
    },
    []
  )
  const saveMaterial = useCallback(async (): Promise<boolean> => {
    if (!dirty.current) return true
    const payload = structuredClone(current.current)
    const edit = editRevision.current
    const save = ++saveRevision.current
    setSaving(true)
    const request = queue.current
      .catch(() => {})
      .then(() => patchAppConfig({ navioMaterial: payload }))
    queue.current = request
    try {
      await request
      if (editRevision.current === edit) dirty.current = false
      if (mounted.current && saveRevision.current === save) setError('')
      return true
    } catch (cause) {
      if (mounted.current && saveRevision.current === save)
        setError(`材质设置未保存：${String(cause)}`)
      return false
    } finally {
      if (mounted.current && saveRevision.current === save) setSaving(false)
    }
  }, [])
  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.navioMaterial = 'enabled'
    root.dataset.navioDefaultPalette = String(
      !appConfig?.customTheme || appConfig.customTheme === 'default.css'
    )
    for (const [name, value] of Object.entries(navioMaterialVariables(material)))
      root.style.setProperty(name, value)
    for (const [region, value] of Object.entries(material.regions))
      root.dataset[`navio${region[0].toUpperCase()}${region.slice(1)}`] = value.mode
  }, [material, appConfig?.customTheme])
  useEffect(
    () => () => {
      const root = document.documentElement
      delete root.dataset.navioMaterial
      delete root.dataset.navioDefaultPalette
      for (const key of ['navioSidebar', 'navioCards', 'navioDialogs']) delete root.dataset[key]
      for (const name of Object.keys(navioMaterialVariables(current.current)))
        root.style.removeProperty(name)
    },
    []
  )
  return (
    <MaterialContext.Provider value={{ material, updateMaterial, saveMaterial, saving, error }}>
      {children}
    </MaterialContext.Provider>
  )
}

export function useNavioMaterial(): MaterialContextValue {
  const context = useContext(MaterialContext)
  if (!context) throw new Error('NavioMaterialProvider is required')
  return context
}
