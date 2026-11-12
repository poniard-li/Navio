import { Button, Card, CardBody } from '@heroui/react'
import { mihomoUnfixedProxy } from '@renderer/utils/ipc'
import { toast } from '@renderer/components/base/toast'
import React, { useMemo, useState, useCallback } from 'react'
import { FaMapPin } from 'react-icons/fa6'
import { LuCheck, LuStar } from 'react-icons/lu'
import { useTranslation } from 'react-i18next'
import { KeyedMutator } from 'swr'

interface Props {
  mutateProxies: KeyedMutator<IMihomoMixedGroup[]>
  onProxyDelay: (proxy: IMihomoProxy | IMihomoGroup, url?: string) => Promise<IMihomoDelay>
  proxyDisplayMode: 'simple' | 'full'
  proxy: IMihomoProxy | IMihomoGroup
  group: IMihomoMixedGroup
  onSelect: (group: string, proxy: string) => void
  selected: boolean
  favorite?: boolean
  onFavorite?: (name: string) => void
  isGroupTesting?: boolean
}

function delayColor(delay: number): 'primary' | 'success' | 'warning' | 'danger' {
  if (delay === -1) return 'primary'
  if (delay === 0) return 'danger'
  if (delay < 500) return 'success'
  return 'warning'
}

const ProxyItemBase: React.FC<Props> = ({
  mutateProxies,
  proxyDisplayMode,
  group,
  proxy,
  selected,
  favorite = false,
  onFavorite,
  onSelect,
  onProxyDelay,
  isGroupTesting = false
}) => {
  const { t } = useTranslation()
  const delay = useMemo(() => proxy.history.at(-1)?.delay ?? -1, [proxy.history])
  const [loading, setLoading] = useState(false)
  const fixed = group.fixed === proxy.name
  const delayText =
    delay === -1
      ? t('proxies.delay.test')
      : delay === 0
        ? t('proxies.delay.timeout')
        : `${delay} ms`
  const onDelay = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      await onProxyDelay(proxy, group.testUrl)
      await mutateProxies()
    } catch (error) {
      toast.error(String(error))
    } finally {
      setLoading(false)
    }
  }, [proxy, group.testUrl, onProxyDelay, mutateProxies])
  return (
    <Card
      as="div"
      fullWidth
      shadow="none"
      radius="sm"
      className="navio-v7-proxy-node navio-material-card"
      data-selected={selected}
      data-fixed={fixed}
    >
      <CardBody className="navio-v7-proxy-node-body">
        <div className="navio-v7-proxy-node-main">
          <button
            className="navio-v7-proxy-select"
            onClick={() => onSelect(group.name, proxy.name)}
            aria-label={`选择 ${proxy.name}`}
            aria-pressed={selected}
            title={proxy.name}
          >
            {selected && <LuCheck />}
            <span className="flag-emoji">{proxy.name}</span>
          </button>
          {onFavorite && (
            <button
              className="navio-v7-proxy-favorite"
              onClick={() => onFavorite(proxy.name)}
              aria-label={`${favorite ? '取消收藏' : '收藏'} ${proxy.name}`}
              aria-pressed={favorite}
              title={favorite ? '取消收藏' : '收藏'}
            >
              <LuStar fill={favorite ? 'currentColor' : 'none'} />
            </button>
          )}
        </div>
        <div className="navio-v7-proxy-node-details">
          <div className="navio-v7-proxy-protocols">
            {proxyDisplayMode === 'full' && (
              <>
                <span>{proxy.type}</span>
                {['tfo', 'udp', 'xudp', 'mptcp', 'smux'].map((protocol) =>
                  proxy[protocol as keyof IMihomoProxy] ? (
                    <span key={protocol}>{protocol}</span>
                  ) : null
                )}
              </>
            )}
            {proxyDisplayMode === 'simple' && <span>{selected ? '当前节点' : proxy.type}</span>}
          </div>
          {fixed && (
            <Button
              isIconOnly
              size="sm"
              title={t('proxies.unpin')}
              aria-label={`取消固定 ${proxy.name}`}
              variant="light"
              className="navio-v7-proxy-unpin"
              onPress={async () => {
                try {
                  await mihomoUnfixedProxy(group.name)
                  await mutateProxies()
                } catch (error) {
                  toast.error(String(error))
                }
              }}
            >
              <FaMapPin />
            </Button>
          )}
          <Button
            size="sm"
            title={`检测 ${proxy.name} 的延迟`}
            aria-label={`检测 ${proxy.name} 的延迟，${delayText}`}
            isLoading={loading || isGroupTesting}
            color={delayColor(delay)}
            onPress={() => void onDelay()}
            variant="light"
            className="navio-v7-proxy-latency"
          >
            {delayText}
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}

const ProxyItem = React.memo(ProxyItemBase)
ProxyItem.displayName = 'ProxyItem'
export default ProxyItem
