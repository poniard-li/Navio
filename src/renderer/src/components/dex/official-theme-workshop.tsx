import { useCallback, useEffect, useState } from 'react'
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Switch
} from '@heroui/react'
import { useNavigate } from 'react-router-dom'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { useNavioMotion } from '@renderer/hooks/use-navio-motion'
import {
  OFFICIAL_THEME_CATEGORIES,
  defaultOfficialSettings,
  officialPreviewTheme,
  type OfficialThemeCatalog,
  type OfficialThemeEntry,
  type OfficialThemeSettings
} from '../../../../shared/official-themes'
import type { DexTheme, DexThemeAction } from '../../../../shared/dex-theme'
import { MaterialSettingsButton } from './material-settings'
import { OfficialThemeScene } from './official-theme-scene'

async function request<T>(action: DexThemeAction, payload: unknown = {}): Promise<T> {
  const value = await window.electron.ipcRenderer.invoke('dexThemes', action, payload)
  if (value && typeof value === 'object' && 'invokeError' in value)
    throw new Error(String(value.invokeError))
  return value as T
}
export default function OfficialThemeWorkshop({
  favoritesOnly = false,
  onCreate
}: {
  favoritesOnly?: boolean
  onCreate: (theme: DexTheme) => void
}): React.JSX.Element {
  const [catalog, setCatalog] = useState<OfficialThemeCatalog>({
      themes: [],
      activeId: '',
      trial: null
    }),
    [detailId, setDetailId] = useState(''),
    [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [online, setOnline] = useState(navigator.onLine)
  const { appConfig, mutateAppConfig } = useAppConfig(),
    navigate = useNavigate(),
    motion = useNavioMotion()
  const dark =
    appConfig?.appTheme === 'dark' ||
    (appConfig?.appTheme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches)
  const load = useCallback(async (): Promise<void> => {
    setCatalog(await request<OfficialThemeCatalog>('officialCatalog'))
  }, [])
  useEffect(() => {
    let alive = true
    const refresh = (): void => {
      void request<OfficialThemeCatalog>('officialCatalog')
        .then((value) => {
          if (alive) setCatalog(value)
        })
        .catch((e) => {
          if (alive) setError(String(e))
        })
    }
    const offline = (): void => setOnline(navigator.onLine)
    refresh()
    const off = window.electron.ipcRenderer.on('dexThemeBackground', refresh)
    window.addEventListener('online', offline)
    window.addEventListener('offline', offline)
    return () => {
      alive = false
      off()
      window.removeEventListener('online', offline)
      window.removeEventListener('offline', offline)
    }
  }, [])
  const run = async (id: string, action: () => Promise<void>): Promise<void> => {
    if (busy) return
    setBusy(id)
    setError('')
    try {
      await action()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }
  const trial = async (theme: OfficialThemeEntry): Promise<void> =>
    run(theme.id, async () => {
      if (!theme.installed) {
        if (!navigator.onLine) throw new Error('此主题尚未下载，请联网后重试。')
        await request('installOfficial', { id: theme.id })
      }
      await request('trial', { id: theme.id, appearance: dark ? 'dark' : 'light' })
      mutateAppConfig()
    })
  const update = async (
    theme: OfficialThemeEntry,
    patch: Partial<OfficialThemeSettings>
  ): Promise<void> =>
    run(theme.id, async () => {
      await request('officialSettings', {
        id: theme.id,
        settings: { ...theme.settings, ...patch },
        appearance: dark ? 'dark' : 'light'
      })
      mutateAppConfig()
    })
  const active = catalog.themes.find((t) => t.id === (catalog.trial?.id || catalog.activeId)),
    detail = catalog.themes.find((t) => t.id === detailId)
  const appearance = (t: OfficialThemeEntry): 'light' | 'dark' =>
    t.settings.appearance === 'system' ? (dark ? 'dark' : 'light') : t.settings.appearance
  const cover = (t: OfficialThemeEntry, play = false): React.JSX.Element => (
    <div className="navio-official-cover">
      <OfficialThemeScene
        definition={t}
        theme={officialPreviewTheme(t, appearance(t))}
        settings={t.settings}
        playback={play}
      />
    </div>
  )
  const trialLabel = (t: OfficialThemeEntry): string => (t.installed ? '全窗试用' : '下载并试用')
  const themeCard = (t: OfficialThemeEntry): React.JSX.Element => (
    <article className="navio-official-card" key={t.id}>
      <button
        className="navio-official-cover-button"
        onClick={() => setDetailId(t.id)}
        aria-label={`查看${t.name}`}
      >
        {cover(t)}
      </button>
      <div className="navio-official-card-title">
        <div>
          <h3>{t.name}</h3>
          <p>{t.summary}</p>
        </div>
        <Button
          size="sm"
          isIconOnly
          aria-label={t.favorite ? '取消收藏' : '收藏主题'}
          variant="light"
          isDisabled={!!busy}
          onPress={() =>
            void run(t.id, async () => {
              await request('officialFavorite', { id: t.id, favorite: !t.favorite })
            })
          }
        >
          {t.favorite ? '♥' : '♡'}
        </Button>
      </div>
      <div className="navio-official-card-footer">
        <span>{t.builtIn ? '内置' : t.installed ? '已下载' : '按需下载'}</span>
        <Button
          size="sm"
          variant="flat"
          isLoading={busy === t.id}
          isDisabled={!!busy || (!online && !t.installed)}
          onPress={() => void trial(t)}
        >
          {trialLabel(t)}
        </Button>
      </div>
      {t.cacheError && <p className="text-xs text-warning">缓存校验失败，重新下载后可使用。</p>}
    </article>
  )
  return (
    <section className="navio-official-workshop">
      {error && (
        <p role="alert" className="navio-theme-error">
          {error}
        </p>
      )}
      {!favoritesOnly && (
        <div className="navio-theme-current navio-material-card">
          <div className="navio-theme-current-art">
            {active ? (
              cover(active, true)
            ) : (
              <div className="navio-theme-current-custom">
                <strong>当前外观</strong>
                <span>本地设计或自定义配色</span>
              </div>
            )}
          </div>
          <div className="navio-theme-current-info">
            <span className="navio-theme-eyebrow">
              {catalog.trial ? '正在全窗试用' : '当前主题'}
            </span>
            <h2>{active?.name || '自定义外观'}</h2>
            <p>
              {active?.description || '原有主题保持不变。可以选择下方官方主题，在各个页面中试用。'}
            </p>
            <div className="flex flex-wrap gap-2">
              {active && (
                <Button size="sm" variant="flat" onPress={() => setDetailId(active.id)}>
                  查看主题
                </Button>
              )}
              <Button size="sm" variant="light" onPress={() => navigate('/home')}>
                在概览中查看
              </Button>
            </div>
          </div>
        </div>
      )}
      {favoritesOnly ? (
        <>
          <h2 className="text-base font-semibold">收藏的官方主题</h2>
          <div className="navio-official-rail">
            {catalog.themes.filter((t) => t.favorite).map(themeCard)}
          </div>
          {!catalog.themes.some((t) => t.favorite) && (
            <p className="text-sm text-default-500">还没有收藏官方主题。</p>
          )}
        </>
      ) : (
        OFFICIAL_THEME_CATEGORIES.map(([category, label]) => (
          <section className="navio-official-category" key={category}>
            <div className="navio-official-category-heading">
              <h2>{label}</h2>
              <span>{catalog.themes.filter((t) => t.category === category).length} 款</span>
            </div>
            <div className="navio-official-rail">
              {catalog.themes.filter((t) => t.category === category).map(themeCard)}
            </div>
          </section>
        ))
      )}
      {!online && <p className="text-sm text-default-500">当前离线。内置与已下载主题仍可使用。</p>}
      <Modal
        isOpen={!!detail}
        size="2xl"
        scrollBehavior="inside"
        isDismissable={!busy}
        onClose={() => setDetailId('')}
      >
        <ModalContent>
          {detail && (
            <>
              <ModalHeader>{detail.name}</ModalHeader>
              <ModalBody>
                <div className="navio-theme-detail-art">{cover(detail, true)}</div>
                <p className="text-sm text-default-500">{detail.description}</p>
                {error && (
                  <p role="alert" className="text-danger text-sm">
                    {error}
                  </p>
                )}
                <div className="navio-official-settings">
                  <label>
                    明暗
                    <select
                      value={detail.settings.appearance}
                      disabled={!!busy}
                      onChange={(e) =>
                        void update(detail, {
                          appearance: e.target.value as OfficialThemeSettings['appearance']
                        })
                      }
                    >
                      <option value="system">跟随系统</option>
                      <option value="light">浅色</option>
                      <option value="dark">深色</option>
                    </select>
                  </label>
                  <div className="flex items-center justify-between gap-2">
                    <span>窗口材质</span>
                    <MaterialSettingsButton />
                  </div>
                  {detail.dynamic && (
                    <>
                      <label>
                        动画强度 <span>{detail.settings.intensity}%</span>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          defaultValue={detail.settings.intensity}
                          key={`${detail.id}-${detail.settings.intensity}`}
                          onChange={(e) => {
                            e.currentTarget.setAttribute('aria-valuetext', `${e.target.value}%`)
                          }}
                          onPointerUp={(e) =>
                            void update(detail, { intensity: Number(e.currentTarget.value) })
                          }
                          onKeyUp={(e) =>
                            void update(detail, { intensity: Number(e.currentTarget.value) })
                          }
                          disabled={!!busy}
                        />
                      </label>
                      <label>
                        播放方式
                        <select
                          value={detail.settings.playback}
                          disabled={!!busy}
                          onChange={(e) =>
                            void update(detail, {
                              playback: e.target.value as OfficialThemeSettings['playback']
                            })
                          }
                        >
                          <option value="auto">自动平衡</option>
                          <option value="always">窗口可见时始终播放</option>
                          <option value="paused">静态封面</option>
                        </select>
                      </label>
                      <p className="text-xs text-default-500">
                        {motion.reason || '窗口隐藏时暂停。自动模式遵循系统的减少动态与节能设置。'}
                      </p>
                    </>
                  )}
                  <Switch
                    size="sm"
                    isSelected={detail.settings.background}
                    isDisabled={!!busy}
                    onValueChange={(background) => void update(detail, { background })}
                  >
                    背景场景
                  </Switch>
                  {detail.character && (
                    <Switch
                      size="sm"
                      isSelected={detail.settings.character}
                      isDisabled={!!busy}
                      onValueChange={(character) => void update(detail, { character })}
                    >
                      角色
                    </Switch>
                  )}
                  {detail.dynamic && (
                    <Switch
                      size="sm"
                      isSelected={detail.settings.feedback}
                      isDisabled={!!busy}
                      onValueChange={(feedback) => void update(detail, { feedback })}
                    >
                      连接、节点切换与鼠标反馈
                    </Switch>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="light"
                      isDisabled={!!busy}
                      onPress={() => void update(detail, defaultOfficialSettings())}
                    >
                      恢复此主题默认设置
                    </Button>
                    <Button
                      size="sm"
                      variant="light"
                      onPress={() => {
                        onCreate(officialPreviewTheme(detail, appearance(detail)))
                        setDetailId('')
                      }}
                    >
                      使用此配色创建设计
                    </Button>
                    {!detail.builtIn && detail.installed && (
                      <Button
                        size="sm"
                        color="danger"
                        variant="light"
                        isDisabled={
                          !!busy ||
                          detail.id === catalog.activeId ||
                          detail.id === catalog.trial?.id
                        }
                        onPress={() =>
                          void run(detail.id, async () => {
                            await request('removeOfficial', { id: detail.id })
                          })
                        }
                      >
                        移除下载
                      </Button>
                    )}
                  </div>
                </div>
                <p className="text-xs text-default-500">
                  {detail.builtIn
                    ? '此主题随软件提供。'
                    : '首次使用从 Navio GitHub Release 下载主题包，校验 SHA256 后保存在本机。'}
                  配色副本不包含官方动态场景。
                </p>
              </ModalBody>
              <ModalFooter>
                <Button variant="light" onPress={() => setDetailId('')}>
                  关闭
                </Button>
                <Button
                  color="primary"
                  isLoading={busy === detail.id}
                  isDisabled={!!busy || (!online && !detail.installed)}
                  onPress={() => void trial(detail)}
                >
                  {trialLabel(detail)}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </section>
  )
}
