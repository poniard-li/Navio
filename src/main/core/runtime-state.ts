export type CoreRuntimeStatus = 'stopped' | 'starting' | 'running' | 'error'

export interface CoreRuntimeState {
  generation: number
  status: CoreRuntimeStatus
  sysProxy: boolean | null
  tun: boolean
}

let state: CoreRuntimeState = { generation: 0, status: 'stopped', sysProxy: false, tun: false }
const listeners = new Set<() => void>()

export function getCoreRuntimeState(): Readonly<CoreRuntimeState> {
  return state
}

function publish(patch: Partial<CoreRuntimeState>): void {
  state = { ...state, ...patch }
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      // Status observers must not interrupt core or OS proxy operations.
    }
  }
}

export function subscribeCoreRuntimeState(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function beginCoreRuntimeStart(): number {
  publish({ generation: state.generation + 1, status: 'starting', tun: false })
  return state.generation
}

export function setCoreRuntimeStatus(status: CoreRuntimeStatus, generation: number): void {
  if (generation !== state.generation) return
  publish({ status, ...(status === 'running' ? {} : { tun: false }) })
}

export function stopCoreRuntimeState(): void {
  publish({ generation: state.generation + 1, status: 'stopped', tun: false })
}

export function setAppliedSystemProxy(enable: boolean | null): void {
  publish({ sysProxy: enable })
}

export function setAppliedTunState(enable: boolean, generation: number): void {
  if (generation !== state.generation || state.status !== 'running') return
  publish({ tun: enable })
}
