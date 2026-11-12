import https from 'https'
import os from 'os'
import { existsSync } from 'fs'
import { readFile, mkdir, writeFile, readdir, lstat } from 'fs/promises'
import path from 'path'
import dayjs from 'dayjs'
import AdmZip from 'adm-zip'
import { Cron } from 'croner'
import { dialog } from 'electron'
import i18next from 'i18next'
import { stringify, parse } from '../utils/yaml'
import { systemLogger } from '../utils/logger'
import {
  appConfigPath,
  controledMihomoConfigPath,
  dataDir,
  overrideConfigPath,
  overrideDir,
  profileConfigPath,
  profilesDir,
  rulesDir,
  subStoreDir,
  themesDir
} from '../utils/dirs'
import { getAppConfig } from '../config'
import { atomicWriteFile } from '../utils/safeFile'
import type { BackupExternalPreview } from '../../shared/backup-external'
import { readBackupPassword } from './backup-password'
import { encryptBackup, decryptBackup } from './backup-crypto'
import {
  ExternalBackupFiles,
  assertNoLinks,
  insideDirectory,
  rewriteExternalRestore,
  type BackupDocument
} from './backup-external'

let backupCronJob: Cron | null = null

interface WebDAVContext {
  client: ReturnType<Awaited<typeof import('webdav/dist/node/index.js')>['createClient']>
  webdavDir: string
  webdavMaxBackups: number
}

function sanitizeDeviceNameForFilename(name: string): string {
  const withoutControlChars = Array.from(name)
    .filter((char) => char.charCodeAt(0) >= 32)
    .join('')

  const sanitized = withoutControlChars
    .trim()
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')

  return sanitized || 'unknown-device'
}

function getWebDAVBackupPrefix(): string {
  const deviceName = sanitizeDeviceNameForFilename(os.hostname())
  return `${process.platform}_${deviceName}`
}

async function getWebDAVClient(): Promise<WebDAVContext> {
  if (!(await getAppConfig()).webdavEnabled)
    throw new Error('请先启用 WebDAV 备份并确认上传目的地。')
  const { createClient, AuthType } = await import('webdav/dist/node/index.js')
  const {
    webdavUrl = '',
    webdavUsername = '',
    webdavPassword = '',
    webdavDir = 'clash-party',
    webdavMaxBackups = 0,
    webdavIgnoreCert = false
  } = await getAppConfig()

  // webdav 自带的 Basic 认证走 base-64 包，只接受 Latin1 字符，非 ASCII 用户名/密码
  // 会直接抛 InvalidCharacterError（#323）。按 RFC 7617 先用 UTF-8 编码再 base64，
  // 自己拼 Authorization 头，并关掉库内的认证以免被覆盖。
  const clientOptions: Parameters<typeof createClient>[1] =
    webdavUsername || webdavPassword
      ? {
          authType: AuthType.None,
          headers: {
            Authorization: `Basic ${Buffer.from(`${webdavUsername}:${webdavPassword}`, 'utf-8').toString('base64')}`
          }
        }
      : {}

  if (webdavIgnoreCert) {
    clientOptions.httpsAgent = new https.Agent({
      rejectUnauthorized: false
    })
  }

  const client = createClient(webdavUrl, clientOptions)

  return { client, webdavDir, webdavMaxBackups }
}

const externalManagers = new Map<string, ExternalBackupFiles>()
function externalFiles(): ExternalBackupFiles {
  const root = dataDir()
  let manager = externalManagers.get(root)
  if (!manager) {
    manager = new ExternalBackupFiles(root)
    externalManagers.set(root, manager)
  }
  return manager
}

async function backupDocuments(zip: AdmZip): Promise<BackupDocument[]> {
  const { diffWorkDir } = await getAppConfig()
  let current = 'default'
  try {
    current =
      parse<{ current?: string }>(zip.getEntry('profile.yaml')?.getData().toString('utf8') || '')
        .current || current
  } catch {
    /* Individual source profiles still have their own base. */
  }
  return zip
    .getEntries()
    .filter((entry) => !entry.isDirectory)
    .map((entry) => {
      const name = entry.entryName
      const profile = name.match(/^(?:profiles|profile-local)\/([\w-]+)\./)?.[1]
      const base = name.startsWith('work/')
        ? path.dirname(path.join(dataDir(), name))
        : path.join(dataDir(), 'work', ...(diffWorkDir ? [profile || current] : []))
      return { name, content: entry.getData(), base }
    })
}

async function createBackupZip(includeExternal = true): Promise<AdmZip> {
  const zip = new AdmZip()
  const warnings: string[] = []
  async function add(source: string, name: string): Promise<void> {
    try {
      await assertNoLinks(source)
      const info = await lstat(source)
      if (info.isDirectory()) {
        for (const child of await readdir(source))
          await add(path.join(source, child), `${name}/${child}`)
      } else if (info.isFile()) zip.addFile(name.replace(/\\/g, '/'), await readFile(source))
      else warnings.push(`${name} 不是普通文件，未备份。`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        warnings.push(`${name}：${(error as Error).message}`)
    }
  }

  const files = [controledMihomoConfigPath(), profileConfigPath(), overrideConfigPath()]
  const settings = {
    ...(await getAppConfig()),
    sysProxy: { ...(await getAppConfig()).sysProxy, enable: false },
    autoConnect: false
  }
  for (const key of [
    'githubToken',
    'webdavPassword',
    'encryptedPassword',
    'gistAgeSecretKey'
  ] as const)
    delete settings[key]
  zip.addFile(path.basename(appConfigPath()), Buffer.from(stringify(settings)))
  for (const name of ['simple-config.yaml', 'theme-settings.json']) {
    const file = path.join(dataDir(), name)
    if (existsSync(file)) await add(file, name)
  }

  const folders = [
    { path: themesDir(), name: 'themes' },
    { path: profilesDir(), name: 'profiles' },
    { path: overrideDir(), name: 'override' },
    { path: rulesDir(), name: 'rules' },
    { path: subStoreDir(), name: 'substore' },
    { path: path.join(dataDir(), 'dex-library'), name: 'dex-library' },
    { path: path.join(dataDir(), 'profile-local'), name: 'profile-local' },
    { path: path.join(dataDir(), 'work'), name: 'work' },
    { path: path.join(dataDir(), 'restored-resources'), name: 'restored-resources' }
  ]

  for (const file of files) {
    if (existsSync(file)) {
      await add(file, path.basename(file))
    }
  }

  for (const { path, name } of folders) {
    if (existsSync(path)) {
      await add(path, name)
    }
  }

  if (includeExternal) await externalFiles().append(zip, await backupDocuments(zip), warnings)
  else if (warnings.length)
    zip.addFile('external-scan-warnings.json', Buffer.from(JSON.stringify(warnings)))
  return zip
}

export async function previewBackupExternalFiles(): Promise<BackupExternalPreview> {
  const zip = await createBackupZip(false)
  const report = await externalFiles().preview(await backupDocuments(zip))
  const warnings = zip.getEntry('external-scan-warnings.json')
  if (warnings) report.warnings.push(...JSON.parse(warnings.getData().toString('utf8')))
  return report
}

export async function approveBackupExternalFiles(token: string, ids: string[]): Promise<void> {
  const zip = await createBackupZip(false)
  await externalFiles().approve(await backupDocuments(zip), token, ids)
}

async function backupPayload(): Promise<{ data: Buffer; extension: string }> {
  const zip = await createBackupZip()
  const data = zip.toBuffer()
  if ((await getAppConfig()).backupEncrypted !== false)
    return { data: await encryptBackup(data, await readBackupPassword()), extension: 'nbackup' }
  return { data, extension: 'zip' }
}

async function restorePayload(data: Buffer, password?: string): Promise<void> {
  if (data.length > 512 * 1024 * 1024) throw new Error('备份超过 512 MB，请使用分批迁移。')
  const zip = new AdmZip(
    await decryptBackup(data, password || (await readBackupPassword().catch(() => '')))
  )
  const entries = zip.getEntries()
  const roots = new Set([
    'themes',
    'profiles',
    'override',
    'rules',
    'substore',
    'dex-library',
    'work',
    'profile-local',
    'restored-resources'
  ])
  const files = new Set([
    'config.yaml',
    'mihomo.yaml',
    'profile.yaml',
    'override.yaml',
    'simple-config.yaml',
    'theme-settings.json',
    'external-files.json'
  ])
  let total = 0
  const seen = new Set<string>()
  for (const entry of entries) {
    const name = entry.entryName
    const parts = name.split('/')
    if (
      name.startsWith('/') ||
      name.includes('\\') ||
      parts.some(
        (p, index) =>
          (!p && (!entry.isDirectory || index !== parts.length - 1)) ||
          p === '..' ||
          p === '.' ||
          p.includes(':') ||
          /[. ]$/.test(p) ||
          /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)
      ) ||
      ((entry.header.attr >>> 16) & 0o170000) === 0o120000 ||
      (!roots.has(parts[0]) && !files.has(name))
    )
      throw new Error(`不支持的备份路径：${name}`)
    const key = process.platform === 'win32' ? name.toLowerCase() : name
    if (seen.has(key)) throw new Error(`备份中存在重复路径：${name}`)
    seen.add(key)
    total += entry.header.size
    if (total > 512 * 1024 * 1024) throw new Error('解压后的备份超过 512 MB。')
  }
  // Validate every entry before writing; account and backup vaults are never imported.
  const contents = new Map(
    entries.filter((entry) => !entry.isDirectory).map((entry) => [entry.entryName, entry.getData()])
  )
  const missing = rewriteExternalRestore(contents, dataDir())
  const prepared = [...contents].map(([name, original]) => {
    let content = original
    if (name === 'config.yaml') {
      const value = parse(content.toString('utf8')) as IAppConfig
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('备份设置无效')
      value.autoConnect = false
      value.webdavEnabled = false
      value.gistSyncEnabled = false
      value.sysProxy = { ...value.sysProxy, enable: false }
      for (const key of [
        'githubToken',
        'webdavPassword',
        'encryptedPassword',
        'gistAgeSecretKey'
      ] as const)
        delete value[key]
      content = Buffer.from(stringify(value))
    }
    if (name === 'mihomo.yaml') {
      const value = parse(content.toString('utf8')) as IMihomoConfig
      if (value.tun) value.tun.enable = false
      content = Buffer.from(stringify(value))
    }
    return { name, content }
  })
  // Reject every linked destination before replacing any configuration.
  for (const entry of prepared) {
    const destination = path.resolve(dataDir(), entry.name)
    if (!insideDirectory(dataDir(), destination)) throw new Error('无效恢复路径')
    await assertNoLinks(destination)
  }
  for (const entry of prepared) {
    const destination = path.resolve(dataDir(), entry.name)
    const rel = path.relative(dataDir(), destination)
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('无效恢复路径')
    await mkdir(path.dirname(destination), { recursive: true })
    await assertNoLinks(destination)
    await atomicWriteFile(destination, entry.content)
  }
  if (missing.length)
    await dialog.showMessageBox({
      type: 'warning',
      title: '备份已恢复，部分外部文件未包含',
      message: `共有 ${missing.length} 项需要检查。相关配置可能需要手动修正路径或补齐文件。`,
      detail: missing.slice(0, 50).join('\n')
    })
}

export async function webdavBackup(): Promise<boolean> {
  const { client, webdavDir, webdavMaxBackups } = await getWebDAVClient()
  const payload = await backupPayload()
  const date = new Date()
  const backupPrefix = getWebDAVBackupPrefix()
  const zipFileName = `${backupPrefix}_${dayjs(date).format('YYYY-MM-DD_HH-mm-ss')}.${payload.extension}`

  try {
    await client.createDirectory(webdavDir)
  } catch {
    // ignore
  }

  const result = await client.putFileContents(`${webdavDir}/${zipFileName}`, payload.data)

  if (webdavMaxBackups > 0) {
    try {
      const fileList = await client.getDirectoryContents(webdavDir)

      const currentPlatformFiles = fileList.filter((file) => {
        return (
          file.basename.startsWith(`${backupPrefix}_`) && /\.(zip|nbackup)$/.test(file.basename)
        )
      })

      currentPlatformFiles.sort((a, b) => {
        const timeA =
          a.basename.match(/_(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})\.(?:zip|nbackup)$/)?.[1] || ''
        const timeB =
          b.basename.match(/_(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})\.(?:zip|nbackup)$/)?.[1] || ''
        return timeB.localeCompare(timeA)
      })

      if (currentPlatformFiles.length > webdavMaxBackups) {
        const filesToDelete = currentPlatformFiles.slice(webdavMaxBackups)

        for (let i = 0; i < filesToDelete.length; i++) {
          const file = filesToDelete[i]
          await client.deleteFile(`${webdavDir}/${file.basename}`)

          if (i < filesToDelete.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 500))
          }
        }
      }
    } catch (error) {
      await systemLogger.error('Failed to clean up old backup files', error)
    }
  }

  return result
}

export async function webdavRestore(filename: string, password?: string): Promise<void> {
  if (path.basename(filename) !== filename) throw new Error('无效备份名称')
  const { client, webdavDir } = await getWebDAVClient()
  const zipData = await client.getFileContents(`${webdavDir}/${filename}`)
  await restorePayload(zipData as Buffer, password)
}

export async function listWebdavBackups(): Promise<string[]> {
  const { client, webdavDir } = await getWebDAVClient()
  const files = await client.getDirectoryContents(webdavDir)
  return files.map((file) => file.basename).filter((name) => /\.(zip|nbackup)$/.test(name))
}

export async function webdavDelete(filename: string): Promise<void> {
  if (path.basename(filename) !== filename) throw new Error('无效备份名称')
  const { client, webdavDir } = await getWebDAVClient()
  await client.deleteFile(`${webdavDir}/${filename}`)
}

/**
 * 初始化 WebDAV 定时备份任务
 */
export async function initWebdavBackupScheduler(): Promise<void> {
  try {
    // 先停止现有的定时任务
    if (backupCronJob) {
      backupCronJob.stop()
      backupCronJob = null
    }

    const { webdavBackupCron, webdavEnabled } = await getAppConfig()

    // 如果配置了 Cron 表达式，则启动定时任务
    if (webdavEnabled && webdavBackupCron) {
      backupCronJob = new Cron(webdavBackupCron, async () => {
        try {
          await webdavBackup()
          await systemLogger.info('WebDAV backup completed successfully via cron job')
        } catch (error) {
          await systemLogger.error('Failed to execute WebDAV backup via cron job', error)
        }
      })

      await systemLogger.info(`WebDAV backup scheduler initialized with cron: ${webdavBackupCron}`)
      await systemLogger.info(`WebDAV backup scheduler nextRun: ${backupCronJob.nextRun()}`)
    } else {
      await systemLogger.info('WebDAV backup scheduler disabled (no cron expression configured)')
    }
  } catch (error) {
    await systemLogger.error('Failed to initialize WebDAV backup scheduler', error)
  }
}

/**
 * 停止 WebDAV 定时备份任务
 */
export async function stopWebdavBackupScheduler(): Promise<void> {
  if (backupCronJob) {
    backupCronJob.stop()
    backupCronJob = null
    await systemLogger.info('WebDAV backup scheduler stopped')
  }
}

/**
 * 重新初始化 WebDAV 定时备份任务
 * 先停止现有任务，然后重新启动
 */
export async function reinitScheduler(): Promise<void> {
  await systemLogger.info('Reinitializing WebDAV backup scheduler...')
  await stopWebdavBackupScheduler()
  await initWebdavBackupScheduler()
  await systemLogger.info('WebDAV backup scheduler reinitialized successfully')
}

/**
 * 导出本地备份
 */
export async function exportLocalBackup(): Promise<boolean> {
  const payload = await backupPayload()

  const date = new Date()
  const zipFileName = `navio-backup-${dayjs(date).format('YYYY-MM-DD_HH-mm-ss')}.${payload.extension}`
  const result = await dialog.showSaveDialog({
    title: i18next.t('localBackup.export.title'),
    defaultPath: zipFileName,
    filters: [
      { name: 'Navio Backup', extensions: [payload.extension] },
      { name: 'All Files', extensions: ['*'] }
    ]
  })

  if (!result.canceled && result.filePath) {
    await writeFile(result.filePath, payload.data)
    await systemLogger.info(`Local backup exported to: ${result.filePath}`)
    return true
  }
  return false
}

/**
 * 导入本地备份
 */
export async function importLocalBackup(password?: string): Promise<boolean> {
  const result = await dialog.showOpenDialog({
    title: i18next.t('localBackup.import.title'),
    filters: [
      { name: 'Navio Backup', extensions: ['nbackup', 'zip'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['openFile']
  })

  if (!result.canceled && result.filePaths.length > 0) {
    const filePath = result.filePaths[0]
    await restorePayload(await readFile(filePath), password)
    await systemLogger.info(`Local backup imported from: ${filePath}`)
    return true
  }
  return false
}
