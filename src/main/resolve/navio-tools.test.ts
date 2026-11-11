import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
vi.mock('../config/app', () => ({ getAppConfig: vi.fn() }))
vi.mock('../config/controledMihomo', () => ({ getControledMihomoConfig: vi.fn() }))
import {
  navioScriptCommand,
  proxyTerminalEnvironment,
  validateNavioTrayScript
} from './navio-tools'

describe('proxy terminal environment', () => {
  it('only changes the child environment and selects active HTTP/SOCKS ports', () => {
    const original = { PATH: 'test', HTTPS_PROXY: 'old' }
    expect(
      proxyTerminalEnvironment({ 'mixed-port': 0, port: 17892, 'socks-port': 17891 }, original)
    ).toMatchObject({
      PATH: 'test',
      HTTP_PROXY: 'http://127.0.0.1:17892',
      HTTPS_PROXY: 'http://127.0.0.1:17892',
      ALL_PROXY: 'socks5h://127.0.0.1:17891'
    })
    expect(original).toEqual({ PATH: 'test', HTTPS_PROXY: 'old' })
  })
  it('brackets IPv6 and refuses disabled ports or invalid bind host', () => {
    expect(
      proxyTerminalEnvironment({ 'mixed-port': 17890, 'bind-address': '::' }, {}).HTTP_PROXY
    ).toBe('http://[::1]:17890')
    expect(() => proxyTerminalEnvironment({ 'mixed-port': 0, port: 0, 'socks-port': 0 })).toThrow()
    expect(() => proxyTerminalEnvironment({ 'bind-address': '127.0.0.1;command' })).toThrow()
  })
})
describe('manual tray script arguments', () => {
  const script = {
    id: 'test',
    name: 'Local tool',
    path: join(tmpdir(), 'script with spaces.ps1'),
    args: ['a;b', '$(not-a-command)', 'two words']
  }
  it('preserves literal user args and does not turn them into a command string', () => {
    expect(navioScriptCommand(validateNavioTrayScript(script)).args).toEqual([
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-File',
      script.path,
      ...script.args
    ])
  })
  it('rejects unsupported types, relative paths and malformed argument arrays', () => {
    expect(() => validateNavioTrayScript({ ...script, path: 'relative.ps1' })).toThrow()
    expect(() =>
      validateNavioTrayScript({ ...script, path: join(tmpdir(), 'script.cmd') })
    ).toThrow()
    expect(() => validateNavioTrayScript({ ...script, args: 'anything' })).toThrow()
    expect(() => validateNavioTrayScript({ ...script, args: ['\0'] })).toThrow()
  })
})
