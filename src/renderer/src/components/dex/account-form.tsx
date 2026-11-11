import { useEffect, useState } from 'react'
import { Button, Input, Tab, Tabs } from '@heroui/react'
import { dexAccountAction, type DexServiceStatus } from '@renderer/utils/ipc'

export function AccountCodeField({
  contact,
  purpose,
  code,
  onCode,
  disabled = false
}: {
  contact: string
  purpose: 'register' | 'login' | 'reset' | 'bind'
  code: string
  onCode: (value: string) => void
  disabled?: boolean
}): React.JSX.Element {
  const [sending, setSending] = useState(false)
  const [until, setUntil] = useState(0)
  const [seconds, setSeconds] = useState(0)
  const [message, setMessage] = useState('')
  const [error, setError] = useState(false)
  useEffect(() => {
    const tick = (): void => setSeconds(Math.max(0, Math.ceil((until - Date.now()) / 1000)))
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [until])
  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2">
        <Input
          label="验证码"
          value={code}
          onValueChange={onCode}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          isRequired
          isDisabled={disabled}
        />
        <Button
          className="h-14 shrink-0"
          variant="flat"
          isLoading={sending}
          isDisabled={disabled || !contact.trim() || seconds > 0}
          onPress={async () => {
            setSending(true)
            setMessage('')
            try {
              await dexAccountAction('otp-request', { contact: contact.trim(), purpose })
              setUntil(Date.now() + 60000)
              setError(false)
              setMessage(
                purpose === 'login' || purpose === 'reset'
                  ? '若该联系方式已绑定账号，你将收到验证码。有效期 10 分钟。'
                  : '验证码已发送，有效期 10 分钟。'
              )
            } catch (err) {
              setError(true)
              setMessage(String(err))
            } finally {
              setSending(false)
            }
          }}
        >
          {seconds > 0 ? `${seconds} 秒后重发` : '获取验证码'}
        </Button>
      </div>
      {message && (
        <p
          className={error ? 'navio-auth-error' : 'text-xs text-default-500'}
          role={error ? 'alert' : 'status'}
        >
          {message}
        </p>
      )}
    </div>
  )
}

export default function AccountForm({
  onComplete,
  onOAuth,
  oauthBusy,
  status
}: {
  onComplete: () => void
  onOAuth: (provider: 'google' | 'github') => void
  oauthBusy: boolean
  status?: DexServiceStatus
}): React.JSX.Element {
  const [mode, setMode] = useState<'password' | 'code' | 'register' | 'reset'>('password')
  const [identifier, setIdentifier] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState(false)
  const changeMode = (value: typeof mode): void => {
    setMode(value)
    setCode('')
    setPassword('')
    setRepeat('')
    setMessage('')
  }
  const newPassword = mode === 'register' || mode === 'reset'
  const submit = async (): Promise<void> => {
    setError(false)
    setMessage('')
    if (newPassword && password !== repeat) {
      setError(true)
      setMessage('两次输入的密码不一致。')
      return
    }
    setBusy(true)
    try {
      if (mode === 'reset') {
        await dexAccountAction('password-reset', {
          contact: identifier.trim(),
          code,
          newPassword: password
        })
        changeMode('password')
        setMessage('密码已重置，其他登录会话已失效。请使用新密码登录。')
      } else {
        if (mode === 'password')
          await dexAccountAction('login', { identifier: identifier.trim(), password })
        if (mode === 'code')
          await dexAccountAction('otp-login', { contact: identifier.trim(), code })
        if (mode === 'register')
          await dexAccountAction('register', {
            username: username.trim(),
            contact: identifier.trim(),
            code,
            password
          })
        setPassword('')
        setRepeat('')
        setCode('')
        onComplete()
      }
    } catch (err) {
      setError(true)
      setMessage(String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form
      className="space-y-4 mt-5"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      {mode === 'register' || mode === 'reset' ? (
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">{mode === 'register' ? '创建 D.E.X 账号' : '找回密码'}</h3>
          <Button
            size="sm"
            variant="light"
            isDisabled={busy}
            onPress={() => changeMode('password')}
          >
            返回登录
          </Button>
        </div>
      ) : (
        <Tabs
          aria-label="登录方式"
          fullWidth
          selectedKey={mode}
          onSelectionChange={(key) => changeMode(key as 'password' | 'code')}
          isDisabled={busy || oauthBusy}
        >
          <Tab key="password" title="密码登录" />
          <Tab key="code" title="验证码登录" />
        </Tabs>
      )}
      {mode === 'register' && (
        <Input
          label="用户名"
          value={username}
          onValueChange={setUsername}
          autoComplete="username"
          description="3–32 位，以字母开头，可包含数字、点、短横线或下划线。"
          pattern="[a-zA-Z][a-zA-Z0-9_.\-]{2,31}"
          maxLength={32}
          isRequired
          isDisabled={busy}
        />
      )}
      <Input
        label={mode === 'password' ? '邮箱 / 手机号 / 用户名' : '邮箱或手机号'}
        description={
          mode === 'reset'
            ? '验证已绑定的邮箱或手机号后，设置新密码。'
            : mode === 'register'
              ? '验证其中一种即可；境外手机号请包含国家区号。'
              : undefined
        }
        value={identifier}
        onValueChange={setIdentifier}
        autoComplete={mode === 'password' ? 'username' : 'email'}
        maxLength={254}
        isRequired
        isDisabled={busy}
      />
      {mode !== 'password' && (
        <AccountCodeField
          contact={identifier}
          purpose={mode === 'code' ? 'login' : mode}
          code={code}
          onCode={setCode}
          disabled={busy}
        />
      )}
      {mode !== 'code' && (
        <Input
          label={newPassword ? '新密码' : '密码'}
          type="password"
          value={password}
          onValueChange={setPassword}
          autoComplete={newPassword ? 'new-password' : 'current-password'}
          description={newPassword ? '10–128 个字符，建议使用独立密码。' : undefined}
          minLength={newPassword ? 10 : 1}
          maxLength={128}
          isRequired
          isDisabled={busy}
        />
      )}
      {newPassword && (
        <Input
          label="再次输入新密码"
          type="password"
          value={repeat}
          onValueChange={setRepeat}
          autoComplete="new-password"
          minLength={10}
          maxLength={128}
          isRequired
          isDisabled={busy}
        />
      )}
      {message && (
        <p
          className={error ? 'navio-auth-error' : 'text-xs text-success'}
          role={error ? 'alert' : 'status'}
        >
          {message}
        </p>
      )}
      <Button color="primary" fullWidth type="submit" isLoading={busy} isDisabled={oauthBusy}>
        {mode === 'register' ? '验证并创建账号' : mode === 'reset' ? '验证并重置密码' : '登录'}
      </Button>
      {!newPassword && (
        <>
          <div className="flex justify-between gap-2">
            <Button
              size="sm"
              variant="light"
              isDisabled={busy || status?.registrationEnabled === false}
              onPress={() => changeMode('register')}
            >
              创建账号
            </Button>
            <Button size="sm" variant="light" isDisabled={busy} onPress={() => changeMode('reset')}>
              忘记密码
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="bordered"
              isDisabled={busy || oauthBusy || !status?.providers.google}
              onPress={() => onOAuth('google')}
            >
              Google
            </Button>
            <Button
              variant="bordered"
              isDisabled={busy || oauthBusy || !status?.providers.github}
              onPress={() => onOAuth('github')}
            >
              GitHub
            </Button>
          </div>
          <p className="text-xs text-default-500">
            第三方登录会在系统浏览器完成授权，然后回到软件继续。
          </p>
        </>
      )}
    </form>
  )
}
