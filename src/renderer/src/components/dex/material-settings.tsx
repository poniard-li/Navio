import { useEffect, useId, useState, type ReactNode } from 'react'
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react'
import { useNavioMaterial } from '@renderer/hooks/use-navio-material'
import { useNavioMotion } from '@renderer/hooks/use-navio-motion'
import {
  DEFAULT_NAVIO_MATERIAL,
  NAVIO_MATERIAL_PRESETS,
  type NavioMaterialMode,
  type NavioMaterialRegion,
  type NavioMotionPolicy
} from '../../../../shared/navio-material'
export { NavioMaterialProvider } from '@renderer/hooks/use-navio-material'

const REGIONS: [NavioMaterialRegion, string][] = [
  ['sidebar', '侧栏与标题栏'],
  ['cards', '内容卡片'],
  ['dialogs', '弹窗']
]
const MODES: [NavioMaterialMode, string, string][] = [
  ['solid', '实色', '清晰的纯色表面'],
  ['frosted', '磨砂', '柔化背景细节'],
  ['glass', '通透玻璃', '透光层次与反光']
]

export function openMaterialSettings(): void {
  window.dispatchEvent(new Event('navio:open-material'))
}
export function MaterialSettingsButton({
  children = '窗口材质',
  className = ''
}: {
  children?: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <Button size="sm" variant="flat" className={className} onPress={openMaterialSettings}>
      {children}
    </Button>
  )
}

function MaterialRange({
  label,
  value,
  max,
  unit = '%',
  disabled = false,
  onChange
}: {
  label: string
  value: number
  max: number
  unit?: string
  disabled?: boolean
  onChange: (value: number) => void
}): React.JSX.Element {
  const id = useId()
  const { saveMaterial } = useNavioMaterial()
  const commit = (): void => {
    void saveMaterial()
  }
  return (
    <label className="navio-material-range" htmlFor={id} data-disabled={disabled}>
      <span>
        {label}
        <output htmlFor={id}>
          {value}
          {unit}
        </output>
      </span>
      <input
        id={id}
        type="range"
        min={0}
        max={max}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        onPointerUp={commit}
        onPointerCancel={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
    </label>
  )
}

export function NavioMaterialSettingsPanel({
  region,
  onRegionChange
}: {
  region: NavioMaterialRegion
  onRegionChange: (region: NavioMaterialRegion) => void
}): React.JSX.Element {
  const { material, updateMaterial, saveMaterial } = useNavioMaterial()
  const motion = useNavioMotion()
  const [contrast, setContrast] = useState(false)
  useEffect(() => {
    const queries = [matchMedia('(prefers-contrast: more)'), matchMedia('(forced-colors: active)')]
    const update = (): void => setContrast(queries.some((query) => query.matches))
    update()
    queries.forEach((query) => query.addEventListener('change', update))
    return () => queries.forEach((query) => query.removeEventListener('change', update))
  }, [])
  const surface = material.regions[region]
  const changeValue = (key: 'transparency' | 'blur' | 'sheen', value: number): void =>
    updateMaterial((current) => ({
      ...current,
      regions: { ...current.regions, [region]: { ...current.regions[region], [key]: value } }
    }))
  return (
    <div className="navio-material-editor">
      <p className="navio-material-intro" role="status">
        {contrast
          ? '系统高对比度已启用，当前显示实色；保存的材质设置保持不变。'
          : '材质独立于主题保存。调节立即生效，切换主题时继续使用。'}
      </p>
      <div className="navio-material-regions" role="group" aria-label="调整区域">
        {REGIONS.map(([key, title]) => (
          <button
            key={key}
            type="button"
            aria-pressed={region === key}
            onClick={() => onRegionChange(key)}
          >
            {title}
          </button>
        ))}
      </div>
      <div className="navio-material-modes" role="group" aria-label="材质类型">
        {MODES.map(([mode, title, description]) => (
          <button
            key={mode}
            type="button"
            aria-pressed={surface.mode === mode}
            onClick={() => {
              updateMaterial((current) => ({
                ...current,
                regions: { ...current.regions, [region]: { ...NAVIO_MATERIAL_PRESETS[mode] } }
              }))
              void saveMaterial()
            }}
          >
            <span
              className={`navio-material-swatch navio-material-swatch-${mode}`}
              aria-hidden="true"
            >
              <i />
            </span>
            <strong>{title}</strong>
            <small>{description}</small>
          </button>
        ))}
      </div>
      <div className="navio-material-ranges">
        <MaterialRange
          label="透明度"
          value={surface.transparency}
          max={65}
          disabled={surface.mode === 'solid'}
          onChange={(value) => changeValue('transparency', value)}
        />
        <MaterialRange
          label="背景模糊"
          value={surface.blur}
          max={40}
          unit=" px"
          disabled={surface.mode === 'solid'}
          onChange={(value) => changeValue('blur', value)}
        />
        <MaterialRange
          label="表面光泽"
          value={surface.sheen}
          max={100}
          disabled={surface.mode === 'solid'}
          onChange={(value) => changeValue('sheen', value)}
        />
      </div>
      <p className="navio-material-hint">
        {surface.mode === 'solid'
          ? '实色不透出背景。选择磨砂或通透玻璃后可调整细节。'
          : '调整窗口内部的透光效果，保留文字底衬。'}
      </p>
      <div className="navio-material-motion">
        <MaterialRange
          label="背景流动强度"
          value={material.flow}
          max={100}
          onChange={(flow) => updateMaterial((current) => ({ ...current, flow }))}
        />
        <p className="navio-material-hint">
          设为 0 暂停背景流动；角色仍遵循主题设置和下方动效策略。
        </p>
        <label className="navio-material-policy">
          <span>动效策略</span>
          <select
            value={material.motionPolicy}
            onChange={(event) => {
              const motionPolicy = event.target.value as NavioMotionPolicy
              updateMaterial((current) => ({ ...current, motionPolicy }))
              void saveMaterial()
            }}
          >
            <option value="balanced">自动平衡</option>
            <option value="full">完整动效</option>
            <option value="off">关闭动效</option>
          </select>
        </label>
        <p className="navio-material-hint" role="status">
          {motion.reason}
        </p>
        <p className="navio-material-hint">
          自动平衡在电池供电或系统限制性能时降低负载。窗口隐藏时暂停，并遵循系统减少动态效果设置。
        </p>
      </div>
    </div>
  )
}

export default function MaterialSettings(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [region, setRegion] = useState<NavioMaterialRegion>('sidebar')
  const { updateMaterial, saveMaterial, saving, error } = useNavioMaterial()
  useEffect(() => {
    const show = (): void => setOpen(true)
    window.addEventListener('navio:open-material', show)
    return () => window.removeEventListener('navio:open-material', show)
  }, [])
  const close = async (): Promise<void> => {
    if (await saveMaterial()) setOpen(false)
  }
  return (
    <Modal
      isOpen={open}
      onOpenChange={(value) => {
        if (!value) void close()
      }}
      scrollBehavior="inside"
      size="lg"
      isDismissable={!saving}
      classNames={{ base: 'navio-material-dialog', body: 'navio-material-dialog-body' }}
    >
      <ModalContent>
        <ModalHeader>窗口材质</ModalHeader>
        <ModalBody>
          <NavioMaterialSettingsPanel region={region} onRegionChange={setRegion} />
          {error && (
            <p role="alert" className="text-danger text-sm">
              {error}，请重试。
            </p>
          )}
        </ModalBody>
        <ModalFooter>
          <Button
            variant="light"
            onPress={() => {
              updateMaterial((current) => ({
                ...current,
                regions: {
                  ...current.regions,
                  [region]: { ...DEFAULT_NAVIO_MATERIAL.regions[region] }
                }
              }))
              void saveMaterial()
            }}
          >
            恢复本区域默认
          </Button>
          <Button color="primary" isLoading={saving} onPress={() => void close()}>
            {error ? '重试保存' : '完成'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
