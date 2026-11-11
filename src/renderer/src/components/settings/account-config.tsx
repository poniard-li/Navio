import { useCallback, useEffect, useState } from 'react'
import {
  Button,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader
} from '@heroui/react'
import {
  dexAccountAction,
  cancelDexOAuth,
  getDexAccount,
  logoutDexAccount,
  startDexOAuth,
  type DexAccount,
  type DexAccountSecurity,
  type DexOAuthRequest,
  type DexServiceStatus
} from '@renderer/utils/ipc'
import { toast } from '@renderer/components/base/toast'
import BaseConfirmModal from '../base/base-confirm-modal'
import { AccountCodeField } from '../dex/account-form'
import OAuthFlow from '../dex/oauth-flow'

export default function AccountConfig(): React.JSX.Element {
  const [account, setAccount] = useState<DexAccount>()
  const [security, setSecurity] = useState<DexAccountSecurity>()
  const [status, setStatus] = useState<DexServiceStatus>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<'profile' | 'password' | 'contact'>()
  const [displayName, setDisplayName] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [repeatPassword, setRepeatPassword] = useState('')
  const [contact, setContact] = useState('')
  const [code, setCode] = useState('')
  const [oauth, setOAuth] = useState<DexOAuthRequest>()
  const [confirm, setConfirm] = useState<{
    title: string
    content: string
    action: () => Promise<void>
  }>()
  const refresh = useCallback(async (): Promise<void> => {
    const result = await getDexAccount()
    setAccount(result)
    if (result.status === 'signed-out') {
      window.dispatchEvent(new Event('dex-account-updated'))
      return
    }
    if (result.status === 'online') {
      const [info, service] = await Promise.all([
        dexAccountAction<DexAccountSecurity>('security'),
        dexAccountAction<DexServiceStatus>('status')
      ])
      setSecurity(info)
      setStatus(service)
    }
  }, [])
  useEffect(() => {
    void refresh().catch((err) => setError(String(err)))
  }, [refresh])
  const online = account?.status === 'online'
  const open = (kind: typeof editing): void => {
    setEditing(kind)
    setDisplayName(account?.user?.displayName || account?.user?.username || '')
    setContact(kind === 'password' ? account?.user?.email || account?.user?.phone || '' : '')
    setCurrentPassword('')
    setNewPassword('')
    setRepeatPassword('')
    setCode('')
    setError('')
  }
  const revoke = (
    kind: 'revoke-device' | 'unlink-provider' | 'revoke-grant',
    target: string,
    title: string,
    content: string
  ): void =>
    setConfirm({
      title,
      content,
      action: async () => {
        await dexAccountAction(kind, { target })
        await refresh()
      }
    })
  const save = async (): Promise<void> => {
    if (editing === 'password' && newPassword !== repeatPassword) {
      setError('两次输入的新密码不一致。')
      return
    }
    setBusy(true)
    setError('')
    try {
      if (editing === 'profile') await dexAccountAction('profile', { displayName })
      if (editing === 'contact') await dexAccountAction('contact', { contact, code })
      if (editing === 'password')
        await dexAccountAction('password', { currentPassword, newPassword, contact, code })
      setEditing(undefined)
      setCurrentPassword('')
      setNewPassword('')
      setRepeatPassword('')
      setCode('')
      await refresh()
      toast.success('账号设置已保存')
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="m-3 rounded-xl border border-default-200 p-5 space-y-6">
      <div className="flex flex-wrap justify-between gap-4 items-center">
        <div>
          <h3 className="font-semibold">
            {account?.user?.displayName || account?.user?.username || 'D.E.X 账号'}
          </h3>
          <p className="text-xs text-default-500 mt-2">
            {account?.status === 'offline'
              ? '离线模式 · 本机功能可用，账号操作需要联网'
              : '统一账号 · Navio 应用授权'}
          </p>
        </div>
        <Button
          variant="flat"
          isLoading={busy}
          onPress={async () => {
            setBusy(true)
            setError('')
            try {
              await refresh()
            } catch (err) {
              setError(String(err))
            } finally {
              setBusy(false)
            }
          }}
        >
          刷新状态
        </Button>
      </div>
      <p className="text-sm text-default-500 leading-7">
        在这里管理账号资料、密码、联系方式、第三方绑定和登录设备。订阅与节点凭据保留在本机，账号登录不会上传或恢复这些数据。
      </p>
      {error && !editing && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <div className="grid sm:grid-cols-2 gap-4 text-sm">
        <div className="rounded-xl bg-default-100 p-4 space-y-3">
          <h4 className="font-medium">账号资料</h4>
          <p className="text-default-500 break-all">用户名：{account?.user?.username || '—'}</p>
          <p className="text-default-500 break-all">邮箱：{account?.user?.email || '未绑定'}</p>
          <p className="text-default-500 break-all">手机号：{account?.user?.phone || '未绑定'}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="flat"
              isDisabled={!online || busy}
              onPress={() => open('profile')}
            >
              修改昵称
            </Button>
            <Button
              size="sm"
              variant="flat"
              isDisabled={!online || busy}
              onPress={() => open('contact')}
            >
              绑定 / 更换联系方式
            </Button>
          </div>
        </div>
        <div className="rounded-xl bg-default-100 p-4 space-y-3">
          <h4 className="font-medium">密码与第三方登录</h4>
          <Button
            size="sm"
            variant="flat"
            isDisabled={!online || busy}
            onPress={() => open('password')}
          >
            {account?.user?.hasPassword === false ? '设置独立密码' : '修改密码'}
          </Button>
          {(['google', 'github'] as const).map((provider) => {
            const linked = security?.providers.some((item) => item.provider === provider)
            return (
              <div key={provider} className="flex justify-between items-center gap-3">
                <span>
                  {provider === 'google' ? 'Google' : 'GitHub'} · {linked ? '已绑定' : '未绑定'}
                </span>
                <Button
                  size="sm"
                  variant="light"
                  isDisabled={!online || busy || (!linked && !status?.providers[provider])}
                  onPress={async () => {
                    if (linked) {
                      revoke(
                        'unlink-provider',
                        provider,
                        `解除 ${provider} 绑定？`,
                        '解除后，这个第三方账号将无法登录当前 D.E.X 账号。你仍可使用已绑定的邮箱、手机号或密码登录。'
                      )
                      return
                    }
                    setBusy(true)
                    setError('')
                    try {
                      setOAuth(await startDexOAuth(provider, 'link'))
                    } catch (err) {
                      setError(String(err))
                    } finally {
                      setBusy(false)
                    }
                  }}
                >
                  {linked ? '解除绑定' : '绑定'}
                </Button>
              </div>
            )
          })}
        </div>
      </div>
      <div className="space-y-3">
        <h4 className="font-medium">登录设备</h4>
        {!security && <p className="text-sm text-default-500">联网后可查看登录设备。</p>}
        {security?.devices.map((device) => (
          <div
            key={device.id}
            className="flex flex-wrap justify-between items-center gap-3 border-b border-default-100 pb-3"
          >
            <div>
              <p className="text-sm">
                {device.label || 'D.E.X 设备'}
                {device.current ? ' · 当前设备' : ''}
              </p>
              <p className="text-xs text-default-500 mt-1">
                最近活动：{new Date(device.lastSeenAt).toLocaleString()}
              </p>
            </div>
            <Button
              size="sm"
              variant="light"
              isDisabled={!online || busy}
              onPress={() =>
                revoke(
                  'revoke-device',
                  device.id,
                  device.current ? '退出当前设备？' : '撤销这台设备的登录？',
                  '这台设备下次联网验证时需要重新登录。本机订阅和配置不会被删除。'
                )
              }
            >
              退出设备
            </Button>
          </div>
        ))}
      </div>
      <div className="space-y-3">
        <h4 className="font-medium">应用授权</h4>
        {security?.grants.map((grant) => (
          <div key={grant.appId} className="flex justify-between items-center gap-3">
            <span className="text-sm">{grant.appId === 'navio' ? 'Navio' : grant.appId}</span>
            <Button
              size="sm"
              variant="light"
              isDisabled={!online || busy}
              onPress={() =>
                revoke(
                  'revoke-grant',
                  grant.appId,
                  `撤销 ${grant.appId} 的应用授权？`,
                  '该应用的登录会话将失效，再次使用需要联网登录。该应用本机保存的配置不受影响。'
                )
              }
            >
              撤销授权
            </Button>
          </div>
        ))}
      </div>
      <Button
        size="sm"
        variant="light"
        onPress={() =>
          setConfirm({
            title: '退出 D.E.X 账号？',
            content: '本机订阅和配置仍会保留。退出后再次打开 Navio 需要联网登录，离线模式会停止。',
            action: async () => {
              await logoutDexAccount()
              window.dispatchEvent(new Event('dex-account-updated'))
            }
          })
        }
      >
        退出此设备账号
      </Button>
      {confirm && (
        <BaseConfirmModal
          isLoading={busy}
          isOpen
          title={confirm.title}
          content={confirm.content}
          onCancel={() => setConfirm(undefined)}
          onConfirm={async () => {
            setBusy(true)
            try {
              await confirm.action()
              setConfirm(undefined)
            } catch (err) {
              setError(String(err))
              setConfirm(undefined)
            } finally {
              setBusy(false)
            }
          }}
        />
      )}
      <Modal
        isOpen={!!editing}
        isDismissable={!busy}
        hideCloseButton={busy}
        onClose={() => {
          if (!busy) setEditing(undefined)
        }}
      >
        <ModalContent>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void save()
            }}
          >
            <ModalHeader>
              {editing === 'profile'
                ? '修改昵称'
                : editing === 'contact'
                  ? '绑定或更换联系方式'
                  : '设置账号密码'}
            </ModalHeader>
            <ModalBody>
              {editing === 'profile' && (
                <Input
                  label="显示昵称"
                  value={displayName}
                  onValueChange={setDisplayName}
                  maxLength={64}
                  isRequired
                  isDisabled={busy}
                />
              )}
              {editing === 'contact' && (
                <>
                  <p className="text-sm text-default-500">
                    验证新邮箱或手机号后，会替换原有的同类联系方式；另一种联系方式仍然保留。
                  </p>
                  <Input
                    label="新邮箱或手机号"
                    value={contact}
                    onValueChange={setContact}
                    autoComplete="email"
                    isRequired
                    isDisabled={busy}
                  />
                  <AccountCodeField
                    contact={contact}
                    purpose="bind"
                    code={code}
                    onCode={setCode}
                    disabled={busy}
                  />
                </>
              )}
              {editing === 'password' && (
                <>
                  {account?.user?.hasPassword === false ? (
                    <>
                      <p className="text-sm">首次设置密码需要验证已绑定的邮箱或手机号。</p>
                      <Input
                        label="已绑定的邮箱或手机号"
                        value={contact}
                        onValueChange={setContact}
                        isRequired
                        isDisabled={busy}
                      />
                      <AccountCodeField
                        contact={contact}
                        purpose="bind"
                        code={code}
                        onCode={setCode}
                        disabled={busy}
                      />
                    </>
                  ) : (
                    <Input
                      type="password"
                      label="当前密码"
                      value={currentPassword}
                      onValueChange={setCurrentPassword}
                      autoComplete="current-password"
                      maxLength={128}
                      isRequired
                      isDisabled={busy}
                    />
                  )}
                  <Input
                    type="password"
                    label="新密码"
                    description="10–128 个字符。保存后其他设备需要重新登录。"
                    value={newPassword}
                    onValueChange={setNewPassword}
                    autoComplete="new-password"
                    minLength={10}
                    maxLength={128}
                    isRequired
                    isDisabled={busy}
                  />
                  <Input
                    type="password"
                    label="再次输入新密码"
                    value={repeatPassword}
                    onValueChange={setRepeatPassword}
                    autoComplete="new-password"
                    minLength={10}
                    maxLength={128}
                    isRequired
                    isDisabled={busy}
                  />
                </>
              )}
              {error && (
                <p className="text-sm text-danger" role="alert">
                  {error}
                </p>
              )}
            </ModalBody>
            <ModalFooter>
              <Button variant="light" isDisabled={busy} onPress={() => setEditing(undefined)}>
                取消
              </Button>
              <Button color="primary" type="submit" isLoading={busy}>
                保存
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>
      <Modal
        isOpen={!!oauth}
        onClose={() => {
          if (oauth) void cancelDexOAuth(oauth.requestCode)
          setOAuth(undefined)
        }}
      >
        <ModalContent>
          <ModalHeader>绑定第三方账号</ModalHeader>
          <ModalBody>
            {oauth && (
              <OAuthFlow
                request={oauth}
                onCancel={() => setOAuth(undefined)}
                onComplete={() => {
                  setOAuth(undefined)
                  void refresh().catch((err) => setError(String(err)))
                }}
              />
            )}
          </ModalBody>
        </ModalContent>
      </Modal>
    </section>
  )
}
