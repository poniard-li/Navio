'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, session, Tray, Menu, nativeImage } = require('electron');
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
  let shutdownComplete = false;
  let tray;
  let trayTimer;
  let trayState;
  const appRoot = path.resolve(__dirname, '..');
  const rendererPath = path.join(appRoot, 'renderer', 'index.html');
  const rendererUrl = pathToFileURL(rendererPath).href;
  const allowed = new Set(['snapshot', 'importProfile', 'importSubscription', 'refreshProfile', 'activateProfile', 'deleteProfile', 'start', 'stop', 'connect', 'disconnect', 'setMode', 'selectProxy', 'testProxy', 'closeConnection', 'setSystemProxy', 'saveSettings', 'window', 'openDataFolder', 'themes.list', 'themes.import', 'themes.export', 'themes.apply', 'themes.publish', 'themes.configure', 'themes.refresh', 'themes.save']);

  function showWindow() { if (window && !window.isDestroyed()) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } }
  function enqueueMutation(operation) {
    const execute = () => { if (quitting) throw new Error('应用正在退出。'); return operation(); };
    const pending = mutationQueue.then(execute, execute);
    mutationQueue = pending.catch(() => {});
    return pending;
  }
  function updateTray() {
    if (!tray || tray.isDestroyed() || !service) return;
    const status = service.connectionStatus();
    const state = `${status.connected}:${status.running}:${status.systemProxy}:${service.connectionAction}:${quitting}`;
    if (state === trayState) return;
    trayState = state;
    const active = status.connected || status.systemProxy;
    const busy = !!service.connectionAction || quitting;
    const label = service.connectionAction === 'connecting' ? '正在连接…' : service.connectionAction === 'disconnecting' ? '正在断开…' : active ? '断开连接' : '连接';
    tray.setToolTip(`D.E.X STUDIO · ${status.connected ? '已连接' : status.running ? '内核就绪' : '未连接'}`);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示 D.E.X STUDIO', click: showWindow },
      { type: 'separator' },
      { label, enabled: !busy, click: () => {
        enqueueMutation(() => active ? service.disconnect() : service.connect())
          .catch(error => { service.failure(error); showWindow(); })
          .finally(updateTray);
      } },
      { type: 'separator' },
      { label: '退出', click: () => app.quit(), enabled: !quitting }
    ]));
  }

  app.on('second-instance', showWindow);
  app.on('before-quit', event => {
    if (shutdownComplete || !service) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    service.disposed = true;
    updateTray();
    // Reject queued work and let the active mutation settle before final cleanup.
    // A second quit request must not bypass proxy recovery while it is pending.
    mutationQueue.catch(() => {}).then(() => service.dispose()).then(() => {
      clearInterval(trayTimer);
      tray?.destroy();
      shutdownComplete = true;
      app.quit();
    }, () => {
      // The core has stopped, but the saved Windows proxy may still need recovery.
      // Keep the application usable so disconnect or a later quit can retry it.
      quitting = false;
      service.disposed = false;
      const message = '系统代理尚未恢复，应用将保持打开。请重试“断开连接”或再次退出；恢复完成前，部分应用可能暂时无法联网。';
      service.failure(new Error(message));
      showWindow();
      updateTray();
      dialog.showErrorBox('D.E.X STUDIO 尚未退出', message);
    });
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
    window = new BrowserWindow({ width: 1300, height: 860, minWidth: 1050, minHeight: 700, title: 'D.E.X STUDIO', icon: app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(appRoot, 'resources', 'icon.png'), frame: false, show: false, backgroundColor: '#f5f5f7', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false } });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    window.webContents.on('render-process-gone', () => app.quit());
    // Keep a retry surface alive until proxy recovery has completed, including
    // when exit starts from the window close button instead of the tray menu.
    window.on('close', event => {
      if (shutdownComplete) return;
      event.preventDefault();
      app.quit();
    });
    window.once('ready-to-show', () => { if (process.env.DEX_TEST_MODE === '1') return; window.show(); if (service.state.settings.startMinimized) window.minimize(); });
    if (process.env.DEX_TEST_MODE !== '1') {
      try {
        const trayImage = nativeImage.createFromPath(app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(appRoot, 'resources', 'icon.png'));
        if (!trayImage.isEmpty()) {
          tray = new Tray(trayImage.resize({ width: 24, height: 24 }));
          tray.on('double-click', showWindow);
          updateTray();
          trayTimer = setInterval(updateTray, 1500);
          trayTimer.unref();
        }
      } catch { service.log('warning', '托盘暂不可用，仍可在主窗口操作。'); }
    }
    ipcMain.handle('dex:invoke', async (event, action, payload) => {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== rendererUrl) throw new Error('无效的操作来源。');
      if (!allowed.has(action)) throw new Error('不支持的操作。');
      if (payload !== undefined && (!payload || typeof payload !== 'object' || Array.isArray(payload))) throw new Error('参数格式无效。');
      const execute = async () => { try {
        if (quitting) throw new Error('应用正在退出。');
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
      } catch (error) { service.failure(error); throw new Error(error.message || '操作失败。'); } finally { updateTray(); } };
      if (action === 'snapshot' || action === 'window' || action === 'themes.list') return execute();
      return enqueueMutation(execute);
    });
    await window.loadFile(rendererPath);
  }).catch(error => { dialog.showErrorBox('D.E.X STUDIO 启动失败', error.message); app.quit(); });
}
