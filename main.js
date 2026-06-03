const { app, BrowserWindow, ipcMain, screen, shell, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

let win = null;
let tray = null;

// Hit region reported by the renderer (window-local coords) describing where
// the rat's silhouette currently is. Used to decide click-through vs interactive.
let ratRegion = { cx: 0, cy: 0, r: 0 };
let interactive = false;

function createWindow() {
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.workAreaSize;
  const { x: areaX, y: areaY } = display.workArea;

  // Window sits in the bottom-right corner of the work area.
  const W = 480;
  const H = 520;

  win = new BrowserWindow({
    width: W,
    height: H,
    x: areaX + width - W,
    y: areaY + height - H,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Start click-through; the cursor poller flips it on when the cursor is
  // over the rat (works even mid drag-and-drop, unlike DOM mouse events).
  win.setIgnoreMouseEvents(true, { forward: true });
  interactive = false;

  // win.webContents.openDevTools({ mode: 'detach' });

  // Dev-only end-to-end test: auto-feed a throwaway file to verify the
  // eat animation and Recycle Bin handoff. Enabled via DESKRAT_TEST=1.
  if (process.env.DESKRAT_TEST) {
    win.webContents.once('did-finish-load', () => {
      const tmp = path.join(app.getPath('temp'), 'deskrat_devmeal.txt');
      try { fs.writeFileSync(tmp, 'om nom nom'); } catch {}
      setTimeout(() => win.webContents.send('dev-eat', tmp), 2500);
    });
  }

  // Dev pose tour: renderer cycles through every pose on its own clock.
  if (process.env.DESKRAT_DEMO) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(() => win.webContents.send('dev-pose', 'TOUR'), 1200);
    });
  }

  startCursorPoller();
  createTray();
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  tray = new Tray(icon);
  tray.setToolTip('책상 쥐 — 파일을 끌어다 먹이세요');
  const menu = Menu.buildFromTemplate([
    { label: '책상 쥐 🐀  (파일을 끌어다 먹이세요)', enabled: false },
    { type: 'separator' },
    { label: '춤추게 하기 ♪', click: () => win && win.webContents.send('cmd', 'dance') },
    {
      label: '구석으로 부르기',
      click: () => {
        if (!win) return;
        const wa = screen.getPrimaryDisplay().workArea;
        const b = win.getBounds();
        win.setPosition(wa.x + wa.width - b.width, wa.y + wa.height - b.height);
      },
    },
    { type: 'separator' },
    { label: '종료', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

function startCursorPoller() {
  setInterval(() => {
    if (!win || win.isDestroyed()) return;
    const pt = screen.getCursorScreenPoint();
    const b = win.getBounds();
    const localX = pt.x - b.x;
    const localY = pt.y - b.y;

    // Distance from the rat silhouette center.
    const dx = localX - ratRegion.cx;
    const dy = localY - ratRegion.cy;
    const inside =
      ratRegion.r > 0 && dx * dx + dy * dy <= ratRegion.r * ratRegion.r;

    if (inside && !interactive) {
      win.setIgnoreMouseEvents(false);
      interactive = true;
    } else if (!inside && interactive) {
      win.setIgnoreMouseEvents(true, { forward: true });
      interactive = false;
    }

    const wa = screen.getPrimaryDisplay().workArea;
    win.webContents.send('cursor', {
      x: localX,
      y: localY,
      inside,
      w: b.width,
      h: b.height,
      wx: b.x,
      wy: b.y,
      sx: wa.x,
      sy: wa.y,
      sw: wa.width,
      sh: wa.height,
    });
  }, 16);
}

// Renderer asks to reposition the window (the rat wandering the desktop).
ipcMain.on('move-window', (_e, pos) => {
  if (!win || win.isDestroyed()) return;
  if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return; // guard NaN
  try {
    const wa = screen.getPrimaryDisplay().workArea;
    const b = win.getBounds();
    const x = Math.round(Math.max(wa.x, Math.min(wa.x + wa.width - b.width, pos.x)));
    const y = Math.round(Math.max(wa.y, Math.min(wa.y + wa.height - b.height, pos.y)));
    win.setPosition(x, y);
  } catch {}
});

// Renderer tells us where the rat's body is so we can hit-test the cursor.
ipcMain.on('rat-region', (_e, region) => {
  ratRegion = region;
});

// Move a file/folder to the Windows Recycle Bin and report its size.
ipcMain.handle('trash-file', async (_e, filePath) => {
  let size = 0;
  try {
    const st = fs.statSync(filePath);
    size = st.isDirectory() ? dirSize(filePath) : st.size;
  } catch (err) {
    return { ok: false, error: 'stat failed: ' + err.message };
  }
  try {
    await shell.trashItem(filePath); // built-in, unicode-safe Recycle Bin
    return { ok: true, size };
  } catch (err) {
    return { ok: false, error: err.message, size };
  }
});

function dirSize(dir) {
  let total = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) total += dirSize(p);
      else {
        try {
          total += fs.statSync(p).size;
        } catch {}
      }
    }
  } catch {}
  return total;
}

ipcMain.on('quit-app', () => app.quit());

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
