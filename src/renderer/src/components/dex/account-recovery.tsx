import { useEffect, useState } from 'react'
import { Button, Input } from '@heroui/react'
import { dexAccountAction, type DexRecoveryInfo } from '@renderer/utils/ipc'

export default function AccountRecovery({ onBack }: { onBack: () => void }): React.JSX.Element {
  const [recoveryToken, setRecoveryToken] = useState('')
  const [info, setInfo] = useState<DexRecoveryInfo>()
  const [contact, setContact] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [seconds, setSeconds] = useState(0)
  const [complete, setComplete] = useState(false)
  useEffect(() => {
    if (!seconds) return
    const timer = setTimeout(() => setSeconds(seconds - 1), 1000)
    return () => clearTimeout(timer)
  }, [seconds])
  const submit = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      if (!info) {
        setInfo(
          await dexAccountAction<DexRecoveryInfo>('recovery-info', {
            recoveryToken: recoveryToken.trim()
          })
        )
      } else {
        if (password !== repeat) throw new Error('两次输入的密码不一致。')
        await dexAccountAction('recovery-complete', {
          recoveryToken: recoveryToken.trim(),
          contact: contact.trim(),
          code,
          newPassword: password
        })
        setRecoveryToken('')
        setCode('')
        setPassword('')
        setRepeat('')
        setComplete(true)
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }
  if (complete)
    return (
      <div className="space-y-4 mt-5" role="status">
        <h3 className="font-semibold">账号已恢复</h3>
        <p className="text-sm leading-6">
          新联系方式和密码已生效，原登录会话已退出。请使用新密码登录。
        </p>
        <Button color="primary" fullWidth onPress={onBack}>
          返回登录
        </Button>
      </div>
    )
  return (
    <form
      className="space-y-4 mt-5"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <h3 className="font-semibold">管理员协助恢复</h3>
      <p className="text-sm text-default-500 leading-6">
        无法使用原登录方式时，请先联系管理员核实身份，取得恢复凭据。恢复前账号保持停用。
      </p>
      {!info ? (
        <Input
          label="管理员提供的恢复凭据"
          type="password"
          autoComplete="off"
          value={recoveryToken}
          onValueChange={setRecoveryToken}
          isRequired
          isDisabled={busy}
          maxLength={64}
        />
      ) : (
        <>
          <div className="rounded-xl bg-default-100 p-4 text-sm space-y-2 break-words">
            <p>
              恢复账号：<strong>@{info.username}</strong>
            </p>
            <p>
              已核实的新{info.contactType === 'email' ? '邮箱' : '手机号'}：{info.maskedContact}
            </p>
            <p>有效期至：{new Date(info.expiresAt).toLocaleString()}</p>
            <p>
              完成后将替换此账号的{info.contactType === 'email' ? '邮箱' : '手机号'}
              并设置新密码。其他联系方式、第三方绑定、主题和盲盒数据保留。
            </p>
          </div>
          <Input
            label={`完整的新${info.contactType === 'email' ? '邮箱' : '手机号'}`}
            type={info.contactType === 'email' ? 'email' : 'tel'}
            value={contact}
            onValueChange={setContact}
            autoComplete={info.contactType === 'email' ? 'email' : 'tel'}
            isRequired
            isDisabled={busy}
          />
          <div className="flex gap-2 items-start">
            <Input
              label="验证码"
              value={code}
              onValueChange={setCode}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              pattern="[0-9]{6}"
              isRequired
              isDisabled={busy}
            />
            <Button
              className="h-14 shrink-0"
              isDisabled={busy || seconds > 0 || !contact.trim()}
              onPress={async () => {
                setBusy(true)
                setError('')
                setMessage('')
                try {
                  await dexAccountAction('recovery-request', {
                    recoveryToken: recoveryToken.trim(),
                    contact: contact.trim()
                  })
                  setSeconds(60)
                  setMessage('验证码已发送，有效期 10 分钟。')
                } catch (err) {
                  setError(String(err))
                } finally {
                  setBusy(false)
                }
              }}
            >
              {seconds ? `${seconds} 秒后重发` : '获取验证码'}
            </Button>
          </div>
          <Input
            label="新密码"
            type="password"
            autoComplete="new-password"
            value={password}
            onValueChange={setPassword}
            minLength={10}
            maxLength={128}
            isRequired
            isDisabled={busy}
          />
          <Input
            label="再次输入新密码"
            type="password"
            autoComplete="new-password"
            value={repeat}
            onValueChange={setRepeat}
            minLength={10}
            maxLength={128}
            isRequired
            isDisabled={busy}
          />
        </>
      )}
      {message && (
        <p className="text-xs text-default-500" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="navio-auth-error" role="alert">
          {error}
        </p>
      )}
      <Button fullWidth color="primary" type="submit" isLoading={busy}>
        {info ? '验证并恢复账号' : '核对恢复申请'}
      </Button>
      <Button fullWidth variant="light" isDisabled={busy} onPress={onBack}>
        返回登录
      </Button>
    </form>
  )
}
