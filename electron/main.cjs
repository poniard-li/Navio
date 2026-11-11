'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, session } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { CoreService } = require('./core-service.cjs');
const { ThemeService } = require('./theme-service.cjs');

app.setName('D.E.X STUDIO');
app.setPath('userData', process.env.DEX_USER_DATA ? path.resolve(process.env.DEX_USER_DATA) : path.join(app.getPath('appData'), 'DEX-STUDIO'));
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) { app.quit(); }
else { boot(); }

function boot() {
  let window;
  let service;
  let themes;
  let mutationQueue = Promise.resolve();
  let quitting = false;
  const appRoot = path.resolve(__dirname, '..');
  const rendererPath = path.join(appRoot, 'renderer', 'index.html');
  const rendererUrl = pathToFileURL(rendererPath).href;
  const allowed = new Set(['snapshot', 'importProfile', 'importSubscription', 'refreshProfile', 'activateProfile', 'deleteProfile', 'start', 'stop', 'setMode', 'selectProxy', 'testProxy', 'closeConnection', 'setSystemProxy', 'saveSettings', 'window', 'openDataFolder', 'themes.list', 'themes.import', 'themes.export', 'themes.apply', 'themes.publish', 'themes.configure', 'themes.refresh', 'themes.save']);

  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.on('before-quit', event => {
    if (quitting || !service) return;
    event.preventDefault(); quitting = true;
    service.dispose().catch(() => {}).finally(() => app.quit());
  });
  app.on('window-all-closed', () => app.quit());
  process.on('SIGINT', () => app.quit());
  process.on('SIGTERM', () => app.quit());
  process.on('uncaughtException', error => { service?.failure(new Error('应用出现未处理异常，正在恢复代理并退出。')); app.quit(); });
  process.on('unhandledRejection', error => { service?.failure(new Error('应用出现未处理任务错误，正在恢复代理并退出。')); app.quit(); });

  app.whenReady().then(async () => {
    const coreDir = app.isPackaged ? path.join(process.resourcesPath, 'core') : path.join(appRoot, 'resources', 'core');
    service = await new CoreService({ dataDir: app.getPath('userData'), coreDir, scriptsDir: path.join(appRoot, 'scripts'), version: app.getVersion() }).init();
    themes = new ThemeService({ userData: app.getPath('userData'), dialog, getWindow: () => window });
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'"] } }));
    window = new BrowserWindow({ width: 1300, height: 860, minWidth: 1050, minHeight: 700, title: 'D.E.X STUDIO', icon: app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(appRoot, 'resources', 'icon.png'), frame: false, show: false, backgroundColor: '#0b0d10', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false } });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    window.webContents.on('render-process-gone', () => app.quit());
    window.once('ready-to-show', () => { if (process.env.DEX_TEST_MODE === '1') return; window.show(); if (service.state.settings.startMinimized) window.minimize(); });
    ipcMain.handle('dex:invoke', async (event, action, payload) => {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== rendererUrl) throw new Error('无效的操作来源。');
      if (!allowed.has(action)) throw new Error('不支持的操作。');
      if (payload !== undefined && (!payload || typeof payload !== 'object' || Array.isArray(payload))) throw new Error('参数格式无效。');
      const execute = async () => { try {
        if (action === 'snapshot') return service.snapshot();
        if (action.startsWith('themes.')) {
          const result = await themes.handle(action, payload);
          if (action === 'themes.apply' && result?.id) await service.saveSettings({ theme: result.id });
          return result;
        }
        if (action === 'importProfile') {
          const selected = await dialog.showOpenDialog(window, { title: '导入 Clash YAML 配置', properties: ['openFile'], filters: [{ name: 'Clash YAML', extensions: ['yaml', 'yml'] }] });
          if (selected.canceled || !selected.filePaths[0]) return { canceled: true };
          return await service.importProfile(selected.filePaths[0]);
        }
        if (action === 'window') {
          if (payload?.action === 'minimize') window.minimize();
          else if (payload?.action === 'maximize') { if (window.isMaximized()) window.unmaximize(); else window.maximize(); }
          else if (payload?.action === 'close') window.close();
          else throw new Error('窗口操作无效。');
          return { ok: true };
        }
        if (action === 'openDataFolder') { const error = await shell.openPath(app.getPath('userData')); if (error) throw new Error('无法打开应用数据目录。'); return { ok: true }; }
        return await service[action](payload);
      } catch (error) { service.failure(error); throw new Error(error.message || '操作失败。'); } };
      if (action === 'snapshot' || action === 'window' || action === 'themes.list') return execute();
      const pending = mutationQueue.then(execute, execute);
      mutationQueue = pending.catch(() => {});
      return pending;
    });
    await window.loadFile(rendererPath);
  }).catch(error => { dialog.showErrorBox('D.E.X STUDIO 启动失败', error.message); app.quit(); });
}
