'use strict';
// Opt-in integration test: launches only this project's bundled core, uses an
// isolated DIRECT-only profile, and never writes the Windows system proxy.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { CoreService } = require('../electron/core-service.cjs');

test('bundled Clash starts, serves live controller data, changes mode and exits cleanly', { skip: process.env.DEX_RUN_REAL_CORE_TEST !== '1', timeout: 30_000 }, async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dex-real-core-'));
  let proxyWrites = 0;
  const service = new CoreService({
    dataDir,
    coreDir: path.resolve(__dirname, '..', 'resources', 'core'),
    scriptsDir: path.resolve(__dirname, '..', 'scripts'),
    proxyAdapter: { enable: async () => { proxyWrites++; }, restore: async () => { proxyWrites++; return { restored: true }; } }
  });
  t.after(async () => {
    await service.dispose().catch(() => {});
    assert.equal(proxyWrites, 0);
    assert.ok(dataDir.startsWith(path.join(os.tmpdir(), 'dex-real-core-')));
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  await service.init();
  await service.importText('proxies: []\nproxy-groups:\n  - name: Test selection\n    type: select\n    proxies: [DIRECT]\nrules:\n  - MATCH,DIRECT\n', 'Integration DIRECT');
  await service.start();
  const live = await service.snapshot();
  assert.equal(live.core.running, true);
  assert.ok(live.core.version);
  assert.equal(live.systemProxy, false);
  assert.equal(live.proxies['Test selection'].type, 'Selector');
  assert.ok(live.rules.length > 0);
  await service.selectProxy({ group: 'Test selection', name: 'DIRECT' });
  await service.setMode({ mode: 'direct' });
  assert.equal((await service.snapshot()).mode, 'direct');
  await assert.rejects(service.importText('proxies:\n  - name: Unsupported\n    type: dex-invalid-protocol\nrules:\n  - MATCH,DIRECT\n', 'Invalid candidate'), /已恢复此前配置/);
  const restored = await service.snapshot();
  assert.equal(restored.core.running, true);
  assert.equal(restored.mode, 'direct');
  assert.equal(restored.profiles.find(profile => profile.active).name, 'Integration DIRECT');
  assert.equal(restored.profiles.length, 1);
  await service.stop();
  assert.equal((await service.snapshot()).core.running, false);
});
