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
import BaseConfirmModal from '../base/base-confirm-modal'

export default function ProfileChangesModal({
  id,
  onClose
}: {
  id: string
  onClose: () => void
}): React.JSX.Element {
  const [changes, setChanges] = useState<ProfileChanges>()
  const [busy, setBusy] = useState(false)
  const [discard, setDiscard] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    void getProfileChanges(id)
      .then(setChanges)
      .catch((err) => setError(String(err)))
  }, [id])
  const resolve = async (choice: 'keep-local' | 'use-incoming'): Promise<void> => {
    setBusy(true)
    try {
      await resolveProfileChanges(id, choice)
      setChanges(await getProfileChanges(id))
      setDiscard(false)
      toast.success('冲突已处理')
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Modal size="4xl" isOpen onClose={onClose} scrollBehavior="inside">
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
                {changes.conflicts.length > 0 && (
                  <ul className="text-xs text-warning list-disc pl-5">
                    {changes.conflicts.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )}
                <Tabs aria-label="对照配置内容" variant="underlined">
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
                  color="danger"
                  isDisabled={busy}
                  onPress={() => setDiscard(true)}
                >
                  使用订阅更新，放弃全部本地修改
                </Button>
                <Button color="primary" isLoading={busy} onPress={() => void resolve('keep-local')}>
                  保留本地修改并合并
                </Button>
              </>
            )}
            <Button variant="light" isDisabled={busy} onPress={onClose}>
              关闭
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      <BaseConfirmModal
        isOpen={discard}
        isLoading={busy}
        title="使用订阅中的内容？"
        content="此订阅的全部本地修改将被放弃，配置会完整采用待处理的订阅更新。请先在对照页面保存需要保留的内容。"
        onCancel={() => setDiscard(false)}
        onConfirm={() => void resolve('use-incoming')}
      />
    </>
  )
}
