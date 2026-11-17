const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('browserAPI', {
  onBlockedCount: (cb) => ipcRenderer.on('blocked-count', (e, n) => cb(n)),
  onOpenNewTab: (cb) => ipcRenderer.on('open-new-tab', (e, url) => cb(url)),
  onDataCleared: (cb) => ipcRenderer.on('data-cleared', () => cb()),
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  getStats: () => ipcRenderer.invoke('get-stats-async'),
  getNewtabPath: () => ipcRenderer.invoke('get-newtab-path'),
  onAskDevtoolsPassword: (cb) => ipcRenderer.on('ask-devtools-password', (e, data) => cb(data)),
  onPasswordResult: (cb) => ipcRenderer.on('password-result', (e, success) => cb(success)),
  verifyPassword: (data) => ipcRenderer.send('verify-devtools-password', data),
  setSitePermission: (data) => ipcRenderer.send('set-site-permission', data),
  
  // 🔥 HERRAMIENTAS
  newWindow: () => ipcRenderer.send('new-window'),
  printPage: () => ipcRenderer.send('print-page'),
  clearData: () => ipcRenderer.send('clear-data')
});