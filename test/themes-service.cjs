'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { ThemeService, normalizeServerUrl } = require('../electron/theme-service.cjs');
const { BUILTIN_THEMES } = require('../shared/themes.cjs');
const { createThemeServer } = require('../server/index.cjs');
const { once } = require('node:events');

test('server URL accepts secure endpoints and local development only', () => {
  assert.equal(normalizeServerUrl('https://mydex.top/dex-api/'), 'https://mydex.top/dex-api');
  assert.equal(normalizeServerUrl('http://127.0.0.1:17896/'), 'http://127.0.0.1:17896');
  assert.equal(normalizeServerUrl(''), '');
  for (const url of ['http://example.com', 'file:///etc/passwd', 'https://user:pass@example.com', 'https://example.com/?token=secret', 'https://example.com/#x']) assert.throws(() => normalizeServerUrl(url));
});

test('desktop theme service persists edits, uses native dialogs, and publishes without saving tokens', async () => {
  const work = path.resolve(__dirname, '../../../work');
  await fs.mkdir(work, { recursive: true });
  const directory = await fs.mkdtemp(path.join(work, 'theme-service-'));
  const token = 'publish-token-'.repeat(4);
  const dataDir = path.join(directory, 'server-data');
  const server = await createThemeServer({ dataDir, uploadToken: token });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const exported = path.join(directory, 'exported.json');
  const imported = path.join(directory, 'imported.json');
  const theme = { ...structuredClone(BUILTIN_THEMES[0]), id: 'my-local-design', name: 'Local design' };
  const dialog = {
    async showSaveDialog() { return { canceled: false, filePath: exported }; },
    async showOpenDialog() { return { canceled: false, filePaths: [imported] }; },
  };
  try {
    const userData = path.join(directory, 'client');
    const service = new ThemeService({ userData, dialog });
    assert.equal((await service.handle('themes.list')).builtins.length, 6);
    await service.handle('themes.save', { theme });
    await service.handle('themes.apply', { id: theme.id });
    await service.handle('themes.export', { id: theme.id });
    assert.deepEqual(JSON.parse(await fs.readFile(exported, 'utf8')), theme);
    await fs.writeFile(imported, JSON.stringify({ ...theme, id: 'imported-theme' }));
    assert.equal((await service.handle('themes.import')).id, 'imported-theme');
    await assert.rejects(service.save({ theme: BUILTIN_THEMES[0] }), /内置主题/);
    await service.handle('themes.configure', { url: `http://127.0.0.1:${server.address().port}` });
    assert.equal((await service.handle('themes.publish', { id: theme.id, token })).id, theme.id);
    const refreshed = await service.handle('themes.refresh');
    assert.equal(refreshed.remote.length, 1);
    assert.equal(refreshed.remoteError, null);
    const config = await fs.readFile(path.join(userData, 'theme-settings.json'), 'utf8');
    assert.ok(!config.includes(token));
    const restarted = new ThemeService({ userData });
    const persisted = await restarted.list();
    assert.equal(persisted.selectedId, theme.id);
    assert.equal(persisted.local.length, 2);
    assert.equal(persisted.remote.length, 0);
    await restarted.configure({ url: '' });
    assert.equal((await restarted.refresh()).remote.length, 0);
  } finally { await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }); }
});
