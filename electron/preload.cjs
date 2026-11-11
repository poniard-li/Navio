'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const allowed = new Set(['snapshot', 'importProfile', 'importSubscription', 'refreshProfile', 'activateProfile', 'deleteProfile', 'start', 'stop', 'setMode', 'selectProxy', 'testProxy', 'closeConnection', 'setSystemProxy', 'saveSettings', 'window', 'openDataFolder', 'themes.list', 'themes.import', 'themes.export', 'themes.apply', 'themes.publish', 'themes.configure', 'themes.refresh', 'themes.save']);
contextBridge.exposeInMainWorld('dex', Object.freeze({
  invoke: (action, payload) => {
    if (!allowed.has(action)) return Promise.reject(new Error('不支持的操作。'));
    return ipcRenderer.invoke('dex:invoke', action, payload);
  }
}));
