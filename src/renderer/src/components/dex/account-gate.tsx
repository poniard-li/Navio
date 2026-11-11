import { useCallback, useEffect, useState } from 'react'
import {
  Button,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Spinner
} from '@heroui/react'
import {
  getDexAccount,
  startDexLogin,
  pollDexLogin,
  setDexServerUrl,
  type DexAccount,
  type DexDeviceLogin
} from '@renderer/utils/ipc'
import { markInitialContentPartReady } from '@renderer/utils/startup'
import '../../assets/navio.css'

export default function AccountGate({
  children
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const [account, setAccount] = useState<DexAccount>()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [login, setLogin] = useState<DexDeviceLogin>()
  const [server, setServer] = useState('https://account.mydex.top')
  const [settings, setSettings] = useState(false)
  const [purpose, setPurpose] = useState(false)
  const refresh = useCallback(async (): Promise<void> => {
    try {
      const result = await getDexAccount()
      setAccount(result)
      setServer(result.serverUrl)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    void refresh()
    const handler = (): void => {
      setLoading(true)
      void refresh()
    }
    window.addEventListener('dex-account-updated', handler)
    return () => window.removeEventListener('dex-account-updated', handler)
  }, [refresh])
  useEffect(() => {
    if (loading || account?.user) return
    markInitialContentPartReady('route')
    markInitialContentPartReady('sider')
  }, [loading, account])
  useEffect(() => {
    if (!login) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const deadline = Date.now() + login.expiresIn * 1000
    const poll = async (): Promise<void> => {
      if (cancelled) return
      if (Date.now() >= deadline) {
        setLogin(undefined)
        setError('本次登录已过期，请重新打开登录页面。')
        return
      }
      try {
        const result = await pollDexLogin(login.deviceCode)
        if (cancelled) return
        if (result.status === 'complete') {
          setLogin(undefined)
          await refresh()
          return
        }
        if (result.status === 'expired') {
          setLogin(undefined)
          setError('本次登录已过期，请重试。')
          return
        }
      } catch (err) {
        if (!cancelled) setError(`暂时无法确认授权，正在重试。${String(err)}`)
      }
      timer = setTimeout(() => void poll(), Math.max(2, login.interval) * 1000)
    }
    timer = setTimeout(() => void poll(), Math.max(2, login.interval) * 1000)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [login, refresh])
  const begin = async (): Promise<void> => {
    setPurpose(false)
    setBusy(true)
    setError('')
    try {
      setLogin(await startDexLogin())
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }
  if (loading)
    return (
      <div className="navio-auth items-center justify-center">
        <Spinner label="正在检查本机登录状态" />
      </div>
    )
  if (account?.user && account.status !== 'signed-out')
    return (
      <>
        {children}
        {account.status === 'offline' && (
          <div className="navio-offline-banner" role="status">
            D.E.X 离线模式 · 本机功能可用，云服务暂不可用{' '}
            <button onClick={() => void refresh()}>重新连接</button>
          </div>
        )}
      </>
    )
  return (
    <div className="navio-auth">
      <div className="navio-auth-drag" />
      <div className="navio-auth-layout">
        <section className="navio-auth-brand">
          <p className="navio-eyebrow">A MORE CONSIDERED CONNECTION</p>
          <h1>Navio</h1>
          <p>
            从连接开始，
            <br />
            让每一次选择更清晰。
          </p>
          <small>Built by D.E.X Studio</small>
        </section>
        <section className="navio-auth-panel">
          <h2>欢迎使用 Navio</h2>
          <p>
            使用 D.E.X 统一账号，进入你的主题空间。已有账号可直接继续，所有 D.E.X 服务使用同一身份。
          </p>
          {login ? (
            <>
              <p className="mt-5">请在已打开的浏览器中登录，并核对设备代码：</p>
              <p className="navio-auth-code">{login.userCode}</p>
              <Button fullWidth variant="flat" onPress={() => window.open(login.verificationUri)}>
                重新打开授权页面
              </Button>
              <Button
                fullWidth
                variant="light"
                className="mt-2"
                onPress={() => setLogin(undefined)}
              >
                取消本次登录
              </Button>
            </>
          ) : (
            <Button
              className="mt-6"
              color="primary"
              fullWidth
              isLoading={busy}
              onPress={() => setPurpose(true)}
            >
              登录或注册 D.E.X 账号
            </Button>
          )}
          {error && (
            <p className="navio-auth-error" role="alert">
              {error}
            </p>
          )}
          <div className="navio-auth-purpose">
            <p>
              账号用于主题发布、收藏与跨产品身份。订阅链接和节点凭据保留在本机，不上传到 D.E.X
              官方云。已登录设备在服务暂不可用时可以离线使用。
            </p>
          </div>
          <Button variant="light" size="sm" className="mt-4" onPress={() => setSettings(!settings)}>
            账号服务设置
          </Button>
          {settings && (
            <div className="mt-3 space-y-3">
              <Input
                label="账号服务地址"
                value={server}
                onValueChange={setServer}
                description="首次使用需要可访问的 D.E.X 账号服务。"
              />
              <Button
                size="sm"
                onPress={async () => {
                  try {
                    await setDexServerUrl(server)
                    setError('')
                    await refresh()
                  } catch (err) {
                    setError(String(err))
                  }
                }}
              >
                保存并重试
              </Button>
            </div>
          )}
        </section>
      </div>
      <Modal isOpen={purpose} onOpenChange={setPurpose}>
        <ModalContent>
          <ModalHeader>为什么需要 D.E.X 账号？</ModalHeader>
          <ModalBody>
            <p className="text-sm leading-7">
              账号用于主题作品、收藏以及未来 D.E.X
              产品的统一登录。它不会提供代理线路，也不是订阅服务商账号。
            </p>
            <p className="text-sm leading-7">
              订阅链接与节点凭据保留在本机。注册会验证一个邮箱或手机号；你可以在账号门户管理绑定和授权。首次登录后，暂时断网仍可使用本机代理与已保存的配置。
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={() => setPurpose(false)}>
              返回
            </Button>
            <Button color="primary" onPress={begin}>
              了解，继续
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}
