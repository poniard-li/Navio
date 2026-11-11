import { existsSync } from 'fs'
import { mkdir } from 'fs/promises'
import path from 'path'
import { getControledMihomoConfig } from '../config'
import { mihomoTestDir, mihomoWorkDir } from '../utils/dirs'
import { atomicWriteFile } from '../utils/safeFile'
import { defaultControledMihomoConfig } from '../utils/template'
import { fetchReleaseAsset } from './release-download'

const resources = [
  { key: 'mmdb', file: 'country.mmdb' },
  { key: 'geoip', file: 'geoip.dat' },
  { key: 'asn', file: 'ASN.mmdb' },
  { key: 'geosite', file: 'geosite.dat' }
] as const
const maxBytes = 128 * 1024 * 1024
let activeDownload: Promise<void> | undefined

export async function getGeoResourceStatus(): Promise<string[]> {
  return resources
    .filter(({ file }) => !existsSync(path.join(mihomoWorkDir(), file)))
    .map(({ file }) => file)
}

async function download(): Promise<void> {
  const config = await getControledMihomoConfig()
  const urls = { ...defaultControledMihomoConfig['geox-url'], ...config['geox-url'] }
  const directories = [mihomoWorkDir(), mihomoTestDir()]
  await Promise.all(directories.map((dir) => mkdir(dir, { recursive: true })))
  for (const { key, file } of resources) {
    const url = new URL(urls[key] || '')
    if (url.protocol !== 'https:' || url.username || url.password)
      throw new Error(`${file} 下载地址必须为不含账号密码的 HTTPS 地址。`)
    const response = await fetchReleaseAsset(url, '', AbortSignal.timeout(120_000))
    if (!response.ok || !response.body)
      throw new Error(`${file} 下载失败（${response.status}），请检查网络与资源地址。`)
    const contentType = response.headers.get('content-type') || ''
    const length = Number(response.headers.get('content-length') || 0)
    if (/text\/html|application\/json/i.test(contentType) || length > maxBytes) {
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
        if (size > maxBytes) throw new Error(`${file} 超过 128 MB 限制。`)
        chunks.push(value)
      }
    } finally {
      await reader.cancel().catch(() => {})
    }
    const data = Buffer.concat(chunks)
    if (data.length < 1024 || /^\s*</.test(data.subarray(0, 100).toString('utf8')))
      throw new Error(`${file} 内容无效，原有文件未更改。`)
    // No core start, proxy changes, account tokens or subscription credentials are involved.
    for (const dir of directories) await atomicWriteFile(path.join(dir, file), data)
  }
}

export function downloadGeoResources(): Promise<void> {
  if (!activeDownload)
    activeDownload = download().finally(() => {
      activeDownload = undefined
    })
  return activeDownload
}
