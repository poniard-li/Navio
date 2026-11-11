import {
  cn,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Input,
  Switch,
  Select,
  SelectItem,
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
  Textarea,
  Tooltip
} from '@heroui/react'
import { toast } from '@renderer/components/base/toast'
import React, { useState } from 'react'
import { useOverrideConfig } from '@renderer/hooks/use-override-config'
import {
  mihomoHotReloadConfig,
  addProfileUpdater,
  getFilePath,
  readTextFile
} from '@renderer/utils/ipc'
import { MdDeleteForever, MdInfoOutline } from 'react-icons/md'
import { FaPlus } from 'react-icons/fa6'
import { useTranslation } from 'react-i18next'
import { isValidCron } from 'cron-validator'
import SettingItem from '../base/base-setting-item'

interface Props {
  item: IProfileItem
  mode?: 'edit' | 'import'
  updateProfileItem?: (item: IProfileItem) => Promise<void>
  addProfileItem?: (item: Partial<IProfileItem>) => Promise<void>
  onClose: () => void
}
const EditInfoModal: React.FC<Props> = (props) => {
  const { item, mode = 'edit', updateProfileItem, addProfileItem, onClose } = props
  const [saving, setSaving] = useState(false)
  const { overrideConfig } = useOverrideConfig()
  const { items: overrideItems = [] } = overrideConfig || {}
  const [values, setValues] = useState({
    ...item
  })
  const inputWidth = 'w-[65%] min-w-0'
  const { t } = useTranslation()
  const isImportMode = mode === 'import'
  const [headersText, setHeadersText] = useState(
    Object.entries(item.headers || {})
      .map(([key, value]) => key + ': ' + value)
      .join('\n')
  )
  const canSave =
    !isImportMode || (values.type === 'remote' ? Boolean(values.url?.trim()) : values.file != null)

  const onSave = async (): Promise<void> => {
    setSaving(true)
    try {
      const headers: Record<string, string> = {}
      for (const line of headersText.split('\n')) {
        if (!line.trim()) continue
        const colon = line.indexOf(':')
        const name = line.slice(0, colon).trim()
        const value = line.slice(colon + 1).trim()
        if (colon < 1 || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[\r\n]/.test(value))
          throw new Error('请求头需使用“名称: 值”格式，每行一项')
        if (['user-agent', 'authorization'].includes(name.toLowerCase()))
          throw new Error('User-Agent 和 Authorization 请使用上方专用设置')
        if (Object.keys(headers).some((key) => key.toLowerCase() === name.toLowerCase()))
          throw new Error('请求头名称不能重复')
        headers[name] = value
      }
      const updatedItem = {
        ...values,
        headers,
        override: values.override?.filter((id) =>
          overrideItems.some((entry) => entry.id === id && !entry.global)
        )
      }
      if (isImportMode) {
        if (!addProfileItem) throw new Error('Missing profile import handler')
        await addProfileItem(updatedItem)
      } else {
        if (!updateProfileItem) throw new Error('Missing profile update handler')
        await updateProfileItem(updatedItem)
        await addProfileUpdater(updatedItem)
        await mihomoHotReloadConfig()
      }
      onClose()
    } catch (e) {
      toast.error(String(e))
    } finally {
      setSaving(false)
    }
  }

  const selectLocalFile = async (): Promise<void> => {
    const files = await getFilePath(['yml', 'yaml'])
    if (!files?.length) return

    const file = await readTextFile(files[0])
    const fileName = files[0].split('/').pop()?.split('\\').pop()
    setValues({
      ...values,
      type: 'local',
      file,
      name: values.name || fileName || values.name
    })
  }

  const subscriptionFields = (
    <>
      {isImportMode && (
        <SettingItem title={t('profiles.editInfo.type')}>
          <Select
            classNames={{ trigger: 'data-[hover=true]:bg-default-200' }}
            size="sm"
            className={cn(inputWidth)}
            selectedKeys={new Set([values.type])}
            disallowEmptySelection={true}
            onSelectionChange={(v) => {
              setValues({
                ...values,
                type: v.currentKey as 'remote' | 'local'
              })
            }}
          >
            <SelectItem key="remote">{t('profiles.remote')}</SelectItem>
            <SelectItem key="local">{t('profiles.local')}</SelectItem>
          </Select>
        </SettingItem>
      )}
      <SettingItem title={t('profiles.editInfo.name')}>
        <Input
          size="sm"
          className={cn(inputWidth)}
          value={values.name}
          onValueChange={(v) => {
            setValues({ ...values, name: v })
          }}
        />
      </SettingItem>
      <SettingItem title={t('profiles.editInfo.ageSecretKey')}>
        <Input
          size="sm"
          type="password"
          className={cn(inputWidth)}
          value={values.ageSecretKey || ''}
          onValueChange={(v) => {
            setValues({ ...values, ageSecretKey: v || undefined })
          }}
          placeholder={t('profiles.editInfo.ageSecretKeyPlaceholder')}
        />
      </SettingItem>
      {isImportMode && values.type === 'local' && (
        <SettingItem title={t('profiles.editInfo.file')}>
          <div className={cn(inputWidth, 'flex justify-end')}>
            <Button size="sm" variant={values.file ? 'flat' : 'solid'} onPress={selectLocalFile}>
              {values.file
                ? values.name || t('profiles.editInfo.selectFile')
                : t('profiles.editInfo.selectFile')}
            </Button>
          </div>
        </SettingItem>
      )}
      {values.type === 'remote' && (
        <>
          <SettingItem title={t('profiles.editInfo.url')}>
            <Input
              size="sm"
              className={cn(inputWidth)}
              value={values.url}
              onValueChange={(v) => {
                setValues({ ...values, url: v })
              }}
            />
          </SettingItem>
          <SettingItem title={t('profiles.editInfo.authToken')}>
            <Input
              size="sm"
              type="password"
              className={cn(inputWidth)}
              value={values.authToken || ''}
              onValueChange={(v) => {
                setValues({ ...values, authToken: v })
              }}
              placeholder={t('profiles.editInfo.authTokenPlaceholder')}
            />
          </SettingItem>
          <SettingItem title={t('profiles.editInfo.userAgent')}>
            <Input
              size="sm"
              className={cn(inputWidth)}
              value={values.userAgent || ''}
              onValueChange={(v) => {
                setValues({ ...values, userAgent: v || undefined })
              }}
              placeholder={t('profiles.editInfo.userAgentPlaceholder')}
            />
          </SettingItem>
          <SettingItem title={t('profiles.editInfo.useProxy')}>
            <Switch
              size="sm"
              isSelected={values.useProxy ?? false}
              onValueChange={(v) => {
                setValues({ ...values, useProxy: v })
              }}
            />
          </SettingItem>
          <SettingItem title={t('profiles.editInfo.autoUpdate')}>
            <Switch
              size="sm"
              isSelected={values.autoUpdate ?? false}
              onValueChange={(v) => {
                setValues({ ...values, autoUpdate: v })
              }}
            />
          </SettingItem>
          {values.autoUpdate && (
            <>
              <SettingItem
                title={t('profiles.editInfo.interval')}
                actions={
                  <Tooltip
                    content={
                      typeof values.interval === 'number' ||
                      /^\d+$/.test(values.interval?.toString() || '')
                        ? t('profiles.editInfo.intervalMinutes')
                        : isValidCron(values.interval?.toString() || '', { seconds: false })
                          ? t('profiles.editInfo.intervalCron')
                          : t('profiles.editInfo.intervalHint')
                    }
                  >
                    <button
                      type="button"
                      aria-label={t('profiles.editInfo.intervalHint')}
                      className="ml-1.5 flex h-8 items-center text-foreground-500"
                    >
                      <MdInfoOutline className="text-sm" />
                    </button>
                  </Tooltip>
                }
              >
                <Input
                  size="sm"
                  type="text"
                  className={cn(
                    inputWidth,
                    // 不合法
                    typeof values.interval === 'string' &&
                      !/^\d+$/.test(values.interval) &&
                      !isValidCron(values.interval, { seconds: false }) &&
                      'border-red-500'
                  )}
                  value={values.interval?.toString() ?? ''}
                  onValueChange={(v) => {
                    // 输入限制
                    if (/^[\d\s*\-,/]*$/.test(v)) {
                      // 纯数字
                      if (/^\d+$/.test(v)) {
                        setValues({ ...values, interval: parseInt(v, 10) || 0 })
                        return
                      }
                      // 非纯数字
                      try {
                        setValues({ ...values, interval: v })
                      } catch {
                        // ignore
                      }
                    }
                  }}
                  placeholder={t('profiles.editInfo.intervalPlaceholder')}
                />
              </SettingItem>
              <SettingItem title={t('profiles.editInfo.fixedInterval')}>
                <Switch
                  size="sm"
                  isSelected={values.allowFixedInterval ?? false}
                  onValueChange={(v) => {
                    setValues({ ...values, allowFixedInterval: v })
                  }}
                />
              </SettingItem>
            </>
          )}
          <SettingItem title={t('profiles.editInfo.updateTimeout')}>
            <Input
              size="sm"
              type="text"
              className={cn(inputWidth)}
              value={values.updateTimeout?.toString() ?? ''}
              onValueChange={(v) => {
                if (v === '') {
                  setValues({ ...values, updateTimeout: undefined })
                  return
                }
                if (/^\d+$/.test(v)) {
                  setValues({ ...values, updateTimeout: parseInt(v, 10) })
                }
              }}
              placeholder={t('profiles.editInfo.updateTimeoutPlaceholder')}
            />
          </SettingItem>
        </>
      )}
      <SettingItem title={t('profiles.editInfo.override.title')}>
        <div>
          {overrideItems
            .filter((i) => i.global)
            .map((i) => {
              return (
                <div className="flex mb-2" key={i.id}>
                  <Button disabled fullWidth variant="flat" size="sm">
                    {i.name} ({t('profiles.editInfo.override.global')})
                  </Button>
                </div>
              )
            })}
          {values.override?.map((i) => {
            if (!overrideItems.find((t) => t.id === i)) return null
            if (overrideItems.find((t) => t.id === i)?.global) return null
            return (
              <div className="flex mb-2" key={i}>
                <Button disabled fullWidth variant="flat" size="sm">
                  {overrideItems.find((t) => t.id === i)?.name}
                </Button>
                <Button
                  color="warning"
                  variant="flat"
                  className="ml-2"
                  size="sm"
                  onPress={() => {
                    setValues({
                      ...values,
                      override: values.override?.filter((t) => t !== i)
                    })
                  }}
                >
                  <MdDeleteForever className="text-lg" />
                </Button>
              </div>
            )
          })}
          <Dropdown>
            <DropdownTrigger>
              <Button fullWidth size="sm" variant="flat" color="default">
                <FaPlus />
              </Button>
            </DropdownTrigger>
            <DropdownMenu
              emptyContent={t('profiles.editInfo.override.noAvailable')}
              onAction={(key) => {
                setValues({
                  ...values,
                  override: Array.from(values.override || []).concat(key.toString())
                })
              }}
            >
              {overrideItems
                .filter((i) => !values.override?.includes(i.id) && !i.global)
                .map((i) => (
                  <DropdownItem key={i.id}>{i.name}</DropdownItem>
                ))}
            </DropdownMenu>
          </Dropdown>
        </div>
      </SettingItem>
    </>
  )

  return (
    <Modal
      backdrop="blur"
      size="5xl"
      classNames={{
        backdrop: 'top-[48px]',
        base: 'w-[min(900px,calc(100vw-32px))] max-h-[calc(100dvh-80px)]'
      }}
      hideCloseButton
      isOpen={true}
      onOpenChange={onClose}
      scrollBehavior="inside"
    >
      <ModalContent>
        <ModalHeader className="flex app-drag">
          {isImportMode ? t('profiles.import') : t('profiles.editInfo.title')}
        </ModalHeader>
        <ModalBody>
          {subscriptionFields}
          {values.type === 'remote' && (
            <details className="border-t border-default-200 pt-4 pb-3">
              <summary className="cursor-pointer text-sm">高级 · 自定义请求头</summary>
              <p className="text-xs text-default-500 leading-6 my-3">
                用于订阅服务要求的额外 HTTP
                请求头。仅发送至该订阅地址；可能含凭据，请勿分享。User-Agent 和 Authorization
                使用上方专用设置。
              </p>
              <Textarea
                aria-label="自定义订阅请求头"
                placeholder={'X-Client: Navio\nX-Custom-Token: value'}
                minRows={3}
                value={headersText}
                onValueChange={setHeadersText}
              />
            </details>
          )}
        </ModalBody>
        <ModalFooter>
          <Button size="sm" variant="light" onPress={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            size="sm"
            color="primary"
            isDisabled={!canSave || saving}
            isLoading={saving}
            onPress={onSave}
          >
            {isImportMode ? t('profiles.import') : t('common.save')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default EditInfoModal
