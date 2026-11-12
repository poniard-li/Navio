import { useCallback, useEffect, useState } from 'react'
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
  type DexMysteryProof,
  type DexProductAccounts,
  type DexUser
} from '@renderer/utils/ipc'
import { AccountCodeField } from '../dex/account-form'

export default function AccountProducts({
  user,
  online
}: {
  user: DexUser
  online: boolean
}): React.JSX.Element {
  const [products, setProducts] = useState<DexProductAccounts>()
  const [mode, setMode] = useState<'link' | 'unlink'>()
  const [proofMode, setProofMode] = useState<'password' | 'code'>(
    user.hasPassword === false ? 'code' : 'password'
  )
  const [currentPassword, setCurrentPassword] = useState('')
  const [legacyUsername, setLegacyUsername] = useState('')
  const [legacyPassword, setLegacyPassword] = useState('')
  const [contact, setContact] = useState(user.email || user.phone || '')
  const [code, setCode] = useState('')
  const [verified, setVerified] = useState<DexMysteryProof>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const refresh = useCallback(async (): Promise<void> => {
    if (online) setProducts(await dexAccountAction<DexProductAccounts>('products'))
  }, [online])
  useEffect(() => {
    void refresh().catch((err) => setError(String(err)))
  }, [refresh])
  const close = (): void => {
    setMode(undefined)
    setVerified(undefined)
    setCurrentPassword('')
    setLegacyPassword('')
    setCode('')
    setError('')
  }
  const linked = products?.products.find((item) => item.product === 'mystery')
  const proof = (): Record<string, string> =>
    proofMode === 'password' ? { currentPassword } : { contact, code }
  const submit = async (): Promise<void> => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      if (mode === 'unlink') {
        await dexAccountAction('mystery-unlink', proof())
        close()
        setMessage('已解除账号对应关系。旧盲盒账号和原数据保留。')
        await refresh()
      } else if (!verified) {
        setVerified(
          await dexAccountAction<DexMysteryProof>('mystery-verify', {
            ...proof(),
            legacyUsername: legacyUsername.trim(),
            legacyPassword
          })
        )
        setCurrentPassword('')
        setLegacyPassword('')
        setCode('')
      } else {
        await dexAccountAction('mystery-link', {
          proof: verified.proof,
          confirmed: true,
          confirmDexUsername: verified.dexUsername,
          confirmLegacyUsername: verified.legacyUsername
        })
        close()
        setMessage('两个账号已绑定。旧盲盒数据与权益保留在原服务。')
        await refresh()
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="space-y-4">
      <div className="rounded-xl bg-default-100 p-4 space-y-3">
        <h4 className="font-medium">同机 D.E.X 账号</h4>
        <p className="text-sm text-default-500 leading-6">
          同一 Windows
          用户下，已接入的软件可以提示“以此账号继续”，由你确认或切换账号。共享凭据按账号服务隔离并加密保存在本机；各软件的配置和业务数据分别保留。
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            isDisabled={!online || busy}
            onPress={async () => {
              setBusy(true)
              setError('')
              setMessage('')
              try {
                await dexAccountAction('sso-enable')
                setMessage('已允许其他接入的软件在此 Windows 用户下提示以此账号继续。')
              } catch (err) {
                setError(String(err))
              } finally {
                setBusy(false)
              }
            }}
          >
            允许以此账号继续
          </Button>
          <Button
            size="sm"
            variant="light"
            isDisabled={busy}
            onPress={async () => {
              setBusy(true)
              setError('')
              setMessage('')
              try {
                await dexAccountAction('sso-forget')
                setMessage('已清除本机共享登录提示。各软件已建立的会话仍可在登录设备中撤销。')
              } catch (err) {
                setError(String(err))
              } finally {
                setBusy(false)
              }
            }}
          >
            清除本机共享凭据
          </Button>
        </div>
      </div>
      <div className="rounded-xl bg-default-100 p-4 space-y-3">
        <h4 className="font-medium">旧盲盒账号</h4>
        <p className="text-sm text-default-500 leading-6">
          绑定须分别验证旧盲盒账号和当前 D.E.X
          账号。原积分、等级、订单和权益留在旧账号中，不会按邮箱或用户名自动合并。
        </p>
        {linked && <p className="text-sm break-all">已绑定：@{linked.username}</p>}
        {!online ? (
          <p className="text-sm text-default-500">联网后可管理绑定。</p>
        ) : !products?.mysteryAvailable ? (
          <p className="text-sm text-default-500">旧盲盒账号服务尚未接入。</p>
        ) : (
          <Button
            size="sm"
            isDisabled={busy}
            onPress={() => {
              setError('')
              setVerified(undefined)
              setMode(linked ? 'unlink' : 'link')
            }}
          >
            {linked ? '解除对应关系' : '验证并绑定旧账号'}
          </Button>
        )}
      </div>
      {message && (
        <p className="text-sm text-success" role="status">
          {message}
        </p>
      )}
      {error && !mode && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <Modal
        isOpen={!!mode}
        onClose={close}
        isDismissable={!busy}
        isKeyboardDismissDisabled={busy}
        scrollBehavior="inside"
      >
        <ModalContent>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void submit()
            }}
          >
            <ModalHeader>
              {mode === 'unlink'
                ? '解除旧盲盒账号对应关系'
                : verified
                  ? '核对并确认两个账号'
                  : '验证两个账号'}
            </ModalHeader>
            <ModalBody>
              {verified ? (
                <div className="space-y-3 text-sm leading-6">
                  <p>
                    D.E.X 账号：<strong>@{verified.dexUsername}</strong>
                  </p>
                  <p>
                    旧盲盒账号：<strong>@{verified.legacyUsername}</strong>
                  </p>
                  <p>
                    确认后建立这两个账号的对应关系，原盲盒数据和权益保留。旧账号只能绑定一个 D.E.X
                    账号。验证结果 10 分钟内有效。
                  </p>
                </div>
              ) : (
                <>
                  <p className="text-sm leading-6">
                    当前 D.E.X 账号：<strong>@{user.username}</strong>
                    {mode === 'unlink' && (
                      <>
                        。解除与 @{linked?.username}{' '}
                        的对应关系后，旧盲盒账号仍可独立登录，原数据不会删除；其他 D.E.X
                        登录会话会退出。
                      </>
                    )}
                  </p>
                  <Tabs
                    selectedKey={proofMode}
                    onSelectionChange={(key) => {
                      setProofMode(key as 'password' | 'code')
                      setCurrentPassword('')
                      setCode('')
                    }}
                    isDisabled={busy}
                    aria-label="验证 D.E.X 身份"
                  >
                    <Tab
                      key="password"
                      title="D.E.X 密码"
                      isDisabled={user.hasPassword === false}
                    />
                    <Tab
                      key="code"
                      title="已绑定联系方式"
                      isDisabled={!user.email && !user.phone}
                    />
                  </Tabs>
                  {proofMode === 'password' ? (
                    <Input
                      label="D.E.X 当前密码"
                      type="password"
                      autoComplete="current-password"
                      value={currentPassword}
                      onValueChange={setCurrentPassword}
                      isRequired
                      isDisabled={busy}
                      maxLength={128}
                    />
                  ) : (
                    <>
                      <label className="text-sm">
                        验证方式
                        <select
                          className="block w-full rounded-lg bg-default-100 p-3 mt-2"
                          value={contact}
                          onChange={(event) => {
                            setContact(event.target.value)
                            setCode('')
                          }}
                          disabled={busy}
                        >
                          {[user.email, user.phone]
                            .filter(
                              (value): value is string =>
                                typeof value === 'string' && value.length > 0
                            )
                            .map((value) => (
                              <option key={value} value={value}>
                                {value}
                              </option>
                            ))}
                        </select>
                      </label>
                      <AccountCodeField
                        contact={contact}
                        purpose="security"
                        code={code}
                        onCode={setCode}
                        disabled={busy}
                      />
                    </>
                  )}
                  {mode === 'link' && (
                    <>
                      <Input
                        label="旧盲盒用户名"
                        autoComplete="username"
                        value={legacyUsername}
                        onValueChange={setLegacyUsername}
                        maxLength={32}
                        isRequired
                        isDisabled={busy}
                      />
                      <Input
                        label="旧盲盒密码"
                        type="password"
                        autoComplete="current-password"
                        value={legacyPassword}
                        onValueChange={setLegacyPassword}
                        maxLength={128}
                        isRequired
                        isDisabled={busy}
                      />
                    </>
                  )}
                </>
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
              <Button
                color={mode === 'unlink' ? 'danger' : 'primary'}
                type="submit"
                isLoading={busy}
              >
                {mode === 'unlink'
                  ? '验证并解除'
                  : verified
                    ? '确认绑定这两个账号'
                    : '验证双方身份'}
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>
    </section>
  )
}
