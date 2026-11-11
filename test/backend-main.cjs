'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');

const mainPath = path.join(__dirname, '..', 'electron', 'main.cjs');
const mainSource = fs.readFileSync(mainPath, 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));

function cancelableEvent() {
  return { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
}

async function harness({ dispose } = {}) {
  const windows = [];
  const errors = [];
  const handlers = new Map();
  let exits = 0;
  let disposals = 0;
  let disconnects = 0;
  const app = new EventEmitter();
  Object.assign(app, {
    isPackaged: false,
    setName() {}, setPath() {},
    getPath: () => path.join(__dirname, 'mock-user-data'),
    getVersion: () => 'test',
    requestSingleInstanceLock: () => true,
    whenReady: async () => {},
    quit() {
      const event = cancelableEvent();
      app.emit('before-quit', event);
      if (event.defaultPrevented) return;
      for (const window of windows) window.close();
      if (windows.every(window => window.isDestroyed())) exits++;
    }
  });

  class MockWindow extends EventEmitter {
    constructor() {
      super();
      this.destroyed = false;
      this.shown = 0;
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = () => {};
      this.webContents.mainFrame = {};
      windows.push(this);
    }
    isDestroyed() { return this.destroyed; }
    isMinimized() { return false; }
    show() { this.shown++; }
    focus() {}
    async loadFile(file) { this.webContents.mainFrame.url = pathToFileURL(file).href; }
    close() {
      if (this.destroyed) return;
      const event = cancelableEvent();
      this.emit('close', event);
      if (!event.defaultPrevented) this.destroyed = true;
    }
  }

  const service = {
    disposed: false,
    state: { settings: { startMinimized: false } },
    async init() { return this; },
    async dispose() { disposals++; if (dispose) await dispose(disposals); },
    failure(error) { this.lastError = error.message; },
    async disconnect() { disconnects++; return { connected: false }; },
    async snapshot() { return { lastError: this.lastError }; }
  };
  const electron = {
    app,
    BrowserWindow: MockWindow,
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    dialog: { showErrorBox: (title, message) => errors.push({ title, message }) },
    session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, webRequest: { onHeadersReceived() {} } } }
  };
  const context = {
    require(id) {
      if (id === 'electron') return electron;
      if (id === './core-service.cjs') return { CoreService: class { constructor() { return service; } } };
      if (id === './theme-service.cjs') return { ThemeService: class {} };
      return require(id);
    },
    __dirname: path.dirname(mainPath),
    process: { env: { DEX_TEST_MODE: '1' }, on() {} },
    clearInterval,
    console
  };
  vm.runInNewContext(mainSource, context, { filename: mainPath });
  await settle();
  assert.equal(windows.length, 1);
  assert.ok(handlers.has('dex:invoke'));
  return {
    app, service, errors, window: windows[0],
    get exits() { return exits; },
    get disposals() { return disposals; },
    get disconnects() { return disconnects; },
    invoke(action) {
      const sender = windows[0].webContents;
      return handlers.get('dex:invoke')({ sender, senderFrame: sender.mainFrame }, action);
    }
  };
}

test('failed quit preserves the window, reports recovery failure and accepts a retry', async () => {
  const fixture = await harness({ dispose: async attempt => { if (attempt === 1) throw new Error('Mock Windows proxy recovery failure'); } });
  fixture.app.quit();
  await settle();
  assert.equal(fixture.exits, 0);
  assert.equal(fixture.disposals, 1);
  assert.equal(fixture.window.isDestroyed(), false);
  assert.equal(fixture.window.shown, 1);
  assert.equal(fixture.service.disposed, false);
  assert.equal(fixture.errors.length, 1);
  assert.match(fixture.errors[0].message, /系统代理尚未恢复/);
  assert.match((await fixture.invoke('snapshot')).lastError, /保持打开/);
  await fixture.invoke('disconnect');
  assert.equal(fixture.disconnects, 1);
  fixture.app.quit();
  await settle();
  assert.equal(fixture.disposals, 2);
  assert.equal(fixture.exits, 1);
  assert.equal(fixture.window.isDestroyed(), true);
  assert.equal(fixture.errors.length, 1);
});

test('closing the window cannot destroy the recovery retry surface', async () => {
  const fixture = await harness({ dispose: async () => { throw new Error('Mock recovery denied'); } });
  fixture.window.close();
  await settle();
  assert.equal(fixture.exits, 0);
  assert.equal(fixture.window.isDestroyed(), false);
  assert.equal(fixture.errors.length, 1);
  fixture.window.close();
  await settle();
  assert.equal(fixture.disposals, 2);
  assert.equal(fixture.exits, 0);
  assert.equal(fixture.window.isDestroyed(), false);
  assert.equal(fixture.errors.length, 2);
});

test('repeated quit requests wait for the same pending recovery before exit', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const fixture = await harness({ dispose: () => pending });
  fixture.app.quit();
  await settle();
  fixture.app.quit();
  fixture.window.close();
  await settle();
  assert.equal(fixture.disposals, 1);
  assert.equal(fixture.exits, 0);
  assert.equal(fixture.window.isDestroyed(), false);
  release();
  await settle();
  assert.equal(fixture.exits, 1);
  assert.equal(fixture.window.isDestroyed(), true);
  assert.equal(fixture.errors.length, 0);
});
