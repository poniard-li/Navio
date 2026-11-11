import {describe,it,expect} from 'vitest'
import {encryptBackup,decryptBackup,isEncryptedBackup} from './backup-crypto'
describe('independent backup encryption',()=>{
  it('round trips credentials without exposing plaintext and uses random salt',async()=>{
    const value=Buffer.from('subscription-token-and-node-password'),password='independent-backup-secret'
    const a=await encryptBackup(value,password),b=await encryptBackup(value,password)
    expect(isEncryptedBackup(a)).toBe(true);expect(a.equals(b)).toBe(false)
    expect(a.includes(value)).toBe(false);expect(await decryptBackup(a,password)).toEqual(value)
  })
  it('rejects wrong passwords and tampering',async()=>{
    const a=await encryptBackup(Buffer.from('zip-data'),'a-long-backup-password')
    await expect(decryptBackup(a,'wrong-password')).rejects.toThrow('未恢复任何文件')
    a[a.length-1]^=1
    await expect(decryptBackup(a,'a-long-backup-password')).rejects.toThrow('未恢复任何文件')
  })
})
