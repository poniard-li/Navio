export interface DexUser {
  id: string
  username: string
  displayName?: string
  email?: string | null
  phone?: string | null
  hasPassword?: boolean
}
export interface DexAccount {
  status: 'signed-out' | 'online' | 'offline'
  user?: DexUser
  serverUrl: string
}
export interface DexAccountSecurity {
  devices: {
    id: string
    label: string
    kind: string
    createdAt: string
    lastSeenAt: string
    current: boolean
  }[]
  providers: { provider: 'google' | 'github'; createdAt: string }[]
  grants: { appId: string; createdAt: string }[]
}
export type DexAccountAction =
  | 'status'
  | 'login'
  | 'register'
  | 'otp-request'
  | 'otp-login'
  | 'password-reset'
  | 'profile'
  | 'password'
  | 'contact'
  | 'security'
  | 'revoke-device'
  | 'unlink-provider'
  | 'revoke-grant'
  | 'themes'
  | 'my-themes'
  | 'favorite-themes'
  | 'theme-favorite'
  | 'theme-report'
  | 'theme-delete'
export interface DexServiceStatus {
  providers: { email: boolean; sms: boolean; google: boolean; github: boolean }
  registrationEnabled: boolean
}
export interface DexOAuthRequest {
  requestCode: string
  authorizationUrl: string
  expiresIn: number
  interval: number
}
export type DexOAuthResult =
  | { status: 'pending' | 'linked' | 'expired' }
  | { status: 'approved'; account: DexAccount }
  | {
      status: 'registration_required'
      provider: string
      suggestedEmail?: string
      emailVerified: boolean
    }
