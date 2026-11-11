import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button } from '@heroui/react'
import React, { useEffect, useState } from 'react'
import { getProfileStr, setProfileStr } from '@renderer/utils/ipc'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BaseEditor } from '../base/base-editor'
import { toast } from '../base/toast'

interface Props {
  id: string
  onClose: () => void
}

const EditFileModal: React.FC<Props> = (props) => {
  const { id, onClose } = props
  const [currData, setCurrData] = useState('')
  const [saving, setSaving] = useState(false)
  const navigate = useNavigate()
  const { t } = useTranslation()

  useEffect(() => {
    const loadContent = async (): Promise<void> => {
      setCurrData(await getProfileStr(id))
    }
    void loadContent().catch((error) => toast.error(String(error)))
  }, [id])

  return (
    <Modal
      backdrop="blur"
      classNames={{ backdrop: 'top-[48px]' }}
      size="5xl"
      hideCloseButton
      isOpen={true}
      onOpenChange={onClose}
      scrollBehavior="inside"
    >
      <ModalContent className="h-full w-[calc(100%-100px)]">
        <ModalHeader className="flex pb-0 app-drag">
          <div className="flex justify-start">
            <div className="flex items-center">{t('profiles.editFile.title')}</div>
            <small className="ml-2 text-foreground-500">
              远程订阅的修改会独立保存，并在更新后继续应用。也可使用
              <Button
                size="sm"
                color="primary"
                variant="light"
                className="app-nodrag"
                onPress={() => {
                  navigate('/override')
                }}
              >
                {t('profiles.editFile.override')}
              </Button>
              {t('profiles.editFile.feature')}
            </small>
          </div>
        </ModalHeader>
        <ModalBody className="h-full">
          <BaseEditor language="yaml" value={currData} onChange={(value) => setCurrData(value)} />
        </ModalBody>
        <ModalFooter className="pt-0">
          <Button size="sm" variant="light" onPress={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            size="sm"
            color="primary"
            isLoading={saving}
            onPress={async () => {
              setSaving(true)
              try {
                await setProfileStr(id, currData)
                onClose()
              } catch (error) {
                toast.error(String(error))
              } finally {
                setSaving(false)
              }
            }}
          >
            {t('common.confirm')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default EditFileModal
