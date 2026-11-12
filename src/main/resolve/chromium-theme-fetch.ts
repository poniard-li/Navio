import { net, type IncomingMessage } from 'electron'

const MAX_THEME_BYTES = 32 * 1024
const ignoreLateError = (): void => {}

/** Exposes each Chromium redirect before the downloader makes another request. */
export const chromiumThemeFetch: typeof fetch = (
  input,
  init: NonNullable<Parameters<typeof fetch>[1]> = {}
) => {
  if (
    init.redirect !== 'manual' ||
    init.credentials !== 'omit' ||
    (init.method && init.method !== 'GET')
  )
    return Promise.reject(new Error('主题下载请求参数无效'))
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  return new Promise<Response>((resolve, reject) => {
    const signal = init.signal
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }
    const request = net.request({
      url,
      method: 'GET',
      redirect: 'manual',
      credentials: 'omit',
      useSessionCookies: false
    })
    let finished = false,
      size = 0,
      chunks: Uint8Array[] = [],
      incoming: IncomingMessage | undefined
    const cleanup = (): void => {
      signal?.removeEventListener('abort', abort)
      request.removeListener('redirect', onRedirect)
      request.removeListener('response', onResponse)
      request.removeListener('error', onError)
      request.removeListener('abort', onAbort)
      request.on('error', ignoreLateError)
      if (incoming) {
        incoming.removeListener('data', onData)
        incoming.removeListener('end', onEnd)
        incoming.removeListener('error', onError)
        incoming.removeListener('aborted', onAborted)
        incoming.on('error', ignoreLateError)
      }
      incoming = undefined
      chunks = []
    }
    const finish = (error?: Error, response?: Response, stop = Boolean(error)): void => {
      if (finished) return
      finished = true
      cleanup()
      if (stop) {
        try {
          request.abort()
        } catch {
          /* The request may already be closed. */
        }
      }
      if (error) reject(error)
      else if (response) resolve(response)
    }
    const abort = (): void =>
      finish(signal?.reason instanceof Error ? signal.reason : new Error('主题下载已取消'))
    const onError = (error: Error): void => finish(error)
    const onAbort = (): void => finish(new Error('主题下载已取消'), undefined, false)
    const onAborted = (): void => finish(new Error('主题下载连接已中断'))
    const onRedirect = (status: number, _method: string, target: string): void => {
      try {
        finish(undefined, new Response(null, { status, headers: { location: target } }), true)
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)))
      }
    }
    const onData = (chunk: Uint8Array): void => {
      if (finished) return
      size += chunk.byteLength
      if (size > MAX_THEME_BYTES) {
        finish(new Error('主题包超过大小限制'))
        return
      }
      chunks.push(chunk)
    }
    const onEnd = (): void => {
      if (finished || !incoming) return
      try {
        const headers = new Headers()
        for (const [key, values] of Object.entries(incoming.headers)) {
          for (const value of Array.isArray(values) ? values : [values])
            headers.append(key, String(value))
        }
        finish(
          undefined,
          new Response(size ? Buffer.concat(chunks) : null, {
            status: incoming.statusCode,
            headers
          })
        )
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)))
      }
    }
    const onResponse = (response: IncomingMessage): void => {
      incoming = response
      response.on('data', onData)
      response.once('error', onError)
      response.once('aborted', onAborted)
      response.once('end', onEnd)
    }
    signal?.addEventListener('abort', abort, { once: true })
    request.on('redirect', onRedirect)
    request.once('response', onResponse)
    request.once('error', onError)
    request.once('abort', onAbort)
    try {
      for (const [key, value] of new Headers(init.headers)) request.setHeader(key, value)
      request.end()
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)))
    }
  })
}
