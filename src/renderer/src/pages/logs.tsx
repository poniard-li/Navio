import BasePage from '@renderer/components/base/base-page'
import LogItem from '@renderer/components/logs/log-item'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  Divider,
  Input,
  Select,
  SelectItem,
  Checkbox,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter
} from '@heroui/react'
import { LuPause, LuPlay, LuDownload, LuStethoscope } from 'react-icons/lu'
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso'
import { IoLocationSharp } from 'react-icons/io5'
import { CgTrash } from 'react-icons/cg'
import { useTranslation } from 'react-i18next'
import { includesIgnoreCase } from '@renderer/utils/includes'
import { redactLogText } from '../../../shared/log-export'

const LOGS_FILTER_KEY = 'logs-filter'
const LOGS_LEVEL_FILTER_KEY = 'logs-level-filter'
const MAX_CACHED_LOGS = 500
const LOG_RENDER_INTERVAL_MS = 100
const logLevelOrder: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warning: 2,
  info: 3,
  debug: 4
}

const cachedLogs: {
  log: IMihomoLogInfo[]
  trigger: ((i: IMihomoLogInfo[]) => void) | null
  clean: () => void
} = {
  log: [],
  trigger: null,
  clean(): void {
    this.log = []
    if (this.trigger !== null) {
      this.trigger(this.log)
    }
  }
}

const onLog = (_e: unknown, ...args: unknown[]): void => {
  const log = args[0] as IMihomoLogInfo
  log.time = new Date().toLocaleString()
  cachedLogs.log.push(log)
  if (cachedLogs.log.length > MAX_CACHED_LOGS) {
    cachedLogs.log.splice(0, cachedLogs.log.length - MAX_CACHED_LOGS)
  }
  cachedLogs.trigger?.(cachedLogs.log)
}

// Keep streaming while this page is hidden so returning users can see intervening logs.
// The session cache is bounded by MAX_CACHED_LOGS, so stopping on unmount hurts UX
// without providing meaningful memory savings.
const unsubscribeLogs = window.electron.ipcRenderer.on('mihomoLogs', onLog)

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    unsubscribeLogs()
  })
}

const Logs: React.FC = () => {
  const { t } = useTranslation()
  const [logs, setLogs] = useState<IMihomoLogInfo[]>(() => [...cachedLogs.log])
  const [filter, setFilter] = useState(() => {
    return localStorage.getItem(LOGS_FILTER_KEY) || ''
  })
  const [levelFilter, setLevelFilter] = useState<LogLevel>(() => {
    const savedLevel = localStorage.getItem(LOGS_LEVEL_FILTER_KEY)
    return savedLevel && savedLevel in logLevelOrder ? (savedLevel as LogLevel) : 'debug'
  })
  const [trace, setTrace] = useState(true)
  const [paused, setPaused] = useState(false)
  const [redact, setRedact] = useState(true)
  const [diagnosis, setDiagnosis] = useState(false)
  const pausedRef = useRef(false)
  pausedRef.current = paused
  const exportLogs = (): void => {
    const text = filteredLogs
      .map((log) => `[${log.time || ''}] [${log.type}] ${log.payload}`)
      .join('\n')
    const url = URL.createObjectURL(
      new Blob([redact ? redactLogText(text) : text], { type: 'text/plain;charset=utf-8' })
    )
    const link = document.createElement('a')
    link.href = url
    link.download = `Navio-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const virtuosoRef = useRef<VirtuosoHandle>(null)

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      return (
        logLevelOrder[log.type] <= logLevelOrder[levelFilter] &&
        (filter === '' ||
          includesIgnoreCase(log.payload, filter) ||
          includesIgnoreCase(log.type, filter))
      )
    })
  }, [logs, filter, levelFilter])

  useEffect(() => {
    localStorage.setItem(LOGS_FILTER_KEY, filter)
  }, [filter])

  useEffect(() => {
    localStorage.setItem(LOGS_LEVEL_FILTER_KEY, levelFilter)
  }, [levelFilter])

  useEffect(() => {
    const old = cachedLogs.trigger
    let renderTimer: ReturnType<typeof setTimeout> | null = null

    cachedLogs.trigger = (): void => {
      if (pausedRef.current || renderTimer !== null) return
      renderTimer = setTimeout(() => {
        renderTimer = null
        if (!pausedRef.current) setLogs([...cachedLogs.log])
      }, LOG_RENDER_INTERVAL_MS)
    }

    return (): void => {
      cachedLogs.trigger = old
      if (renderTimer !== null) {
        clearTimeout(renderTimer)
      }
    }
  }, [])

  return (
    <BasePage title={t('logs.title')} contentClassName="flex flex-col overflow-hidden">
      <div className="shrink-0 z-40">
        <div className="w-full flex flex-wrap items-center gap-2 p-2">
          <Input
            size="sm"
            className="min-w-40 flex-1"
            aria-label="搜索日志"
            value={filter}
            placeholder={t('logs.filter')}
            isClearable
            onValueChange={setFilter}
          />
          <Select
            size="sm"
            className="ml-2 w-28 shrink-0"
            aria-label={t('mihomo.selectLogLevel')}
            selectedKeys={[levelFilter]}
            disallowEmptySelection
            onSelectionChange={(selection) => {
              const level = selection.currentKey
              if (level && level in logLevelOrder) setLevelFilter(level as LogLevel)
            }}
          >
            <SelectItem key="silent">{t('mihomo.silent')}</SelectItem>
            <SelectItem key="error">{t('mihomo.error')}</SelectItem>
            <SelectItem key="warning">{t('mihomo.warning')}</SelectItem>
            <SelectItem key="info">{t('mihomo.info')}</SelectItem>
            <SelectItem key="debug">全部</SelectItem>
          </Select>
          <Button
            size="sm"
            isIconOnly
            className="ml-2"
            color={trace ? 'primary' : 'default'}
            variant={trace ? 'solid' : 'bordered'}
            title={t('logs.autoScroll')}
            onPress={() => {
              setTrace((prev) => !prev)
            }}
          >
            <IoLocationSharp className="text-lg" />
          </Button>
          <Button
            size="sm"
            isIconOnly
            title={t('logs.clear')}
            className="ml-2"
            variant="light"
            color="danger"
            onPress={() => {
              cachedLogs.clean()
              setLogs([])
            }}
          >
            <CgTrash className="text-lg" />
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-2 pb-2">
          <Button
            size="sm"
            variant="flat"
            startContent={paused ? <LuPlay /> : <LuPause />}
            onPress={() => {
              setPaused(!paused)
              if (paused) setLogs([...cachedLogs.log])
            }}
          >
            {paused ? '继续' : '暂停'}
          </Button>
          <Button
            size="sm"
            variant="flat"
            startContent={<LuDownload />}
            onPress={exportLogs}
            isDisabled={!filteredLogs.length}
          >
            导出当前结果
          </Button>
          <Button
            size="sm"
            variant="flat"
            startContent={<LuStethoscope />}
            onPress={() => setDiagnosis(true)}
          >
            诊断
          </Button>
          <Checkbox size="sm" isSelected={redact} onValueChange={setRedact}>
            导出时隐藏 IP 与常见敏感字段
          </Checkbox>
          <span className="text-xs text-default-500 ml-auto">
            {filteredLogs.length} / {logs.length} 条{paused ? ' · 已暂停显示' : ' · 实时接收'}
          </span>
        </div>
        <Divider />
      </div>
      <div className="flex-1 min-h-0 mt-px">
        <Virtuoso
          ref={virtuosoRef}
          data={filteredLogs}
          initialTopMostItemIndex={filteredLogs.length - 1}
          followOutput={trace}
          itemContent={(i, log) => (
            <LogItem index={i} time={log.time} type={log.type} payload={log.payload} />
          )}
        />
      </div>
      <Modal isOpen={diagnosis} onOpenChange={setDiagnosis} size="2xl" scrollBehavior="inside">
        <ModalContent>
          <ModalHeader>日志诊断</ModalHeader>
          <ModalBody>
            <p className="text-sm text-default-500">
              分析本机已接收的最近 {logs.length} 条日志。不会上传日志，也不会修改网络设置。
            </p>
            <div className="grid grid-cols-3 gap-3 text-sm">
              {(['error', 'warning', 'info'] as const).map((level) => (
                <div key={level} className="rounded-lg bg-content2 p-3">
                  {{ error: '错误', warning: '警告', info: '信息' }[level]}
                  <strong className="block mt-1 text-xl">
                    {logs.filter((log) => log.type === level).length}
                  </strong>
                </div>
              ))}
            </div>
            <p className="text-sm">
              {logs.some((log) => log.type === 'error' || log.type === 'warning')
                ? '下列记录可用于排查；单条错误不一定表示连接已中断。'
                : '当前缓存中没有错误或警告。线路是否可用仍需通过实际连接或测速确认。'}
            </p>
            {logs
              .filter((log) => log.type === 'error' || log.type === 'warning')
              .slice(-20)
              .reverse()
              .map((log, i) => (
                <pre
                  key={i}
                  className="whitespace-pre-wrap break-all rounded-lg bg-content2 p-3 text-xs"
                >
                  {log.time} · {log.type}
                  {'\n'}
                  {redactLogText(log.payload)}
                </pre>
              ))}
          </ModalBody>
          <ModalFooter>
            <Button onPress={() => setDiagnosis(false)}>关闭</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </BasePage>
  )
}

export default Logs
