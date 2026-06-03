const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('deskrat', {
  dev: !!(process.env.DESKRAT_DEMO || process.env.DESKRAT_TEST),
  // Resolve the absolute path of a dropped File (Electron removed File.path).
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
  // Send a file/folder to the Recycle Bin; resolves { ok, size }.
  trash: (filePath) => ipcRenderer.invoke('trash-file', filePath),
  // Global cursor updates (works even during OS drag-and-drop).
  onCursor: (cb) => ipcRenderer.on('cursor', (_e, data) => cb(data)),
  // Report the rat silhouette so the main process can hit-test the cursor.
  reportRegion: (region) => ipcRenderer.send('rat-region', region),
  onDevEat: (cb) => ipcRenderer.on('dev-eat', (_e, p) => cb(p)),
  onDevPose: (cb) => ipcRenderer.on('dev-pose', (_e, p) => cb(p)),
  onCmd: (cb) => ipcRenderer.on('cmd', (_e, c) => cb(c)),
  quit: () => ipcRenderer.send('quit-app'),
});
