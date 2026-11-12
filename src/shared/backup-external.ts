export interface BackupFileReference {
  document: string
  pointer: string[]
  value: string
}

export interface BackupExternalFile {
  id: string
  path: string
  references: BackupFileReference[]
  state: 'available' | 'missing' | 'blocked'
  reason?: string
  bytes?: number
  approved: boolean
}

export interface BackupExternalPreview {
  token: string
  files: BackupExternalFile[]
  warnings: string[]
}
