import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react'
import { driver, type DriveStep } from 'driver.js'
import { toast } from '@renderer/components/base/toast'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { patchAppConfig as saveAppConfig } from '@renderer/utils/ipc'
import { PRODUCT_NAME } from '../../../../shared/product'
import 'driver.js/dist/driver.css'
import './onboarding.css'

interface GuideStep {
  title: string
  description: string
  selector?: string
  route?: string
  side?: 'left' | 'right' | 'top' | 'bottom'
}

function guideSteps(simple: boolean): GuideStep[] {
  return [
    {
      title: `认识 ${PRODUCT_NAME}`,
      description:
        '<p>用几步认识订阅、代理与直连例外。我们会在真实界面上指出它们的位置。</p><p><strong>引导只介绍操作，不会开启系统代理或 TUN，也不会更改你的路由设置。</strong></p>'
    },
    {
      title: '从左侧找到需要的功能',
      selector: '#dex-navigation, .dex-sidebar',
      side: 'right',
      description: simple
        ? '<p>简易模式优先展示常用功能。需要 DNS、TUN 等专业设置时，可展开“更多功能”。</p><p>按 <strong>Ctrl + K</strong> 搜索全部功能。当前模式可以在设置中更改。</p>'
        : '<p>日常操作、网络配置与诊断按用途排列。按 <strong>Ctrl + K</strong> 可直接搜索并打开功能。</p><p>标准模式沿用你的订阅配置与规则；配置模式可以在设置中更改。</p>'
    },
    {
      title: '第一步，添加订阅或配置',
      route: simple ? '/simple' : '/profiles',
      selector: '.profiles-sticky',
      side: 'bottom',
      description: simple
        ? '<p>在这里粘贴订阅链接或导入本地文件。两种界面模式共用同一套订阅与规则。</p><p><strong>订阅链接可能包含访问凭据</strong>，请只导入可信来源，分享截图时注意遮挡。</p>'
        : '<p>在这里粘贴订阅链接，或导入本地配置文件。选中配置后，再去“代理组”选择节点。</p><p><strong>订阅链接可能包含访问凭据</strong>，请只导入可信来源，分享截图时注意遮挡。</p>'
    },
    {
      title: '在代理组中选择出口',
      route: '/proxies',
      selector: '#dex-main-content',
      side: 'left',
      description:
        '<p>代理组决定匹配流量使用哪个节点。可搜索节点、测试延迟，再选择合适的出口。</p><p><strong>规则模式</strong>按配置分流；<strong>全局模式</strong>使用全局代理组；<strong>直连模式</strong>不经代理节点。选择节点本身不会接管系统网络。</p>'
    },
    {
      title: '决定哪些流量交给应用',
      route: '/sysproxy',
      selector: '#dex-main-content',
      side: 'left',
      description:
        '<p><strong>系统代理</strong>供遵循 Windows 代理设置的软件使用；不遵循该设置的软件不一定会经过它。</p><p><strong>TUN</strong>通过虚拟网卡接管更多流量，可能需要管理员权限。确认配置可用后再按需开启；不必同时开启两者。</p>'
    },
    {
      title: '全局代理也能保留直连例外',
      route: '/bypass',
      selector: '#dex-main-content',
      side: 'left',
      description:
        '<p>在这里选择常用应用预设，或添加自己的网站、进程名称。命中的新连接将直接访问网络。</p><p><strong>直连会使用你当前网络的出口 IP。</strong> 应用识别取决于流量是否进入内核，以及系统能否识别进程；可以在“连接”中检查实际路由。</p>'
    },
    {
      title: '不熟悉的术语，随时查阅',
      route: '/help',
      selector: '#dex-main-content',
      side: 'left',
      description:
        '<p>说明页解释外部资源、嗅探覆写、Sub-Store 与 Smart 内核。带帮助标记的功能也可悬停或点击查看说明。</p><p>网络信息不显示坐标。ISP 是运营商，ASN 是网络自治系统编号；它们描述网络归属，<strong>不是你的设备编号或精确位置</strong>。</p>'
    },
    {
      title: '准备好了，从订阅开始',
      description:
        '<p>建议先导入可信配置，选择节点，再开启需要的接入方式。访问异常时，可查看连接与日志，确认实际命中的规则。</p><p>你可以在<strong>设置 → 使用引导</strong>或<strong>功能说明</strong>中重新查看。现在继续，会回到订阅页面。</p>'
    }
  ]
}

// Wait for a lazy route to commit before positioning the spotlight. On a missing
// selector, driver.js deliberately shows a centered card instead of blocking.
async function waitForGuideSurface(selector?: string): Promise<void> {
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  )
  const started = performance.now()
  while (
    performance.now() - started < 1800 &&
    (document.querySelector('.dex-page-loading') || (selector && !document.querySelector(selector)))
  ) {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 40))
  }
}

export default function DexOnboarding({ blocked }: { blocked: boolean }): React.JSX.Element | null {
  const { appConfig, mutateAppConfig } = useAppConfig()
  const navigate = useNavigate()
  const navigateRef = useRef(navigate)
  const mutateConfigRef = useRef(mutateAppConfig)
  navigateRef.current = navigate
  mutateConfigRef.current = mutateAppConfig
  const modeSelected = appConfig?.modeSelected === true
  const simple = appConfig?.operationMode === 'simple'
  const disableAnimations = appConfig?.disableAnimations === true
  const hasFinished = Boolean(appConfig?.dexOnboarding)
  const [requested, setRequested] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [saving, setSaving] = useState(false)
  const resumeRef = useRef<() => void>(() => {})
  const finishRef = useRef<(status: 'completed' | 'skipped') => Promise<void>>(async () => {})

  useEffect(() => {
    const open = (): void => setRequested(true)
    window.addEventListener('dex-open-guide', open)
    return () => window.removeEventListener('dex-open-guide', open)
  }, [])

  useEffect(() => {
    if (modeSelected && !hasFinished && !blocked) setRequested(true)
  }, [modeSelected, hasFinished, blocked])

  useEffect(() => {
    if (!requested || !modeSelected || blocked) return
    const definitions = guideSteps(simple)
    let active = true
    let changing = false
    let writing = false
    let currentIndex = 0

    const showStep = async (index: number): Promise<void> => {
      if (!active || changing || writing) return
      changing = true
      currentIndex = Math.max(0, Math.min(definitions.length - 1, index))
      const step = definitions[currentIndex]
      if (step.route) navigateRef.current(step.route)
      await waitForGuideSurface(step.selector)
      if (active) guide.drive(currentIndex)
      changing = false
    }

    const finish = async (status: 'completed' | 'skipped'): Promise<void> => {
      if (writing || !active) return
      writing = true
      setSaving(true)
      try {
        await saveAppConfig({
          dexOnboarding: { version: 1, status, completedAt: new Date().toISOString() }
        })
        mutateConfigRef.current()
        guide.destroy()
        setConfirmClose(false)
        setRequested(false)
        if (status === 'completed') navigateRef.current(simple ? '/simple' : '/profiles')
      } catch (error) {
        toast.error(String(error), '无法保存引导进度，请重试')
      } finally {
        writing = false
        setSaving(false)
      }
    }
    finishRef.current = finish
    resumeRef.current = () => {
      setConfirmClose(false)
      void showStep(currentIndex)
    }

    const steps: DriveStep[] = definitions.map((step) => ({
      ...(step.selector ? { element: step.selector } : {}),
      popover: {
        title: step.title,
        description: step.description,
        side: step.side || 'bottom',
        align: 'center'
      }
    }))
    const guide = driver({
      steps,
      animate: !disableAnimations,
      duration: 180,
      overlayColor: '#15272e',
      overlayOpacity: 0.42,
      stagePadding: 6,
      stageRadius: 12,
      disableActiveInteraction: true,
      overlayClickBehavior: 'none',
      popoverClass: 'dex-guide-popover',
      showProgress: true,
      progressText: '{{current}} / {{total}}',
      nextBtnText: '下一步',
      prevBtnText: '上一步',
      doneBtnText: '开始使用',
      closeBtnLabel: '关闭使用引导',
      onNextClick: () => {
        if (currentIndex === definitions.length - 1) void finish('completed')
        else void showStep(currentIndex + 1)
      },
      onPrevClick: () => void showStep(currentIndex - 1),
      onDestroyStarted: () => {
        if (writing || changing) return
        // Tear down the driver before opening a React dialog so its pointer and
        // focus lock cannot make the close confirmation inaccessible.
        guide.destroy()
        setConfirmClose(true)
      }
    })
    void showStep(0)
    return () => {
      active = false
      guide.destroy()
    }
  }, [requested, modeSelected, blocked, simple, disableAnimations])

  if (!confirmClose) return null
  return (
    <Modal
      isOpen
      onClose={() => resumeRef.current()}
      hideCloseButton={saving}
      isDismissable={!saving}
      isKeyboardDismissDisabled={saving}
      size="md"
      classNames={{ base: 'dex-setup-modal' }}
    >
      <ModalContent>
        <ModalHeader className="px-6 pt-6">暂时结束使用引导？</ModalHeader>
        <ModalBody className="px-6 text-small leading-relaxed text-default-600">
          <p>了解代理模式、直连例外与 TUN 的作用，有助于避免连接异常或流量未按预期分流。</p>
          <p>你可以稍后在设置或功能说明中重新查看。结束引导不会修改当前网络设置。</p>
        </ModalBody>
        <ModalFooter className="px-6 pb-6">
          <Button
            variant="light"
            isDisabled={saving}
            isLoading={saving}
            onPress={() => void finishRef.current('skipped')}
          >
            稍后学习
          </Button>
          <Button color="primary" isDisabled={saving} onPress={() => resumeRef.current()}>
            继续了解
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
