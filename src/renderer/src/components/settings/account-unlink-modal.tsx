import { useState } from 'react'
import {
  Button,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Tab,
  Tabs
} from '@heroui/react'
import {
  dexAccountAction,
  type DexAccountMutation,
  type DexSecurityProof,
  type DexServiceStatus,
  type DexUnlinkTarget,
  type DexUser
} from '@renderer/utils/ipc'
import { AccountCodeField } from '../dex/account-form'

const labels = { email: '邮箱', phone: '手机号', google: 'Google', github: 'GitHub' }

export default function AccountUnlinkModal({
  user,
  target,
  status,
  onClose,
  onComplete
}: {
  user: DexUser
  target: DexUnlinkTarget
  status?: DexServiceStatus
  onClose: () => void
  onComplete: (user: DexUser) => void
}): React.JSX.Element {
  const contacts = [
    ...(user.email ? [{ value: user.email, label: '邮箱', enabled: status?.providers.email }] : []),
    ...(user.phone ? [{ value: user.phone, label: '手机号', enabled: status?.providers.sms }] : [])
  ]
  const [method, setMethod] = useState<'password' | 'code'>(user.hasPassword ? 'password' : 'code')
  const [contact, setContact] = useState(
    contacts.find((item) => item.enabled)?.value || contacts[0]?.value || ''
  )
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const contactEnabled = contacts.some((item) => item.value === contact && item.enabled)
  const label = labels[target.target]
  const currentValue = target.kind === 'contact' ? user[target.target] : undefined
  const canVerify = method === 'password' ? !!user.hasPassword : contactEnabled

  const close = (): void => {
    if (busy) return
    setPassword('')
    setCode('')
    onClose()
  }
  const submit = async (): Promise<void> => {
    if (busy || !canVerify) return
    setError('')
    if (method === 'code' && !/^\d{6}$/.test(code)) {
      setError('请输入 6 位验证码。')
      return
    }
    if (method === 'password' && !password) {
      setError('请输入当前密码。')
      return
    }
    const proof: DexSecurityProof =
      method === 'password' ? { currentPassword: password } : { contact, code }
    setBusy(true)
    try {
      const result = await dexAccountAction<DexAccountMutation>(
        target.kind === 'contact' ? 'unlink-contact' : 'unlink-provider',
        { target: target.target, ...proof }
      )
      setPassword('')
      setCode('')
      onComplete(result.user)
    } catch (err) {
      setError(String(err))
      setPassword('')
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      isOpen
      isDismissable={!busy}
      isKeyboardDismissDisabled={busy}
      hideCloseButton={busy}
      onClose={close}
    >
      <ModalContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <ModalHeader>解除{label}绑定</ModalHeader>
          <ModalBody>
            {currentValue && (
              <p className="text-sm font-medium break-all">将解除绑定：{currentValue}</p>
            )}
            <p className="text-sm text-default-500 leading-6">
              {target.kind === 'contact'
                ? `解除后，该${label}将无法用于登录或接收账号验证码。账号必须保留另一个已验证的邮箱或手机号。`
                : `解除后，此 ${label} 账号将无法登录当前 D.E.X 账号。这里只移除登录绑定，不会删除你的 ${label} 账号。账号必须保留至少一种可用的登录方式。`}
            </p>
            <p className="text-sm text-default-500">
              请验证身份后确认。操作成功后，其他设备需要重新登录，当前设备保持登录。
            </p>
            {user.hasPassword && contacts.length > 0 && (
              <Tabs
                aria-label="身份验证方式"
                selectedKey={method}
                isDisabled={busy}
                onSelectionChange={(key) => {
                  setMethod(key as 'password' | 'code')
                  setPassword('')
                  setCode('')
                  setError('')
                }}
              >
                <Tab key="password" title="当前密码" />
                <Tab key="code" title="验证码" />
              </Tabs>
            )}
            {method === 'password' && user.hasPassword ? (
              <Input
                type="password"
                label="当前密码"
                value={password}
                onValueChange={setPassword}
                autoComplete="current-password"
                maxLength={128}
                isRequired
                isDisabled={busy}
              />
            ) : contacts.length > 0 ? (
              <>
                <div className="space-y-2">
                  <p className="text-sm">使用已绑定的联系方式验证</p>
                  {contacts.map((item) => (
                    <Button
                      key={item.value}
                      variant={contact === item.value ? 'flat' : 'bordered'}
                      color={contact === item.value ? 'primary' : 'default'}
                      className="w-full justify-start h-auto min-h-10 py-2 whitespace-normal break-all"
                      aria-pressed={contact === item.value}
                      isDisabled={busy || !item.enabled}
                      onPress={() => {
                        setContact(item.value)
                        setCode('')
                        setError('')
                      }}
                    >
                      {item.label}：{item.value}
                      {!item.enabled && '（验证码服务暂不可用）'}
                    </Button>
                  ))}
                </div>
                <AccountCodeField
                  key={contact}
                  contact={contact}
                  purpose="security"
                  code={code}
                  onCode={setCode}
                  disabled={busy || !contactEnabled}
                />
                {!contactEnabled && (
                  <p className="text-sm text-default-500">
                    当前联系方式的验证码服务暂不可用，请使用当前密码或稍后重试。
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-warning">请先绑定并验证邮箱或手机号，再解除第三方绑定。</p>
            )}
            {error && (
              <p className="text-sm text-danger" role="alert">
                {error}
              </p>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="light" isDisabled={busy} onPress={close}>
              取消
            </Button>
            <Button color="danger" type="submit" isLoading={busy} isDisabled={!canVerify}>
              确认解除绑定
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  )
}
