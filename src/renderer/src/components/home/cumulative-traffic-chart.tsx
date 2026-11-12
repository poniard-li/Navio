import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { LuArrowDown, LuArrowUp } from 'react-icons/lu'
import type { NavioTrafficState } from '../../../../shared/navio-live'

export function trafficBytes(value: number, precision = 1): string {
  if (!Number.isFinite(value) || value < 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(
    units.length - 1,
    value > 0 ? Math.floor(Math.log(value) / Math.log(1024)) : 0
  )
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : precision)} ${units[index]}`
}

export function trafficDuration(elapsedMs: number): string {
  const seconds = Math.floor(Math.max(0, elapsedMs) / 1000)
  return [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60]
    .map((value) => String(value).padStart(2, '0'))
    .join(':')
}

export default function CumulativeTrafficChart({
  state
}: {
  state: NavioTrafficState
}): React.JSX.Element {
  const [range, setRange] = useState<'today' | 'session'>(() =>
    localStorage.getItem('navio-home-traffic-range') === 'session' ? 'session' : 'today'
  )
  const [width, setWidth] = useState(400)
  const [selectedTime, setSelectedTime] = useState<number | null>(null)
  const container = useRef<HTMLDivElement>(null)
  const id = useId()
  useEffect(() => {
    if (!container.current) return
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(220, Math.floor(entry.contentRect.width)))
    )
    observer.observe(container.current)
    return () => observer.disconnect()
  }, [])
  const data = state[range]
  const points = data.points
  const start = range === 'today' ? state.today.startTime : state.session.startedAt
  const end = Math.max(
    start ?? 0,
    range === 'today' ? state.timestamp : (state.session.endedAt ?? state.timestamp)
  )
  const available = range === 'today' ? state.today.available : state.session.startedAt !== null
  const left = 47,
    right = width - 12,
    top = 26,
    bottom = 147
  const maximum = Math.max(1, data.download, data.upload)
  const unitIndex = maximum >= 1024 ** 3 ? 3 : maximum >= 1024 ** 2 ? 2 : maximum >= 1024 ? 1 : 0
  const unit = ['B', 'KB', 'MB', 'GB'][unitIndex]
  const magnitude = 1024 ** unitIndex
  const rough = maximum / magnitude
  const axisMax = Math.max(magnitude, Math.ceil(rough / 4) * 4 * magnitude)
  const x = (time: number): number =>
    left +
    Math.max(0, Math.min(1, (time - (start ?? end)) / Math.max(1, end - (start ?? end)))) *
      (right - left)
  const y = (value: number): number => bottom - (value / axisMax) * (bottom - top)
  const timeLabel = (time: number): string =>
    range === 'today'
      ? new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
      : trafficDuration(time - (start ?? time))
  const active = useMemo(() => {
    if (selectedTime === null || !points.length) return undefined
    return points.reduce((best, point) =>
      Math.abs(point.timestamp - selectedTime) < Math.abs(best.timestamp - selectedTime)
        ? point
        : best
    )
  }, [points, selectedTime])
  const pick = (clientX: number): void => {
    if (!container.current || !points.length || start === null) return
    const local = clientX - container.current.getBoundingClientRect().left
    setSelectedTime(
      start + Math.max(0, Math.min(1, (local - left) / (right - left))) * (end - start)
    )
  }
  return (
    <section className="navio-v7-chart navio-material-card" aria-labelledby={`${id}-heading`}>
      <div className="navio-v7-card-heading">
        <h2 id={`${id}-heading`}>累计用量</h2>
        <select
          aria-label="累计用量时间范围"
          value={range}
          onChange={(event) => {
            const next = event.target.value as 'today' | 'session'
            setRange(next)
            setSelectedTime(null)
            localStorage.setItem('navio-home-traffic-range', next)
          }}
        >
          <option value="today">今日</option>
          <option value="session">{state.session.endedAt ? '上次连接' : '连接后'}</option>
        </select>
      </div>
      <div className="navio-v7-rates" aria-label="当前实时速率">
        <div>
          <span>
            <LuArrowDown /> 下载
          </span>
          <strong data-live-metric>
            {trafficBytes(state.down)}
            <small>/s</small>
          </strong>
        </div>
        <div>
          <span>
            <LuArrowUp /> 上传
          </span>
          <strong data-live-metric>
            {trafficBytes(state.up)}
            <small>/s</small>
          </strong>
        </div>
        <span className="navio-v7-stream" data-online={state.streamOnline}>
          {!state.coreRunning || !state.accessEnabled
            ? '未连接'
            : state.streamOnline
              ? '实时'
              : '等待数据'}
        </span>
      </div>
      <div className="navio-v7-chart-plot" ref={container}>
        <svg
          width="100%"
          height="182"
          viewBox={`0 0 ${width} 182`}
          role="img"
          aria-labelledby={`${id}-title ${id}-desc`}
          tabIndex={available ? 0 : -1}
          onPointerMove={(event) => pick(event.clientX)}
          onPointerLeave={() => setSelectedTime(null)}
          onFocus={() => setSelectedTime(points.at(-1)?.timestamp ?? null)}
          onBlur={() => setSelectedTime(null)}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
            event.preventDefault()
            const index = active ? points.indexOf(active) : points.length - 1
            setSelectedTime(
              points[
                Math.max(
                  0,
                  Math.min(points.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1))
                )
              ]?.timestamp ?? null
            )
          }}
        >
          <title id={`${id}-title`}>
            {range === 'today' ? '今日' : '连接后'}累计上传和下载用量
          </title>
          <desc id={`${id}-desc`}>
            横轴为时间，纵轴为累计用量，单位 {unit}。下载 {trafficBytes(data.download)}，上传{' '}
            {trafficBytes(data.upload)}。聚焦后可用左右方向键查看采样。
          </desc>
          <text x={left} y="13" className="navio-v7-axis-label">
            累计用量 · {unit}
          </text>
          {[0, 1, 2, 3, 4].map((index) => {
            const value = (axisMax * index) / 4
            return (
              <g key={index}>
                <line
                  x1={left}
                  x2={right}
                  y1={y(value)}
                  y2={y(value)}
                  className="navio-v7-gridline"
                />
                <text
                  x={left - 8}
                  y={y(value) + 4}
                  textAnchor="end"
                  className="navio-v7-axis-label"
                >
                  {Number((value / magnitude).toFixed(1))}
                </text>
              </g>
            )
          })}
          {start !== null &&
            [0, 0.5, 1].map((fraction) => {
              const time = start + (end - start) * fraction
              return (
                <text
                  key={fraction}
                  x={left + (right - left) * fraction}
                  y="164"
                  textAnchor={fraction === 0 ? 'start' : fraction === 1 ? 'end' : 'middle'}
                  className="navio-v7-axis-label"
                >
                  {timeLabel(time)}
                </text>
              )
            })}
          <text x={right} y="179" textAnchor="end" className="navio-v7-axis-label">
            {range === 'today' ? '时间' : '连接时长'}
          </text>
          {available &&
            (['download', 'upload'] as const).map((key) => (
              <polyline
                key={key}
                points={points.map((point) => `${x(point.timestamp)},${y(point[key])}`).join(' ')}
                className={`navio-v7-line navio-v7-line-${key}`}
              />
            ))}
          {active && (
            <g>
              <line
                x1={x(active.timestamp)}
                x2={x(active.timestamp)}
                y1={top}
                y2={bottom}
                className="navio-v7-crosshair"
              />
              {(['download', 'upload'] as const).map((key) => (
                <circle
                  key={key}
                  cx={x(active.timestamp)}
                  cy={y(active[key])}
                  r="3.5"
                  className={`navio-v7-point-${key}`}
                />
              ))}
            </g>
          )}
        </svg>
        {!available && (
          <p className="navio-v7-chart-empty">
            {range === 'session' ? '连接后开始累计' : '正在读取本机统计'}
          </p>
        )}
        {active && (
          <div
            className="navio-v7-chart-readout"
            role="status"
            style={{ left: Math.max(4, Math.min(width - 180, x(active.timestamp) - 90)) }}
          >
            <b>{timeLabel(active.timestamp)}</b>
            <span>下载 {trafficBytes(active.download)}</span>
            <span>上传 {trafficBytes(active.upload)}</span>
            <strong>合计 {trafficBytes(active.download + active.upload)}</strong>
          </div>
        )}
      </div>
      <div className="navio-v7-chart-legend">
        <span>
          <i className="navio-v7-dot-download" />
          下载 {trafficBytes(data.download)}
        </span>
        <span>
          <i className="navio-v7-dot-upload" />
          上传 {trafficBytes(data.upload)}
        </span>
      </div>
    </section>
  )
}
