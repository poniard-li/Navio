import { useRef, useState } from 'react'
import { Button, Modal, ModalBody, ModalContent, ModalHeader } from '@heroui/react'
import { LuArrowRight, LuLayers, LuSlidersHorizontal } from 'react-icons/lu'
import { toast } from '@renderer/components/base/toast'
import { DEVELOPER_NAME, PRODUCT_NAME } from '../../../../shared/product'
import './onboarding.css'

interface ModeSelectionProps {
  canDismiss: boolean
  currentMode?: 'standard' | 'simple'
  onClose: () => void
  onSelect: (mode: 'standard' | 'simple') => Promise<void>
}

export default function ModeSelection({
  canDismiss,
  currentMode,
  onClose,
  onSelect
}: ModeSelectionProps): React.JSX.Element {
  const [selectingMode, setSelectingMode] = useState<'standard' | 'simple' | null>(null)
  const selecting = useRef(false)
  const busy = selectingMode !== null
  return (
    <Modal
      isOpen
      hideCloseButton={!canDismiss || busy}
      isDismissable={canDismiss && !busy}
      isKeyboardDismissDisabled={!canDismiss || busy}
      onClose={onClose}
      size="2xl"
      scrollBehavior="inside"
      classNames={{ base: 'dex-setup-modal', backdrop: 'dex-setup-backdrop' }}
    >
      <ModalContent>
        <ModalHeader className="dex-setup-heading">
          <span className="dex-setup-eyebrow">{canDismiss ? '配置模式' : '初次使用 · 01'}</span>
          <h1>{canDismiss ? '选择适合你的配置方式' : `欢迎使用 ${PRODUCT_NAME}`}</h1>
          <p>我们会记住你的选择。之后可随时在设置中切换。</p>
        </ModalHeader>
        <ModalBody className="dex-setup-body">
          <div className="dex-setup-choices" aria-busy={busy}>
            {(['standard', 'simple'] as const).map((mode) => {
              const standard = mode === 'standard'
              const Icon = standard ? LuSlidersHorizontal : LuLayers
              return (
                <Button
                  key={mode}
                  variant="bordered"
                  className="dex-setup-choice"
                  aria-labelledby={`operation-mode-${mode}-label`}
                  aria-describedby={`operation-mode-${mode}-description`}
                  isDisabled={busy}
                  isLoading={selectingMode === mode}
                  onPress={async () => {
                    if (selecting.current) return
                    selecting.current = true
                    setSelectingMode(mode)
                    try {
                      await onSelect(mode)
                      onClose()
                    } catch (error) {
                      toast.error(String(error), '配置模式切换失败')
                    } finally {
                      selecting.current = false
                      setSelectingMode(null)
                    }
                  }}
                >
                  <span className="dex-setup-choice-top">
                    <Icon aria-hidden="true" />
                    {canDismiss && currentMode === mode && <small>正在使用</small>}
                  </span>
                  <span id={`operation-mode-${mode}-label`} className="dex-setup-choice-title">
                    {standard ? '标准模式' : '简易模式'}
                  </span>
                  <span id={`operation-mode-${mode}-description`} className="dex-setup-choice-copy">
                    {standard
                      ? '沿用订阅或本地配置中的节点和规则，完整掌握每项设置。'
                      : '保留同一套订阅与规则，收起高级选项，随时可以展开。'}
                  </span>
                  <span className="dex-setup-choice-note">
                    {standard
                      ? '适合已有配置、需要精细控制的用户'
                      : '适合希望分步设置、减少界面干扰的用户'}
                  </span>
                  <span className="dex-setup-choice-action">
                    选择{standard ? '标准' : '简易'}模式 <LuArrowRight aria-hidden="true" />
                  </span>
                </Button>
              )
            })}
          </div>
          <div className="dex-setup-notes">
            <p>两种模式使用同一套订阅、节点与规则。切换只改变界面展示，不改变连接和路由。</p>
            <p>选择模式不会开启系统代理或 TUN。初次选择后，会带你认识常用操作。</p>
          </div>
          <span className="dex-setup-credit">Built by {DEVELOPER_NAME}</span>
        </ModalBody>
      </ModalContent>
    </Modal>
  )
}
