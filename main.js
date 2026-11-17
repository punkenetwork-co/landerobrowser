const { app, BrowserWindow, session, ipcMain, Menu, clipboard, webContents } = require('electron');
const path = require('path');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');
const fetch = require('cross-fetch');
// Arriba del todo:
const { autoUpdater } = require('electron-updater');

// Dentro de app.whenReady().then(...), después de createWindow():
autoUpdater.checkForUpdatesAndNotify();

let mainWindow;
let blocker;
let blockedCount = 0;
const PARTITION = 'persist:main';
const DEVTOOLS_PASSWORD = 'admin';
const sitePermissions = {};

async function initAdblocker() {
  try {
    blocker = await ElectronBlocker.fromLists(fetch, [
      'https://easylist.to/easylist/easylist.txt',
      'https://easylist.to/easylist/easyprivacy.txt'
    ]);
    const ses = session.fromPartition(PARTITION);

    blocker.on('request-blocked', () => {
      blockedCount++;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('blocked-count', blockedCount);
    });
    blocker.enableBlockingInSession(ses);

    ses.setPermissionRequestHandler((wc, permission, callback) => {
      const domain = new URL(wc.getURL()).hostname;
      if (sitePermissions[domain] && sitePermissions[domain][permission] !== undefined) return callback(sitePermissions[domain][permission]);
      callback(false);
    });
  } catch (err) { console.error('[Escudo] ❌ Error:', err); }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 800, minHeight: 600,
    frame: false, titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true, contextIsolation: true, nodeIntegration: false
    }
  });

  const ses = session.fromPartition(PARTITION);
  const firefoxUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0';
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const requestHeaders = { ...details.requestHeaders };
    requestHeaders['User-Agent'] = firefoxUA;
    delete requestHeaders['X-Electron'];
    callback({ cancel: false, requestHeaders });
  });

  win.loadFile('index.html');
  if (!mainWindow) mainWindow = win; // Guardamos la principal para el IPC
  return win;
}

app.whenReady().then(async () => {
  await initAdblocker();
  createWindow();
  autoUpdater.checkForUpdatesAndNotify();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

app.on('web-contents-created', (event, contents) => {
  if (contents.getType() === 'webview') {
    contents.setWindowOpenHandler(({ url }) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('open-new-tab', url);
      return { action: 'deny' }; 
    });

    contents.on('dom-ready', () => {
      contents.executeJavaScript(`Object.defineProperty(navigator, 'webdriver', { get: () => false }); delete window.process; delete window.require;`).catch(() => {});
      if (contents.getURL().includes('youtube.com')) {
        const killYoutubeAds = `(function() { const style = document.createElement('style'); style.textContent = \`.video-ads, .ytp-ad-module, .ytp-ad-overlay-container, #player-ads, ytd-display-ad-renderer { display: none !important; }\`; document.documentElement.appendChild(style); setInterval(() => { const video = document.querySelector('video'); if (video && document.querySelector('.ad-showing')) { video.muted = true; video.playbackRate = 16; if (video.duration > 0) video.currentTime = video.duration; } const btn = document.querySelector('.ytp-ad-skip-button, .ytp-skip-ad-button'); if (btn) btn.click(); }, 50); })();`;
        contents.executeJavaScript(killYoutubeAds).catch(() => {});
      }
    });

    contents.on('context-menu', (e, params) => {
      const menuTemplate = [];
      if (params.linkURL) {
        menuTemplate.push({ label: 'Abrir en nueva pestaña', click: () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('open-new-tab', params.linkURL); }});
        menuTemplate.push({ label: 'Copiar dirección', click: () => clipboard.writeText(params.linkURL) });
        menuTemplate.push({ type: 'separator' });
      }
      if (params.mediaType === 'image' && params.srcURL) {
        menuTemplate.push({ label: 'Guardar imagen', click: () => contents.downloadURL(params.srcURL) });
        menuTemplate.push({ type: 'separator' });
      }
      if (params.selectionText) menuTemplate.push({ label: 'Copiar', role: 'copy' });
      else if (params.isEditable) menuTemplate.push({ label: 'Cortar', role: 'cut' }, { label: 'Copiar', role: 'copy' }, { label: 'Pegar', role: 'paste' });
      else menuTemplate.push({ label: 'Atrás', enabled: contents.canGoBack(), click: () => contents.goBack() }, { label: 'Recargar', click: () => contents.reload() });
      
      menuTemplate.push({ type: 'separator' }, { label: 'Inspeccionar Elemento', click: () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('ask-devtools-password', { wcId: contents.id, x: params.x, y: params.y }); }});
      Menu.buildFromTemplate(menuTemplate).popup();
    });
  }
});

// 🔥 NUEVAS HERRAMIENTAS
ipcMain.on('new-window', () => createWindow());
ipcMain.on('print-page', (e) => { const wc = webContents.fromId(e.sender.id); if (wc) wc.print(); });

ipcMain.on('clear-data', async (e) => {
  const ses = session.fromPartition(PARTITION);
  await ses.clearCache();
  await ses.clearStorageData();
  mainWindow.webContents.send('data-cleared');
});

ipcMain.on('set-site-permission', (e, { domain, permission, allow }) => {
  if (!sitePermissions[domain]) sitePermissions[domain] = {};
  sitePermissions[domain][permission] = allow;
});

ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
ipcMain.on('window-close', () => mainWindow?.close());
ipcMain.handle('get-stats-async', () => ({ blockedCount }));
ipcMain.handle('get-newtab-path', () => 'file://' + path.join(__dirname, 'newtab.html').replace(/\\/g, '/'));

ipcMain.on('verify-devtools-password', (e, { password, wcId, x, y }) => {
  if (password === DEVTOOLS_PASSWORD) {
    const wc = webContents.fromId(wcId);
    if (wc) wc.inspectElement(x, y);
    mainWindow.webContents.send('password-result', true);
  } else mainWindow.webContents.send('password-result', false);
});