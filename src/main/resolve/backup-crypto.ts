import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCallback } from 'crypto'
import { promisify } from 'util'
const derive = promisify(scryptCallback)
const magic = Buffer.from('NAVIOBK1')
export function isEncryptedBackup(value: Buffer): boolean { return value.subarray(0, magic.length).equals(magic) }
export async function encryptBackup(data: Buffer, password: string): Promise<Buffer> {
  if (typeof password !== 'string' || password.length < 12 || password.length > 1024) throw new Error('独立备份密码需要 12–1024 个字符。')
  const salt = randomBytes(16), iv = randomBytes(12)
  const key = await derive(password, salt, 32) as Buffer
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  try {
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()])
    return Buffer.concat([magic, salt, iv, cipher.getAuthTag(), encrypted])
  } finally { key.fill(0) }
}
export async function decryptBackup(data: Buffer, password: string): Promise<Buffer> {
  if (!isEncryptedBackup(data)) return data
  if (!password || data.length < 53) throw new Error('该备份已加密，请输入创建备份时设置的独立备份密码。')
  const key = await derive(password, data.subarray(8,24),32) as Buffer
  try {
    const decipher = createDecipheriv('aes-256-gcm',key,data.subarray(24,36))
    decipher.setAuthTag(data.subarray(36,52))
    return Buffer.concat([decipher.update(data.subarray(52)),decipher.final()])
  } catch { throw new Error('备份密码不正确，或备份文件已损坏。未恢复任何文件。') }
  finally { key.fill(0) }
}
