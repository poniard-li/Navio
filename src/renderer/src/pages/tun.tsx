import { Button, Input, Switch, Tab, Tabs } from '@heroui/react'
import BasePage from '@renderer/components/base/base-page'
import { showErrorSync } from '@renderer/utils/error-display'
import SettingCard from '@renderer/components/base/base-setting-card'
import SettingItem from '@renderer/components/base/base-setting-item'
import { useControledMihomoConfig } from '@renderer/hooks/use-controled-mihomo-config'
import { grantTunPermissions, restartCore, setupFirewall } from '@renderer/utils/ipc'
import { platform } from '@renderer/utils/init'
import { ipCIDRValidator } from '@renderer/utils/validate'
import React, { Key, useState } from 'react'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { MdDeleteForever } from 'react-icons/md'
import { useTranslation } from 'react-i18next'
import { FeatureIntro, HelpTip } from '@renderer/components/dex/feature-help'
import WindowsServiceSettings from '@renderer/components/settings/windows-service'
import { DEFAULT_MIHOMO_TUN_CONFIG, getDefaultMihomoTunDevice } from '../../../shared/appConfig'

const Tun: React.FC = () => {
  const { t } = useTranslation()
  const { controledMihomoConfig, patchControledMihomoConfig } = useControledMihomoConfig()
  const { appConfig, patchAppConfig } = useAppConfig()
  const { autoSetDNS = true } = appConfig || {}
  const { tun } = controledMihomoConfig || {}
  const [loading, setLoading] = useState(false)
  const {
    device = getDefaultMihomoTunDevice(platform),
    stack = DEFAULT_MIHOMO_TUN_CONFIG.stack,
    'auto-route': autoRoute = DEFAULT_MIHOMO_TUN_CONFIG['auto-route'],
    'auto-redirect': autoRedirect = DEFAULT_MIHOMO_TUN_CONFIG['auto-redirect'],
    'auto-detect-interface': autoDetectInterface = DEFAULT_MIHOMO_TUN_CONFIG[
      'auto-detect-interface'
    ],
    'dns-hijack': dnsHijack = DEFAULT_MIHOMO_TUN_CONFIG['dns-hijack'],
    'route-exclude-address': routeExcludeAddress = DEFAULT_MIHOMO_TUN_CONFIG[
      'route-exclude-address'
    ],
    'strict-route': strictRoute = false,
    mtu = DEFAULT_MIHOMO_TUN_CONFIG.mtu
  } = tun || {}
  const [changed, setChanged] = useState(false)
  const [values, originSetValues] = useState({
    device,
    stack,
    autoRoute,
    autoRedirect,
    autoDetectInterface,
    dnsHijack,
    strictRoute,
    routeExcludeAddress,
    mtu: Math.min(Math.max(mtu || 1500, 1), 65535)
  })
  const setValues = (v: typeof values): void => {
    originSetValues(v)
    setChanged(true)
  }
  const normalizedRouteExcludeAddress = values.routeExcludeAddress
    .map((address) => address.trim())
    .filter(Boolean)
  const hasInvalidExcludeAddress = normalizedRouteExcludeAddress.some(
    (address) => !ipCIDRValidator(address)
  )
  const excludeAddressInputs = hasInvalidExcludeAddress
    ? values.routeExcludeAddress
    : [...values.routeExcludeAddress, '']
  const getExcludeAddressError = (address: string): string | undefined => {
    const trimmedAddress = address.trim()
    if (trimmedAddress === '' || ipCIDRValidator(trimmedAddress)) return undefined
    return t('tun.excludeAddress.invalid')
  }

  const handleExcludeAddressChange = (value: string, index: number): void => {
    const newExcludeAddresses = [...values.routeExcludeAddress]
    if (index === newExcludeAddresses.length) {
      if (value.trim() !== '') {
        newExcludeAddresses.push(value)
      }
    } else {
      if (value.trim() === '') {
        newExcludeAddresses.splice(index, 1)
      } else {
        newExcludeAddresses[index] = value
      }
    }
    setValues({ ...values, routeExcludeAddress: newExcludeAddresses })
  }

  const onSave = async (patch: Partial<IMihomoConfig>): Promise<void> => {
    // 内核的 PATCH /configs 里 tun.enable 是非指针 bool：请求体带了 tun 却没带 enable
    // 就会被解析成 false，ReCreateTun 随即把虚拟网卡拆掉。必须显式带上当前开关状态。
    const tunPatch = { enable: tun?.enable ?? false, ...patch.tun }
    if (hasInvalidExcludeAddress) {
      // 存在非法条目时不覆盖已保存的排除地址，避免静默丢弃用户数据；其它 TUN 设置照常保存
      delete tunPatch['route-exclude-address']
    } else {
      // 全部合法：写入去空格、去空项后的列表
      tunPatch['route-exclude-address'] = normalizedRouteExcludeAddress
    }
    try {
      await patchControledMihomoConfig({ ...patch, tun: tunPatch })
      await restartCore()
    } catch (e) {
      showErrorSync(e, t('common.error.updateCoreConfigFailed'))
    } finally {
      setChanged(false)
    }
  }

  return (
    <>
      <BasePage
        title={t('tun.title')}
        header={
          changed && (
            <Button
              size="sm"
              className="app-nodrag"
              color="primary"
              onPress={() =>
                onSave({
                  tun: {
                    device: values.device,
                    stack: values.stack,
                    'auto-route': values.autoRoute,
                    'auto-redirect': values.autoRedirect,
                    'auto-detect-interface': values.autoDetectInterface,
                    'dns-hijack': values.dnsHijack,
                    'strict-route': values.strictRoute,
                    'route-exclude-address': values.routeExcludeAddress,
                    mtu: values.mtu
                  }
                })
              }
            >
              {t('common.save')}
            </Button>
          )
        }
      >
        <FeatureIntro topic="tun" />
        {platform === 'win32' && <WindowsServiceSettings />}
        <SettingCard className="tun-settings">
          {platform === 'win32' && (
            <SettingItem title={t('tun.firewall.title')} divider>
              <Button
                size="sm"
                color="primary"
                isLoading={loading}
                onPress={async () => {
                  setLoading(true)
                  try {
                    await setupFirewall()
                    new Notification(t('tun.notifications.firewallResetSuccess'))
                    await restartCore()
                  } catch (e) {
                    showErrorSync(e, t('common.error.firewallSetupFailed'))
                  } finally {
                    setLoading(false)
                  }
                }}
              >
                {t('tun.firewall.reset')}
              </Button>
            </SettingItem>
          )}
          {platform !== 'win32' && (
            <SettingItem title={t('tun.core.title')} divider>
              <Button
                size="sm"
                color="primary"
                onPress={async () => {
                  try {
                    await grantTunPermissions()
                    new Notification(t('tun.notifications.coreAuthSuccess'))
                    await restartCore()
                  } catch (e) {
                    showErrorSync(e, t('common.error.coreAuthFailed'))
                  }
                }}
              >
                {t('tun.core.auth')}
              </Button>
            </SettingItem>
          )}
          {platform === 'darwin' && (
            <SettingItem title={t('tun.dns.autoSet')} divider>
              <Switch
                size="sm"
                isSelected={autoSetDNS}
                onValueChange={async (v) => {
                  await patchAppConfig({ autoSetDNS: v })
                }}
              />
            </SettingItem>
          )}

          <SettingItem
            title={
              <>
                {t('tun.stack.title')}
                <HelpTip
                  title="TUN 协议栈"
                  content="协议栈处理虚拟网卡内的数据包。不同实现的兼容性、性能和资源占用不同；只有遇到游戏、UDP 或连接异常时才建议尝试切换，改完需要重新连接验证。"
                />
              </>
            }
            divider
          >
            <Tabs
              size="sm"
              color="primary"
              selectedKey={values.stack}
              onSelectionChange={(key: Key) => setValues({ ...values, stack: key as TunStack })}
            >
              <Tab key="gvisor" title="gVisor" />
              <Tab key="mixed" title="Mixed" />
              <Tab key="system" title="System" />
              <Tab key="mips" title="Mips" />
            </Tabs>
          </SettingItem>
          <SettingItem title={t('tun.device.title')} divider>
            <Input
              size="sm"
              className="w-25"
              value={values.device}
              placeholder={getDefaultMihomoTunDevice(platform)}
              onValueChange={(v) => {
                setValues({ ...values, device: v })
              }}
            />
          </SettingItem>

          <SettingItem
            title={
              <>
                {t('tun.strictRoute')}
                <HelpTip
                  title="严格路由"
                  content="收紧系统路由，减少流量绕过 TUN 的情况。在 Windows 上可能影响部分应用的连通性检测或局域网访问；出现问题可关闭后重试。"
                />
              </>
            }
            divider
          >
            <Switch
              size="sm"
              isSelected={values.strictRoute}
              onValueChange={(v) => {
                setValues({ ...values, strictRoute: v })
              }}
            />
          </SettingItem>
          <SettingItem title={t('tun.autoRoute')} divider>
            <Switch
              size="sm"
              isSelected={values.autoRoute}
              onValueChange={(v) => {
                setValues({ ...values, autoRoute: v })
              }}
            />
          </SettingItem>
          {platform === 'linux' && (
            <SettingItem title={t('tun.autoRedirect')} divider>
              <Switch
                size="sm"
                isSelected={values.autoRedirect}
                onValueChange={(v) => {
                  setValues({ ...values, autoRedirect: v })
                }}
              />
            </SettingItem>
          )}
          <SettingItem title={t('tun.autoDetectInterface')} divider>
            <Switch
              size="sm"
              isSelected={values.autoDetectInterface}
              onValueChange={(v) => {
                setValues({ ...values, autoDetectInterface: v })
              }}
            />
          </SettingItem>
          <SettingItem title="MTU" divider>
            <Input
              size="sm"
              type="number"
              className="w-25"
              value={values.mtu.toString()}
              min={1}
              onValueChange={(v) => {
                setValues({
                  ...values,
                  mtu: Math.min(Math.max(parseInt(v) || 1500, 1), 65535)
                })
              }}
            />
          </SettingItem>
          <SettingItem
            title={
              <>
                {t('tun.dnsHijack')}
                <HelpTip
                  title="DNS 劫持"
                  content="将符合地址和端口条件的 DNS 请求交给内核 DNS 处理，以统一解析和分流。它不会自动接管所有加密 DNS；错误设置可能导致域名无法解析。"
                />
              </>
            }
            divider
          >
            <Input
              size="sm"
              className="w-[50%]"
              value={values.dnsHijack.join(',')}
              onValueChange={(v) => {
                const arr = v !== '' ? v.split(',') : []
                setValues({ ...values, dnsHijack: arr })
              }}
            />
          </SettingItem>
          <div className="flex flex-col items-stretch">
            <h3 className="mb-2">{t('tun.excludeAddress.title')}</h3>
            {excludeAddressInputs.map((address, index) => (
              <div key={index} className="mb-2 flex">
                <Input
                  fullWidth
                  size="sm"
                  placeholder={t('tun.excludeAddress.placeholder')}
                  value={address}
                  isInvalid={Boolean(getExcludeAddressError(address))}
                  errorMessage={getExcludeAddressError(address)}
                  onValueChange={(v) => handleExcludeAddressChange(v, index)}
                />
                {index < values.routeExcludeAddress.length && (
                  <Button
                    className="ml-2"
                    size="sm"
                    variant="flat"
                    color="warning"
                    onPress={() => handleExcludeAddressChange('', index)}
                  >
                    <MdDeleteForever className="text-lg" />
                  </Button>
                )}
              </div>
            ))}
            {hasInvalidExcludeAddress && (
              <div className="px-1 text-xs text-danger">{t('tun.excludeAddress.notSaved')}</div>
            )}
          </div>
        </SettingCard>
      </BasePage>
    </>
  )
}

export default Tun
