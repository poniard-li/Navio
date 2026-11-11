import { readFile } from 'fs/promises'
import { join } from 'path'
import { safeStorage } from 'electron'
import { dataDir } from '../utils/dirs'
import { atomicWriteFile } from '../utils/safeFile'
const filename = (): string => join(dataDir(), 'backup-password.vault')
export async function setBackupPassword(password: string): Promise<void> {
  if (typeof password !== 'string' || password.length < 12 || password.length > 1024)
    throw new Error('独立备份密码需要 12–1024 个字符，请保存在安全的地方。')
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 安全凭据存储不可用。')
  await atomicWriteFile(filename(), safeStorage.encryptString(password))
}
export async function readBackupPassword(): Promise<string> {
  try {
    return safeStorage.decryptString(await readFile(filename()))
  } catch {
    throw new Error('请先在备份设置中设置独立备份密码。此密码与 D.E.X 账号密码无关。')
  }
}
export async function hasBackupPassword(): Promise<boolean> {
  try {
    await readBackupPassword()
    return true
  } catch {
    return false
  }
}
