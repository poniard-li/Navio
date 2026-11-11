import { useEffect, useState } from 'react'
import { Button } from '@heroui/react'
import {
  getDexAccount,
  logoutDexAccount,
  openDexAccountPortal,
  type DexAccount
} from '@renderer/utils/ipc'
import { toast } from '@renderer/components/base/toast'
import BaseConfirmModal from '../base/base-confirm-modal'

export default function AccountConfig(): React.JSX.Element {
  const [account, setAccount] = useState<DexAccount>()
  const [confirm, setConfirm] = useState(false)
  useEffect(() => {
    void getDexAccount()
      .then(setAccount)
      .catch((err) => toast.error(String(err)))
  }, [])
  return (
    <section className="m-3 rounded-xl border border-default-200 p-5">
      <div className="flex justify-between gap-4 items-center">
        <div>
          <h3 className="font-semibold">
            {account?.user?.displayName || account?.user?.username || 'D.E.X 账号'}
          </h3>
          <p className="text-xs text-default-500 mt-2">
            {account?.status === 'offline'
              ? '离线模式 · 本机功能可用'
              : '统一账号 · Navio 应用授权'}
          </p>
        </div>
        <Button
          variant="flat"
          onPress={() => void openDexAccountPortal().catch((err) => toast.error(String(err)))}
        >
          打开账号门户
        </Button>
      </div>
      <p className="text-sm text-default-500 leading-7 mt-6">
        在网页账号中心管理密码、邮箱、手机号、Google / GitHub 绑定、登录设备和应用授权。Navio
        的订阅与节点凭据保留在本机，账号登录不会上传或恢复这些数据。
      </p>
      <Button size="sm" variant="light" className="mt-4" onPress={() => setConfirm(true)}>
        退出此设备账号
      </Button>
      <BaseConfirmModal
        isOpen={confirm}
        title="退出 D.E.X 账号？"
        content="本机订阅和配置仍会保留。退出后再次打开 Navio 需要联网登录，离线模式会停止。"
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          try {
            await logoutDexAccount()
            window.dispatchEvent(new Event('dex-account-updated'))
          } catch (err) {
            toast.error(String(err))
          }
        }}
      />
    </section>
  )
}
