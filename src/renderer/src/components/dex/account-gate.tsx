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
  dexAccountAction,
  getDexAccount,
  startDexOAuth,
  setDexServerUrl,
  type DexAccount,
  type DexOAuthRequest,
  type DexServiceStatus
} from '@renderer/utils/ipc'
import { markInitialContentPartReady } from '@renderer/utils/startup'
import AccountForm from './account-form'
import OAuthFlow from './oauth-flow'
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
  const [oauth, setOAuth] = useState<DexOAuthRequest>()
  const [server, setServer] = useState('https://navio.mydex.top')
  const [status, setStatus] = useState<DexServiceStatus>()
  const [settings, setSettings] = useState(false)
  const [purpose, setPurpose] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const refresh = useCallback(async (): Promise<void> => {
    try {
      const result = await getDexAccount()
      setAccount(result)
      setServer(result.serverUrl)
      if (result.status === 'signed-out') {
        setStatus(undefined)
        void dexAccountAction<DexServiceStatus>('status')
          .then(setStatus)
          .catch(() => {})
      }
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
  const complete = (): void => {
    setOAuth(undefined)
    void refresh()
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
          <small>Public Beta · Built by D.E.X Studio</small>
        </section>
        <section className="navio-auth-panel">
          <h2>欢迎使用 Navio</h2>
          <p>使用 D.E.X 统一账号，进入你的主题空间。注册、登录和账号管理，都可以在软件内完成。</p>
          {oauth ? (
            <OAuthFlow request={oauth} onComplete={complete} onCancel={() => setOAuth(undefined)} />
          ) : showForm ? (
            <AccountForm
              onComplete={complete}
              oauthBusy={busy}
              status={status}
              onOAuth={async (provider) => {
                setBusy(true)
                setError('')
                try {
                  setOAuth(await startDexOAuth(provider))
                } catch (err) {
                  setError(String(err))
                } finally {
                  setBusy(false)
                }
              }}
            />
          ) : (
            <Button className="mt-6" color="primary" fullWidth onPress={() => setPurpose(true)}>
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
                isDisabled={!!oauth || busy}
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
              注册会验证一个邮箱或手机号。账号资料、验证码发送及主题服务由 D.E.X
              服务器处理；订阅链接、节点凭据和代理流量不上传到账号服务器。你可以在软件内找回密码、管理绑定与登录设备。
            </p>
            <p className="text-sm leading-7">
              首次登录后，暂时断网仍可使用本机代理与已保存的配置。
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={() => setPurpose(false)}>
              返回
            </Button>
            <Button
              color="primary"
              onPress={() => {
                setPurpose(false)
                setShowForm(true)
              }}
            >
              了解，继续
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}
