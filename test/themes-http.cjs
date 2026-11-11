'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const crypto = require('node:crypto');
const { BUILTIN_THEMES } = require('../shared/themes.cjs');

const uploadToken = crypto.randomBytes(32).toString('hex');
const adminToken = crypto.randomBytes(32).toString('hex');

async function startServer(dataDir) {
  const child = spawn(process.execPath, [path.join(__dirname, '../server/index.cjs')], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0', DATA_DIR: dataDir, UPLOAD_TOKEN: uploadToken, ADMIN_TOKEN: adminToken, CORS_ORIGINS: 'https://themes.example.com' },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  const port = await new Promise((resolve, reject) => {
    let output = '';
    let error = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Theme server startup timed out')); }, 10000);
    child.stderr.on('data', chunk => { error += chunk.toString(); });
    child.once('error', failure => { clearTimeout(timer); reject(failure); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Theme server exited ${code}: ${error}`)); });
    child.stdout.on('data', chunk => {
      output += chunk.toString();
      if (output.includes('\n')) {
        try { const result = JSON.parse(output.split('\n')[0]); clearTimeout(timer); resolve(result.port); } catch (failure) { clearTimeout(timer); reject(failure); }
      }
    });
  });
  return { child, url: `http://127.0.0.1:${port}` };
}

async function stopServer(child) {
  if (child.exitCode != null) return;
  const exited = once(child, 'exit');
  child.kill();
  await exited;
}

test('real HTTP process authenticates publishing, validates themes, paginates, and persists', { timeout: 30000 }, async t => {
  const work = path.resolve(__dirname, '../../../work');
  await fs.mkdir(work, { recursive: true });
  const dataDir = await fs.mkdtemp(path.join(work, 'theme-http-'));
  let running = await startServer(dataDir);
  const theme = { ...structuredClone(BUILTIN_THEMES[0]), id: 'community-test', name: 'Community test' };
  const post = (value, token = uploadToken, extras = {}) => fetch(`${running.url}/themes`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...extras }, body: typeof value === 'string' ? value : JSON.stringify(value) });
  try {
    await t.test('health and empty catalog are public and contain no secrets', async () => {
      const health = await fetch(`${running.url}/health`);
      assert.equal(health.status, 200);
      assert.deepEqual(await health.json(), { status: 'ok', service: 'dex-themes', version: 1 });
      assert.deepEqual(await (await fetch(`${running.url}/themes`)).json(), { themes: [], total: 0, nextOffset: null });
    });
    await t.test('missing or invalid token is rejected', async () => {
      assert.equal((await post(theme, 'invalid')).status, 401);
      assert.equal((await fetch(`${running.url}/themes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(theme) })).status, 401);
    });
    await t.test('executable themes, reserved names, invalid JSON, and large payloads are rejected', async () => {
      assert.equal((await post({ ...theme, css: 'body{display:none}' })).status, 400);
      assert.equal((await post({ ...theme, colors: { ...theme.colors, accent: 'url(https://evil.example)' } })).status, 400);
      assert.equal((await post({ ...theme, description: '<script>alert(1)</script>' })).status, 400);
      assert.equal((await post(BUILTIN_THEMES[0])).status, 400);
      assert.equal((await post('{invalid')).status, 400);
      assert.equal((await post('x'.repeat(9000))).status, 413);
    });
    await t.test('publishing works, but only admin can replace an existing ID', async () => {
      const result = await post(theme);
      assert.equal(result.status, 201);
      assert.deepEqual((await result.json()).theme, theme);
      assert.equal((await post({ ...theme, name: 'Unauthorized update' })).status, 403);
      const update = await post({ ...theme, name: 'Administrator update' }, adminToken);
      assert.equal(update.status, 200);
      assert.equal((await update.json()).theme.name, 'Administrator update');
    });
    await t.test('pagination is bounded and CORS is exact', async () => {
      assert.equal((await post({ ...theme, id: 'another-design' })).status, 201);
      const first = await (await fetch(`${running.url}/themes?limit=1&offset=0`)).json();
      assert.equal(first.themes.length, 1);
      assert.equal(first.total, 2);
      assert.equal(first.nextOffset, 1);
      assert.equal((await fetch(`${running.url}/themes?limit=1000`)).status, 400);
      assert.equal((await fetch(`${running.url}/themes?offset=-1`)).status, 400);
      assert.equal((await fetch(`${running.url}/themes`, { headers: { Origin: 'https://evil.example' } })).status, 403);
      const permitted = await fetch(`${running.url}/themes`, { headers: { Origin: 'https://themes.example.com' } });
      assert.equal(permitted.headers.get('access-control-allow-origin'), 'https://themes.example.com');
      assert.equal(permitted.headers.get('access-control-allow-credentials'), null);
    });
    await t.test('data survives restart without exposing or storing access tokens', async () => {
      await stopServer(running.child);
      running = await startServer(dataDir);
      const catalog = await (await fetch(`${running.url}/themes`)).json();
      assert.equal(catalog.total, 2);
      assert.equal(catalog.themes.find(item => item.id === theme.id).name, 'Administrator update');
      const files = await fs.readdir(dataDir);
      assert.equal(files.length, 2);
      for (const file of files) {
        const content = await fs.readFile(path.join(dataDir, file), 'utf8');
        assert.ok(!content.includes(uploadToken) && !content.includes(adminToken));
      }
    });
  } finally { await stopServer(running.child); await fs.rm(dataDir, { recursive: true, force: true }); }
});
