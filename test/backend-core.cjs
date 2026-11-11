'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const YAML = require('yaml');
const { CoreService, parseProfile, normalizeConfig, fetchSubscription, MAX_PROFILE_BYTES } = require('../electron/core-service.cjs');

const validYaml = 'proxies: []\nproxy-groups:\n  - name: Choice\n    type: select\n    proxies: [DIRECT]\nrules:\n  - MATCH,DIRECT\n';

async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dex-backend-'));
  const coreDir = path.join(directory, 'bundle');
  await fs.mkdir(coreDir);
  await fs.writeFile(path.join(coreDir, process.platform === 'win32' ? 'clash.exe' : 'clash'), 'fixture');
  await fs.writeFile(path.join(coreDir, 'Country.mmdb'), 'fixture database');
  const calls = { spawn: 0, enable: 0, restore: 0, requests: [] };
  let activeMode = 'rule';
  const service = new CoreService({
    dataDir: path.join(directory, 'user'), coreDir, scriptsDir: path.join(__dirname, '..', 'scripts'), watchdog: false,
    proxyAdapter: { enable: async () => { calls.enable++; }, restore: async () => { calls.restore++; return { restored: true }; }, read: async () => ({ enabled: true }) },
    portCheck: async () => {},
    spawnProcess: () => {
      calls.spawn++;
      const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.exitCode = null;
      child.kill = () => { child.exitCode = 0; process.nextTick(() => child.emit('exit', 0)); };
      return child;
    },
    fetcher: async (address, request = {}) => {
      const url = new URL(address); calls.requests.push({ pathname: url.pathname, request });
      if (url.protocol === 'https:') return new Response(validYaml);
      if (url.pathname === '/version') return Response.json({ version: 'fixture-core' });
      if (url.pathname === '/configs') { if (request.body) activeMode = JSON.parse(request.body).mode; return Response.json({ mode: activeMode }); }
      if (url.pathname === '/proxies') return Response.json({ proxies: { Choice: { type: 'Selector', all: ['DIRECT'], now: 'DIRECT' }, DIRECT: { type: 'Direct', history: [] } } });
      if (url.pathname === '/connections') return Response.json({ connections: [{ id: 'one', metadata: { host: 'example.test' }, upload: 10, download: 20 }], uploadTotal: 30, downloadTotal: 40 });
      if (url.pathname === '/rules') return Response.json({ rules: [{ type: 'Match', proxy: 'DIRECT' }] });
      if (url.pathname.endsWith('/delay')) return Response.json({ delay: 23 });
      return new Response(null, { status: 204 });
    }, ...options
  });
  await service.init();
  t.after(async () => { await service.dispose().catch(() => {}); assert.ok(directory.startsWith(path.join(os.tmpdir(), 'dex-backend-'))); await fs.rm(directory, { recursive: true, force: true }); });
  return { service, directory, calls };
}

test('untrusted configuration cannot open listeners, run scripts, or choose provider filesystem paths', () => {
  const parsed = parseProfile(`${validYaml}\nallow-lan: true\nexternal-controller: 0.0.0.0:9090\nsecret: stolen\nexternal-ui: C:/private\ntun: {enable: true}\nport: 1234\nredir-port: 1235\ndns: {enable: true, listen: '0.0.0.0:53'}\nproxy-providers:\n  remote:\n    type: http\n    url: https://example.test/feed?token=secret\n    path: ../../outside.yaml\n`);
  const config = normalizeConfig(parsed, 'random-secret', 'safe-id');
  assert.equal(config['external-controller'], '127.0.0.1:19090');
  assert.equal(config['mixed-port'], 17890); assert.equal(config['allow-lan'], false);
  assert.equal(config.port, 0); assert.equal(config['redir-port'], 0); assert.equal(config.tun.enable, false);
  assert.equal(config.secret, 'random-secret'); assert.equal(config['external-ui'], undefined); assert.equal(config.dns.listen, undefined);
  assert.equal(config['proxy-providers'].remote.path, './providers/safe-id-proxy-providers-0.yaml');
  assert.throws(() => parseProfile(`${validYaml}\nscript: {code: print(1)}`), /脚本/);
  assert.throws(() => normalizeConfig(parseProfile(`${validYaml}\nproxy-providers: {local: {type: file, path: 'C:/secret'}}`), 's', 'i'), /本地文件/);
});

test('rejects non-Clash input, malformed YAML, HTTP subscription and oversized downloads', async () => {
  for (const value of ['<html>login</html>', 'c3M6Ly9hYmNk', 'arbitrary: yaml', 'rules: hello', 'rules: []\nrules: []']) assert.throws(() => parseProfile(value));
  await assert.rejects(fetchSubscription('http://example.test/feed'), /HTTPS/);
  await assert.rejects(fetchSubscription('https://example.test/feed', async () => new Response('x', { headers: { 'content-length': String(MAX_PROFILE_BYTES + 1) } })), /10 MiB/);
  await assert.rejects(fetchSubscription('https://example.test/feed', async () => new Response('<html>', { headers: { 'content-type': 'text/html' } })), /网页/);
});

test('subscription redirect limit and HTTPS downgrade are enforced', async () => {
  let calls = 0;
  await assert.rejects(fetchSubscription('https://example.test/feed', async () => { calls++; return new Response(null, { status: 302, headers: { location: '/again' } }); }), /5 次/);
  assert.equal(calls, 6);
  await assert.rejects(fetchSubscription('https://example.test/feed', async () => new Response(null, { status: 302, headers: { location: 'http://other.test/feed' } })), /HTTPS/);
});

test('empty app stays stopped and never touches the system proxy', async t => {
  const { service, calls } = await fixture(t);
  const snapshot = await service.snapshot();
  assert.equal(snapshot.core.running, false); assert.deepEqual(snapshot.profiles, []); assert.deepEqual(snapshot.connections, []);
  await assert.rejects(service.start(), /先导入/);
  await assert.rejects(service.setSystemProxy({ enabled: true }), /先导入/);
  assert.equal(calls.spawn, 0); assert.equal(calls.enable, 0); assert.equal(calls.restore, 0);
});

test('subscription secrets stay in main-process storage; refresh and deletion are real', async t => {
  const { service, directory, calls } = await fixture(t);
  const imported = await service.importSubscription({ url: 'https://example.test/feed?token=VERY_SECRET', name: 'Private feed' });
  assert.equal(imported.source, 'subscription'); assert.equal(imported.url, undefined);
  assert.equal((await service.snapshot()).profiles[0].active, true);
  assert.equal(JSON.stringify(await service.snapshot()).includes('VERY_SECRET'), false);
  await service.refreshProfile({ id: imported.id });
  assert.equal(calls.spawn, 0);
  assert.match(await fs.readFile(path.join(directory, 'user', 'state.json'), 'utf8'), /VERY_SECRET/);
  await service.deleteProfile({ id: imported.id });
  assert.deepEqual((await service.snapshot()).profiles, []);
  await assert.rejects(fs.access(path.join(directory, 'user', 'profiles', `${imported.id}.yaml`)));
});

test('explicit core lifecycle drives authenticated live APIs and restores only its proxy adapter', async t => {
  const { service, directory, calls } = await fixture(t);
  await service.importText(validYaml, 'Test');
  await Promise.all([service.start(), service.start()]);
  assert.equal(calls.spawn, 1); assert.equal(calls.enable, 0);
  const runtime = YAML.parse(await fs.readFile(path.join(directory, 'user', 'core', 'runtime.yaml'), 'utf8'));
  assert.equal(runtime['mixed-port'], 17890); assert.equal(runtime.secret.length, 64);
  assert.equal(await fs.readFile(path.join(directory, 'user', 'core', 'Country.mmdb'), 'utf8'), 'fixture database');
  const snapshot = await service.snapshot();
  assert.equal(snapshot.core.running, true); assert.equal(snapshot.core.version, 'fixture-core');
  assert.equal(snapshot.connections[0].metadata.host, 'example.test'); assert.deepEqual(snapshot.totals, { upload: 30, download: 40 });
  assert.equal(JSON.stringify(snapshot).includes(runtime.secret), false);
  assert.equal(calls.requests.filter(c => c.pathname === '/version')[0].request.headers.Authorization, `Bearer ${runtime.secret}`);
  await service.setMode({ mode: 'global' }); assert.equal((await service.snapshot()).mode, 'global');
  await service.selectProxy({ group: 'Choice', name: 'DIRECT' });
  await assert.rejects(service.selectProxy({ group: 'Choice', name: 'MISSING' }), /不能/);
  assert.deepEqual(await service.testProxy({ name: 'DIRECT' }), { name: 'DIRECT', delay: 23 });
  await service.closeConnection({ id: 'one' });
  await service.setSystemProxy({ enabled: true }); assert.equal(calls.enable, 1);
  await service.stop(); assert.equal(calls.restore, 1); assert.equal((await service.snapshot()).core.running, false);
});

test('settings persist without launching any network service', async t => {
  const { service, calls } = await fixture(t);
  await service.saveSettings({ theme: 'custom-mono', startMinimized: true });
  assert.deepEqual((await service.snapshot()).settings, { theme: 'custom-mono', startMinimized: true });
  await assert.rejects(service.saveSettings({ theme: '../../invalid' }), /格式/);
  assert.equal(calls.spawn, 0); assert.equal(calls.requests.length, 0);
});

test('a conflicting port prevents process creation and a core crash restores the owned proxy', async t => {
  const blocked = await fixture(t, { portCheck: async () => { throw new Error('端口已占用'); } });
  await blocked.service.importText(validYaml, 'Blocked');
  await assert.rejects(blocked.service.start(), /占用/);
  assert.equal(blocked.calls.spawn, 0);
  const { service, calls } = await fixture(t);
  await service.importText(validYaml, 'Crash'); await service.start(); await service.setSystemProxy({ enabled: true });
  service.child.exitCode = 1; service.child.emit('exit', 1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.restore, 1); assert.equal((await service.snapshot()).core.running, false);
  assert.match((await service.snapshot()).lastError, /退出/);
});

test('logs redact token-bearing URLs and credentials', async t => {
  const { service } = await fixture(t);
  service.log('error', 'download https://example.test/sub?token=PRIVATE failed secret=OTHER');
  const logs = JSON.stringify((await service.snapshot()).logs);
  assert.equal(logs.includes('PRIVATE'), false); assert.equal(logs.includes('OTHER'), false);
});

test('a failed active profile change restores the previous profile and running proxy ownership', async t => {
  const { service, directory, calls } = await fixture(t);
  const unavailable = await service.importText(validYaml, 'Unsupported');
  const good = await service.importText(validYaml, 'Working');
  await service.start(); await service.setSystemProxy({ enabled: true });
  const originalStart = service.start.bind(service);
  service.start = async () => {
    if (service.profile(service.state.activeProfileId).name !== 'Working') throw new Error('Unsupported proxy type');
    return originalStart();
  };
  await assert.rejects(service.activateProfile({ id: unavailable.id }), /已恢复此前配置/);
  assert.equal(service.state.activeProfileId, good.id);
  assert.equal((await service.snapshot()).core.running, true);
  assert.equal(service.systemProxy, true);
  await assert.rejects(service.importText(validYaml, 'New incompatible'), /已恢复此前配置/);
  assert.equal(service.state.activeProfileId, good.id);
  assert.equal(service.state.profiles.length, 2);
  assert.equal((await fs.readdir(path.join(directory, 'user', 'profiles'))).length, 2);
  assert.equal(service.systemProxy, true);
  assert.equal(calls.enable, 3); assert.equal(calls.restore, 2);
});

test('failed subscription refresh restores its exact YAML and previous runtime', async t => {
  const { service, directory } = await fixture(t);
  const profile = await service.importSubscription({ url: 'https://example.test/feed' });
  await service.start();
  const originalFetcher = service.fetcher;
  service.fetcher = async (address, options) => new URL(address).protocol === 'https:' ? new Response(`${validYaml}\n# incompatible update`) : originalFetcher(address, options);
  const originalStart = service.start.bind(service);
  service.start = async () => {
    const text = await fs.readFile(path.join(directory, 'user', 'profiles', `${profile.id}.yaml`), 'utf8');
    if (text.includes('incompatible')) throw new Error('Unsupported proxy type');
    return originalStart();
  };
  await assert.rejects(service.refreshProfile({ id: profile.id }), /已恢复此前配置/);
  assert.equal(await fs.readFile(path.join(directory, 'user', 'profiles', `${profile.id}.yaml`), 'utf8'), validYaml);
  assert.equal((await service.snapshot()).core.running, true);
});
