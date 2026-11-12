import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  Input,
  Select,
  SelectItem
} from '@heroui/react'
import {
  LuArrowDown,
  LuArrowUp,
  LuArrowUpRight,
  LuCheck,
  LuChevronRight,
  LuPower,
  LuSearch,
  LuStar,
  LuWifi
} from 'react-icons/lu'
import { useNavigate } from 'react-router-dom'
import BasePage from '@renderer/components/base/base-page'
import OutboundModeSwitcher from '@renderer/components/sider/outbound-mode-switcher'
import { toast } from '@renderer/components/base/toast'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { useControledMihomoConfig } from '@renderer/hooks/use-controled-mihomo-config'
import { useGroups } from '@renderer/hooks/use-groups'
import { useProfileConfig } from '@renderer/hooks/use-profile-config'
import {
  mihomoChangeProxy,
  mihomoCloseAllConnections,
  mihomoProxyDelay,
  triggerSysProxy,
  updateTrayIcon
} from '@renderer/utils/ipc'
import '../assets/navio.css'
import BaseConfirmModal from '@renderer/components/base/base-confirm-modal'
import {
  recommendationCandidates,
  recommendMeasuredNode
} from '../../../shared/node-recommendation'

function bytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '—'
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${Math.round(value)} B`
}

export default function Home(): React.JSX.Element {
  const navigate = useNavigate()
  const { appConfig, patchAppConfig } = useAppConfig()
  const { profileConfig } = useProfileConfig()
  const { groups, mutate } = useGroups()
  const { controledMihomoConfig, patchControledMihomoConfig } = useControledMihomoConfig()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [groupName, setGroupName] = useState('')
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [delays, setDelays] = useState<Record<string, number | null>>({})
  const [recommendation, setRecommendation] = useState<{
    name: string
    delay: number
    favorite: boolean
    context: string
  }>()
  const [traffic, setTraffic] = useState({ up: 0, down: 0 })
  const [samples, setSamples] = useState<number[]>(Array(40).fill(0))
  const mode = controledMihomoConfig?.mode ?? 'rule'
  const connected = Boolean(appConfig?.sysProxy?.enable || controledMihomoConfig?.tun?.enable)
  const profile = profileConfig?.items?.find((item) => item.id === profileConfig.current)
  const visibleGroups = useMemo(() => (groups || []).filter((group) => !group.hidden), [groups])
  const group =
    visibleGroups.find((item) => item.name === groupName) ||
    (mode === 'global'
      ? visibleGroups.find((item) => item.name === 'GLOBAL')
      : visibleGroups.find((item) => item.name !== 'GLOBAL')) ||
    visibleGroups[0]
  const favorites = appConfig?.navioFavoriteNodes || []
  const nodes = (group?.all || []).filter(
    (node) =>
      node.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()) &&
      (!favoritesOnly || favorites.includes(node.name))
  )
  const current = group?.all.find((node) => node.name === group.now)
  const recommendationContext = JSON.stringify([
    profile?.id,
    mode,
    group?.name,
    group?.now,
    group?.type,
    group?.all.map((node) => node.name)
  ])
  const contextRef = useRef(recommendationContext)
  contextRef.current = recommendationContext
  useEffect(() => setRecommendation(undefined), [recommendationContext])
  const currentDelay = current ? (delays[current.name] ?? current.history.at(-1)?.delay) : undefined
  const unhealthy =
    current &&
    (delays[current.name] === null ||
      currentDelay === 0 ||
      (current.history.length > 0 && !current.alive))
  const extra = profile?.extra
  const remaining =
    extra && extra.total > 0 ? Math.max(0, extra.total - extra.upload - extra.download) : undefined
  const maxSample = Math.max(1, ...samples)
  useEffect(() => {
    setGroupName('')
  }, [mode])
  const sparkline = samples
    .map((value, index) => `${index * 8},${48 - (value / maxSample) * 42}`)
    .join(' ')

  useEffect(
    () =>
      window.electron.ipcRenderer.on('mihomoTraffic', (_event, ...args) => {
        const value = args[0] as IMihomoTrafficInfo
        setTraffic({ up: value.up, down: value.down })
        setSamples((previous) => [...previous.slice(1), value.up + value.down])
      }),
    []
  )

  const toggleConnection = async (): Promise<void> => {
    if (!profile && !connected) {
      navigate('/profiles')
      return
    }
    setBusy(true)
    try {
      if (connected) {
        await triggerSysProxy(false)
        await patchAppConfig({ sysProxy: { enable: false } })
        if (controledMihomoConfig?.tun?.enable)
          await patchControledMihomoConfig({ tun: { enable: false } })
      } else {
        await triggerSysProxy(true)
        await patchAppConfig({ sysProxy: { enable: true } })
      }
      await updateTrayIcon()
      window.electron.ipcRenderer.send('updateTrayMenu')
    } catch (error) {
      toast.error(String(error))
    } finally {
      setBusy(false)
    }
  }

  const selectNode = async (name: string): Promise<boolean> => {
    if (!group) return false
    try {
      await mihomoChangeProxy(group.name, name)
      if (appConfig?.autoCloseConnection !== false) await mihomoCloseAllConnections(group.name)
      await mutate()
      window.electron.ipcRenderer.send('updateTrayMenu')
      toast.success(`已切换至 ${name}`)
      return true
    } catch (error) {
      toast.error(String(error))
      return false
    }
  }

  const testNodes = async (): Promise<void> => {
    setTesting(true)
    const queue = [...nodes]
    await Promise.all(
      Array.from({ length: Math.min(5, queue.length) }, async () => {
        while (queue.length) {
          const node = queue.shift()
          if (!node) break
          try {
            const result = await mihomoProxyDelay(node.name, group?.testUrl)
            setDelays((previous) => ({
              ...previous,
              [node.name]: result.delay && result.delay > 0 ? result.delay : null
            }))
          } catch {
            setDelays((previous) => ({ ...previous, [node.name]: null }))
          }
        }
      })
    )
    setTesting(false)
  }
  const findRecommendation = async (): Promise<void> => {
    if (!group || group.type !== 'Selector' || testing) return
    const context = recommendationContext
    const queue = recommendationCandidates(group.all, group.now)
    const measured: Record<string, number | null> = {}
    setTesting(true)
    try {
      await Promise.all(
        Array.from({ length: Math.min(5, queue.length) }, async () => {
          while (queue.length && contextRef.current === context) {
            const node = queue.shift()
            if (!node) break
            try {
              const result = await mihomoProxyDelay(node.name, group.testUrl)
              measured[node.name] =
                typeof result.delay === 'number' && result.delay > 0 ? result.delay : null
            } catch {
              measured[node.name] = null
            }
          }
        })
      )
      if (contextRef.current !== context) {
        toast.error('当前配置或策略组已变化，请重新查找可用节点。')
        return
      }
      setDelays((previous) => ({ ...previous, ...measured }))
      const candidate = recommendMeasuredNode(group.all, group.now, measured, favorites)
      if (!candidate) {
        setOpen(true)
        toast.error('当前策略组没有检测成功的其他节点，未更改节点。')
        return
      }
      setRecommendation({ ...candidate, context })
    } finally {
      setTesting(false)
    }
  }

  return (
    <BasePage title="概览" header={<span className="navio-header-label">你的网络，由你决定</span>}>
      <div className="navio-home">
        <header className="navio-home-heading">
          <div>
            <p className="navio-eyebrow">NAVIO / WORKSPACE</p>
            <h1>连接，就在眼前。</h1>
          </div>
          <span className="navio-status" data-connected={connected}>
            <i />
            {connected ? '已接入' : '未连接'}
          </span>
        </header>
        <section className="navio-connection" aria-label="连接控制">
          <div className="navio-connection-top">
            <div>
              <span className="navio-eyebrow">当前连接</span>
              <h2>
                {connected
                  ? controledMihomoConfig?.tun?.enable
                    ? 'TUN 已开启'
                    : '系统代理已开启'
                  : '准备好，出发。'}
              </h2>
              <p>
                {connected
                  ? '接管范围取决于当前方式，路由按照所选模式运行。'
                  : '导入你的订阅，选择节点，一键连接。'}
              </p>
            </div>
            <button
              className="navio-power"
              data-connected={connected}
              disabled={busy}
              onClick={() => void toggleConnection()}
              aria-label={connected ? '断开连接' : '连接系统代理'}
            >
              <LuPower />
              <span>{busy ? '处理中' : connected ? '断开' : '连接'}</span>
            </button>
          </div>
          <div className="navio-control-row">
            <div>
              <span className="navio-eyebrow">路由模式</span>
              <OutboundModeSwitcher />
            </div>
            <button className="navio-tun-link" onClick={() => navigate('/tun')}>
              TUN 设置 <LuArrowUpRight />
            </button>
          </div>
        </section>
        <button className="navio-node-summary" onClick={() => setOpen(true)} disabled={!group}>
          <span className="navio-node-icon">
            <LuWifi />
          </span>
          <span>
            <small>{group ? `当前策略组 · ${group.name}` : '尚无可用节点'}</small>
            <strong>{mode === 'direct' ? '直连模式' : group?.now || '导入订阅后选择节点'}</strong>
          </span>
          <span className="navio-node-delay">
            {currentDelay && currentDelay > 0 ? `${currentDelay} ms` : '选择节点'}
            <LuChevronRight />
          </span>
        </button>
        {unhealthy && mode !== 'direct' && (
          <div className="navio-notice" role="status">
            <span>当前节点的最近检测未成功。你可以测速后选择可用节点，出口 IP 可能随之改变。</span>
            <Button
              size="sm"
              variant="flat"
              isLoading={testing}
              onPress={() => {
                if (group?.type === 'Selector') void findRecommendation()
                else {
                  setOpen(true)
                  void testNodes()
                }
              }}
            >
              {group?.type === 'Selector' ? '推荐可用节点' : '查找可用节点'}
            </Button>
          </div>
        )}
        <section className="navio-telemetry" aria-label="实时流量">
          <div>
            <span>
              <LuArrowDown /> 下载
            </span>
            <strong>
              {bytes(traffic.down)}
              <small>/s</small>
            </strong>
          </div>
          <div>
            <span>
              <LuArrowUp /> 上传
            </span>
            <strong>
              {bytes(traffic.up)}
              <small>/s</small>
            </strong>
          </div>
          <svg viewBox="0 0 312 52" role="img" aria-label="最近流量趋势">
            <polyline points={sparkline} fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
        </section>
        <section className="navio-profile-summary">
          <div>
            <span className="navio-eyebrow">当前订阅</span>
            <strong>{profile?.name || '还没有订阅'}</strong>
            <p>
              {remaining === undefined
                ? '服务商未提供用量数据'
                : `剩余 ${bytes(remaining)} / ${bytes(extra?.total ?? 0)}`}
              {extra?.expire ? ` · ${new Date(extra.expire * 1000).toLocaleDateString()} 到期` : ''}
            </p>
          </div>
          <Button variant="light" onPress={() => navigate('/profiles')}>
            {profile ? '管理订阅' : '导入订阅'} <LuArrowUpRight />
          </Button>
        </section>
        <footer className="navio-home-footer">
          <button onClick={() => navigate('/bypass')}>
            全局直连例外 <LuChevronRight />
          </button>
          <button onClick={() => navigate('/connections')}>
            查看当前连接 <LuChevronRight />
          </button>
        </footer>
      </div>
      {recommendation && (
        <BaseConfirmModal
          isOpen
          isLoading={busy}
          title="切换到推荐节点？"
          content={`当前策略组「${group?.name}」推荐 ${recommendation.name}，本次测速 ${recommendation.delay} ms${recommendation.favorite ? '，优先选择了你的收藏' : '，是本次检测中延迟最低的可用节点'}。确认后才切换，出口 IP 可能改变。`}
          onCancel={() => setRecommendation(undefined)}
          onConfirm={async () => {
            if (
              recommendation.context !== contextRef.current ||
              !group?.all.some((node) => node.name === recommendation.name)
            ) {
              setRecommendation(undefined)
              toast.error('当前策略组已变化，请重新查找。')
              return
            }
            setBusy(true)
            try {
              if (await selectNode(recommendation.name)) setRecommendation(undefined)
            } finally {
              setBusy(false)
            }
          }}
        />
      )}
      <Drawer isOpen={open} onOpenChange={setOpen} size="md" placement="right">
        <DrawerContent>
          <DrawerHeader className="flex flex-col gap-1">
            <span>切换节点</span>
            <p className="text-xs font-normal text-default-500">
              选择后留在首页；完整策略组仍可在代理组页面管理。
            </p>
          </DrawerHeader>
          <DrawerBody className="pb-5">
            <Select
              label="策略组"
              selectedKeys={group ? [group.name] : []}
              onSelectionChange={(keys) => setGroupName(String(Array.from(keys)[0] || ''))}
            >
              {visibleGroups.map((item) => (
                <SelectItem key={item.name}>{item.name}</SelectItem>
              ))}
            </Select>
            <Input
              aria-label="搜索节点"
              placeholder="搜索节点名称"
              value={query}
              onValueChange={setQuery}
              startContent={<LuSearch />}
            />
            <div className="flex justify-between gap-2">
              <Button
                size="sm"
                variant={favoritesOnly ? 'solid' : 'flat'}
                onPress={() => setFavoritesOnly(!favoritesOnly)}
                startContent={<LuStar />}
              >
                只看收藏
              </Button>
              <Button size="sm" variant="flat" isLoading={testing} onPress={testNodes}>
                测试当前列表
              </Button>
            </div>
            {group?.type !== 'Selector' && (
              <p className="text-xs text-default-500">
                这个策略组有自己的自动选点逻辑；手动选择是否固定由该组类型决定。
              </p>
            )}
            <div className="navio-node-list">
              {nodes.map((node) => {
                const delay = Object.hasOwn(delays, node.name)
                  ? delays[node.name]
                  : node.history.at(-1)?.delay
                return (
                  <div
                    className="navio-node-row"
                    key={node.name}
                    data-selected={group?.now === node.name}
                  >
                    <button onClick={() => void selectNode(node.name)}>
                      <span>
                        <strong>{node.name}</strong>
                        <small>{node.type}</small>
                      </span>
                      <span>
                        {group?.now === node.name && <LuCheck />}
                        {delay === null || delay === 0
                          ? '不可用'
                          : delay
                            ? `${delay} ms`
                            : '未检测'}
                      </span>
                    </button>
                    <button
                      aria-label={`${favorites.includes(node.name) ? '取消收藏' : '收藏'} ${node.name}`}
                      aria-pressed={favorites.includes(node.name)}
                      onClick={() =>
                        void patchAppConfig({
                          navioFavoriteNodes: favorites.includes(node.name)
                            ? favorites.filter((name) => name !== node.name)
                            : [...favorites, node.name]
                        })
                      }
                    >
                      <LuStar fill={favorites.includes(node.name) ? 'currentColor' : 'none'} />
                    </button>
                  </div>
                )
              })}
              {!nodes.length && (
                <p className="py-10 text-center text-sm text-default-500">没有匹配的节点</p>
              )}
            </div>
            <Button
              variant="light"
              onPress={() => {
                setOpen(false)
                navigate('/proxies')
              }}
            >
              打开完整代理组 <LuArrowUpRight />
            </Button>
          </DrawerBody>
        </DrawerContent>
      </Drawer>
    </BasePage>
  )
}
