import type { CoreRuntimeStatus } from '../core/runtime-state'

export type TrayIconStatus = 'white' | 'blue' | 'green' | 'red'

export function calculateTrayIconStatus(
  sysProxyEnabled: boolean | null,
  tunEnabled: boolean,
  coreStatus: CoreRuntimeStatus = 'stopped'
): TrayIconStatus {
  if (coreStatus === 'error') return 'red'
  if (tunEnabled) return 'blue'
  return sysProxyEnabled ? 'green' : 'white'
}

export function getCustomTrayIconKey(status: TrayIconStatus): keyof ICustomTrayIcons | undefined {
  if (status === 'green') return 'sysProxy'
  if (status === 'blue') return 'tun'
  if (status === 'white') return 'off'
  return undefined
}

export function buildTrayTooltip(status: string[], traffic?: string): string {
  return [...status, ...(traffic ? [traffic] : [])].join('\n')
}
