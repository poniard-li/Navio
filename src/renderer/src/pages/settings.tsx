import { Button, Tabs, Tab } from '@heroui/react'
import BasePage from '@renderer/components/base/base-page'
import WebdavConfig from '@renderer/components/settings/webdav-config'
import GeneralConfig from '@renderer/components/settings/general-config'
import MihomoConfig from '@renderer/components/settings/mihomo-config'
import Actions from '@renderer/components/settings/actions'
import ShortcutConfig from '@renderer/components/settings/shortcut-config'
import SiderConfig from '@renderer/components/settings/sider-config'
import SubStoreConfig from '@renderer/components/settings/substore-config'
import LocalBackupConfig from '@renderer/components/settings/local-backup-config'
import { useTranslation } from 'react-i18next'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { useNavigate } from 'react-router-dom'
import { version } from '@renderer/utils/init'
import AccountConfig from '@renderer/components/settings/account-config'
import NavioToolsConfig from '@renderer/components/settings/navio-tools-config'
import CfwMigration from '@renderer/components/settings/cfw-migration'
import { PRODUCT_NAME, DEVELOPER_NAME, formatProductVersion } from '../../../shared/product'

const Settings: React.FC = () => {
  const { t } = useTranslation()
  const { appConfig, patchAppConfig } = useAppConfig()
  const navigate = useNavigate()

  return (
    <BasePage
      title={t('settings.title')}
      header={
        <>
          <span className="text-xs text-default-500 app-nodrag">Built by {DEVELOPER_NAME}</span>
        </>
      }
    >
      <div className="px-5 pt-5 pb-2">
        <h2 className="text-xl font-semibold tracking-tight">让工具适合你的习惯。</h2>
        <p className="text-small text-default-500 mt-2">外观、系统行为、快捷键与数据，按需设置。</p>
      </div>
      <Tabs
        aria-label="设置分类"
        variant="underlined"
        classNames={{ base: 'px-3 sticky top-0 z-10 bg-background', panel: 'pt-1' }}
      >
        <Tab key="general" title="通用">
          <div className="m-3 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-default-200 p-5">
            <div>
              <h3 className="font-medium">使用指南</h3>
              <p className="mt-1 text-small text-default-500">
                回顾操作步骤，了解高级功能和网络信息的含义。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="flat"
                onPress={() => window.dispatchEvent(new Event('dex-open-guide'))}
              >
                重新查看引导
              </Button>
              <Button variant="light" onPress={() => navigate('/help')}>
                功能说明
              </Button>
            </div>
          </div>
          <GeneralConfig />
        </Tab>
        <Tab key="appearance" title="界面">
          <div className="m-3 rounded-xl border border-default-200 p-5 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="font-medium">主题工坊</h3>
                <p className="text-small text-default-500 mt-1">创建、导入和分享你的主题设计。</p>
              </div>
              <Button onPress={() => navigate('/dex-themes')}>打开主题工坊</Button>
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-default-200 pt-4">
              <div>
                <h3 className="font-medium">导航布局</h3>
                <p className="text-small text-default-500 mt-1">
                  工作台便于快速定位；卡片布局支持原有大小、显隐与排序。
                </p>
              </div>
              <Tabs
                aria-label="导航布局"
                size="sm"
                selectedKey={appConfig?.dexNavigation || 'studio'}
                onSelectionChange={(key) => {
                  void patchAppConfig({ dexNavigation: key as 'studio' | 'classic' })
                }}
              >
                <Tab key="studio" title="工作台" />
                <Tab key="classic" title="卡片" />
              </Tabs>
            </div>
          </div>
          {appConfig?.dexNavigation === 'classic' && <SiderConfig />}
        </Tab>
        <Tab key="shortcuts" title="快捷键">
          <ShortcutConfig />
        </Tab>
        <Tab key="data" title="数据">
          <SubStoreConfig />
          <LocalBackupConfig />
          <WebdavConfig />
        </Tab>
        <Tab key="account" title="账号">
          <AccountConfig />
        </Tab>
        <Tab key="advanced" title="高级">
          <CfwMigration />
          <NavioToolsConfig />
          <MihomoConfig />
        </Tab>
        <Tab key="about" title="关于">
          <div className="m-3 rounded-xl border border-default-200 px-6 py-12 text-center">
            <h3 className="text-4xl tracking-tight font-semibold">{PRODUCT_NAME}</h3>
            <p className="text-sm text-default-500 mt-4">{formatProductVersion(version)}</p>
            <p className="text-xs text-default-500 mt-3">Built by {DEVELOPER_NAME}</p>
            <Button variant="light" className="mt-7" onPress={() => navigate('/credits')}>
              鸣谢与开源许可 →
            </Button>
          </div>
          <Actions />
        </Tab>
      </Tabs>
    </BasePage>
  )
}

export default Settings
