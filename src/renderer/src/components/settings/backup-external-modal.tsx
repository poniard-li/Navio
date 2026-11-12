import React, { useEffect, useState } from 'react'
import {
  Button,
  Checkbox,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Spinner
} from '@heroui/react'
import { approveBackupExternalFiles, previewBackupExternalFiles } from '@renderer/utils/ipc'
import type { BackupExternalPreview } from '../../../../shared/backup-external'

export default function BackupExternalModal({
  onClose,
  onApproved,
  actionLabel = '保存选择'
}: {
  onClose: () => void
  onApproved: () => void | Promise<void>
  actionLabel?: string
}): React.JSX.Element {
  const [report, setReport] = useState<BackupExternalPreview>()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const value = await previewBackupExternalFiles()
      setReport(value)
      setSelected(new Set(value.files.filter((file) => file.approved).map((file) => file.id)))
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    void load()
  }, [])
  return (
    <Modal
      isOpen
      size="3xl"
      scrollBehavior="inside"
      isDismissable={!busy}
      isKeyboardDismissDisabled={busy}
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <ModalContent>
        <ModalHeader>确认配置引用的外部文件</ModalHeader>
        <ModalBody>
          <p className="text-sm text-default-600 leading-6">
            只列出配置明确引用、位于 Navio 数据目录外的文件。勾选后记住具体路径，供本地和
            WebDAV（含定时）备份使用；新路径默认不勾选。恢复时复制到 Navio
            数据目录并更新引用，不覆盖原位置。
          </p>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          {!report && busy && <Spinner label="读取配置引用…" />}
          {report?.files.length === 0 && (
            <p className="p-4 rounded-lg bg-default-100 text-sm">
              没有发现需要确认的外部文件。备份仍包含 Navio 数据目录内的配置和资源。
            </p>
          )}
          {report?.files.map((file) => (
            <div key={file.id} className="rounded-lg border border-default-200 p-3">
              <Checkbox
                isSelected={selected.has(file.id)}
                isDisabled={busy || (file.state !== 'available' && !file.approved)}
                onValueChange={(value) =>
                  setSelected((previous) => {
                    const next = new Set(previous)
                    if (value) next.add(file.id)
                    else next.delete(file.id)
                    return next
                  })
                }
              >
                <span className="text-sm break-all select-text">{file.path}</span>
              </Checkbox>
              <p
                className={`ml-7 text-xs mt-1 ${file.state === 'available' ? 'text-default-500' : 'text-warning-700 dark:text-warning-400'}`}
              >
                {file.state === 'available'
                  ? `${((file.bytes || 0) / 1024).toFixed(1)} KB · ${file.approved ? '已批准' : '新路径，默认不包含'}`
                  : `${file.reason}；本次不会包含，缺失项会写入报告。`}
              </p>
              <details className="ml-7 mt-1 text-xs text-default-500">
                <summary>引用位置（{file.references.length}）</summary>
                <ul className="mt-1 space-y-1">
                  {file.references.map((reference, index) => (
                    <li key={index} className="break-all select-text">
                      {reference.document} · {reference.pointer.join(' / ')}
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          ))}
          {!!report?.warnings.length && (
            <div className="text-xs text-warning-700 dark:text-warning-400">
              <p>以下内容未自动收集：</p>
              {report.warnings.map((warning, index) => (
                <p key={index}>{warning}</p>
              ))}
            </div>
          )}
          <p className="text-xs text-default-500 leading-5">
            未勾选、缺失或无法读取的文件会写入备份报告。单文件上限 32 MB，外部文件合计上限 128
            MB。撤销勾选只影响之后的备份。
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="light" isDisabled={busy} onPress={onClose}>
            取消
          </Button>
          <Button variant="flat" isDisabled={busy} onPress={() => void load()}>
            重新读取
          </Button>
          <Button
            color="primary"
            isLoading={busy}
            isDisabled={!report}
            onPress={async () => {
              if (!report) return
              setBusy(true)
              setError('')
              try {
                await approveBackupExternalFiles(report.token, [...selected])
                await onApproved()
              } catch (err) {
                setError(String(err))
                setBusy(false)
              }
            }}
          >
            {actionLabel}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
