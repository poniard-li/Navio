export interface CfwMigrationCandidate {
  id: string
  name: string
  kind: 'local' | 'remote'
  sourceFile: string
  sourceHost?: string
  nodeCount: number
  groupCount: number
  ruleCount: number
  warnings: string[]
}

export interface CfwMigrationPreview {
  planId: string
  sourceDirectory: string
  expiresAt: number
  candidates: CfwMigrationCandidate[]
  overrides: { id: string; name: string; sourceFile: string; keys: string[] }[]
  warnings: string[]
  unsupportedScripts: { source: string; kind: string; message: string }[]
}

export interface CfwMigrationSelection {
  profileIds?: string[]
  overrideIds?: string[]
}

export interface CfwMigrationResult {
  importedProfiles: { id: string; name: string }[]
  importedOverrides: { id: string; name: string }[]
  warnings: string[]
}
