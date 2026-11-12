import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const requestMock = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({ net: { request: requestMock } }))
import { chromiumThemeFetch } from './chromium-theme-fetch'
const url =
  'https://github.com/poniard-li/Navio/releases/download/v1.0.0-beta.7/Navio-Theme-aurora-1.json'
const options = { redirect: 'manual', credentials: 'omit' } as const
function request(): EventEmitter & {
  abort: ReturnType<typeof vi.fn>
  end: ReturnType<typeof vi.fn>
  setHeader: ReturnType<typeof vi.fn>
} {
  const req = Object.assign(new EventEmitter(), {
    abort: vi.fn(),
    end: vi.fn(),
    setHeader: vi.fn()
  })
  req.abort.mockImplementation(() => req.emit('abort'))
  requestMock.mockReturnValue(req)
  return req
}
beforeEach(() => {
  requestMock.mockReset()
})
describe('Chromium theme transport', () => {
  it('exposes redirects without following them and releases its abort listener', async () => {
    const req = request(),
      controller = new AbortController(),
      remove = vi.spyOn(controller.signal, 'removeEventListener')
    const pending = chromiumThemeFetch(url, { ...options, signal: controller.signal })
    req.emit('redirect', 302, 'GET', 'https://release-assets.githubusercontent.com/file', {})
    const response = await pending
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(
      'https://release-assets.githubusercontent.com/file'
    )
    expect(req.abort).toHaveBeenCalledOnce()
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(requestMock).toHaveBeenCalledOnce()
    expect(req.listenerCount('redirect')).toBe(0)
    expect(req.listenerCount('response')).toBe(0)
    expect(req.listenerCount('abort')).toBe(0)
  })
  it('aborts the actual request when the caller signal is cancelled', async () => {
    const req = request(),
      controller = new AbortController(),
      remove = vi.spyOn(controller.signal, 'removeEventListener')
    const pending = chromiumThemeFetch(url, { ...options, signal: controller.signal })
    controller.abort(new Error('caller cancelled'))
    await expect(pending).rejects.toThrow('caller cancelled')
    expect(req.abort).toHaveBeenCalledOnce()
    expect(remove).toHaveBeenCalledOnce()
  })
  it('bounds incoming data to 32 KiB and aborts before buffering an oversized chunk', async () => {
    const req = request(),
      pending = chromiumThemeFetch(url, options),
      res = Object.assign(new EventEmitter(), { statusCode: 200, headers: {} })
    req.emit('response', res)
    res.emit('data', new Uint8Array(33000))
    await expect(pending).rejects.toThrow('大小')
    expect(req.abort).toHaveBeenCalledOnce()
  })
  it('accepts a response after the request writable side closes, as Electron 43 does', async () => {
    const req = request(),
      pending = chromiumThemeFetch(url, options),
      res = Object.assign(new EventEmitter(), {
        statusCode: 200,
        headers: { 'content-type': ['application/json'] }
      })
    req.emit('finish')
    req.emit('close')
    req.emit('response', res)
    res.emit('data', Buffer.from('{}'))
    res.emit('end')
    expect(await (await pending).text()).toBe('{}')
    expect(req.abort).not.toHaveBeenCalled()
    expect(res.listenerCount('data')).toBe(0)
    expect(res.listenerCount('end')).toBe(0)
    expect(() => res.emit('error', new Error('late close'))).not.toThrow()
  })
  it('settles malformed response metadata as rejection instead of an uncaught callback error', async () => {
    const req = request(),
      pending = chromiumThemeFetch(url, options),
      res = Object.assign(new EventEmitter(), { statusCode: 0, headers: {} })
    req.emit('response', res)
    expect(() => res.emit('end')).not.toThrow()
    await expect(pending).rejects.toThrow()
  })
  it('terminates an errored response and removes listeners that captured buffered chunks', async () => {
    const req = request(),
      controller = new AbortController(),
      remove = vi.spyOn(controller.signal, 'removeEventListener')
    const pending = chromiumThemeFetch(url, { ...options, signal: controller.signal }),
      res = Object.assign(new EventEmitter(), { statusCode: 200, headers: {} })
    req.emit('response', res)
    res.emit('data', Buffer.from('partial'))
    res.emit('error', new Error('connection reset'))
    await expect(pending).rejects.toThrow('connection reset')
    expect(req.abort).toHaveBeenCalledOnce()
    expect(remove).toHaveBeenCalledOnce()
    expect(res.listenerCount('data')).toBe(0)
    expect(res.listenerCount('end')).toBe(0)
  })
})
