import { useCallback, useEffect, useState } from 'react'
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react'
import {
  LuCheck,
  LuCloudUpload,
  LuDownload,
  LuFolderInput,
  LuPalette,
  LuPencil,
  LuPlus,
  LuRefreshCw,
  LuSettings2
} from 'react-icons/lu'
import { useNavigate } from 'react-router-dom'
import BasePage from '@renderer/components/base/base-page'
import ThemeCommunity from '@renderer/components/dex/theme-community'
import { ThemeCanvas } from '@renderer/components/dex/theme-background'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { themeAssetUrl, type ThemeAsset } from '../../../shared/theme-media'
import { PRODUCT_NAME } from '../../../shared/product'
import {
  DEX_COLOR_KEYS,
  type DexColorKey,
  type DexTheme,
  type DexThemeAction,
  type DexThemeCatalog
} from '../../../shared/dex-theme'

const blankCatalog: DexThemeCatalog = {
  builtins: [],
  local: [],
  remote: [],
  selectedId: '',
  serverUrl: '',
  remoteError: null
}
const colorLabels: Record<DexColorKey, string> = {
  bg: '页面背景',
  surface: '卡片与侧栏',
  surfaceRaised: '悬浮背景',
  border: '边框',
  text: '主要文字',
  muted: '次要文字',
  accent: '强调色',
  accentText: '强调色文字',
  success: '成功状态'
}
const inputClass =
  'w-full rounded-lg border border-divider bg-content2 px-2.5 py-2 text-xs text-foreground outline-none focus:border-primary'
const fieldLabel = 'mb-1.5 block text-xs font-medium text-default-600'
type ThemeTab = 'builtins' | 'local' | 'remote'

async function request<T>(action: DexThemeAction, payload: unknown = {}): Promise<T> {
  const result = await window.electron.ipcRenderer.invoke('dexThemes', action, payload)
  if (result && typeof result === 'object' && 'invokeError' in result)
    throw new Error(String(result.invokeError))
  return result as T
}

async function verifyMediaPlayback(asset: ThemeAsset): Promise<void> {
  if (asset.mime.startsWith('image/')) {
    const image = new Image()
    image.src = themeAssetUrl(asset)
    try {
      await image.decode()
    } catch {
      throw new Error('图片无法解码，请选择有效的静态图片。')
    }
    return
  }
  await new Promise<void>((resolve, reject) => {
    const video = document.createElement('video')
    const finish = (error?: Error): void => {
      clearTimeout(timer)
      video.onloadeddata = null
      video.onerror = null
      video.removeAttribute('src')
      video.load()
      if (error) reject(error)
      else resolve()
    }
    const timer = setTimeout(() => finish(new Error('读取视频超时，请选择可播放的短视频。')), 15000)
    video.muted = true
    video.preload = 'auto'
    video.onloadeddata = () =>
      finish(
        video.videoWidth > 0 &&
          video.videoHeight > 0 &&
          video.videoWidth <= 8192 &&
          video.videoHeight <= 8192
          ? undefined
          : new Error('视频没有可用画面，或尺寸超过 8192 像素。')
      )
    video.onerror = () =>
      finish(new Error('此视频编码无法播放，请选择 H.264 MP4 或 VP8/VP9 WebM。'))
    video.src = themeAssetUrl(asset)
    video.load()
  })
}

function Preview({
  theme,
  large = false
}: {
  theme: DexTheme
  large?: boolean
}): React.JSX.Element {
  const c = theme.colors
  return (
    <div
      aria-label={`${theme.name} 的界面预览`}
      style={{
        background: c.bg,
        color: c.text,
        borderColor: c.border,
        borderRadius: Math.min(theme.radius, 12),
        height: large ? 164 : 120
      }}
      className="relative flex overflow-hidden border"
    >
      <ThemeCanvas theme={theme} playback={large} />
      <div
        className="relative z-10 flex w-[25%] min-w-16 max-w-24 flex-col gap-1 border-r p-2"
        style={{ background: c.surface, color: c.text, borderColor: c.border }}
      >
        <div className="mb-1 text-[9px] font-bold tracking-wider">{PRODUCT_NAME}</div>
        {['代理节点', '订阅管理', '分流规则'].map((label, index) => (
          <div
            key={label}
            className="rounded px-1.5 py-1 text-[7px]"
            style={{
              background:
                index === 0 ? `color-mix(in srgb, ${c.accent} 14%, ${c.surface})` : 'transparent',
              color: index === 0 ? c.text : c.muted
            }}
          >
            {label}
          </div>
        ))}
        <div
          className="mt-auto flex items-center justify-between border-t pt-1 text-[6px]"
          style={{ borderColor: c.border, color: c.muted }}
        >
          <span>系统代理</span>
          <span className="h-2 w-4 rounded-full" style={{ background: c.accent }} />
        </div>
      </div>
      <div className="relative z-10 min-w-0 flex-1 p-2.5">
        <div className="mb-2 flex items-center justify-between gap-2 text-[8px]">
          <span className="font-semibold">代理节点</span>
          <span className="text-[6px]" style={{ color: c.muted }}>
            布局示意
          </span>
        </div>
        <div
          className="overflow-hidden border"
          style={{
            background: c.surface,
            borderColor: c.border,
            borderRadius: Math.max(4, Math.min(8, theme.radius - 8))
          }}
        >
          {['节点 A', '节点 B', '节点 C'].map((label, index) => (
            <div
              key={label}
              className="flex items-center gap-2 px-2 text-[7px]"
              style={{
                height: large ? 31 : 22,
                borderBottom: index < 2 ? `1px solid ${c.border}` : undefined,
                background: index === 0 ? c.surfaceRaised : c.surface
              }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full border"
                style={{
                  borderColor: index === 0 ? c.accent : c.muted,
                  background: index === 0 ? c.accent : 'transparent'
                }}
              />
              <span className="flex-1">{label}</span>
              <span style={{ color: c.success }}>{[32, 48, 64][index]} ms</span>
            </div>
          ))}
        </div>
        {large && (
          <p className="mt-2 text-[7px]" style={{ color: c.muted }}>
            预览中的节点与延迟为布局示意
          </p>
        )}
      </div>
    </div>
  )
}

const DexThemes: React.FC = () => {
  const [communityOpen, setCommunityOpen] = useState(false)
  const [catalog, setCatalog] = useState<DexThemeCatalog>(blankCatalog)
  const [tab, setTab] = useState<ThemeTab>('builtins')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null)
  const [draft, setDraft] = useState<DexTheme | null>(null)
  const [editingExisting, setEditingExisting] = useState(false)
  const [livePreview, setLivePreview] = useState(true)
  const [serverOpen, setServerOpen] = useState(false)
  const [serverUrl, setServerUrl] = useState('')
  const [publishTheme, setPublishTheme] = useState<DexTheme | null>(null)
  const [pendingVideo, setPendingVideo] = useState<ThemeAsset | null>(null)
  const [mediaRevision, setMediaRevision] = useState(0)
  const { appConfig, mutateAppConfig } = useAppConfig()
  const navigate = useNavigate()
  const activeId =
    /^dex-([a-z][a-z0-9-]{2,47})\.css$/.exec(appConfig?.customTheme || '')?.[1] ||
    catalog.selectedId
  const load = useCallback(async (): Promise<DexThemeCatalog> => {
    const next = await request<DexThemeCatalog>('list')
    setCatalog(next)
    return next
  }, [])
  useEffect(() => {
    void load().catch((error) => setNotice({ text: String(error.message || error), error: true }))
  }, [load])
  useEffect(
    () => () => {
      void request('cancelPreview').catch(() => {})
    },
    []
  )
  useEffect(() => {
    if (!draft || !livePreview) {
      void request('cancelPreview').catch(() => {})
      return
    }
    const timer = setTimeout(() => {
      void request('preview', {
        theme: {
          ...draft,
          name: draft.name.trim() || '主题预览',
          author: draft.author.trim() || 'D.E.X Studio'
        }
      }).catch(() => {})
    }, 120)
    return () => clearTimeout(timer)
  }, [draft, livePreview])
  const run = async (action: () => Promise<void>): Promise<void> => {
    if (busy) return
    setBusy(true)
    setNotice(null)
    try {
      await action()
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : String(error), error: true })
    } finally {
      setBusy(false)
    }
  }
  const openEditor = (theme?: DexTheme, edit = false): void => {
    const base =
      theme ||
      [...catalog.local, ...catalog.builtins].find((item) => item.id === activeId) ||
      catalog.builtins[0]
    if (!base) return
    setEditingExisting(edit)
    setLivePreview(true)
    setNotice(null)
    setPendingVideo(null)
    setDraft({
      ...structuredClone(base),
      id: edit ? base.id : `custom-${crypto.randomUUID().slice(0, 12)}`,
      name: edit ? base.name : `${base.name} · 我的设计`.slice(0, 48),
      author: edit ? base.author : 'D.E.X Studio'
    })
  }
  const changeDraft = (patch: Partial<DexTheme>): void =>
    setDraft((current) => (current ? { ...current, ...patch } : null))
  const chooseMedia = async (kind: 'image' | 'video', poster = false): Promise<void> => {
    await run(async () => {
      const asset = await request<ThemeAsset | null>('importMedia', { kind })
      if (!asset || !draft) return
      await verifyMediaPlayback(asset)
      if (kind === 'video') {
        setPendingVideo(asset)
        setNotice({ text: '视频已选择。再选择一张静态封面，减少动态或隐藏窗口时显示封面。' })
      } else if (poster && (pendingVideo || draft.background?.type === 'video')) {
        const video =
          pendingVideo || (draft.background?.type === 'video' ? draft.background.asset : null)
        if (video)
          changeDraft({
            background: { type: 'video', asset: video, poster: asset, opacity: 0.35, fit: 'cover' }
          })
        setPendingVideo(null)
      } else {
        changeDraft({ background: { type: 'image', asset, opacity: 0.35, fit: 'cover' } })
        setPendingVideo(null)
      }
    })
  }
  const saveDraft = async (apply: boolean): Promise<void> => {
    if (!draft) return
    await run(async () => {
      const saved = await request<DexTheme>('save', { theme: draft })
      if (apply) {
        await request('apply', { id: saved.id })
        mutateAppConfig()
      }
      await request('cancelPreview')
      setDraft(null)
      setTab('local')
      await load()
      setNotice({
        text: apply
          ? `已保存并应用「${saved.name}」`
          : `已保存「${saved.name}」，可在我的设计中应用`
      })
    })
  }
  const refreshRemote = async (): Promise<void> => {
    const next = await request<DexThemeCatalog>('refresh')
    setCatalog(next)
    if (next.remoteError) throw new Error(next.remoteError)
  }
  return (
    <BasePage
      title="主题工坊"
      header={
        <Button
          className="app-nodrag"
          size="sm"
          variant="light"
          onPress={() => navigate('/settings')}
          startContent={<LuSettings2 />}
        >
          高级 CSS 设置
        </Button>
      }
    >
      <style>{`.dex-theme-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:14px}.dex-theme-editor-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,.92fr);gap:20px}@media(max-width:680px){.dex-theme-editor-grid{grid-template-columns:minmax(0,1fr)}}`}</style>
      <div className="mx-auto max-w-[1200px] space-y-4 p-5 pb-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">主题库</h1>
            <p className="mt-1 text-xs text-default-500">选择外观，或编辑并分享自己的设计。</p>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="light"
              isDisabled={busy}
              onPress={() =>
                void run(async () => {
                  const value = await request<{ removed: number }>('pruneMedia')
                  setNotice({ text: `已清理 ${value.removed} 个未被本地设计使用的媒体文件` })
                })
              }
            >
              清理未使用媒体
            </Button>
            <Button
              size="sm"
              variant="flat"
              isDisabled={busy}
              onPress={() => setCommunityOpen(true)}
            >
              在线作品与收藏
            </Button>
            <Button
              size="sm"
              isDisabled={busy}
              variant="bordered"
              startContent={<LuFolderInput />}
              onPress={() =>
                void run(async () => {
                  const imported = await request<DexTheme | null>('import')
                  if (imported) {
                    await load()
                    setTab('local')
                    setNotice({ text: `已导入「${imported.name}」` })
                  }
                })
              }
            >
              导入主题
            </Button>
            <Button
              size="sm"
              color="primary"
              isDisabled={busy || !catalog.builtins.length}
              startContent={<LuPlus />}
              onPress={() => openEditor()}
            >
              创建设计
            </Button>
          </div>
        </div>
        {notice && !draft && !publishTheme && !serverOpen && (
          <div
            role="status"
            className={`rounded-xl border px-4 py-3 text-sm ${notice.error ? 'border-danger/30 bg-danger/10 text-danger' : 'border-primary/20 bg-primary/5 text-foreground'}`}
          >
            {notice.text}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-divider pb-2">
          <div className="flex gap-1">
            {(
              [
                ['builtins', '精选主题'],
                ['local', '我的设计'],
                ['remote', '在线主题库']
              ] as const
            ).map(([key, label]) => (
              <Button
                key={key}
                size="sm"
                variant={tab === key ? 'flat' : 'light'}
                color={tab === key ? 'primary' : 'default'}
                onPress={() => setTab(key)}
              >
                {label}
                <span className="text-xs opacity-60">{catalog[key].length}</span>
              </Button>
            ))}
          </div>
          <Button
            size="sm"
            variant="light"
            startContent={<LuSettings2 />}
            onPress={() => {
              setServerUrl(catalog.serverUrl)
              setServerOpen(true)
              setNotice(null)
            }}
          >
            主题服务设置
          </Button>
        </div>
        {tab === 'remote' && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-divider bg-content1 p-4">
            <div className="min-w-0 text-sm">
              <p className="break-all">{catalog.serverUrl || '尚未配置主题服务器'}</p>
              <p
                className={`mt-1 text-xs ${catalog.remoteError ? 'text-danger' : 'text-default-500'}`}
              >
                {catalog.remoteError || '只在你点击刷新后获取在线主题；代理订阅不会上传。'}
              </p>
            </div>
            <Button
              size="sm"
              isDisabled={busy || !catalog.serverUrl}
              startContent={<LuRefreshCw />}
              onPress={() =>
                void run(async () => {
                  await refreshRemote()
                  setNotice({ text: '在线主题库已更新' })
                })
              }
            >
              刷新主题
            </Button>
          </div>
        )}
        {catalog[tab].length === 0 ? (
          <div className="rounded-[20px] border border-dashed border-divider p-14 text-center">
            <LuPalette className="mx-auto mb-4 text-3xl text-default-400" />
            <h2 className="text-lg font-medium">
              {tab === 'local'
                ? '第一套设计，从你开始'
                : tab === 'remote'
                  ? '连接自己的主题库'
                  : '正在读取主题'}
            </h2>
            <p className="mt-2 text-sm text-default-500">
              {tab === 'local'
                ? '从精选主题创建副本，或导入主题文件。'
                : tab === 'remote'
                  ? '填写部署好的服务地址，再刷新浏览远程设计。'
                  : '请稍候。'}
            </p>
          </div>
        ) : (
          <div className="dex-theme-cards">
            {catalog[tab].map((theme) => (
              <article
                key={theme.id}
                className="min-w-0 overflow-hidden rounded-2xl border border-divider bg-content1 p-3"
              >
                <Preview key={mediaRevision} theme={theme} />
                {tab === 'remote' && theme.background && 'asset' in theme.background && (
                  <Button
                    size="sm"
                    variant="light"
                    isDisabled={busy}
                    onPress={() =>
                      void run(async () => {
                        await request('loadMedia', { theme })
                        setMediaRevision((value) => value + 1)
                      })
                    }
                  >
                    下载媒体预览
                  </Button>
                )}
                <div className="mt-2.5 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold" title={theme.description}>
                      {theme.name}
                    </h2>
                    <p className="mt-0.5 truncate text-[10px] text-default-500">
                      {theme.author} · {theme.appearance === 'light' ? '浅色' : '深色'} ·{' '}
                      {theme.radius}px
                    </p>
                  </div>
                  {activeId === theme.id && (
                    <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-[10px] text-primary">
                      <LuCheck />
                      使用中
                    </span>
                  )}
                </div>
                <div className="mt-2.5 flex items-center justify-between gap-2">
                  <div className="flex gap-1.5" aria-label="主题配色">
                    {(['bg', 'surfaceRaised', 'accent', 'text'] as const).map((key) => (
                      <span
                        key={key}
                        className="h-3 w-3 rounded-full border border-divider"
                        style={{ background: theme.colors[key] }}
                      />
                    ))}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      isIconOnly
                      title={tab === 'local' ? '编辑设计' : '创建设计副本'}
                      aria-label={tab === 'local' ? '编辑设计' : '创建设计副本'}
                      size="sm"
                      variant="light"
                      isDisabled={busy}
                      onPress={() => {
                        if (tab === 'remote')
                          void run(async () => {
                            await request('loadMedia', { theme })
                            openEditor(theme)
                          })
                        else openEditor(theme, tab === 'local')
                      }}
                    >
                      <LuPencil />
                    </Button>
                    <Button
                      isIconOnly
                      title="导出完整主题"
                      aria-label="导出完整主题"
                      size="sm"
                      variant="light"
                      isDisabled={busy}
                      onPress={() =>
                        void run(async () => {
                          const result = await request<{ saved: boolean } | null>('export', {
                            id: theme.id
                          })
                          if (result) setNotice({ text: '主题文件已导出' })
                        })
                      }
                    >
                      <LuDownload />
                    </Button>
                    {tab === 'local' && (
                      <Button
                        isIconOnly
                        title="发布主题"
                        aria-label="发布主题"
                        size="sm"
                        variant="light"
                        isDisabled={busy}
                        onPress={() => {
                          setPublishTheme(theme)
                          setNotice(null)
                        }}
                      >
                        <LuCloudUpload />
                      </Button>
                    )}
                    <Button
                      color="primary"
                      size="sm"
                      variant={activeId === theme.id ? 'flat' : 'solid'}
                      isDisabled={busy}
                      onPress={() =>
                        void run(async () => {
                          await request('apply', { id: theme.id, source: tab })
                          mutateAppConfig()
                          await load()
                          setNotice({ text: `已应用「${theme.name}」` })
                        })
                      }
                    >
                      {activeId === theme.id ? '重新应用' : '应用'}
                    </Button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
        <p className="text-xs leading-relaxed text-default-400">
          缩略图中的节点与延迟为布局示意。高级 CSS 编辑器保留在偏好设置中。
        </p>
      </div>

      <Modal
        isOpen={!!draft}
        onOpenChange={(open) => {
          if (!open && !busy) setDraft(null)
        }}
        size="4xl"
        classNames={{
          base: 'max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] max-w-[900px] my-4',
          header: 'px-5 py-3',
          body: 'px-5 py-2',
          footer: 'px-5 py-3'
        }}
        scrollBehavior="inside"
        isDismissable={!busy}
        hideCloseButton={busy}
      >
        <ModalContent>
          <ModalHeader className="flex-col gap-1 text-base">
            <span>{editingExisting ? '编辑主题' : '新建主题'}</span>
            <span className="text-xs font-normal text-default-500">
              实时预览只临时改变外观，取消后恢复已应用主题。
            </span>
          </ModalHeader>
          <ModalBody>
            {draft && (
              <div className="dex-theme-editor-grid">
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className={fieldLabel}>主题名称</span>
                      <input
                        className={inputClass}
                        maxLength={48}
                        value={draft.name}
                        onChange={(event) => changeDraft({ name: event.target.value })}
                      />
                    </label>
                    <label className="block">
                      <span className={fieldLabel}>设计者</span>
                      <input
                        className={inputClass}
                        maxLength={64}
                        value={draft.author}
                        onChange={(event) => changeDraft({ author: event.target.value })}
                      />
                    </label>
                  </div>
                  <label className="block">
                    <span className={fieldLabel}>设计说明</span>
                    <textarea
                      className={inputClass}
                      rows={2}
                      maxLength={240}
                      value={draft.description}
                      onChange={(event) => changeDraft({ description: event.target.value })}
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label>
                      <span className={fieldLabel}>外观</span>
                      <select
                        className={inputClass}
                        value={draft.appearance}
                        onChange={(event) =>
                          changeDraft({ appearance: event.target.value as DexTheme['appearance'] })
                        }
                      >
                        <option value="light">浅色</option>
                        <option value="dark">深色</option>
                      </select>
                    </label>
                    <label>
                      <span className={fieldLabel}>圆角 · {draft.radius}px</span>
                      <input
                        aria-label="圆角"
                        className="mt-3 w-full accent-primary"
                        type="range"
                        min={8}
                        max={24}
                        step={1}
                        value={draft.radius}
                        onChange={(event) => changeDraft({ radius: Number(event.target.value) })}
                      />
                    </label>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {DEX_COLOR_KEYS.map((key) => (
                      <label
                        key={key}
                        className="flex items-center gap-2 rounded-xl border border-divider p-2"
                      >
                        <input
                          aria-label={colorLabels[key]}
                          type="color"
                          className="h-7 w-7 cursor-pointer border-0 bg-transparent"
                          value={draft.colors[key]}
                          onChange={(event) =>
                            changeDraft({ colors: { ...draft.colors, [key]: event.target.value } })
                          }
                        />
                        <span className="text-[10px]">{colorLabels[key]}</span>
                      </label>
                    ))}
                  </div>
                  <label className="block">
                    <span className={fieldLabel}>系统字体（未安装时使用默认字体）</span>
                    <input
                      className={inputClass}
                      maxLength={100}
                      list="navio-theme-fonts"
                      value={draft.fontFamily || ''}
                      placeholder="Segoe UI, Microsoft YaHei"
                      onChange={(event) =>
                        changeDraft({ fontFamily: event.target.value || undefined })
                      }
                    />
                    <datalist id="navio-theme-fonts">
                      <option value="Segoe UI" />
                      <option value="Microsoft YaHei" />
                      <option value="SimHei" />
                      <option value="Arial" />
                      <option value="Georgia" />
                    </datalist>
                  </label>
                  <fieldset className="space-y-3 rounded-xl border border-divider p-3">
                    <legend className="px-1 text-xs">页面背景</legend>
                    <select
                      aria-label="背景类型"
                      className={inputClass}
                      value={pendingVideo ? 'video' : draft.background?.type || 'default'}
                      onChange={(event) => {
                        const type = event.target.value
                        setPendingVideo(null)
                        if (type === 'default') changeDraft({ background: undefined })
                        else if (type === 'solid' || type === 'gradient')
                          changeDraft({
                            background: {
                              type,
                              colors:
                                type === 'solid'
                                  ? [draft.colors.bg]
                                  : [draft.colors.bg, draft.colors.surfaceRaised],
                              angle: 135
                            }
                          })
                        else void chooseMedia(type as 'image' | 'video')
                      }}
                    >
                      <option value="default">跟随页面配色</option>
                      <option value="solid">纯色</option>
                      <option value="gradient">渐变</option>
                      <option value="image">静态图片</option>
                      <option value="video">视频 + 静态封面</option>
                    </select>
                    {draft.background && 'colors' in draft.background && (
                      <>
                        <div className="flex flex-wrap gap-3">
                          {draft.background.colors.map((color, index) => (
                            <label key={index} className="text-xs">
                              颜色 {index + 1}
                              <input
                                type="color"
                                aria-label={`背景颜色 ${index + 1}`}
                                className="block mt-1"
                                value={color}
                                onChange={(event) => {
                                  if (draft.background && 'colors' in draft.background)
                                    changeDraft({
                                      background: {
                                        ...draft.background,
                                        colors: draft.background.colors.map((item, position) =>
                                          position === index ? event.target.value : item
                                        )
                                      }
                                    })
                                }}
                              />
                            </label>
                          ))}
                        </div>
                        {draft.background.type === 'gradient' && (
                          <label className="block text-xs">
                            渐变角度 · {draft.background.angle ?? 135}°
                            <input
                              className="w-full mt-2"
                              type="range"
                              min={0}
                              max={360}
                              value={draft.background.angle ?? 135}
                              onChange={(event) => {
                                if (draft.background?.type === 'gradient')
                                  changeDraft({
                                    background: {
                                      ...draft.background,
                                      angle: Number(event.target.value)
                                    }
                                  })
                              }}
                            />
                          </label>
                        )}
                      </>
                    )}
                    {(pendingVideo || draft.background?.type === 'video') && (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          isDisabled={busy}
                          onPress={() => void chooseMedia('video')}
                        >
                          更换视频
                        </Button>
                        <Button
                          size="sm"
                          color={pendingVideo ? 'primary' : 'default'}
                          isDisabled={busy}
                          onPress={() => void chooseMedia('image', true)}
                        >
                          {pendingVideo ? '选择必要的静态封面' : '更换封面'}
                        </Button>
                      </div>
                    )}
                    {draft.background?.type === 'image' && (
                      <Button size="sm" isDisabled={busy} onPress={() => void chooseMedia('image')}>
                        更换图片
                      </Button>
                    )}
                    {draft.background && 'asset' in draft.background && (
                      <>
                        <label className="block text-xs">
                          背景透明度 · {Math.round((draft.background.opacity ?? 0.35) * 100)}%
                          <input
                            className="w-full mt-2"
                            type="range"
                            min={0}
                            max={100}
                            value={Math.round((draft.background.opacity ?? 0.35) * 100)}
                            onChange={(event) => {
                              if (draft.background && 'asset' in draft.background)
                                changeDraft({
                                  background: {
                                    ...draft.background,
                                    opacity: Number(event.target.value) / 100
                                  }
                                })
                            }}
                          />
                        </label>
                        <select
                          aria-label="背景适配"
                          className={inputClass}
                          value={draft.background.fit || 'cover'}
                          onChange={(event) => {
                            if (draft.background && 'asset' in draft.background)
                              changeDraft({
                                background: {
                                  ...draft.background,
                                  fit: event.target.value as 'cover' | 'contain'
                                }
                              })
                          }}
                        >
                          <option value="cover">填满背景</option>
                          <option value="contain">显示完整画面</option>
                        </select>
                      </>
                    )}
                    <p className="text-xs text-default-500 leading-5">
                      图片支持 PNG/JPEG/静态 WebP（8 MB），视频支持 MP4/WebM（32
                      MB）。视频静音循环，减少动态或窗口隐藏时暂停。
                    </p>
                    {pendingVideo && (
                      <p role="status" className="text-xs text-warning-700 dark:text-warning-400">
                        视频尚未应用，请选择静态封面后再保存。
                      </p>
                    )}
                  </fieldset>
                </div>
                <div>
                  <Preview theme={draft} large />
                  <label className="mt-4 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="accent-primary"
                      checked={livePreview}
                      onChange={(event) => setLivePreview(event.target.checked)}
                    />
                    在整个应用中实时预览
                  </label>
                  <p className="mt-3 text-xs leading-relaxed text-default-500">
                    主题包含配色、系统字体和可选媒体背景。导出媒体设计时会生成包含资源的完整主题包；发布会上传设计使用的图片、视频和封面。
                  </p>
                </div>
              </div>
            )}
            {notice?.error && (
              <p role="alert" className="text-sm text-danger">
                {notice.text}
              </p>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="light" isDisabled={busy} onPress={() => setDraft(null)}>
              取消
            </Button>
            <Button
              variant="bordered"
              isDisabled={busy || !!pendingVideo}
              onPress={() => void saveDraft(false)}
            >
              保存设计
            </Button>
            <Button
              color="primary"
              isLoading={busy}
              isDisabled={!!pendingVideo}
              onPress={() => void saveDraft(true)}
            >
              保存并应用
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal
        isOpen={serverOpen}
        onOpenChange={(open) => {
          if (!busy) setServerOpen(open)
        }}
        isDismissable={!busy}
        hideCloseButton={busy}
      >
        <ModalContent>
          <ModalHeader>主题服务地址</ModalHeader>
          <ModalBody>
            <p className="text-sm text-default-500">
              填写已经部署的主题服务地址。主题服务独立于代理订阅，不会接收你的节点配置。
            </p>
            <label>
              <span className={fieldLabel}>服务地址</span>
              <input
                type="url"
                className={inputClass}
                value={serverUrl}
                placeholder="https://your-domain.example/dex-api"
                onChange={(event) => setServerUrl(event.target.value)}
              />
            </label>
            <p className="text-xs text-default-400">
              支持 HTTPS；本机开发允许 localhost HTTP。留空保存可断开主题库。
            </p>
            {notice?.error && (
              <p role="alert" className="text-sm text-danger">
                {notice.text}
              </p>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="light" isDisabled={busy} onPress={() => setServerOpen(false)}>
              取消
            </Button>
            <Button
              variant="bordered"
              isDisabled={busy}
              onPress={() =>
                void run(async () => {
                  await request('configure', { url: serverUrl.trim() })
                  await load()
                  setServerOpen(false)
                  setNotice({ text: '主题库地址已保存' })
                })
              }
            >
              仅保存地址
            </Button>
            <Button
              color="primary"
              isLoading={busy}
              isDisabled={!serverUrl.trim()}
              onPress={() =>
                void run(async () => {
                  await request('configure', { url: serverUrl.trim() })
                  await refreshRemote()
                  setServerOpen(false)
                  setTab('remote')
                  setNotice({ text: '已连接在线主题库' })
                })
              }
            >
              保存并连接
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal
        isOpen={!!publishTheme}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setPublishTheme(null)
          }
        }}
        isDismissable={!busy}
        hideCloseButton={busy}
      >
        <ModalContent>
          <ModalHeader>发布「{publishTheme?.name}」</ModalHeader>
          <ModalBody>
            <p className="break-all text-sm text-default-500">
              目标服务器：{catalog.serverUrl || '尚未配置，请先设置主题服务器'}
            </p>

            <p className="text-xs leading-relaxed text-default-400">
              使用当前 D.E.X
              账号发布。主题通过格式检查后公开，其他用户可以举报，管理员可以下架；你的本机主题不会因此删除。
            </p>
            {notice?.error && (
              <p role="alert" className="text-sm text-danger">
                {notice.text}
              </p>
            )}
          </ModalBody>
          <ModalFooter>
            <Button
              variant="light"
              isDisabled={busy}
              onPress={() => {
                setPublishTheme(null)
              }}
            >
              取消
            </Button>
            <Button
              color="primary"
              isLoading={busy}
              isDisabled={!catalog.serverUrl}
              onPress={() =>
                void run(async () => {
                  await request('publish', { id: publishTheme?.id })
                  await load()
                  setPublishTheme(null)
                  setNotice({ text: '主题已发布到你的服务器' })
                })
              }
            >
              发布主题
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      {communityOpen && (
        <ThemeCommunity
          onEdit={(theme) => {
            setCommunityOpen(false)
            setEditingExisting(true)
            setDraft(theme)
          }}
          onClose={() => setCommunityOpen(false)}
          onApplied={() => {
            void load()
            mutateAppConfig()
          }}
        />
      )}
    </BasePage>
  )
}

export default DexThemes
