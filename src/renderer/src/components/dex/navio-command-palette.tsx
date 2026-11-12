import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader
} from '@heroui/react'
import { LuSearch, LuArrowRight } from 'react-icons/lu'
import { useNavigate } from 'react-router-dom'
import { useProfileConfig } from '@renderer/hooks/use-profile-config'
import { useGroups } from '@renderer/hooks/use-groups'
import {
  addProfileItem,
  changeCurrentProfile,
  getAppConfig,
  getProfileConfig,
  mihomoChangeProxy,
  mihomoCloseAllConnections,
  mihomoGroups,
  updatePluginProfile
} from '@renderer/utils/ipc'
import { navigationGroups, utilityItems } from './sidebar'

interface Command {
  id: string
  title: string
  detail: string
  search: string
  confirm?: string
  run: () => void | Promise<void>
}
const RECENTS_KEY = 'navio-command-recents'
function readRecents(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]')
    return Array.isArray(value) ? value.filter((x) => typeof x === 'string').slice(0, 8) : []
  } catch {
    return []
  }
}

export default function NavioCommandPalette(): React.JSX.Element {
  const navigate = useNavigate()
  const { profileConfig, mutateProfileConfig } = useProfileConfig()
  const { mutate: mutateGroups } = useGroups()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [groups, setGroups] = useState<IMihomoMixedGroup[]>([])
  const [recents, setRecents] = useState(readRecents)
  const [selected, setSelected] = useState(0)
  const [pending, setPending] = useState<Command | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const executing = useRef(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const show = (): void => {
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return
      setOpen(true)
      setPending(null)
      setError('')
      setQuery('')
      setSelected(0)
    }
    const key = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        show()
      }
    }
    window.addEventListener('dex-open-search', show)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('dex-open-search', show)
      window.removeEventListener('keydown', key)
    }
  }, [])
  useEffect(() => {
    if (!open) return
    let active = true
    setGroups([])
    void mihomoGroups()
      .then((value) => {
        if (active) setGroups(value)
      })
      .catch(() => {})
    const timer = setTimeout(() => input.current?.focus(), 50)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [open])

  const commands = useMemo(() => {
    const pages: Command[] = [...navigationGroups.flatMap((g) => g.items), ...utilityItems].map(
      (item) => ({
        id: `page:${item.path}`,
        title: item.fallback,
        detail: '打开页面',
        search: `${item.english} ${item.keywords}`,
        run: () => {
          navigate(item.path)
        }
      })
    )
    for (const profile of profileConfig?.items || []) {
      pages.push({
        id: `profile:${profile.id}`,
        title: profile.name,
        detail: '切换订阅',
        search: '订阅 配置 profile',
        confirm: `切换到「${profile.name}」？当前连接可能重新建立。`,
        run: async () => {
          const latest = await getProfileConfig()
          if (!latest.items.some((p) => p.id === profile.id))
            throw new Error('该订阅已移除，请重新搜索。')
          await changeCurrentProfile(profile.id)
          mutateProfileConfig()
        }
      })
      if (profile.type === 'remote' || profile.type === 'plugin')
        pages.push({
          id: `refresh:${profile.id}`,
          title: `更新订阅 · ${profile.name}`,
          detail: '下载并应用最新配置',
          search: '刷新 更新订阅 update refresh',
          confirm: `更新「${profile.name}」？如果它是当前订阅，更新后可能重新建立连接。`,
          run: async () => {
            const latest = (await getProfileConfig()).items.find((p) => p.id === profile.id)
            if (!latest) throw new Error('该订阅已移除。')
            if (latest.type === 'plugin' && latest.pluginId)
              await updatePluginProfile(latest.pluginId, true)
            else if (latest.type === 'remote') await addProfileItem(latest)
            else throw new Error('该配置不能在线更新。')
            mutateProfileConfig()
          }
        })
    }
    for (const group of groups.filter((g) => g.type === 'Selector'))
      for (const proxy of group.all) {
        pages.push({
          id: `node:${group.name}:${proxy.name}`,
          title: proxy.name,
          detail: `切换节点 · ${group.name}`,
          search: `节点 代理 proxy node ${group.name}`,
          confirm: `将「${group.name}」切换到「${proxy.name}」？出口与地区可能变化。`,
          run: async () => {
            const latest = (await mihomoGroups()).find(
              (g) => g.name === group.name && g.type === 'Selector'
            )
            if (!latest?.all.some((p) => p.name === proxy.name))
              throw new Error('节点或策略组已经变化，请重新搜索。')
            await mihomoChangeProxy(group.name, proxy.name)
            try {
              const config = await getAppConfig()
              if (config.autoCloseConnection !== false)
                await mihomoCloseAllConnections(
                  config.autoCloseConnectionOnlyGroup ? group.name : undefined
                )
            } finally {
              await mutateGroups()
              window.electron.ipcRenderer.send('updateTrayMenu')
            }
            window.dispatchEvent(new CustomEvent('navio-theme-feedback', { detail: 'node' }))
          }
        })
      }
    return pages
  }, [profileConfig, groups, navigate, mutateProfileConfig, mutateGroups])
  const results = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const matches = commands.filter((c) =>
      words.every((w) => `${c.title} ${c.detail} ${c.search}`.toLowerCase().includes(w))
    )
    if (!words.length)
      matches.sort((a, b) => {
        const rank = (id: string): number => (recents.includes(id) ? recents.indexOf(id) : -1)
        const ar = rank(a.id),
          br = rank(b.id)
        return (ar < 0 ? 99 : ar) - (br < 0 ? 99 : br)
      })
    return matches.slice(0, 60)
  }, [commands, query, recents])
  useEffect(() => setSelected(0), [query])
  useEffect(() => {
    document.getElementById(`navio-command-${selected}`)?.scrollIntoView({ block: 'nearest' })
  }, [selected])
  const execute = async (command: Command): Promise<void> => {
    if (executing.current) return
    executing.current = true
    setBusy(true)
    setError('')
    try {
      await command.run()
      const next = [command.id, ...recents.filter((id) => id !== command.id)].slice(0, 8)
      setRecents(next)
      try {
        localStorage.setItem(RECENTS_KEY, JSON.stringify(next))
      } catch {
        // A history write failure must not present a completed operation as failed.
      }
      setOpen(false)
      setPending(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      executing.current = false
      setBusy(false)
    }
  }
  const choose = (command: Command): void => {
    setError('')
    if (command.confirm) setPending(command)
    else void execute(command)
  }
  return (
    <Modal
      isOpen={open}
      onOpenChange={(value) => {
        if (!busy) setOpen(value)
      }}
      size="2xl"
      scrollBehavior="inside"
      isDismissable={!busy}
      isKeyboardDismissDisabled={busy}
    >
      <ModalContent>
        <ModalHeader>快捷操作</ModalHeader>
        <ModalBody>
          {pending ? (
            <div>
              <h3 className="font-medium">{pending.title}</h3>
              <p className="mt-3 text-sm text-default-500">{pending.confirm}</p>
            </div>
          ) : (
            <>
              <Input
                ref={input}
                aria-label="搜索功能、节点、订阅和操作"
                placeholder="搜索功能、节点、订阅或操作"
                startContent={<LuSearch />}
                value={query}
                onValueChange={setQuery}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault()
                    setSelected((s) =>
                      Math.max(
                        0,
                        Math.min(results.length - 1, s + (e.key === 'ArrowDown' ? 1 : -1))
                      )
                    )
                  } else if (e.key === 'Enter' && results[selected]) {
                    e.preventDefault()
                    choose(results[selected])
                  }
                }}
              />
              <p className="text-xs text-default-500">
                {query ? '搜索结果' : '最近使用与常用操作'} · ↑ ↓ 选择 · Enter 打开
              </p>
              <div className="max-h-80 overflow-y-auto flex flex-col gap-1" aria-label="搜索结果">
                {results.map((command, index) => (
                  <button
                    id={`navio-command-${index}`}
                    type="button"
                    key={command.id}
                    className={`flex items-center text-left rounded-lg px-3 py-2 gap-3 ${selected === index ? 'bg-primary/15' : 'hover:bg-content2'}`}
                    onClick={() => choose(command)}
                  >
                    <span className="flex-1 min-w-0">
                      <strong className="block font-medium text-sm truncate">
                        {command.title}
                      </strong>
                      <span className="text-xs text-default-500">{command.detail}</span>
                    </span>
                    <LuArrowRight />
                  </button>
                ))}
                {!results.length && (
                  <p className="p-5 text-sm text-default-500">没有找到匹配项。</p>
                )}
              </div>
            </>
          )}
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
        </ModalBody>
        <ModalFooter>
          {pending ? (
            <>
              <Button
                isDisabled={busy}
                onPress={() => {
                  setPending(null)
                  setError('')
                }}
              >
                返回
              </Button>
              <Button color="primary" isLoading={busy} onPress={() => void execute(pending)}>
                确认执行
              </Button>
            </>
          ) : (
            <Button onPress={() => setOpen(false)}>关闭</Button>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
