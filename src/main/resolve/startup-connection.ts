import { getAppConfig, patchAppConfig } from '../config/app'
import { getControledMihomoConfig } from '../config/controledMihomo'
import { controledMihomoConfigPath } from '../utils/dirs'
import { atomicWriteFile } from '../utils/safeFile'
import { stringify } from '../utils/yaml'

// Prepare disk configuration before the core starts. Never acquire OS proxy or TUN here.
export async function prepareStartupConnection(): Promise<void> {
  const config = await getAppConfig()
  if (config.autoConnect && process.env.DEX_TEST_MODE !== '1') return
  if (config.sysProxy.enable) await patchAppConfig({ sysProxy: { ...config.sysProxy, enable: false } })
  const core = await getControledMihomoConfig()
  if (core.tun?.enable) {
    await atomicWriteFile(controledMihomoConfigPath(), stringify({ ...core, tun: { ...core.tun, enable: false } }))
    await getControledMihomoConfig(true)
  }
}
