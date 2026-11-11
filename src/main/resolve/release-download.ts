/** GitHub release assets redirect to signed HTTPS storage URLs. Never forward account credentials. */
export async function fetchReleaseAsset(
  url: URL,
  serverOrigin: string,
  signal: AbortSignal
): Promise<Response> {
  let target = url
  for (let redirects = 0; redirects <= 5; redirects++) {
    const localServer =
      ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) &&
      target.origin === serverOrigin
    if (
      (target.protocol !== 'https:' && !(localServer && target.protocol === 'http:')) ||
      target.username ||
      target.password
    )
      throw new Error('更新包及其跳转地址必须使用安全的 HTTPS 地址。')
    const response = await fetch(target, { signal, redirect: 'manual' })
    if (![301, 302, 303, 307, 308].includes(response.status)) return response
    await response.body?.cancel()
    const location = response.headers.get('location')
    if (!location || redirects === 5) throw new Error('更新下载地址跳转过多或缺少目标。')
    target = new URL(location, target)
  }
  throw new Error('更新下载地址无效。')
}
