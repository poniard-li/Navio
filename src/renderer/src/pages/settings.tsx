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

const Settings: React.FC = () => {
  const { t } = useTranslation()
  const { appConfig, patchAppConfig } = useAppConfig()
  const navigate = useNavigate()

  return (
    <BasePage
      title={t('settings.title')}
      header={
        <>
          <span className="text-xs text-default-500 app-nodrag">D.E.X STUDIO</span>
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
          <GeneralConfig />
        </Tab>
        <Tab key="appearance" title="界面">
          <div className="m-3 rounded-xl border border-default-200 p-5 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="font-medium">主题工坊</h3>
                <p className="text-small text-default-500 mt-1">创建、导入和分享 D.E.X 主题。</p>
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
        <Tab key="advanced" title="高级">
          <MihomoConfig />
        </Tab>
        <Tab key="about" title="关于">
          <div className="m-3 rounded-xl border border-default-200 p-5">
            <h3 className="text-lg font-semibold">
              D.E.X <span className="font-normal text-default-500">STUDIO</span>
            </h3>
            <p className="text-small text-default-500 mt-2 leading-relaxed">
              D.E.X 的产品设计与主题工坊，结合 Clash Party 的完整客户端功能与 Mihomo 内核。此版本为
              0.3 功能重建预览版。
            </p>
            <div className="flex flex-wrap gap-2 mt-4">
              <Button
                size="sm"
                variant="flat"
                onPress={() => window.open('https://github.com/mihomo-party-org/clash-party')}
              >
                客户端上游
              </Button>
              <Button
                size="sm"
                variant="flat"
                onPress={() => window.open('https://wiki.metacubex.one/')}
              >
                Mihomo 文档
              </Button>
              <Button
                size="sm"
                variant="flat"
                onPress={() => window.open('https://www.gnu.org/licenses/gpl-3.0.html')}
              >
                GPL-3.0 许可
              </Button>
            </div>
          </div>
          <Actions />
        </Tab>
      </Tabs>
    </BasePage>
  )
}

export default Settings
