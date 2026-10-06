'use strict';
const { app, BrowserWindow, screen, ipcMain, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let controlWin = null;
let projectorWin = null;

function externalDisplay() {
  const primary = screen.getPrimaryDisplay();
  return screen.getAllDisplays().find(d => d.id !== primary.id) || null;
}

function placeProjector() {
  if (!projectorWin || projectorWin.isDestroyed()) return;
  const ext = externalDisplay();
  if (ext) {
    if (projectorWin.isFullScreen()) projectorWin.setFullScreen(false);
    projectorWin.setBounds(ext.bounds);
    projectorWin.setFullScreen(true);
  } else {
    if (projectorWin.isFullScreen()) projectorWin.setFullScreen(false);
    const wa = screen.getPrimaryDisplay().workArea;
    const w = Math.min(1280, wa.width - 80), h = Math.round(w * 9 / 16);
    projectorWin.setBounds({ x: wa.x + Math.round((wa.width - w) / 2), y: wa.y + Math.round((wa.height - h) / 2), width: w, height: h });
  }
}

function createControlWindow() {
  controlWin = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Happy Days Presenter',
    backgroundColor: '#111317',
    icon: path.join(__dirname, 'build', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  controlWin.once('ready-to-show', () => { controlWin.maximize(); controlWin.show(); });
  controlWin.loadFile(path.join(__dirname, 'app', 'index.html'));

  controlWin.webContents.setWindowOpenHandler(({ url, frameName }) => {
    if (frameName === 'podium_projector') {
      const ext = externalDisplay();
      const b = ext ? ext.bounds : screen.getPrimaryDisplay().workArea;
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          title: 'Happy Days Presenter (projector)',
          backgroundColor: '#000000',
          autoHideMenuBar: true,
          x: b.x, y: b.y,
          width: ext ? b.width : 1280, height: ext ? b.height : 720,
          icon: path.join(__dirname, 'build', 'icon.png'),
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
        }
      };
    }
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  controlWin.webContents.on('did-create-window', (win, { frameName }) => {
    if (frameName !== 'podium_projector') return;
    projectorWin = win;
    win.setMenuBarVisibility(false);
    placeProjector();
    win.on('closed', () => { projectorWin = null; });
  });

  controlWin.on('closed', () => {
    controlWin = null;
    if (projectorWin && !projectorWin.isDestroyed()) projectorWin.close();
    app.quit();
  });
}

ipcMain.handle('has-external', () => !!externalDisplay());

function ffmpegPath() {
  let p = require('ffmpeg-static');
  if (p && p.includes('app.asar')) p = p.replace('app.asar', 'app.asar.unpacked');
  return p;
}
const toSec = t => { const m = /(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(t); return m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : 0; };

// Converts WMV/WMA (and other formats Chromium can't play) to MP4/M4A.
ipcMain.handle('convert-media', async (event, { input, kind, jobId }) => {
  const ff = ffmpegPath();
  if (!ff || !fs.existsSync(ff)) return { ok: false, error: 'FFmpeg is missing' };
  if (!input || !fs.existsSync(input)) return { ok: false, error: 'Input file not found' };
  const video = kind === 'video';
  const out = path.join(os.tmpdir(), `happydays-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${video ? 'mp4' : 'm4a'}`);
  const args = video
    ? ['-hide_banner', '-y', '-i', input, '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
       '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out]
    : ['-hide_banner', '-y', '-i', input, '-vn', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out];
  return new Promise(resolve => {
    const proc = spawn(ff, args, { windowsHide: true });
    let duration = 0, tail = '', lastPct = -1;
    proc.stderr.on('data', chunk => {
      const text = chunk.toString(); tail = (tail + text).slice(-4000);
      if (!duration) { const d = /Duration:\s*(\d+:\d+:\d+(?:\.\d+)?)/.exec(tail); if (d) duration = toSec(d[1]); }
      const all = [...text.matchAll(/time=\s*(\d+:\d+:\d+(?:\.\d+)?)/g)];
      if (duration && all.length) {
        const pct = Math.max(0, Math.min(99, Math.floor(toSec(all[all.length - 1][1]) / duration * 100)));
        if (pct !== lastPct) { lastPct = pct; if (!event.sender.isDestroyed()) event.sender.send('convert-progress', { jobId, pct }); }
      }
    });
    proc.on('error', err => resolve({ ok: false, error: String(err) }));
    proc.on('close', async code => {
      if (code !== 0) { fs.promises.unlink(out).catch(() => {}); resolve({ ok: false, error: tail.split('\n').slice(-6).join('\n') }); return; }
      try { const data = await fs.promises.readFile(out); resolve({ ok: true, data }); }
      catch (e) { resolve({ ok: false, error: String(e) }); }
      finally { fs.promises.unlink(out).catch(() => {}); }
    });
  });
});
ipcMain.on('toggle-projector-fullscreen', () => {
  if (projectorWin && !projectorWin.isDestroyed()) projectorWin.setFullScreen(!projectorWin.isFullScreen());
});

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [isMac ? { role: 'close' } : { role: 'quit', label: 'Exit' }] },
    { role: 'editMenu' },
    { label: 'View', submenu: [
      { role: 'reload' },
      { role: 'togglefullscreen' },
      { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'toggleDevTools' }
    ] },
    { role: 'windowMenu' },
    { label: 'Help', submenu: [{ label: `Happy Days Presenter ${app.getVersion()}`, enabled: false }] }
  ];
  // On Windows and Linux the app has no menu bar: everything is in the app itself (and translated there).
  Menu.setApplicationMenu(isMac ? Menu.buildFromTemplate(template) : null);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (controlWin) { if (controlWin.isMinimized()) controlWin.restore(); controlWin.focus(); }
  });
  app.whenReady().then(() => {
    buildMenu();
    createControlWindow();
    screen.on('display-added', () => setTimeout(placeProjector, 500));
    screen.on('display-removed', () => setTimeout(placeProjector, 500));
    app.on('activate', () => { if (!controlWin) createControlWindow(); });
  });
  app.on('window-all-closed', () => app.quit());
}
