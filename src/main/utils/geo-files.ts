import { randomBytes } from 'crypto'
import { link, lstat, mkdir, readFile, rename, rm, stat } from 'fs/promises'
import path from 'path'
import { atomicWriteFile } from './safeFile'

export const MAX_GEO_RESOURCE_BYTES = 128 * 1024 * 1024
const mmdbMarker = Buffer.from('\xab\xcd\xefMaxMind.com', 'latin1')
const mmdbNames = ['country.mmdb', 'geoip.db', 'geoip.metadb', 'ASN.mmdb']
const groups = [
  { target: 'country.mmdb', names: ['country.mmdb', 'geoip.db', 'geoip.metadb'] },
  { target: 'geoip.dat', names: ['geoip.dat'] },
  { target: 'ASN.mmdb', names: ['ASN.mmdb'] },
  { target: 'geosite.dat', names: ['geosite.dat'] }
]

/** A bounded truncation/response guard. The core still performs the full database validation. */
export function isGeoResourceComplete(file: string, data: Buffer): boolean {
  if (
    data.length < 1024 ||
    data.length > MAX_GEO_RESOURCE_BYTES ||
    /^\s*</.test(data.subarray(0, 100).toString('utf8'))
  )
    return false
  if (!mmdbNames.some((name) => name.toLowerCase() === file.toLowerCase())) return true
  const tail = data.subarray(Math.max(0, data.length - 128 * 1024))
  const marker = tail.lastIndexOf(mmdbMarker)
  if (marker < 0) return false
  const metadata = tail.subarray(marker + mmdbMarker.length)
  return ['binary_format_major_version', 'database_type', 'node_count', 'record_size'].every(
    (key) => metadata.includes(Buffer.from(key))
  )
}

async function readCompleteFile(dir: string, file: string): Promise<Buffer | undefined> {
  try {
    const filePath = path.join(dir, file)
    const info = await stat(filePath)
    if (!info.isFile() || info.size > MAX_GEO_RESOURCE_BYTES) return undefined
    const data = await readFile(filePath)
    return isGeoResourceComplete(file, data) ? data : undefined
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function firstCompleteFile(dir: string, names: string[]): Promise<Buffer | undefined> {
  for (const name of names) {
    const data = await readCompleteFile(dir, name)
    if (data) return data
  }
  return undefined
}

async function backupIncompleteMmdb(dir: string): Promise<void> {
  for (const file of mmdbNames) {
    if (await readCompleteFile(dir, file)) continue
    const filePath = path.join(dir, file)
    try {
      if (!(await stat(filePath)).isFile()) continue
      await rename(
        filePath,
        `${filePath}.invalid-${Date.now()}-${randomBytes(4).toString('hex')}.bak`
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}

/** Caller holds the validation-directory lock for preparation, core execution and caching. */
export async function prepareGeoValidationDirectory(
  targetDir: string,
  sourceDir: string
): Promise<void> {
  if (path.resolve(targetDir) === path.resolve(sourceDir)) return
  await mkdir(targetDir, { recursive: true })
  await backupIncompleteMmdb(targetDir)
  for (const group of groups) {
    const data = await firstCompleteFile(sourceDir, group.names)
    if (data) await atomicWriteFile(path.join(targetDir, group.target), data)
  }
}

async function anyResourceExists(dir: string, names: string[]): Promise<boolean> {
  for (const name of names) {
    try {
      await lstat(path.join(dir, name))
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return false
}

/** Existing work files may be active downloads: never rename, remove or replace them. */
export async function cacheValidatedGeoResources(
  sourceDir: string,
  targetDir: string
): Promise<void> {
  if (path.resolve(targetDir) === path.resolve(sourceDir)) return
  await mkdir(targetDir, { recursive: true })
  for (const group of groups) {
    if (await anyResourceExists(targetDir, group.names)) continue
    const data = await firstCompleteFile(sourceDir, group.names)
    if (!data) continue
    const temporaryPath = path.join(
      targetDir,
      `.${group.target}.${process.pid}.${randomBytes(8).toString('hex')}.cache-tmp`
    )
    try {
      await atomicWriteFile(temporaryPath, data)
      if (await anyResourceExists(targetDir, group.names)) continue
      try {
        // An exclusive hard link publishes the complete file without overwriting
        // a canonical file created by an active core after our existence check.
        await link(temporaryPath, path.join(targetDir, group.target))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    } finally {
      await rm(temporaryPath, { force: true })
    }
  }
}

export async function getMissingGeoResources(dir: string): Promise<string[]> {
  const missing: string[] = []
  for (const group of groups) {
    if (!(await firstCompleteFile(dir, group.names))) missing.push(group.target)
  }
  return missing
}
