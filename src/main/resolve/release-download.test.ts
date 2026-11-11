import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchReleaseAsset } from './release-download'
afterEach(() => vi.unstubAllGlobals())
describe('GitHub release asset redirects', () => {
  it('follows a GitHub HTTPS redirect without account credentials', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: {
            location: 'https://release-assets.githubusercontent.com/test.zip?signature=test'
          }
        })
      )
      .mockResolvedValueOnce(new Response('zip'))
    vi.stubGlobal('fetch', fetcher)
    const result = await fetchReleaseAsset(
      new URL('https://github.com/poniard-li/Navio/releases/download/v0.6.0-beta.1/Navio.zip'),
      'https://navio.mydex.top',
      AbortSignal.timeout(1000)
    )
    expect(await result.text()).toBe('zip')
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[1][1]).toMatchObject({ redirect: 'manual' })
    expect(fetcher.mock.calls[1][1].headers).toBeUndefined()
  })
  it.each([
    'http://outside.example/file.zip',
    'https://secret@outside.example/file.zip',
    'file:///tmp/file.zip'
  ])('blocks unsafe redirect %s before following it', async (location) => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location } }))
    vi.stubGlobal('fetch', fetcher)
    await expect(
      fetchReleaseAsset(
        new URL('https://github.com/example/file.zip'),
        'https://navio.mydex.top',
        AbortSignal.timeout(1000)
      )
    ).rejects.toThrow('HTTPS')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
