import { useEffect, useState } from 'react'
import { Button } from '@heroui/react'
import { useNavigate } from 'react-router-dom'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import type { ThemeTrialState } from '../../../../shared/official-themes'
export default function ThemeTrialBar(): React.JSX.Element | null {
  const [trial, setTrial] = useState<ThemeTrialState | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const { mutateAppConfig } = useAppConfig(),
    navigate = useNavigate()
  useEffect(() => {
    let active = true,
      sequence = 0
    const load = async (): Promise<void> => {
      const seq = ++sequence
      const value = await window.electron.ipcRenderer.invoke('dexThemes', 'trialState')
      if (active && seq === sequence) {
        if (value === null) setTrial(null)
        else if (
          value &&
          typeof value === 'object' &&
          'id' in value &&
          'name' in value &&
          !('invokeError' in value)
        )
          setTrial(value as ThemeTrialState)
      }
    }
    const off = window.electron.ipcRenderer.on('dexThemeBackground', () => {
      void load().catch(() => {})
    })
    void load().catch(() => {})
    return () => {
      active = false
      off()
    }
  }, [])
  if (!trial) return null
  const finish = async (action: 'keepTrial' | 'restoreTrial'): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const value = await window.electron.ipcRenderer.invoke('dexThemes', action)
      if (value && typeof value === 'object' && 'invokeError' in value)
        throw new Error(String(value.invokeError))
      setTrial(null)
      mutateAppConfig()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="navio-theme-trial" role="region" aria-label="主题试用">
      <div>
        <strong>正在试用 · {trial.name}</strong>
        <span>可以切换页面，试用不会自动结束。</span>
        {error && <p role="alert">{error}</p>}
      </div>
      <div>
        <Button size="sm" variant="light" onPress={() => navigate('/dex-themes')}>
          调节主题
        </Button>
        <Button
          size="sm"
          variant="bordered"
          isDisabled={busy}
          onPress={() => void finish('restoreTrial')}
        >
          恢复原主题
        </Button>
        <Button size="sm" color="primary" isLoading={busy} onPress={() => void finish('keepTrial')}>
          保留主题
        </Button>
      </div>
    </div>
  )
}
