import { Button, Input, Switch, Tab, Tabs } from '@heroui/react'
import { toast } from '@renderer/components/base/toast'
import SettingCard from '@renderer/components/base/base-setting-card'
import SettingItem from '@renderer/components/base/base-setting-item'
import { useControledMihomoConfig } from '@renderer/hooks/use-controled-mihomo-config'
import { mihomoUpgradeGeo } from '@renderer/utils/ipc'
import { useState } from 'react'
import { IoMdRefresh } from 'react-icons/io'
import { useTranslation } from 'react-i18next'
import { HelpTip } from '@renderer/components/dex/feature-help'

const GeoData: React.FC = () => {
  const { t } = useTranslation()
  const { controledMihomoConfig, patchControledMihomoConfig } = useControledMihomoConfig()
  const {
    'geox-url': geoxUrl = {
      geoip: 'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip-lite.dat',
      geosite: 'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geosite.dat',
      mmdb: 'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip.metadb',
      asn: 'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/GeoLite2-ASN.mmdb'
    },
    'geodata-mode': geoMode = false,
    'geo-auto-update': geoAutoUpdate = false,
    'geo-update-interval': geoUpdateInterval = 24
  } = controledMihomoConfig || {}
  const [geoipInput, setGeoIpInput] = useState(geoxUrl.geoip)
  const [geositeInput, setGeositeInput] = useState(geoxUrl.geosite)
  const [mmdbInput, setMmdbInput] = useState(geoxUrl.mmdb)
  const [asnInput, setAsnInput] = useState(geoxUrl.asn)
  const [updating, setUpdating] = useState(false)

  return (
    <SettingCard>
      <SettingItem
        title={
          <>
            {t('resources.geoData.geoip')}
            <HelpTip
              title="GeoIP 规则数据库"
              content="把 IP 地址归入国家、地区或服务分类，供分流规则使用。它是下载到本机的规则资料，不是读取你的 GPS 定位；分类可能不准确。"
            />
          </>
        }
        divider
      >
        <div className="flex w-[70%]">
          {geoipInput !== geoxUrl.geoip && (
            <Button
              size="sm"
              color="primary"
              className="mr-2"
              onPress={() => {
                patchControledMihomoConfig({ 'geox-url': { ...geoxUrl, geoip: geoipInput } })
              }}
            >
              {t('common.confirm')}
            </Button>
          )}
          <Input size="sm" value={geoipInput} onValueChange={setGeoIpInput} />
        </div>
      </SettingItem>
      <SettingItem
        title={
          <>
            {t('resources.geoData.geosite')}
            <HelpTip
              title="GeoSite 域名数据库"
              content="把网站域名整理成可供规则引用的分类，例如某个服务的一组域名。更新来源会影响规则覆盖范围；它本身不会创建代理节点。"
            />
          </>
        }
        divider
      >
        <div className="flex w-[70%]">
          {geositeInput !== geoxUrl.geosite && (
            <Button
              size="sm"
              color="primary"
              className="mr-2"
              onPress={() => {
                patchControledMihomoConfig({ 'geox-url': { ...geoxUrl, geosite: geositeInput } })
              }}
            >
              {t('common.confirm')}
            </Button>
          )}
          <Input size="sm" value={geositeInput} onValueChange={setGeositeInput} />
        </div>
      </SettingItem>
      <SettingItem
        title={
          <>
            {t('resources.geoData.mmdb')}
            <HelpTip
              title="MMDB 数据库"
              content="另一种 IP 归属数据库格式，供内核查询网络分类。通常只在所选配置或规则需要时使用，保持默认来源即可。"
            />
          </>
        }
        divider
      >
        <div className="flex w-[70%]">
          {mmdbInput !== geoxUrl.mmdb && (
            <Button
              size="sm"
              color="primary"
              className="mr-2"
              onPress={() => {
                patchControledMihomoConfig({ 'geox-url': { ...geoxUrl, mmdb: mmdbInput } })
              }}
            >
              {t('common.confirm')}
            </Button>
          )}
          <Input size="sm" value={mmdbInput} onValueChange={setMmdbInput} />
        </div>
      </SettingItem>
      <SettingItem title={t('resources.geoData.asn')} divider>
        <div className="flex w-[70%]">
          {asnInput !== geoxUrl.asn && (
            <Button
              size="sm"
              color="primary"
              className="mr-2"
              onPress={() => {
                patchControledMihomoConfig({ 'geox-url': { ...geoxUrl, asn: asnInput } })
              }}
            >
              {t('common.confirm')}
            </Button>
          )}
          <Input size="sm" value={asnInput} onValueChange={setAsnInput} />
        </div>
      </SettingItem>
      <SettingItem title={t('resources.geoData.mode')} divider>
        <Tabs
          size="sm"
          color="primary"
          selectedKey={geoMode ? 'dat' : 'db'}
          onSelectionChange={(key) => {
            patchControledMihomoConfig({ 'geodata-mode': key === 'dat' })
          }}
        >
          <Tab key="db" title="db" />
          <Tab key="dat" title="dat" />
        </Tabs>
      </SettingItem>
      <SettingItem
        title={t('resources.geoData.autoUpdate')}
        actions={
          <Button
            size="sm"
            isIconOnly
            variant="light"
            onPress={async () => {
              setUpdating(true)
              try {
                await mihomoUpgradeGeo()
                new Notification(t('resources.geoData.updateSuccess'))
              } catch (e) {
                toast.error(String(e))
              } finally {
                setUpdating(false)
              }
            }}
          >
            <IoMdRefresh className={`text-lg ${updating ? 'animate-spin' : ''}`} />
          </Button>
        }
        divider={geoAutoUpdate}
      >
        <Switch
          size="sm"
          isSelected={geoAutoUpdate}
          onValueChange={(v) => {
            patchControledMihomoConfig({ 'geo-auto-update': v })
          }}
        />
      </SettingItem>
      {geoAutoUpdate && (
        <SettingItem title={t('resources.geoData.updateInterval')}>
          <Input
            size="sm"
            type="number"
            className="w-25"
            value={(geoUpdateInterval ?? 24).toString()}
            onValueChange={(v) => {
              const nextInterval = parseInt(v)
              if (Number.isNaN(nextInterval)) return
              patchControledMihomoConfig({ 'geo-update-interval': nextInterval })
            }}
          />
        </SettingItem>
      )}
    </SettingCard>
  )
}

export default GeoData
