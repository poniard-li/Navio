import { mkdir } from 'fs/promises'
import path from 'path'
import { getControledMihomoConfig } from '../config'
import { withProfileCheckLock } from '../core/check-profile'
import { mihomoTestDir, mihomoWorkDir } from '../utils/dirs'
import {
  getMissingGeoResources,
  isGeoResourceComplete,
  MAX_GEO_RESOURCE_BYTES
} from '../utils/geo-files'
import { atomicWriteFile } from '../utils/safeFile'
import { defaultControledMihomoConfig } from '../utils/template'
import { fetchReleaseAsset } from './release-download'

const resources = [
  { key: 'mmdb', file: 'country.mmdb' },
  { key: 'geoip', file: 'geoip.dat' },
  { key: 'asn', file: 'ASN.mmdb' },
  { key: 'geosite', file: 'geosite.dat' }
] as const
let activeDownload: Promise<void> | undefined

export async function getGeoResourceStatus(): Promise<string[]> {
  return getMissingGeoResources(mihomoWorkDir())
}

async function download(): Promise<void> {
  const { withStoppedCoreResources } = await import('../core/manager')
  await withStoppedCoreResources(async () => {})
  const config = await getControledMihomoConfig()
  const urls = { ...defaultControledMihomoConfig['geox-url'], ...config['geox-url'] }
  const downloaded: { file: string; data: Buffer }[] = []
  for (const { key, file } of resources) {
    const url = new URL(urls[key] || '')
    if (url.protocol !== 'https:' || url.username || url.password)
      throw new Error(`${file} 下载地址必须为不含账号密码的 HTTPS 地址。`)
    const response = await fetchReleaseAsset(url, '', AbortSignal.timeout(120_000))
    if (!response.ok || !response.body)
      throw new Error(`${file} 下载失败（${response.status}），请检查网络与资源地址。`)
    const contentType = response.headers.get('content-type') || ''
    const lengthHeader = response.headers.get('content-length')
    const length = Number(lengthHeader || 0)
    if (/text\/html|application\/json/i.test(contentType) || length > MAX_GEO_RESOURCE_BYTES) {
      await response.body.cancel()
      throw new Error(`${file} 返回的不是有效数据库，原有文件未更改。`)
    }
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > MAX_GEO_RESOURCE_BYTES) throw new Error(`${file} 超过 128 MB 限制。`)
        chunks.push(value)
      }
    } finally {
      await reader.cancel().catch(() => {})
    }
    const data = Buffer.concat(chunks)
    if (lengthHeader && !response.headers.get('content-encoding') && data.length !== length)
      throw new Error(`${file} 下载不完整，请重试；原有文件未更改。`)
    if (!isGeoResourceComplete(file, data))
      throw new Error(`${file} 内容无效或下载不完整，原有文件未更改。`)
    downloaded.push({ file, data })
  }
  // Validate the entire batch before changing any existing resource.
  await withStoppedCoreResources(() =>
    withProfileCheckLock(mihomoTestDir(), async () => {
      await mkdir(mihomoWorkDir(), { recursive: true })
      await mkdir(mihomoTestDir(), { recursive: true })
      for (const { file, data } of downloaded) {
        // No core start, proxy changes, account tokens or subscription credentials are involved.
        await atomicWriteFile(path.join(mihomoWorkDir(), file), data)
        await atomicWriteFile(path.join(mihomoTestDir(), file), data)
      }
    })
  )
}

export function downloadGeoResources(): Promise<void> {
  if (!activeDownload)
    activeDownload = download().finally(() => {
      activeDownload = undefined
    })
  return activeDownload
}
