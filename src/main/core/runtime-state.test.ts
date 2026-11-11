import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  beginCoreRuntimeStart,
  getCoreRuntimeState,
  setAppliedSystemProxy,
  setAppliedTunState,
  setCoreRuntimeStatus,
  stopCoreRuntimeState,
  subscribeCoreRuntimeState
} from './runtime-state'

beforeEach(() => {
  stopCoreRuntimeState()
  setAppliedSystemProxy(false)
})

describe('core status observations', () => {
  it('ignores late readiness, exit and TUN responses from a previous process', () => {
    const previous = beginCoreRuntimeStart()
    stopCoreRuntimeState()
    const current = beginCoreRuntimeStart()
    setCoreRuntimeStatus('running', current)
    setAppliedTunState(true, current)
    setCoreRuntimeStatus('error', previous)
    setAppliedTunState(false, previous)
    setCoreRuntimeStatus('running', previous)
    expect(getCoreRuntimeState()).toMatchObject({ status: 'running', tun: true })
  })

  it('does not mistake a deliberate stop for a late startup failure', () => {
    const generation = beginCoreRuntimeStart()
    stopCoreRuntimeState()
    setCoreRuntimeStatus('error', generation)
    expect(getCoreRuntimeState()).toMatchObject({ status: 'stopped', tun: false })
  })

  it('clears TUN and preserves the applied OS proxy after a core failure', () => {
    const generation = beginCoreRuntimeStart()
    setCoreRuntimeStatus('running', generation)
    setAppliedSystemProxy(true)
    setAppliedTunState(true, generation)
    setCoreRuntimeStatus('error', generation)
    expect(getCoreRuntimeState()).toMatchObject({ status: 'error', tun: false, sysProxy: true })
    const retry = beginCoreRuntimeStart()
    setCoreRuntimeStatus('running', retry)
    expect(getCoreRuntimeState().status).toBe('running')
  })

  it('isolates failing observers from proxy operations and other observers', () => {
    const removeFailed = subscribeCoreRuntimeState(() => {
      throw new Error('window closed')
    })
    const listener = vi.fn()
    const remove = subscribeCoreRuntimeState(listener)
    expect(() => setAppliedSystemProxy(true)).not.toThrow()
    expect(listener).toHaveBeenCalledOnce()
    removeFailed()
    remove()
  })
})
