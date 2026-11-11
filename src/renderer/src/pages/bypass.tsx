import { useEffect, useMemo, useState } from 'react'
import { Button, Chip, Switch, Textarea } from '@heroui/react'
import { LuArrowUpRight, LuCheck, LuGlobe, LuMonitor, LuShieldCheck } from 'react-icons/lu'
import BasePage from '@renderer/components/base/base-page'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { useControledMihomoConfig } from '@renderer/hooks/use-controled-mihomo-config'
import { useNavigate } from 'react-router-dom'
import {
  DEX_BYPASS_PRESETS,
  bypassRules,
  normalizeBypass,
  usesGlobalBypass,
  type DexBypassConfig
} from '../../../shared/dex-bypass'

const lines = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)

export default function BypassPage(): React.JSX.Element {
  const { appConfig, mutateAppConfig } = useAppConfig()
  const { controledMihomoConfig } = useControledMihomoConfig()
  const navigate = useNavigate()
  const [enabled, setEnabled] = useState(false)
  const [presets, setPresets] = useState<string[]>([])
  const [processes, setProcesses] = useState('')
  const [domains, setDomains] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const stored = useMemo(() => normalizeBypass(appConfig?.dexBypass), [appConfig?.dexBypass])
  useEffect(() => {
    setEnabled(stored.enabled)
    setPresets(stored.presets)
    setProcesses(stored.processes.join('\n'))
    setDomains(stored.domains.join('\n'))
  }, [stored])
  const mode = controledMihomoConfig?.mode || 'rule'
  const active = usesGlobalBypass(mode, stored)
  const draft: DexBypassConfig = {
    enabled,
    presets,
    processes: lines(processes),
    domains: lines(domains)
  }
  const dirty = JSON.stringify(draft) !== JSON.stringify(stored)
  const save = async (): Promise<void> => {
    setError('')
    setSaved(false)
    setSaving(true)
    try {
      const value = normalizeBypass(draft)
      if (value.enabled && bypassRules(value).length === 0)
        throw new Error('请先选择一个常用应用，或添加应用进程、网站域名。')
      const result = await window.electron.ipcRenderer.invoke('saveDexBypass', value)
      if (result && typeof result === 'object' && 'invokeError' in result)
        throw new Error(String(result.invokeError))
      await mutateAppConfig()
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }
  return (
    <BasePage
      title="直连例外"
      header={
        <Button
          className="app-nodrag"
          size="sm"
          color="primary"
          isLoading={saving}
          isDisabled={!dirty}
          onPress={save}
        >
          保存并应用
        </Button>
      }
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-5 p-5 pb-10">
        <section className="rounded-2xl border border-divider bg-content1 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="mb-2 flex items-center gap-2 text-primary">
                <LuShieldCheck size={20} />
                <span className="text-xs font-semibold tracking-wide">为日常应用保留直连</span>
              </div>
              <h1 className="text-xl font-semibold">全局代理，也能有自己的例外</h1>
              <p className="mt-2 max-w-xl text-sm leading-6 text-default-500">
                选择需要直接联网的应用和网站，其余流量继续使用全局节点。直连会使用当前网络的公网
                IP，目标服务会看到这个 IP。
              </p>
            </div>
            <Switch
              aria-label="启用全局直连例外"
              isSelected={enabled}
              onValueChange={(value) => {
                setEnabled(value)
                setSaved(false)
              }}
              isDisabled={saving}
            />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-divider pt-4">
            <Chip size="sm" variant="flat" color={active ? 'success' : 'default'}>
              {active
                ? '全局 · 含直连例外'
                : mode === 'global'
                  ? '全局 · 无直连例外'
                  : mode === 'direct'
                    ? '当前为全部直连'
                    : '当前为规则模式'}
            </Chip>
            <span className="text-xs text-default-500">
              {active
                ? '已应用的例外优先，其余流量交给 GLOBAL 节点。'
                : '例外仅在全局模式启用；不会改动订阅原有规则。'}
            </span>
          </div>
        </section>

        <section>
          <h2 className="mb-1 text-sm font-semibold">常用应用与网站</h2>
          <p className="mb-3 text-xs leading-5 text-default-500">
            默认均不选中。内建条目是可查看的起点，无法覆盖应用将来新增的所有域名；可以在下方补充。
          </p>
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {DEX_BYPASS_PRESETS.map((preset) => (
              <div key={preset.id} className="rounded-xl border border-divider bg-content1 p-4">
                <Switch
                  classNames={{
                    base: 'max-w-full w-full flex-row-reverse justify-between',
                    label: 'mr-auto'
                  }}
                  isSelected={presets.includes(preset.id)}
                  isDisabled={saving}
                  onValueChange={(value) => {
                    setPresets((current) =>
                      value ? [...current, preset.id] : current.filter((id) => id !== preset.id)
                    )
                    setSaved(false)
                  }}
                  aria-label={`${preset.name}直连`}
                >
                  <span className="text-sm font-medium">{preset.name}</span>
                </Switch>
                <p className="mt-1 text-xs text-default-500">{preset.description}</p>
                <details className="mt-3 text-xs text-default-500">
                  <summary className="cursor-pointer py-1">查看包含的进程与域名</summary>
                  <div className="mt-2 space-y-2 break-all leading-5">
                    {preset.processes.length > 0 && <p>进程：{preset.processes.join('、')}</p>}
                    <p>域名及其子域名：{preset.domains.join('、')}</p>
                  </div>
                </details>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-divider bg-content1 p-5">
          <h2 className="mb-4 text-sm font-semibold">添加自己的例外</h2>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <div>
              <label className="mb-2 flex items-center gap-2 text-sm" htmlFor="bypass-processes">
                <LuMonitor />
                应用进程
              </label>
              <Textarea
                id="bypass-processes"
                aria-label="自定义应用进程"
                placeholder={'Example.exe\n每行一个进程文件名'}
                minRows={3}
                maxRows={7}
                value={processes}
                onValueChange={(value) => {
                  setProcesses(value)
                  setSaved(false)
                }}
                isDisabled={saving}
              />
              <p className="mt-2 text-xs leading-5 text-default-500">
                在任务管理器的“详细信息”中查看名称。填写文件名，不填写安装路径；最多 100 条。
              </p>
            </div>
            <div>
              <label className="mb-2 flex items-center gap-2 text-sm" htmlFor="bypass-domains">
                <LuGlobe />
                网站域名
              </label>
              <Textarea
                id="bypass-domains"
                aria-label="自定义网站域名"
                placeholder={'example.com\n每行一个域名，不含 https://'}
                minRows={3}
                maxRows={7}
                value={domains}
                onValueChange={(value) => {
                  setDomains(value)
                  setSaved(false)
                }}
                isDisabled={saving}
              />
              <p className="mt-2 text-xs leading-5 text-default-500">
                同时匹配该域名与其子域名，不区分网址路径。避免填写覆盖面过大的共享域名；最多 100
                条。
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-xl bg-content2/60 p-4 text-xs leading-6 text-default-500">
          <h2 className="mb-1 font-semibold text-foreground">什么时候会生效？</h2>
          <p>
            保存后用于新建连接；已建立的连接可能继续使用原来的线路，可重新打开目标应用，或到连接页面断开相关连接。
          </p>
          <p>
            只有进入本软件的流量才会参与判断。系统代理无法接管所有应用；TUN
            可覆盖更多流量，但仍受系统权限和应用行为影响。进程例外会为当前运行配置启用进程识别；识别失败时仍可按网站域名匹配，无法保证每个应用都被识别。
          </p>
          <details className="mt-2">
            <summary className="cursor-pointer font-medium text-foreground">
              了解全局例外的工作方式
            </summary>
            <p className="mt-2">
              Mihomo
              原生全局模式不会执行分流规则，因此本软件在启用例外时使用规则引擎：先匹配这些直连项目，最后将其他流量交给
              GLOBAL。界面保留你的“全局”选择，运行配置会显示
              rule。关闭例外或切回规则模式，就恢复对应的原始行为。
            </p>
            <p>
              应用例外覆盖该进程发起的所有已接管连接；例如在微信内打开外部网页，也可能直接联网。系统
              DNS 或加密 DNS 是否经过代理仍由 DNS 设置决定，直连例外不会自行改写 DNS 设置。
            </p>
          </details>
          <Button
            size="sm"
            variant="light"
            className="mt-2 px-0 text-primary"
            endContent={<LuArrowUpRight />}
            onPress={() => navigate('/connections')}
          >
            查看连接与实际路由
          </Button>
        </section>
        {error && (
          <p role="alert" className="rounded-xl bg-danger/10 p-3 text-sm text-danger">
            {error}
          </p>
        )}
        {saved && !dirty && (
          <p role="status" className="flex items-center gap-2 text-sm text-success">
            <LuCheck />
            已保存并应用，新建连接将按当前模式处理。
          </p>
        )}
        <div className="flex justify-end">
          <Button color="primary" isLoading={saving} isDisabled={!dirty} onPress={save}>
            保存并应用
          </Button>
        </div>
      </div>
    </BasePage>
  )
}
