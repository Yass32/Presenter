'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('podium', {
  desktop: true,
  externalDisplay: () => ipcRenderer.invoke('has-external'),
  toggleProjectorFullscreen: () => ipcRenderer.send('toggle-projector-fullscreen'),
  pathForFile: file => { try { return webUtils.getPathForFile(file); } catch (e) { return ''; } },
  convert: (input, kind, jobId) => ipcRenderer.invoke('convert-media', { input, kind, jobId }),
  onConvertProgress: cb => { ipcRenderer.removeAllListeners('convert-progress'); ipcRenderer.on('convert-progress', (_e, d) => cb(d)); }
});
