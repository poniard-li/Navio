import path from 'path'
import { mkdir, writeFile } from 'fs/promises'
import AdmZip from 'adm-zip'

export interface UpdateArtifact {
  url: string
  sha256: string
  size: number
}
export interface UpdateRelease extends UpdateArtifact {
  version: string
  notes: string
  artifacts?: { portable?: UpdateArtifact; installer?: UpdateArtifact }
}
export function selectUpdateArtifact(release: UpdateRelease, portable: boolean): UpdateArtifact {
  const artifact = portable ? release.artifacts?.portable || release : release.artifacts?.installer
  if (!artifact) throw new Error('此版本尚未提供安装版更新包，请稍后重试。')
  const url = new URL(artifact.url)
  if (
    url.origin !== 'https://github.com' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/poniard-li\/Navio\/releases\/download\/[^/]+\/[^/]+$/.test(url.pathname) ||
    !url.pathname.toLowerCase().endsWith(portable ? '.zip' : '.exe')
  )
    throw new Error('更新包地址或文件类型无效。')
  if (
    !/^[a-f0-9]{64}$/i.test(artifact.sha256) ||
    !Number.isSafeInteger(artifact.size) ||
    artifact.size < 1 ||
    artifact.size > 1024 ** 3
  )
    throw new Error('更新清单缺少有效的文件校验信息。')
  return artifact
}

export function isWindowsX64Executable(data: Buffer): boolean {
  if (data.length < 64 || data.toString('ascii', 0, 2) !== 'MZ') return false
  const offset = data.readUInt32LE(60)
  return (
    offset + 6 <= data.length &&
    data.toString('ascii', offset, offset + 4) === 'PE\0\0' &&
    data.readUInt16LE(offset + 4) === 0x8664
  )
}

/** Validate the entire archive before writing any entry. */
export async function stagePortableUpdate(archive: string, destination: string): Promise<void> {
  const entries = new AdmZip(archive).getEntries()
  if (!entries.length || entries.length > 30000) throw new Error('更新包文件数量无效。')
  const names = new Set<string>()
  let unpacked = 0
  for (const entry of entries) {
    const name = entry.entryName
    const components = name.replace(/\/$/, '').split('/')
    if (
      name.includes('\\') ||
      name.startsWith('/') ||
      components.some(
        (p) =>
          !p ||
          p === '.' ||
          p === '..' ||
          /[<>:"|?*]/.test(p) ||
          [...p].some((character) => character.charCodeAt(0) < 32) ||
          /[. ]$/.test(p) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)
      ) ||
      components[0].toLowerCase() === 'dex-studio-next' ||
      ((entry.attr >>> 16) & 0xf000) === 0xa000
    )
      throw new Error('更新包包含不安全的文件路径。')
    const key = name.replace(/\/$/, '').toLowerCase()
    if (names.has(key)) throw new Error('更新包存在重复文件。')
    names.add(key)
    unpacked += entry.header.size
    if (unpacked > 3 * 1024 ** 3 || entry.header.size > 1024 ** 3)
      throw new Error('更新包解压大小超过限制。')
  }
  const exe = entries.find((entry) => entry.entryName === 'Navio.exe')
  if (
    !exe ||
    !isWindowsX64Executable(exe.getData()) ||
    !names.has('resources/app.asar') ||
    !names.has('portable')
  )
    throw new Error('更新包缺少有效的 Navio x64 程序或免安装标记。')
  await mkdir(destination, { recursive: true })
  for (const entry of entries) {
    const target = path.join(destination, ...entry.entryName.split('/'))
    if (entry.isDirectory) await mkdir(target, { recursive: true })
    else {
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, entry.getData(), { flag: 'wx' })
    }
  }
}
