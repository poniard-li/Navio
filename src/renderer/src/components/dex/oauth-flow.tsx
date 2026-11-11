import { useEffect, useRef, useState } from 'react'
import { Button, Input, Spinner } from '@heroui/react'
import {
  cancelDexOAuth,
  finishDexOAuth,
  type DexOAuthRequest,
  type DexOAuthResult
} from '@renderer/utils/ipc'
import { AccountCodeField } from './account-form'

export default function OAuthFlow({
  request,
  onComplete,
  onCancel
}: {
  request: DexOAuthRequest
  onComplete: () => void
  onCancel: () => void
}): React.JSX.Element {
  const [registration, setRegistration] =
    useState<Extract<DexOAuthResult, { status: 'registration_required' }>>()
  const [username, setUsername] = useState('')
  const [contact, setContact] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [expired, setExpired] = useState(false)
  const done = useRef(onComplete)
  done.current = onComplete
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const deadline = Date.now() + request.expiresIn * 1000
    const poll = async (): Promise<void> => {
      if (Date.now() >= deadline) {
        setExpired(true)
        return
      }
      try {
        const result = await finishDexOAuth(request.requestCode)
        if (cancelled) return
        if (result.status === 'approved' || result.status === 'linked') {
          done.current()
          return
        }
        if (result.status === 'expired') {
          setExpired(true)
          return
        }
        if (result.status === 'registration_required') {
          setRegistration(result)
          setContact(result.suggestedEmail || '')
          setError('')
          return
        }
      } catch (err) {
        if (!cancelled) setError(`暂时无法确认授权，正在重试。${String(err)}`)
      }
      if (!cancelled) timer = setTimeout(() => void poll(), request.interval * 1000)
    }
    timer = setTimeout(() => void poll(), request.interval * 1000)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [request])
  return (
    <div className="mt-5 space-y-4">
      {expired ? (
        <p role="alert">本次授权已过期，请返回后重新发起。</p>
      ) : registration ? (
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault()
            setBusy(true)
            setError('')
            try {
              const result = await finishDexOAuth(request.requestCode, {
                username: username.trim(),
                contact: contact.trim(),
                code
              })
              if (result.status === 'approved') done.current()
              else if (result.status === 'expired') setExpired(true)
              else setError('账号未创建成功，请重试。')
            } catch (err) {
              setError(String(err))
            } finally {
              setBusy(false)
            }
          }}
        >
          <h3 className="font-semibold">完成 D.E.X 账号创建</h3>
          <p>
            第三方授权已完成。设置用户名后，即可使用 D.E.X 账号；你可以稍后在软件内设置独立密码。
          </p>
          <Input
            label="用户名"
            value={username}
            onValueChange={setUsername}
            pattern="[a-zA-Z][a-zA-Z0-9_.\-]{2,31}"
            description="3–32 位，以字母开头，可包含数字、点、短横线或下划线。"
            autoComplete="username"
            maxLength={32}
            isRequired
            isDisabled={busy}
          />
          {registration.emailVerified ? (
            <p>已由第三方验证邮箱：{registration.suggestedEmail}</p>
          ) : (
            <>
              <Input
                label="邮箱或手机号"
                value={contact}
                onValueChange={setContact}
                autoComplete="email"
                isRequired
                isDisabled={busy}
              />
              <AccountCodeField
                contact={contact}
                purpose="register"
                code={code}
                onCode={setCode}
                disabled={busy}
              />
            </>
          )}
          <Button fullWidth color="primary" type="submit" isLoading={busy}>
            创建账号并继续
          </Button>
        </form>
      ) : (
        <>
          <Spinner size="sm" />
          <p>请在系统浏览器完成 Google / GitHub 授权。完成后，软件会自动继续，无需打开账号门户。</p>
        </>
      )}
      {error && (
        <p className="navio-auth-error" role="alert">
          {error}
        </p>
      )}
      <Button
        fullWidth
        variant="light"
        isDisabled={busy}
        onPress={() => {
          void cancelDexOAuth(request.requestCode)
          onCancel()
        }}
      >
        {expired ? '返回' : '取消本次授权'}
      </Button>
    </div>
  )
}
