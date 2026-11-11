import { useEffect, useState } from 'react'
import {
  Button,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Switch,
  Textarea
} from '@heroui/react'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import {
  getFilePath,
  getNavioScriptRuns,
  launchProxyTerminal,
  runNavioTrayScript,
  stopNavioTrayScript
} from '@renderer/utils/ipc'
import { toast } from '../base/toast'
import BaseConfirmModal from '../base/base-confirm-modal'

export default function NavioToolsConfig(): React.JSX.Element {
  const { appConfig, patchAppConfig } = useAppConfig()
  const [enable, setEnable] = useState(false)
  const [terminalBusy, setTerminalBusy] = useState(false)
  const [editor, setEditor] = useState<INavioTrayScript>()
  const [argsText, setArgsText] = useState('[]')
  const [runs, setRuns] = useState<INavioScriptRun[]>([])
  const [output, setOutput] = useState<string>()
  const scripts = appConfig?.navioTrayScripts || []
  const enabled = appConfig?.navioTrayScriptsEnabled === true
  useEffect(() => {
    const refresh = (): void => {
      void getNavioScriptRuns()
        .then(setRuns)
        .catch(() => {})
    }
    refresh()
    const timer = setInterval(refresh, 1500)
    return () => clearInterval(timer)
  }, [])
  const runAction = async (action: () => Promise<void>): Promise<void> => {
    try {
      await action()
      setRuns(await getNavioScriptRuns())
    } catch (error) {
      toast.error(String(error))
    }
  }
  const edit = (script?: INavioTrayScript): void => {
    setEditor(script || { id: crypto.randomUUID(), name: '', path: '', args: [] })
    setArgsText(JSON.stringify(script?.args || [], null, 2))
  }
  return (
    <div className="m-3 space-y-4">
      <section className="rounded-xl border border-default-200 p-5">
        <div className="flex items-center justify-between gap-5">
          <div>
            <h3 className="font-medium">代理终端</h3>
            <p className="text-xs text-default-500 leading-6 mt-2">
              打开独立 PowerShell 窗口，预设 HTTP_PROXY、HTTPS_PROXY 和
              ALL_PROXY。仅影响新窗口，不修改系统环境变量；代理内核需要保持运行。
            </p>
          </div>
          <Button
            size="sm"
            isLoading={terminalBusy}
            onPress={async () => {
              setTerminalBusy(true)
              try {
                await launchProxyTerminal()
              } catch (error) {
                toast.error(String(error))
              } finally {
                setTerminalBusy(false)
              }
            }}
          >
            打开终端
          </Button>
        </div>
      </section>
      <section className="rounded-xl border border-default-200 p-5">
        <div className="flex items-center justify-between gap-5">
          <div>
            <h3 className="font-medium">自定义托盘脚本</h3>
            <p className="text-xs text-default-500 leading-6 mt-2">
              只在你主动点击运行时执行；不会随软件启动。支持本机 .ps1 与 .exe，最长运行 60
              秒，可查看最近结果并停止。
            </p>
          </div>
          <Switch
            aria-label="启用托盘脚本"
            isSelected={enabled}
            onValueChange={async (value) => {
              if (value) setEnable(true)
              else {
                await patchAppConfig({ navioTrayScriptsEnabled: false })
                await Promise.all(
                  runs
                    .filter((run) => run.status === 'running')
                    .map((run) => stopNavioTrayScript(run.id))
                )
              }
            }}
          />
        </div>
        <div className="mt-5 divide-y divide-default-200">
          {scripts.map((script) => {
            const run = runs.find((item) => item.id === script.id)
            return (
              <div
                key={script.id}
                className="py-4 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <h4 className="text-sm">{script.name}</h4>
                  <p className="text-xs text-default-500 mt-1 break-all">{script.path}</p>
                  {run && (
                    <p className="text-xs text-default-500 mt-1">
                      {
                        {
                          running: '正在运行',
                          success: '运行完成',
                          failed: '运行失败',
                          stopped: '已停止'
                        }[run.status]
                      }
                    </p>
                  )}
                </div>
                <div className="flex gap-1">
                  {run && (
                    <Button size="sm" variant="light" onPress={() => setOutput(script.id)}>
                      结果
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="light"
                    isDisabled={run?.status === 'running'}
                    onPress={() => edit(script)}
                  >
                    编辑
                  </Button>
                  {run?.status === 'running' ? (
                    <Button
                      size="sm"
                      color="warning"
                      variant="flat"
                      onPress={() => void runAction(() => stopNavioTrayScript(script.id))}
                    >
                      停止
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="flat"
                      isDisabled={!enabled}
                      onPress={() => void runAction(() => runNavioTrayScript(script.id))}
                    >
                      运行
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="light"
                    color="danger"
                    isDisabled={run?.status === 'running'}
                    onPress={() =>
                      void patchAppConfig({
                        navioTrayScripts: scripts.filter((item) => item.id !== script.id)
                      })
                    }
                  >
                    移除
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
        <Button className="mt-3" variant="flat" size="sm" onPress={() => edit()}>
          添加本机脚本
        </Button>
        <p className="text-xs text-default-500 leading-6 mt-3">
          脚本以当前用户权限运行，遵守系统 PowerShell
          执行策略。仅添加你信任的代码；脚本输出仅保留本次运行期间的最近部分。
        </p>
      </section>
      <BaseConfirmModal
        isOpen={enable}
        title="启用自定义托盘脚本？"
        content="你添加的本机脚本可以访问当前用户的文件和网络。启用后仍需主动点击才会运行，不会自动执行。关闭此功能会停止 Navio 当前启动的脚本。"
        confirmText="启用"
        onCancel={() => setEnable(false)}
        onConfirm={() => {
          void patchAppConfig({ navioTrayScriptsEnabled: true })
          setEnable(false)
        }}
      />
      <Modal isOpen={Boolean(editor)} onClose={() => setEditor(undefined)}>
        <ModalContent>
          <ModalHeader>配置本机脚本</ModalHeader>
          <ModalBody>
            <Input
              label="名称"
              value={editor?.name || ''}
              onValueChange={(name) => editor && setEditor({ ...editor, name })}
            />
            <div className="flex items-end gap-2">
              <Input
                label="文件路径"
                value={editor?.path || ''}
                onValueChange={(path) => editor && setEditor({ ...editor, path })}
              />
              <Button
                onPress={async () => {
                  try {
                    const files = await getFilePath(['ps1', 'exe'])
                    if (files?.[0] && editor) setEditor({ ...editor, path: files[0] })
                  } catch (error) {
                    toast.error(String(error))
                  }
                }}
              >
                选择
              </Button>
            </div>
            <Textarea
              label="参数（JSON 字符串数组）"
              value={argsText}
              onValueChange={setArgsText}
              description={'例如 ["-Name", "示例"]；每一项按原样传递，不拼接成命令。'}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={() => setEditor(undefined)}>
              取消
            </Button>
            <Button
              color="primary"
              onPress={async () => {
                if (!editor) return
                try {
                  const args: unknown = JSON.parse(argsText)
                  if (
                    !Array.isArray(args) ||
                    args.some((arg) => typeof arg !== 'string') ||
                    args.length > 64
                  )
                    throw new Error('参数必须是最多 64 项的字符串数组')
                  if (!editor.name.trim() || !/\.(ps1|exe)$/i.test(editor.path))
                    throw new Error('请填写名称并选择 .ps1 或 .exe 文件')
                  const saved = { ...editor, args: args as string[] }
                  await patchAppConfig({
                    navioTrayScripts: [...scripts.filter((item) => item.id !== editor.id), saved]
                  })
                  setEditor(undefined)
                } catch (error) {
                  toast.error(String(error))
                }
              }}
            >
              保存
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      <Modal isOpen={Boolean(output)} onClose={() => setOutput(undefined)} size="2xl">
        <ModalContent>
          <ModalHeader>脚本运行结果</ModalHeader>
          <ModalBody>
            <pre className="text-xs whitespace-pre-wrap select-text max-h-[55vh] overflow-auto">
              {runs.find((run) => run.id === output)?.output || '脚本未输出文本。'}
            </pre>
          </ModalBody>
          <ModalFooter>
            <Button onPress={() => setOutput(undefined)}>关闭</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}
