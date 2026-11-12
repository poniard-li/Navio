import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Button,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Tab,
  Tabs,
  Textarea
} from '@heroui/react'
import { dexAccountAction } from '@renderer/utils/ipc'
import type { DexTheme } from '../../../../shared/dex-theme'
import BaseConfirmModal from '../base/base-confirm-modal'
import { ThemeCanvas } from './theme-background'

interface Publication {
  id: string
  theme: DexTheme
  status: string
  moderationReason?: string
  favoriteCount?: number
}
function CommunityFrame({
  embedded,
  busy,
  onClose,
  children
}: {
  embedded: boolean
  busy: boolean
  onClose: () => void
  children: ReactNode
}): React.JSX.Element {
  return embedded ? (
    <section className="navio-community-inline">{children}</section>
  ) : (
    <Modal
      isOpen
      size="3xl"
      scrollBehavior="inside"
      isDismissable={!busy}
      hideCloseButton={busy}
      onClose={onClose}
    >
      <ModalContent>{children}</ModalContent>
    </Modal>
  )
}
export default function ThemeCommunity({
  onClose,
  onApplied,
  onEdit,
  embedded = false,
  initialScope = 'themes'
}: {
  onClose: () => void
  onApplied: () => void
  onEdit: (theme: DexTheme) => void
  embedded?: boolean
  initialScope?: 'themes' | 'favorite-themes' | 'my-themes'
}): React.JSX.Element {
  const [scope, setScope] = useState<string>(initialScope)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [items, setItems] = useState<Publication[]>([])
  const [favorites, setFavorites] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [report, setReport] = useState<Publication>()
  const [reason, setReason] = useState('')
  const [removing, setRemoving] = useState<Publication>()
  const [mediaPreview, setMediaPreview] = useState<string>()
  const sequence = useRef(0)
  useEffect(() => {
    setScope(initialScope)
    setPage(1)
  }, [initialScope])
  const load = useCallback(async (): Promise<void> => {
    const seq = ++sequence.current
    const result = await dexAccountAction<{ themes: Publication[]; total?: number }>(
      scope as 'themes' | 'my-themes' | 'favorite-themes',
      { q: search, page }
    )
    const liked =
      scope === 'favorite-themes'
        ? result
        : await dexAccountAction<{ themes: Publication[] }>('favorite-themes')
    if (seq !== sequence.current) return
    setItems(result.themes)
    setTotal(result.total || result.themes.length)
    setFavorites(liked.themes.map((item) => item.id))
  }, [scope, search, page])
  useEffect(() => {
    setError('')
    void load().catch((err) => setError(String(err)))
  }, [load])
  const action = async (run: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await run()
      await load()
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <CommunityFrame embedded={embedded} busy={busy} onClose={onClose}>
        {!embedded && <ModalHeader>在线主题与我的作品</ModalHeader>}
        <div className="space-y-4 px-1 py-2">
          <p className="text-sm text-default-500">
            主题、收藏和举报记录保存在 D.E.X 账号服务。账号服务器不接收代理订阅或节点凭据。
          </p>
          {!embedded && (
            <Tabs
              aria-label="在线主题分类"
              selectedKey={scope}
              isDisabled={busy}
              onSelectionChange={(key) => {
                setScope(String(key))
                setPage(1)
                setSearch('')
                setQuery('')
              }}
            >
              <Tab key="themes" title="发现主题" />
              <Tab key="favorite-themes" title="我的收藏" />
              <Tab key="my-themes" title="我发布的" />
            </Tabs>
          )}
          {scope === 'themes' && (
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                setSearch(query.trim())
                setPage(1)
              }}
            >
              <Input
                aria-label="搜索在线主题"
                placeholder="搜索主题名称、作者或描述"
                value={query}
                onValueChange={setQuery}
                maxLength={100}
                isDisabled={busy}
              />
              <Button type="submit" isDisabled={busy}>
                搜索
              </Button>
            </form>
          )}
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="text-sm text-success">
              {notice}
            </p>
          )}
          {items.length === 0 && (
            <p className="text-sm text-default-500 py-8 text-center">
              {error ? '暂时无法读取主题。请确认账号服务可用后重试。' : '这里还没有主题。'}
            </p>
          )}
          <div className="space-y-3">
            {items.map((item) => (
              <article key={item.id} className="rounded-xl border border-default-200 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h4 className="font-medium break-words">{item.theme.name}</h4>
                    <p className="text-xs text-default-500 mt-1">
                      {item.theme.author} ·{' '}
                      {item.status === 'removed'
                        ? '已被管理员下架'
                        : item.status === 'pending_review'
                          ? '等待管理员复核'
                          : item.theme.appearance === 'dark'
                            ? '深色主题'
                            : '浅色主题'}
                    </p>
                  </div>
                  <span
                    className="size-8 rounded-full shrink-0 border border-default-200"
                    style={{ backgroundColor: item.theme.colors.accent }}
                    aria-hidden="true"
                  />
                </div>
                <p className="text-sm text-default-500 my-3 break-words">
                  {item.theme.description || '作者尚未填写说明。'}
                </p>
                {item.theme.background && 'asset' in item.theme.background && (
                  <>
                    {mediaPreview === item.id ? (
                      <div className="relative h-40 mb-3 overflow-hidden rounded-lg">
                        <ThemeCanvas theme={item.theme} playback />
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="flat"
                        className="mb-3"
                        isDisabled={busy}
                        onPress={() =>
                          void action(async () => {
                            const value = await window.electron.ipcRenderer.invoke(
                              'dexThemes',
                              'loadMedia',
                              { theme: item.theme }
                            )
                            if (value && typeof value === 'object' && 'invokeError' in value)
                              throw new Error(String(value.invokeError))
                            setMediaPreview(item.id)
                          })
                        }
                      >
                        下载并预览媒体背景
                      </Button>
                    )}
                  </>
                )}
                {scope === 'my-themes' && item.status !== 'published' && (
                  <div className="rounded-lg bg-warning-50 p-3 mb-3 text-sm">
                    <p>下架原因：{item.moderationReason || '请联系管理员查看处理原因。'}</p>
                    {item.status === 'pending_review' ? (
                      <p className="mt-2">修改稿已提交，复核通过后恢复公开。</p>
                    ) : (
                      <div className="flex gap-2 mt-2">
                        <Button
                          size="sm"
                          isDisabled={busy}
                          onPress={() =>
                            void action(async () => {
                              const value = await window.electron.ipcRenderer.invoke(
                                'dexThemes',
                                'editPublication',
                                { id: item.id }
                              )
                              if (value && typeof value === 'object' && 'invokeError' in value)
                                throw new Error(String(value.invokeError))
                              onEdit(value as DexTheme)
                            })
                          }
                        >
                          编辑修改稿
                        </Button>
                        <Button
                          size="sm"
                          color="primary"
                          isDisabled={busy}
                          onPress={() =>
                            void action(async () => {
                              const value = await window.electron.ipcRenderer.invoke(
                                'dexThemes',
                                'reviewPublication',
                                { id: item.id }
                              )
                              if (value && typeof value === 'object' && 'invokeError' in value)
                                throw new Error(String(value.invokeError))
                              setNotice('修改稿已提交，等待管理员复核。')
                            })
                          }
                        >
                          提交已保存的修改稿
                        </Button>
                      </div>
                    )}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    color="primary"
                    variant="flat"
                    isDisabled={busy || item.status !== 'published'}
                    onPress={() =>
                      void action(async () => {
                        const result = await window.electron.ipcRenderer.invoke(
                          'dexThemes',
                          'installCloud',
                          { id: item.id }
                        )
                        if (result && typeof result === 'object' && 'invokeError' in result)
                          throw new Error(String(result.invokeError))
                        onApplied()
                        setNotice(`已应用「${item.theme.name}」`)
                      })
                    }
                  >
                    下载并应用
                  </Button>
                  <Button
                    size="sm"
                    variant="light"
                    isDisabled={busy || item.status !== 'published'}
                    onPress={() =>
                      void action(async () => {
                        await dexAccountAction('theme-favorite', {
                          target: item.id,
                          favorite: !favorites.includes(item.id)
                        })
                      })
                    }
                  >
                    {favorites.includes(item.id) ? '取消收藏' : '收藏'}
                  </Button>
                  <Button
                    size="sm"
                    variant="light"
                    isDisabled={busy}
                    onPress={() => {
                      setReport(item)
                      setReason('')
                      setError('')
                    }}
                  >
                    举报
                  </Button>
                  {scope === 'my-themes' && (
                    <Button
                      size="sm"
                      color="danger"
                      variant="light"
                      isDisabled={busy}
                      onPress={() => setRemoving(item)}
                    >
                      删除发布
                    </Button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap justify-end items-center gap-2 py-3">
          {scope === 'themes' && (
            <div className="mr-auto flex items-center gap-3">
              <Button
                size="sm"
                variant="light"
                isDisabled={busy || page <= 1}
                onPress={() => setPage(page - 1)}
              >
                上一页
              </Button>
              <span className="text-xs text-default-500">
                第 {page} 页 · 共 {total} 项
              </span>
              <Button
                size="sm"
                variant="light"
                isDisabled={busy || page * 40 >= total}
                onPress={() => setPage(page + 1)}
              >
                下一页
              </Button>
            </div>
          )}
          <Button variant="light" isLoading={busy} onPress={() => void action(async () => {})}>
            刷新
          </Button>
          {!embedded && (
            <Button isDisabled={busy} onPress={onClose}>
              完成
            </Button>
          )}
        </div>
      </CommunityFrame>
      <Modal
        isOpen={!!report}
        isDismissable={!busy}
        hideCloseButton={busy}
        onClose={() => setReport(undefined)}
      >
        <ModalContent>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (!report) return
              void action(async () => {
                await dexAccountAction('theme-report', { target: report.id, reason: reason.trim() })
                setReport(undefined)
                setNotice('举报已提交，管理员会进行处理。')
              })
            }}
          >
            <ModalHeader>举报「{report?.theme.name}」</ModalHeader>
            <ModalBody>
              <Textarea
                label="举报原因"
                description="请描述侵权、不当内容或其他具体问题，最多 1000 字。"
                value={reason}
                onValueChange={setReason}
                maxLength={1000}
                isRequired
                isDisabled={busy}
              />
              {error && (
                <p className="text-sm text-danger" role="alert">
                  {error}
                </p>
              )}
            </ModalBody>
            <ModalFooter>
              <Button variant="light" isDisabled={busy} onPress={() => setReport(undefined)}>
                取消
              </Button>
              <Button type="submit" color="primary" isLoading={busy} isDisabled={!reason.trim()}>
                提交举报
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>
      {removing && (
        <BaseConfirmModal
          isOpen
          isLoading={busy}
          title={`删除「${removing.theme.name}」的公开发布？`}
          content="在线主题和相关收藏会移除；你保存在本机的主题文件仍会保留。"
          onCancel={() => setRemoving(undefined)}
          onConfirm={() =>
            void action(async () => {
              await dexAccountAction('theme-delete', { target: removing.id })
              setRemoving(undefined)
              setNotice('已删除在线发布，本机主题仍然保留。')
            })
          }
        />
      )}
    </>
  )
}
