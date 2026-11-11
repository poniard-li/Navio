import { useState } from 'react'
import {
  Button,
  Checkbox,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader
} from '@heroui/react'
import { applyCfwMigration, previewCfwMigration, type CfwMigrationPlan } from '@renderer/utils/ipc'
import { toast } from '../base/toast'

export default function CfwMigration(): React.JSX.Element {
  const [plan, setPlan] = useState<CfwMigrationPlan>()
  const [busy, setBusy] = useState(false)
  const [profileIds, setProfileIds] = useState<string[]>([])
  const [overrideIds, setOverrideIds] = useState<string[]>([])
  const [result, setResult] = useState<string>()
  const [warnings, setWarnings] = useState<string[]>([])
  return (
    <section className="m-3 rounded-xl border border-default-200 p-5">
      <div className="flex items-center justify-between gap-5">
        <div>
          <h3 className="font-medium">从 Clash for Windows 迁移</h3>
          <p className="text-xs text-default-500 leading-6 mt-2">
            读取本机配置、订阅缓存和支持的 YAML
            Mixin。先检查兼容性再导入；不会执行旧脚本或更改当前连接。
          </p>
        </div>
        <Button
          size="sm"
          isLoading={busy && !plan}
          onPress={async () => {
            setBusy(true)
            try {
              const next = await previewCfwMigration()
              if (!next) return
              setPlan(next)
              setProfileIds(next.candidates.map((item) => item.id))
              setOverrideIds(next.overrides.map((item) => item.id))
              setResult(undefined)
              setWarnings([])
            } catch (error) {
              toast.error(String(error))
            } finally {
              setBusy(false)
            }
          }}
        >
          选择 CFW 配置文件夹
        </Button>
      </div>
      <Modal
        size="3xl"
        isOpen={Boolean(plan)}
        onClose={() => {
          if (!busy) setPlan(undefined)
        }}
        scrollBehavior="inside"
      >
        <ModalContent>
          <ModalHeader>检查迁移内容</ModalHeader>
          <ModalBody>
            <p className="text-xs break-all text-default-500">来源：{plan?.sourceDirectory}</p>
            {result ? (
              <>
                <p className="text-success">{result}</p>
                {warnings.map((warning, index) => (
                  <p className="text-xs text-warning" key={index}>
                    {warning}
                  </p>
                ))}
              </>
            ) : (
              <>
                <p className="text-xs text-default-500 leading-6">
                  导入后保留本机缓存，远程订阅自动更新默认关闭。迁移不会切换当前配置；请核对后在订阅管理中主动选择。
                </p>
                {plan?.candidates.map((item) => (
                  <div className="rounded-lg border border-default-200 p-3" key={item.id}>
                    <Checkbox
                      isSelected={profileIds.includes(item.id)}
                      onValueChange={(value) =>
                        setProfileIds(
                          value
                            ? [...profileIds, item.id]
                            : profileIds.filter((id) => id !== item.id)
                        )
                      }
                    >
                      {item.name}
                    </Checkbox>
                    <p className="text-xs text-default-500 mt-2">
                      {item.kind === 'remote' ? '远程订阅缓存' : '本地配置'} · {item.nodeCount} 节点
                      / {item.groupCount} 策略组 / {item.ruleCount} 规则
                    </p>
                    {item.warnings.map((warning, index) => (
                      <p key={index} className="text-xs text-warning mt-1">
                        {warning}
                      </p>
                    ))}
                  </div>
                ))}
                {plan?.overrides.map((item) => (
                  <div key={item.id} className="rounded-lg border border-default-200 p-3">
                    <Checkbox
                      isSelected={overrideIds.includes(item.id)}
                      onValueChange={(value) =>
                        setOverrideIds(
                          value
                            ? [...overrideIds, item.id]
                            : overrideIds.filter((id) => id !== item.id)
                        )
                      }
                    >
                      {item.name} · YAML 覆写
                    </Checkbox>
                    <p className="text-xs text-default-500 mt-2">字段：{item.keys.join('、')}</p>
                  </div>
                ))}
                {plan?.warnings.map((warning, index) => (
                  <p className="text-xs text-warning leading-6" key={index}>
                    {warning}
                  </p>
                ))}
                {Boolean(plan?.unsupportedScripts.length) && (
                  <div className="rounded-lg bg-warning-50 p-4">
                    <h4 className="text-sm font-medium">以下脚本需人工调整</h4>
                    {plan?.unsupportedScripts.map((script, index) => (
                      <div key={index} className="mt-3 text-xs leading-6">
                        <strong>
                          {script.source} · {script.kind}
                        </strong>
                        <p>{script.message}</p>
                      </div>
                    ))}
                  </div>
                )}
                {plan && !plan.candidates.length && !plan.overrides.length && (
                  <p className="text-sm">
                    没有找到可自动迁移的内容。上面的兼容性说明可用于手动整理。
                  </p>
                )}
              </>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="light" isDisabled={busy} onPress={() => setPlan(undefined)}>
              {result ? '完成' : '取消'}
            </Button>
            {!result && (
              <Button
                color="primary"
                isLoading={busy}
                isDisabled={!profileIds.length && !overrideIds.length}
                onPress={async () => {
                  if (!plan) return
                  setBusy(true)
                  try {
                    const imported = await applyCfwMigration(plan.planId, {
                      profileIds,
                      overrideIds
                    })
                    setResult(
                      `已导入 ${imported.importedProfiles.length} 份配置与 ${imported.importedOverrides.length} 项覆写`
                    )
                    setWarnings(imported.warnings)
                  } catch (error) {
                    toast.error(String(error))
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                确认导入所选内容
              </Button>
            )}
          </ModalFooter>
        </ModalContent>
      </Modal>
    </section>
  )
}
