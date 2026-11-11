import React, { useEffect, useState } from 'react'
import { toast } from '@renderer/components/base/toast'
import {
  Button,
  Input,
  Switch,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader
} from '@heroui/react'
import {
  exportLocalBackup,
  importLocalBackup,
  restartCore,
  hasBackupPassword,
  setBackupPassword
} from '@renderer/utils/ipc'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { useTranslation } from 'react-i18next'
import SettingItem from '../base/base-setting-item'
import SettingCard from '../base/base-setting-card'
import BaseConfirmModal from '../base/base-confirm-modal'

const LocalBackupConfig: React.FC = () => {
  const { t } = useTranslation()
  const { appConfig, patchAppConfig } = useAppConfig()
  const [dialog, setDialog] = useState<'password' | 'import' | null>(null)
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [passwordSet, setPasswordSet] = useState(false)
  const [plaintext, setPlaintext] = useState(false)
  useEffect(() => {
    void hasBackupPassword()
      .then(setPasswordSet)
      .catch(() => {})
  }, [])
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)

  const handleExport = async (): Promise<void> => {
    if (appConfig?.backupEncrypted !== false && !passwordSet) {
      setDialog('password')
      return
    }
    setExporting(true)
    try {
      const success = await exportLocalBackup()
      if (success) {
        new window.Notification(t('localBackup.notification.exportSuccess.title'), {
          body: t('localBackup.notification.exportSuccess.body')
        })
      }
    } catch (e) {
      toast.error(String(e))
    } finally {
      setExporting(false)
    }
  }

  const handleImport = async (): Promise<void> => {
    setImporting(true)
    try {
      const success = await importLocalBackup(password || undefined)
      if (success) {
        setDialog(null)
        setPassword('')
        window.electron.ipcRenderer.send('updateAppConfig')
        window.electron.ipcRenderer.send('updateTrayMenu')
        window.electron.ipcRenderer.send('appConfigUpdated')
        window.electron.ipcRenderer.send('controledMihomoConfigUpdated')
        window.electron.ipcRenderer.send('profileConfigUpdated')

        try {
          await restartCore()
        } catch (error) {
          console.error('Failed to restart core after import:', error)
          toast.error(t('common.error.restartCoreFailed', { error: error }))
        }

        new window.Notification(t('localBackup.notification.importSuccess.title'), {
          body: t('localBackup.notification.importSuccess.body')
        })
      }
    } catch (e) {
      toast.error(t('common.error.importFailed', { error: e }))
    } finally {
      setImporting(false)
    }
  }

  return (
    <>
      <BaseConfirmModal
        isOpen={plaintext}
        onCancel={() => setPlaintext(false)}
        onConfirm={() => {
          void patchAppConfig({ backupEncrypted: false })
          setPlaintext(false)
        }}
        title="改为不加密备份？"
        content="明文备份可能包含订阅链接、节点凭据和本地配置。能够读取备份文件的人可能使用其中的信息。此选择也适用于你主动启用的 WebDAV 备份。"
      />
      <Modal
        isOpen={dialog !== null}
        onClose={() => {
          if (!importing) {
            setDialog(null)
            setPassword('')
            setRepeat('')
          }
        }}
      >
        <ModalContent>
          <ModalHeader>{dialog === 'password' ? '设置独立备份密码' : '恢复本地备份'}</ModalHeader>
          <ModalBody>
            <p className="text-xs text-default-500 leading-6">
              {dialog === 'password'
                ? '请妥善保存备份密码。它独立于 D.E.X 登录密码，遗忘后无法解密已有备份。密码更改不会重新加密已有文件。'
                : '恢复会替换本机配置。加密备份请填写创建时的密码；明文或旧版备份可留空。'}
            </p>
            <Input
              autoComplete="new-password"
              type="password"
              label="备份密码"
              value={password}
              onValueChange={setPassword}
            />
            {dialog === 'password' && (
              <Input
                autoComplete="new-password"
                type="password"
                label="再次输入"
                value={repeat}
                onValueChange={setRepeat}
              />
            )}
          </ModalBody>
          <ModalFooter>
            <Button
              variant="light"
              isDisabled={importing}
              onPress={() => {
                setDialog(null)
                setPassword('')
                setRepeat('')
              }}
            >
              取消
            </Button>
            <Button
              color="primary"
              isLoading={importing}
              isDisabled={dialog === 'password' && (password.length < 12 || password !== repeat)}
              onPress={async () => {
                if (dialog === 'import') {
                  await handleImport()
                  return
                }
                try {
                  await setBackupPassword(password)
                  await patchAppConfig({ backupEncrypted: true })
                  setPasswordSet(true)
                  setPassword('')
                  setRepeat('')
                  setDialog(null)
                  toast.success('备份密码已设置')
                } catch (err) {
                  toast.error(String(err))
                }
              }}
            >
              {dialog === 'password' ? '保存密码（至少 12 位）' : '选择备份并恢复'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      <SettingCard title={t('localBackup.title')}>
        <SettingItem title="加密本地与 WebDAV 备份" divider>
          <Switch
            size="sm"
            aria-label="加密备份"
            isSelected={appConfig?.backupEncrypted !== false}
            onValueChange={(value) => {
              if (!value) setPlaintext(true)
              else void patchAppConfig({ backupEncrypted: true })
            }}
          />
        </SettingItem>
        <SettingItem title={passwordSet ? '独立备份密码已设置' : '尚未设置独立备份密码'} divider>
          <Button size="sm" onPress={() => setDialog('password')}>
            {passwordSet ? '更改密码' : '设置密码'}
          </Button>
        </SettingItem>
        <SettingItem title={t('localBackup.export.title')} divider>
          <Button isLoading={exporting} size="sm" onPress={handleExport}>
            {t('localBackup.export.button')}
          </Button>
        </SettingItem>
        <SettingItem title={t('localBackup.import.title')}>
          <Button isLoading={importing} size="sm" onPress={() => setDialog('import')}>
            {t('localBackup.import.button')}
          </Button>
        </SettingItem>
      </SettingCard>
    </>
  )
}

export default LocalBackupConfig
