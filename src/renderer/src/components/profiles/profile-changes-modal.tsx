import { useEffect, useState } from 'react'
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Spinner,
  Tab,
  Tabs
} from '@heroui/react'
import { getProfileChanges, resolveProfileChanges, type ProfileChanges } from '@renderer/utils/ipc'
import { toast } from '../base/toast'
const displayValue = (value: unknown): string =>
  value === undefined ? '（此项已删除）' : JSON.stringify(value, null, 2)

export default function ProfileChangesModal({
  id,
  onClose
}: {
  id: string
  onClose: () => void
}): React.JSX.Element {
  const [changes, setChanges] = useState<ProfileChanges>()
  const [busy, setBusy] = useState(false)
  const [choices, setChoices] = useState<Record<string, 'local' | 'incoming'>>({})
  const [error, setError] = useState('')
  useEffect(() => {
    void getProfileChanges(id)
      .then(setChanges)
      .catch((err) => setError(String(err)))
  }, [id])
  const resolve = async (): Promise<void> => {
    if (!changes) return
    setBusy(true)
    try {
      await resolveProfileChanges(id, { revision: changes.revision, choices })
      setChanges(await getProfileChanges(id))
      setChoices({})
      setError('')
      toast.success('冲突已处理')
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Modal
        size="5xl"
        isOpen
        onClose={busy ? undefined : onClose}
        isDismissable={!busy}
        hideCloseButton={busy}
        scrollBehavior="inside"
      >
        <ModalContent>
          <ModalHeader>本地修改与订阅更新</ModalHeader>
          <ModalBody>
            <p className="text-xs text-default-500 leading-6">
              订阅原始内容与本地修改分别保存。更新时会重新应用本地修改，遇到无法自动合并的内容会暂停替换，等待你确认。下方内容可能包含订阅及节点凭据。
            </p>
            {error && (
              <p role="alert" className="text-danger text-sm">
                {error}
              </p>
            )}
            {!changes && !error && <Spinner />}
            {changes && (
              <>
                <p className="text-sm">
                  {changes.hasPending
                    ? `有 ${changes.conflicts.length} 项冲突需要处理`
                    : changes.hasChanges
                      ? '本地修改已独立保存'
                      : '当前没有独立的本地修改'}
                </p>
                <Tabs aria-label="对照配置内容" variant="underlined">
                  {changes.hasPending && (
                    <Tab
                      key="conflicts"
                      title={`逐项确认（${Object.keys(choices).length}/${changes.details.length}）`}
                    >
                      <p className="text-xs text-default-500 mb-3">
                        每项选择本地内容或本次订阅内容。确认应用前继续使用原配置，未冲突的新内容会自动合并。
                      </p>
                      <div className="flex gap-2 mb-4">
                        <Button
                          size="sm"
                          variant="flat"
                          isDisabled={busy}
                          onPress={() =>
                            setChoices(
                              Object.fromEntries(changes.conflicts.map((path) => [path, 'local']))
                            )
                          }
                        >
                          全部选择本地
                        </Button>
                        <Button
                          size="sm"
                          variant="flat"
                          isDisabled={busy}
                          onPress={() =>
                            setChoices(
                              Object.fromEntries(
                                changes.conflicts.map((path) => [path, 'incoming'])
                              )
                            )
                          }
                        >
                          全部选择订阅
                        </Button>
                      </div>
                      <div className="space-y-4">
                        {changes.details.map((item) => (
                          <section
                            key={item.path}
                            className="rounded-xl border border-warning-300 p-3 space-y-3"
                          >
                            <h4 className="text-sm font-medium break-all">
                              {decodeURIComponent(item.path)}
                            </h4>
                            <details className="text-xs text-default-500">
                              <summary className="cursor-pointer">更新前的原始内容</summary>
                              <pre className="overflow-auto p-2 select-text">
                                {displayValue(item.base)}
                              </pre>
                            </details>
                            <div className="grid sm:grid-cols-2 gap-3">
                              {(['local', 'incoming'] as const).map((side) => {
                                const value = item[side]
                                const selected = choices[item.path] === side
                                return (
                                  <div
                                    key={side}
                                    className={`rounded-lg border p-3 ${selected ? 'border-primary bg-primary-50' : 'border-default-200'}`}
                                  >
                                    <Button
                                      size="sm"
                                      variant={selected ? 'solid' : 'flat'}
                                      color={selected ? 'primary' : 'default'}
                                      aria-pressed={selected}
                                      isDisabled={busy}
                                      onPress={() =>
                                        setChoices((previous) => ({
                                          ...previous,
                                          [item.path]: side
                                        }))
                                      }
                                    >
                                      {side === 'local' ? '保留本地' : '使用本次订阅'}
                                      {selected ? ' · 已选择' : ''}
                                    </Button>
                                    <pre className="mt-2 max-h-52 overflow-auto select-text text-xs leading-6 whitespace-pre-wrap break-all">
                                      {displayValue(value)
                                        .split('\n')
                                        .map((line, index) => (
                                          <span
                                            key={index}
                                            className={`block ${!displayValue(item.base).split('\n').includes(line) ? 'bg-warning-100 text-warning-800 dark:text-warning-300' : ''}`}
                                          >
                                            {line || ' '}
                                          </span>
                                        ))}
                                    </pre>
                                  </div>
                                )
                              })}
                            </div>
                          </section>
                        ))}
                      </div>
                    </Tab>
                  )}
                  <Tab key="base" title="订阅原始内容">
                    <pre className="max-h-[48vh] overflow-auto select-text p-4 rounded-lg bg-default-100 text-xs leading-6">
                      {changes.base || '无原始快照'}
                    </pre>
                  </Tab>
                  <Tab key="local" title="含本地修改">
                    <pre className="max-h-[48vh] overflow-auto select-text p-4 rounded-lg bg-default-100 text-xs leading-6">
                      {changes.local || '无本地修改'}
                    </pre>
                  </Tab>
                  <Tab key="incoming" title="本次订阅更新">
                    <pre className="max-h-[48vh] overflow-auto select-text p-4 rounded-lg bg-default-100 text-xs leading-6">
                      {changes.incoming || '没有待处理的订阅更新'}
                    </pre>
                  </Tab>
                </Tabs>
              </>
            )}
          </ModalBody>
          <ModalFooter>
            {changes?.hasPending && (
              <>
                <Button
                  variant="flat"
                  isDisabled={busy}
                  onPress={async () => {
                    try {
                      setChanges(await getProfileChanges(id))
                      setChoices({})
                      setError('')
                    } catch (err) {
                      setError(String(err))
                    }
                  }}
                >
                  重新读取
                </Button>
                <Button
                  color="primary"
                  isLoading={busy}
                  isDisabled={changes.conflicts.some((path) => !choices[path])}
                  onPress={() => void resolve()}
                >
                  确认并应用所选内容
                </Button>
              </>
            )}
            <Button variant="light" isDisabled={busy} onPress={onClose}>
              关闭
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
