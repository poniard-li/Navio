import { Button } from '@heroui/react'
import { useEffect, useState } from 'react'
import { showErrorSync } from '@renderer/utils/error-display'
import SettingCard from '@renderer/components/base/base-setting-card'
import SettingItem from '@renderer/components/base/base-setting-item'

interface ServiceStatus {
  available: boolean
  installed: boolean
  running: boolean
  active: boolean
  changed?: boolean
  detail?: string
}

async function serviceAction(
  channel: 'getWindowsServiceStatus' | 'manageWindowsService' | 'restartCore' | 'restartAsAdmin',
  ...args: unknown[]
): Promise<unknown> {
  const result = await window.electron.ipcRenderer.invoke(channel, ...args)
  if (result && typeof result === 'object' && 'invokeError' in result)
    throw new Error(String(result.invokeError))
  return result
}

export default function WindowsServiceSettings(): React.JSX.Element {
  const [status, setStatus] = useState<ServiceStatus>()
  const [busy, setBusy] = useState(false)
  const refresh = async (): Promise<void> => {
    setStatus((await serviceAction('getWindowsServiceStatus')) as ServiceStatus)
  }
  useEffect(() => {
    void refresh().catch((error) => showErrorSync(error))
  }, [])
  const manage = async (action: 'install' | 'uninstall'): Promise<void> => {
    setBusy(true)
    try {
      const result = (await serviceAction('manageWindowsService', action)) as ServiceStatus
      setStatus(result)
      // A service repair or removal stops its core; re-apply the user's saved configuration.
      if (result.changed) await serviceAction('restartCore')
    } catch (error) {
      showErrorSync(error, '后台服务操作失败')
    } finally {
      await refresh().catch(() => undefined)
      setBusy(false)
    }
  }
  return (
    <SettingCard>
      <SettingItem title="TUN 后台服务">
        <span className="text-sm text-foreground/65">
          {!status
            ? '正在读取'
            : status.active
              ? '正在承载内核'
              : status.running
                ? '已就绪'
                : status.installed
                  ? '已安装，未运行'
                  : '未安装'}
        </span>
      </SettingItem>
      <div className="px-4 pb-4 space-y-3">
        <p className="text-sm text-foreground/65">
          安装时需要一次管理员授权，主界面保持普通权限。删除免安装版文件夹不会移除此服务，可在这里或
          Windows「已安装的应用」中卸载。
        </p>
        <p className="text-sm text-foreground/65">
          服务使用独立的受保护内核副本和本机控制接口。外部 Web
          面板、自定义入站监听、自定义内核或服务不支持的配置，可选择仅本次以管理员方式运行。
        </p>
        {status?.detail && <p className="text-sm text-warning">{status.detail}</p>}
        {status && !status.available && (
          <p className="text-sm text-warning">
            此程序包没有包含服务组件，请安装完整的 Windows 版本。
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            color="primary"
            isDisabled={!status?.available || busy}
            isLoading={busy}
            onPress={() => void manage('install')}
          >
            {status?.installed ? '重新安装服务' : '安装服务'}
          </Button>
          {status?.installed && (
            <Button
              size="sm"
              variant="flat"
              color="danger"
              isDisabled={busy}
              onPress={() => void manage('uninstall')}
            >
              卸载服务
            </Button>
          )}
          <Button
            size="sm"
            variant="flat"
            isDisabled={busy}
            onPress={() =>
              void serviceAction('restartAsAdmin').catch((error) => showErrorSync(error))
            }
          >
            仅本次以管理员运行
          </Button>
          <Button
            size="sm"
            variant="light"
            isDisabled={busy}
            onPress={() => void refresh().catch((error) => showErrorSync(error))}
          >
            刷新
          </Button>
        </div>
      </div>
    </SettingCard>
  )
}
