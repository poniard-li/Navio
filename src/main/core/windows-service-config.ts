import { createHash } from 'crypto'
import { readFile, lstat } from 'fs/promises'
import path from 'path'

export interface ServiceAsset {
  path: string
  data: string
}

const controllerKeys = [
  'external-controller',
  'external-controller-tls',
  'external-controller-unix',
  'external-controller-pipe',
  'external-controller-cors',
  'external-ui',
  'external-ui-url',
  'external-ui-name',
  'secret'
]
const geoFiles = [
  'geoip.metadb',
  'country.mmdb',
  'ASN.mmdb',
  'geoip.dat',
  'geosite.dat',
  'Model.bin'
]
const maxAssetBytes = 160 * 1024 * 1024

export async function prepareWindowsServiceConfig(
  source: Record<string, unknown>,
  workDir: string,
  sharedDir?: string
): Promise<{ config: Record<string, unknown>; assets: ServiceAsset[] }> {
  const config = structuredClone(source)
  for (const key of controllerKeys) delete config[key]
  const assets: ServiceAsset[] = []
  let totalBytes = 0
  const addAsset = async (file: string, target: string, optional: boolean): Promise<void> => {
    try {
      const info = await lstat(file)
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new Error(`后台服务不读取链接或目录：${file}`)
      }
      if (info.size + totalBytes > maxAssetBytes) {
        throw new Error('后台服务资源超过 160 MiB，请使用本次管理员运行方式。')
      }
      const data = await readFile(file)
      totalBytes += data.byteLength
      if (totalBytes > maxAssetBytes) throw new Error('后台服务资源过大。')
      assets.push({ path: target, data: data.toString('base64') })
    } catch (error) {
      if (optional && (error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
  }
  for (const file of geoFiles) {
    const local = path.join(workDir, file)
    const exists = await lstat(local).then(
      () => true,
      () => false
    )
    await addAsset(exists || !sharedDir ? local : path.join(sharedDir, file), file, true)
  }
  for (const providerType of ['proxy-providers', 'rule-providers']) {
    const providers = config[providerType]
    if (!providers || typeof providers !== 'object' || Array.isArray(providers)) continue
    for (const [name, value] of Object.entries(providers)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const provider = value as Record<string, unknown>
      const original = typeof provider.path === 'string' ? provider.path : undefined
      const suffix = provider.format === 'mrs' ? '.mrs' : '.yaml'
      const id = createHash('sha256').update(`${providerType}/${name}`).digest('hex')
      provider.path = `providers/${id}${suffix}`
      if (provider.type === 'file') {
        if (!original) throw new Error(`本地资源缺少文件路径：${name}`)
        const sourcePath = path.resolve(workDir, original)
        await addAsset(sourcePath, provider.path as string, false)
      }
    }
  }
  return { config, assets }
}
