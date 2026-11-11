import { Button } from '@heroui/react'
import BasePage from '@renderer/components/base/base-page'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import {
  ensureSubStoreServices,
  subStoreFrontendPort,
  subStorePort,
  startSubStoreFrontendServer,
  startSubStoreBackendServer,
  stopSubStoreFrontendServer,
  stopSubStoreBackendServer,
  downloadSubStore
} from '@renderer/utils/ipc'
import React, { useEffect, useState } from 'react'
import { HiExternalLink } from 'react-icons/hi'
import { useTranslation } from 'react-i18next'
import { IoMdCloudDownload } from 'react-icons/io'
import { FeatureIntro } from '@renderer/components/dex/feature-help'

const SubStore: React.FC = () => {
  const { t } = useTranslation()
  const { appConfig } = useAppConfig()
  const { useCustomSubStore, customSubStoreUrl } = appConfig || {}
  const [backendPort, setBackendPort] = useState<number | undefined>()
  const [frontendPort, setFrontendPort] = useState<number | undefined>()
  const [isUpdating, setIsUpdating] = useState(false)
  const getPort = async (ensureStarted = true): Promise<void> => {
    if (ensureStarted) {
      const ports = await ensureSubStoreServices()
      setBackendPort(ports.backendPort)
      setFrontendPort(ports.frontendPort)
      return
    }
    setBackendPort(await subStorePort())
    setFrontendPort(await subStoreFrontendPort())
  }
  useEffect(() => {
    void getPort().catch((error) => {
      new Notification(`${t('substore.updateFailed')}: ${error}`)
    })
  }, [t, useCustomSubStore])

  if ((!useCustomSubStore && !backendPort) || !frontendPort) {
    return (
      <BasePage title={t('substore.title')}>
        <FeatureIntro topic="substore" />
        <p className="m-4 text-sm text-foreground/60">
          服务尚未就绪。可在「设置 → 数据 →
          Sub-Store」中检查是否启用；普通订阅可以直接在「订阅」页导入。
        </p>
      </BasePage>
    )
  }
  return (
    <>
      <BasePage
        title={t('substore.title')}
        header={
          <div className="flex gap-2">
            <Button
              title={t('substore.checkUpdate')}
              isIconOnly
              size="sm"
              className="app-nodrag"
              variant="light"
              isLoading={isUpdating}
              onPress={async () => {
                try {
                  new Notification(t('substore.updating'))
                  setIsUpdating(true)
                  await downloadSubStore()
                  await stopSubStoreBackendServer()
                  await startSubStoreBackendServer()
                  await new Promise((resolve) => setTimeout(resolve, 1000))
                  setFrontendPort(0)
                  await stopSubStoreFrontendServer()
                  await startSubStoreFrontendServer()
                  await getPort(false)
                  new Notification(t('substore.updateCompleted'))
                } catch (e) {
                  new Notification(`${t('substore.updateFailed')}: ${e}`)
                } finally {
                  setIsUpdating(false)
                }
              }}
            >
              <IoMdCloudDownload className="text-lg" />
            </Button>

            <Button
              title={t('substore.openInBrowser')}
              isIconOnly
              size="sm"
              className="app-nodrag"
              variant="light"
              onPress={() => {
                open(
                  `http://127.0.0.1:${frontendPort}?api=${useCustomSubStore ? customSubStoreUrl : `http://127.0.0.1:${backendPort}`}`
                )
              }}
            >
              <HiExternalLink className="text-lg" />
            </Button>
          </div>
        }
      >
        <FeatureIntro topic="substore" />
        <iframe
          title="Sub-Store 订阅管理"
          className="w-full h-[calc(100%-100px)] min-h-72"
          allow="clipboard-write; clipboard-read"
          src={`http://127.0.0.1:${frontendPort}?api=${useCustomSubStore ? customSubStoreUrl : `http://127.0.0.1:${backendPort}`}`}
        />
      </BasePage>
    </>
  )
}

export default SubStore
