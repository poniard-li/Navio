import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'fs/promises'
import * as fsPromises from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as safeFile from './safeFile'
import {
  cacheValidatedGeoResources,
  getMissingGeoResources,
  isGeoResourceComplete,
  prepareGeoValidationDirectory
} from './geo-files'

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>()
  return { ...actual, link: vi.fn(actual.link) }
})

const completeMmdb = Buffer.concat([
  Buffer.alloc(2048, 1),
  Buffer.from('\xab\xcd\xefMaxMind.com', 'latin1'),
  Buffer.from('binary_format_major_version database_type node_count record_size')
])
const truncated = completeMmdb.subarray(0, 2000)
let root: string
let source: string
let target: string
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'navio-geo-cache-'))
  source = path.join(root, 'source')
  target = path.join(root, 'target')
  await Promise.all([mkdir(source), mkdir(target)])
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})

describe('Geo validation and cache files', () => {
  it.each(['country.mmdb', 'geoip.metadb', 'geoip.db', 'ASN.mmdb'])(
    'detects truncated metadata for %s',
    (file) => {
      expect(isGeoResourceComplete(file, completeMmdb)).toBe(true)
      expect(isGeoResourceComplete(file, truncated)).toBe(false)
      expect(isGeoResourceComplete(file, completeMmdb.subarray(0, -12))).toBe(false)
    }
  )
  it('backs up incomplete validation databases and replaces them from local complete data', async () => {
    await writeFile(path.join(source, 'geoip.metadb'), completeMmdb)
    await writeFile(path.join(source, 'ASN.mmdb'), completeMmdb)
    await writeFile(path.join(source, 'geoip.dat'), Buffer.alloc(2048, 2))
    await writeFile(path.join(target, 'geoip.metadb'), truncated)
    await writeFile(path.join(target, 'ASN.mmdb'), truncated)
    await prepareGeoValidationDirectory(target, source)
    const files = await readdir(target)
    const backups = files.filter((name) => name.includes('.invalid-'))
    expect(backups.length).toBe(2)
    for (const file of backups) expect(await readFile(path.join(target, file))).toEqual(truncated)
    expect(files).not.toContain('geoip.metadb')
    expect(await readFile(path.join(target, 'country.mmdb'))).toEqual(completeMmdb)
    expect(await readFile(path.join(target, 'ASN.mmdb'))).toEqual(completeMmdb)
    expect(await readFile(path.join(target, 'geoip.dat'))).toEqual(Buffer.alloc(2048, 2))
    expect(await readFile(path.join(source, 'geoip.metadb'))).toEqual(completeMmdb)
  })
  it('does not seed validation from incomplete local data or discard complete validation data', async () => {
    await writeFile(path.join(source, 'country.mmdb'), truncated)
    await writeFile(path.join(target, 'geoip.metadb'), completeMmdb)
    await prepareGeoValidationDirectory(target, source)
    expect(await readdir(target)).toEqual(['geoip.metadb'])
    expect(await readFile(path.join(target, 'geoip.metadb'))).toEqual(completeMmdb)
  })
  it('prefers complete work data over an older validation copy', async () => {
    const newer = Buffer.from(completeMmdb)
    newer[0] = 2
    await writeFile(path.join(source, 'geoip.db'), newer)
    await writeFile(path.join(target, 'country.mmdb'), completeMmdb)
    await prepareGeoValidationDirectory(target, source)
    expect(await readFile(path.join(target, 'country.mmdb'))).toEqual(newer)
  })
  it('caches a successfully downloaded database without replacing a valid running-core database', async () => {
    const existing = Buffer.from(completeMmdb)
    existing[0] = 2
    await writeFile(path.join(source, 'geoip.metadb'), completeMmdb)
    await writeFile(path.join(source, 'ASN.mmdb'), completeMmdb)
    await writeFile(path.join(target, 'geoip.db'), existing)
    await cacheValidatedGeoResources(source, target)
    expect(await readdir(target)).toEqual(['ASN.mmdb', 'geoip.db'])
    expect(await readFile(path.join(target, 'geoip.db'))).toEqual(existing)
    expect(await readFile(path.join(target, 'ASN.mmdb'))).toEqual(completeMmdb)
  })
  it('caches missing complete resources only and reuses them for the next validation', async () => {
    await writeFile(path.join(source, 'geoip.metadb'), completeMmdb)
    await writeFile(path.join(source, 'geosite.dat'), Buffer.alloc(2048, 2))
    await writeFile(path.join(source, 'ASN.mmdb'), truncated)
    await cacheValidatedGeoResources(source, target)
    expect(await readFile(path.join(target, 'country.mmdb'))).toEqual(completeMmdb)
    expect(await getMissingGeoResources(target)).toEqual(['geoip.dat', 'ASN.mmdb'])
    const next = path.join(root, 'next-validation')
    await prepareGeoValidationDirectory(next, target)
    expect(await readFile(path.join(next, 'country.mmdb'))).toEqual(completeMmdb)
  })
  it.each(['country.mmdb', 'geoip.metadb', 'geoip.db', 'ASN.mmdb'])(
    'does not rename or replace an incomplete active work download named %s',
    async (file) => {
      await writeFile(path.join(source, file), completeMmdb)
      await writeFile(path.join(target, file), truncated)
      await cacheValidatedGeoResources(source, target)
      expect(await readdir(target)).toEqual([file])
      expect(await readFile(path.join(target, file))).toEqual(truncated)
    }
  )
  it('does not replace a canonical file created concurrently before the exclusive link', async () => {
    await writeFile(path.join(source, 'country.mmdb'), completeMmdb)
    const { link: originalLink } =
      await vi.importActual<typeof import('fs/promises')>('fs/promises')
    vi.mocked(fsPromises.link).mockImplementationOnce(async (temporary, canonical) => {
      expect(await readFile(temporary)).toEqual(completeMmdb)
      await writeFile(canonical, truncated)
      return originalLink(temporary, canonical)
    })
    await cacheValidatedGeoResources(source, target)
    expect(await readdir(target)).toEqual(['country.mmdb'])
    expect(await readFile(path.join(target, 'country.mmdb'))).toEqual(truncated)
  })
  it('skips a competing alias which appears while the complete cache file is being prepared', async () => {
    await writeFile(path.join(source, 'country.mmdb'), completeMmdb)
    const originalWrite = safeFile.atomicWriteFile
    vi.spyOn(safeFile, 'atomicWriteFile').mockImplementationOnce(async (file, data, options) => {
      await originalWrite(file, data, options)
      await writeFile(path.join(target, 'geoip.metadb'), truncated)
    })
    await cacheValidatedGeoResources(source, target)
    expect(await readdir(target)).toEqual(['geoip.metadb'])
    expect(await readFile(path.join(target, 'geoip.metadb'))).toEqual(truncated)
  })
  it('cleans up its temporary file if the filesystem cannot create a hard link', async () => {
    await writeFile(path.join(source, 'country.mmdb'), completeMmdb)
    vi.mocked(fsPromises.link).mockRejectedValueOnce(
      Object.assign(new Error('Hard links unavailable'), { code: 'ENOTSUP' })
    )
    await expect(cacheValidatedGeoResources(source, target)).rejects.toThrow(
      'Hard links unavailable'
    )
    expect(await readdir(target)).toEqual([])
  })
})
