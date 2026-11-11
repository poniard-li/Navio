import { Button, Card, CardBody, CardFooter } from '@heroui/react'
import { FaCircleArrowDown, FaCircleArrowUp } from 'react-icons/fa6'
import { useLocation } from 'react-router-dom'
import { calcTraffic } from '@renderer/utils/calc'
import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { IoLink } from 'react-icons/io5'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { useControledMihomoConfig } from '@renderer/hooks/use-controled-mihomo-config'
import { platform } from '@renderer/utils/init'
import { getTrayTrafficStyle, updateTrayIcon } from '@renderer/utils/ipc'
import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  ChartOptions,
  ScriptableContext
} from 'chart.js'
import { useTranslation } from 'react-i18next'
import navioTrayIcon from '../../../../../resources/iconTemplate.png?inline'
import SiderItem from './sider-item'

// 注册 Chart.js 组件
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler)

interface Props {
  iconOnly?: boolean
  expanded?: boolean
}
const ConnCard: React.FC<Props> = (props) => {
  const { iconOnly, expanded } = props
  const { appConfig } = useAppConfig()
  const { controledMihomoConfig } = useControledMihomoConfig()
  const {
    showTraffic = false,
    connectionCardStatus = 'col-span-2',
    disableAnimations = false,
    hideConnectionCardWave = false,
    disableTrayIconColor = false,
    trayTrafficTextColor = 'auto'
  } = appConfig || {}
  const sysProxyEnabled = appConfig?.sysProxy?.enable
  const tunEnabled = controledMihomoConfig?.tun?.enable
  const location = useLocation()
  const match = location.pathname.includes('/connections')
  const { t } = useTranslation()

  const [upload, setUpload] = useState(0)
  const [download, setDownload] = useState(0)
  const {
    attributes,
    listeners,
    setNodeRef,
    transform: tf,
    transition,
    isDragging
  } = useSortable({
    id: 'connection'
  })
  const [series, setSeries] = useState(Array(10).fill(0))

  // 使用 useRef 替代模块级变量
  const currentUploadRef = useRef<number | undefined>(undefined)
  const currentDownloadRef = useRef<number | undefined>(undefined)
  const hasShowTrafficRef = useRef(false)
  const showTrafficRef = useRef(showTraffic)
  showTrafficRef.current = showTraffic

  // Chart.js 配置
  const chartData = useMemo(() => {
    return {
      labels: Array(10).fill(''),
      datasets: [
        {
          data: series,
          fill: true,
          backgroundColor: (context: ScriptableContext<'line'>) => {
            const chart = context.chart
            const { ctx, chartArea } = chart
            if (!chartArea) {
              return 'transparent'
            }

            const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom)

            // 颜色处理
            const isMatch = location.pathname.includes('/connections')
            const baseColor = isMatch ? '6, 182, 212' : '161, 161, 170' // primary vs foreground 的近似 RGB 值

            gradient.addColorStop(0, `rgba(${baseColor}, 0.8)`)
            gradient.addColorStop(1, `rgba(${baseColor}, 0)`)
            return gradient
          },
          borderColor: 'transparent',
          pointRadius: 0,
          pointHoverRadius: 0,
          tension: 0.4
        }
      ]
    }
  }, [series, location.pathname])

  const chartOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false
      }
    },
    scales: {
      x: {
        display: false
      },
      y: {
        display: false
      }
    },
    elements: {
      line: {
        borderWidth: 0
      }
    },
    interaction: {
      intersect: false
    },
    animation: {
      duration: 0
    }
  }

  const transform = tf ? { x: tf.x, y: tf.y, scaleX: 1, scaleY: 1 } : null

  // 使用 useCallback 创建稳定的 handler 引用，通过 ref 读取 showTraffic 避免重建
  const handleTraffic = useCallback((_e: unknown, ...args: unknown[]) => {
    const info = args[0] as IMihomoTrafficInfo
    setUpload(info.up)
    setDownload(info.down)
    setSeries((prev) => {
      const data = [...prev]
      data.shift()
      data.push(info.up + info.down)
      return data
    })
    if (platform === 'darwin' && showTrafficRef.current) {
      const up = info.up
      const down = info.down
      if (up !== currentUploadRef.current || down !== currentDownloadRef.current) {
        currentUploadRef.current = up
        currentDownloadRef.current = down
        const png = renderTrafficIcon(up, down)
        window.electron.ipcRenderer.send('trayIconUpdate', png, true, trayIconColored)
      }
    }
  }, [])

  useEffect(() => {
    return window.electron.ipcRenderer.on('mihomoTraffic', handleTraffic)
  }, [handleTraffic])

  // showTraffic 开关切换时统一管理托盘图标
  useEffect(() => {
    if (platform !== 'darwin') return
    if (showTraffic) {
      // 开启：立即显示默认流量图标，重置缓存以确保下次流量事件触发更新
      currentUploadRef.current = undefined
      currentDownloadRef.current = undefined
      const png = renderTrafficIcon(0, 0)
      window.electron.ipcRenderer.send('trayIconUpdate', png, true, trayIconColored)
      hasShowTrafficRef.current = true
    } else if (hasShowTrafficRef.current) {
      // 关闭：先让主进程退出流量图标模式（enabled=false 会清掉它的提前 return），
      // 再请主进程用 resources 里的真实图标重绘一次；只发这条 IPC 的话托盘会一直停在
      // 渲染进程发过去的这张兜底图上，状态色丢失且必须重启才恢复
      window.electron.ipcRenderer.send('trayIconUpdate', trayIconBase64, false, false)
      hasShowTrafficRef.current = false
      updateTrayIcon().catch(() => {})
    }
  }, [showTraffic])

  // 网速图标是渲染进程把图标和文字合成一张图交给主进程显示的，主进程无法再往上叠状态色，
  // 所以系统代理/虚拟网卡的颜色必须在这里一起画进去，否则打开网速显示后颜色就失效（#1143）。
  useEffect(() => {
    if (platform !== 'darwin' || !showTraffic) return
    let cancelled = false
    const syncTrayStyle = async (): Promise<void> => {
      const style = await getTrayTrafficStyle()
      let logo: HTMLImageElement | null = null
      if (style.icon) {
        const image = new Image()
        image.src = style.icon
        // 先解码再启用，避免这一帧画出一个没有图标的托盘
        try {
          await image.decode()
          logo = image
        } catch {
          logo = null
        }
      }
      if (cancelled) return
      trayLogo = logo
      trayTextColor = style.textColor
      trayIconColored = style.colored
      const png = renderTrafficIcon(currentUploadRef.current ?? 0, currentDownloadRef.current ?? 0)
      window.electron.ipcRenderer.send('trayIconUpdate', png, true, style.colored)
    }
    syncTrayStyle().catch(() => {})
    return (): void => {
      cancelled = true
    }
  }, [showTraffic, sysProxyEnabled, tunEnabled, disableTrayIconColor, trayTrafficTextColor])

  if (iconOnly) {
    return (
      <SiderItem
        className={connectionCardStatus}
        title={t('sider.cards.connections')}
        route="/connections"
        icon={<IoLink className="text-[20px]" />}
        expanded={expanded}
      />
    )
  }

  return (
    <div
      style={{
        position: 'relative',
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 'calc(infinity)' : undefined
      }}
      className={`${connectionCardStatus} conn-card`}
    >
      {connectionCardStatus === 'col-span-2' ? (
        <>
          <Card
            fullWidth
            ref={setNodeRef}
            {...attributes}
            {...listeners}
            className={`${match ? 'bg-primary' : 'hover:bg-primary/30'} ${disableAnimations ? '' : `motion-reduce:transition-transform-background ${isDragging ? 'scale-[0.95] tap-highlight-transparent' : ''}`}`}
          >
            {!hideConnectionCardWave && (
              <div className="w-full h-full absolute top-0 left-0 pointer-events-none overflow-hidden rounded-[14px]">
                <Line data={chartData} options={chartOptions} />
              </div>
            )}
            <CardBody className="pb-1 pt-0 px-0">
              <div className="flex justify-between">
                <Button
                  isIconOnly
                  className="bg-transparent pointer-events-none"
                  variant="flat"
                  color="default"
                >
                  <IoLink
                    color="default"
                    className={`${match ? 'text-primary-foreground' : 'text-foreground'} text-[24px]`}
                  />
                </Button>
                <div
                  className={`p-2 w-full ${match ? 'text-primary-foreground' : 'text-foreground'} `}
                >
                  <div className="flex justify-between">
                    <div className="w-full text-right mr-2">{calcTraffic(upload)}/s</div>
                    <FaCircleArrowUp className="h-[24px] leading-[24px]" />
                  </div>
                  <div className="flex justify-between">
                    <div className="w-full text-right mr-2">{calcTraffic(download)}/s</div>
                    <FaCircleArrowDown className="h-[24px] leading-[24px]" />
                  </div>
                </div>
              </div>
            </CardBody>
            <CardFooter className="pt-1">
              <h3
                className={`text-md font-bold sider-card-title ${match ? 'text-primary-foreground' : 'text-foreground'}`}
              >
                {t('sider.cards.connections')}
              </h3>
            </CardFooter>
          </Card>
        </>
      ) : (
        <Card
          fullWidth
          ref={setNodeRef}
          {...attributes}
          {...listeners}
          className={`${match ? 'bg-primary' : 'hover:bg-primary/30'} ${disableAnimations ? '' : `motion-reduce:transition-transform-background ${isDragging ? 'scale-[0.95] tap-highlight-transparent' : ''}`}`}
        >
          <CardBody className="pb-1 pt-0 px-0">
            <div className="flex justify-between">
              <Button
                isIconOnly
                className="bg-transparent pointer-events-none"
                variant="flat"
                color="default"
              >
                <IoLink
                  color="default"
                  className={`${match ? 'text-primary-foreground' : 'text-foreground'} text-[24px] font-bold`}
                />
              </Button>
            </div>
          </CardBody>
          <CardFooter className="pt-1">
            <h3
              className={`text-md font-bold ${match ? 'text-primary-foreground' : 'text-foreground'}`}
            >
              {t('sider.cards.connections')}
            </h3>
          </CardFooter>
        </Card>
      )}
    </div>
  )
}

export default ConnCard

const trayIconBase64 = navioTrayIcon

// 固定宽高，同步渲染避免闪烁
const ICON_W = 156
const ICON_H = 36
let trafficCanvas: HTMLCanvasElement | null = null
let trafficCtx: CanvasRenderingContext2D | null = null
const trafficIcon = new Image()
let trafficIconLoaded = false
trafficIcon.onload = () => {
  trafficIconLoaded = true
}
trafficIcon.src = trayIconBase64

// 主进程下发的托盘样式（见 getTrayTrafficStyle）。拿不到时退回内置图标和黑色文字，
// 也就是原来的 template image 行为。
let trayLogo: HTMLImageElement | null = null
let trayTextColor = 'black'
let trayIconColored = false

function renderTrafficIcon(upload: number, download: number): string {
  if (!trafficCanvas) {
    trafficCanvas = document.createElement('canvas')
    trafficCanvas.width = ICON_W
    trafficCanvas.height = ICON_H
    trafficCtx = trafficCanvas.getContext('2d')
  }
  if (!trafficCtx) {
    return trayIconBase64
  }
  const ctx = trafficCtx
  ctx.clearRect(0, 0, ICON_W, ICON_H)
  const logo = trayLogo ?? (trafficIconLoaded ? trafficIcon : null)
  if (logo) {
    ctx.drawImage(logo, 0, 0, ICON_H, ICON_H)
  }
  ctx.font = 'bold 18px "PingFang SC"'
  ctx.fillStyle = trayTextColor
  ctx.textAlign = 'right'
  ctx.fillText(`${calcTraffic(upload)}/s`, ICON_W, 15)
  ctx.fillText(`${calcTraffic(download)}/s`, ICON_W, 34)
  return trafficCanvas.toDataURL('image/png')
}
