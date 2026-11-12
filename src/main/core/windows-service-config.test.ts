import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareWindowsServiceConfig } from './windows-service-config'
import { createElevatedRestartCommand } from './windows-elevation'

const directories: string[] = []
async function fixture(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'navio-service-test-'))
  directories.push(directory)
  return directory
}
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})

describe('privileged core resource staging', () => {
  it('copies explicitly referenced local providers and leaves the original config untouched', async () => {
    const directory = await fixture()
    await mkdir(path.join(directory, 'custom'))
    await writeFile(
      path.join(directory, 'custom', 'rules.yaml'),
      'payload:\n - DOMAIN,example.com\n'
    )
    const original = {
      'external-controller': '0.0.0.0:9090',
      secret: 'private',
      'external-ui': 'C:/outside',
      tun: { enable: true },
      'rule-providers': {
        local: { type: 'file', behavior: 'classical', path: './custom/rules.yaml' }
      }
    }
    const prepared = await prepareWindowsServiceConfig(original, directory)
    expect(prepared.config).not.toHaveProperty('secret')
    expect(prepared.config).not.toHaveProperty('external-controller')
    expect(prepared.config).not.toHaveProperty('external-ui')
    const providers = prepared.config['rule-providers'] as (typeof original)['rule-providers']
    expect(providers.local.path).toMatch(/^providers\/[a-f0-9]{64}\.yaml$/)
    expect(prepared.assets).toHaveLength(1)
    expect(Buffer.from(prepared.assets[0].data, 'base64').toString()).toContain(
      'DOMAIN,example.com'
    )
    expect(original['rule-providers'].local.path).toBe('./custom/rules.yaml')
    expect(await readFile(path.join(directory, 'custom/rules.yaml'), 'utf8')).toContain('payload:')
  })

  it('puts provider downloads into dedicated service paths, preserving the URI and update settings', async () => {
    const directory = await fixture()
    const input = {
      'proxy-providers': {
        subscription: {
          type: 'http',
          url: 'https://example.com/sub',
          interval: 3600,
          path: 'C:/Windows/unsafe.yaml'
        }
      }
    }
    const prepared = await prepareWindowsServiceConfig(input, directory)
    const providers = prepared.config['proxy-providers'] as (typeof input)['proxy-providers']
    expect(providers.subscription).toMatchObject({
      url: input['proxy-providers'].subscription.url,
      interval: 3600
    })
    expect(providers.subscription.path).toMatch(/^providers\//)
    expect(prepared.assets).toEqual([])
  })

  it('reports missing local resources instead of silently creating a different configuration', async () => {
    const directory = await fixture()
    await expect(
      prepareWindowsServiceConfig(
        { 'rule-providers': { local: { type: 'file', path: 'missing.mrs' } } },
        directory
      )
    ).rejects.toThrow()
    await expect(
      prepareWindowsServiceConfig({ 'rule-providers': { local: { type: 'file' } } }, directory)
    ).rejects.toThrow('缺少文件路径')
  })

  it('uses shared Geo resources when per-profile resources are absent', async () => {
    const directory = await fixture()
    const shared = await fixture()
    await writeFile(path.join(shared, 'geoip.metadb'), 'geo fixture')
    const prepared = await prepareWindowsServiceConfig({ tun: { enable: true } }, directory, shared)
    expect(prepared.assets).toEqual([
      { path: 'geoip.metadb', data: Buffer.from('geo fixture').toString('base64') }
    ])
  })
})

describe('one-time administrator restart', () => {
  it('waits for the existing app to exit and carries literal special characters in an encoded command', () => {
    const command = createElevatedRestartCommand(
      "C:\\O'Brien & Co\\Navio.exe",
      ['--admin-restart-for-tun', 'C:\\space name\\'],
      1234
    )
    expect(command).toContain('-Verb RunAs -WindowStyle Hidden')
    const encoded = command.match(/'-EncodedCommand', '([A-Za-z0-9+/=]+)'/)?.[1]
    expect(encoded).toBeTruthy()
    if (!encoded) throw new Error('Missing encoded restart command')
    const inner = Buffer.from(encoded, 'base64').toString('utf16le')
    expect(inner).toContain('Wait-Process -Id 1234')
    expect(inner).toContain("'C:\\O''Brien & Co\\Navio.exe'")
    expect(inner).toContain('if (Get-Process')
    expect(inner).toContain('--admin-restart-for-tun')
  })
  it('rejects a nonnumeric parent identifier', () => {
    expect(() => createElevatedRestartCommand('Navio.exe', [], -1)).toThrow('Invalid parent PID')
  })
})
