import { Button, Card, CardBody, Chip, Textarea } from '@heroui/react'
import BasePage from '@renderer/components/base/base-page'
import { getSimpleConfig, publishSimpleConfig, saveSimpleDraft } from '@renderer/utils/ipc'
import { useEffect, useState } from 'react'
import type { SimpleModule, SimpleState } from '../../../../shared/simple-config'
import { SIMPLE_MODULES } from '../../../../shared/simple-config'
/* eslint-disable react/prop-types */

export const SimpleModuleEditor: React.FC<{ module: SimpleModule; title?: string }> = ({
  module,
  title
}) => {
  const [state, setState] = useState<SimpleState>()
  const [value, setValue] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [warning, setWarning] = useState<string>()
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    let active = true
    setState(undefined)
    setErrors([])
    getSimpleConfig()
      .then((next) => {
        if (!active) return
        setState(next)
        setValue(next.draft.modules[module] || '')
        setWarning(next.draftWarning)
      })
      .catch((error) => {
        if (active) setErrors([String(error)])
      })
    return () => {
      active = false
    }
  }, [module])
  const reload = async (): Promise<void> => {
    if (
      !window.confirm('重新载入会替换当前编辑框中尚未保存的文本。请先复制需要保留的修改。继续吗？')
    )
      return
    try {
      const next = await getSimpleConfig()
      setState(next)
      setValue(next.draft.modules[module] || '')
      setWarning(next.draftWarning)
      setErrors([])
    } catch (error) {
      setErrors([String(error)])
    }
  }
  const save = async (publish: boolean): Promise<void> => {
    if (!state) return
    setSaving(true)
    try {
      const draft = { ...state.draft, modules: { ...state.draft.modules, [module]: value } }
      const result = publish ? await publishSimpleConfig(draft) : await saveSimpleDraft(draft)
      setErrors(result.errors)
      if (!result.errors.length) {
        const saved = await getSimpleConfig()
        setState(saved)
        setValue(saved.draft.modules[module] || '')
        setWarning(saved.draftWarning)
      }
    } catch (error) {
      setErrors([String(error)])
    } finally {
      setSaving(false)
    }
  }
  return (
    <BasePage
      title={title || SIMPLE_MODULES[module]}
      header={
        <>
          <Chip size="sm" variant="flat">
            当前订阅
          </Chip>
          <Button
            size="sm"
            variant="light"
            className="app-nodrag"
            isDisabled={saving}
            onPress={reload}
          >
            重新载入
          </Button>
          <Button
            size="sm"
            variant="light"
            className="app-nodrag"
            isDisabled={!state || saving}
            onPress={() => save(false)}
          >
            保存草稿
          </Button>
          <Button
            size="sm"
            color="primary"
            className="app-nodrag"
            isLoading={saving}
            isDisabled={!state}
            onPress={() => save(true)}
          >
            应用修改
          </Button>
        </>
      }
    >
      <div className="p-2">
        <Card>
          <CardBody>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-small text-default-500">
                编辑当前订阅；远程订阅的修改单独保存，简易与标准模式共享同一配置。
              </span>
              <span className="ml-auto text-small text-default-500">
                {value.split('\n').length} 行
              </span>
            </div>
            {warning && (
              <div role="status" className="text-warning text-small mb-2 break-all">
                {warning}
              </div>
            )}
            <Textarea
              value={value}
              onValueChange={setValue}
              isDisabled={!state || saving}
              minRows={22}
              className="font-mono"
            />
            {errors.map((error) => (
              <div key={error} className="text-danger text-small mt-1">
                {error}
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
    </BasePage>
  )
}
