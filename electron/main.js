// Desktop Bonk — Electron host: transparent, frameless, always-on-top arena over the desktop,
// click-through outside the game's UI, tray menu, floating launcher and global shortcuts.
const { app, BrowserWindow, ipcMain, screen, Tray, Menu, globalShortcut, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

const WEB = path.join(__dirname, '..', 'Sources', 'DesktopBonk', 'Web');
const ICON = path.join(__dirname, '..', 'Packaging', 'AppIcon.iconset', 'icon_32x32@2x.png');

let win = null, launcher = null, tray = null;
let clickThrough = true, allInteractive = false, rects = [], ignoring = null;

// ---------------------------------------------------------------- store ----
const storeFile = () => path.join(app.getPath('userData'), 'store.json');
let store = {};
function loadStore() { try { store = JSON.parse(fs.readFileSync(storeFile(), 'utf8')) || {}; } catch (e) { store = {}; } }
let saveTimer = null;
function saveStore() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { fs.mkdirSync(path.dirname(storeFile()), { recursive: true }); fs.writeFileSync(storeFile(), JSON.stringify(store)); } catch (e) { /* ignore */ } }, 300);
}
function desk() { try { return JSON.parse(store.settings || '{}').desktop || {}; } catch (e) { return {}; } }

// --------------------------------------------------------------- window ----
function send(payload) { if (win && !win.isDestroyed()) win.webContents.send('bonk-event', payload); }

function place(preset) {
  const b = win.getBounds();
  const wa = screen.getDisplayMatching(b).workArea, m = 12;
  let x = wa.x + wa.width - b.width - m, y = wa.y + wa.height - b.height - m;
  if (preset === 'bottom-left') x = wa.x + m;
  if (preset === 'top-right') y = wa.y + m;
  if (preset === 'top-left') { x = wa.x + m; y = wa.y + m; }
  if (preset === 'center') { x = wa.x + Math.round((wa.width - b.width) / 2); y = wa.y + Math.round((wa.height - b.height) / 2); }
  win.setPosition(Math.round(x), Math.round(y));
}

function setSize(w, h) {
  const b = win.getBounds();
  const wa = screen.getDisplayMatching(b).workArea;
  w = Math.round(Math.max(360, Math.min(w, wa.width))); h = Math.round(Math.max(280, Math.min(h, wa.height)));
  const right = b.x + b.width / 2 > wa.x + wa.width / 2, bottom = b.y + b.height / 2 > wa.y + wa.height / 2;
  let x = right ? b.x + b.width - w : b.x, y = bottom ? b.y + b.height - h : b.y;
  x = Math.max(wa.x, Math.min(x, wa.x + wa.width - w)); y = Math.max(wa.y, Math.min(y, wa.y + wa.height - h));
  win.setBounds({ x, y, width: w, height: h });
}

function focusGame() {
  if (!win) return;
  if (launcher) launcher.hide();
  win.show();
  if (app.focus) app.focus({ steal: true });
  win.focus();
  send({ type: 'shown' }); send({ type: 'focus' });
}
function hideArena() { if (win) { win.hide(); send({ type: 'hidden' }); } }
function toggleArena() { if (win && win.isVisible()) hideArena(); else focusGame(); }
function minimize() {
  if (!win) return;
  const b = win.getBounds();
  hideArena();
  if (!launcher) {
    launcher = new BrowserWindow({
      width: 46, height: 46, x: b.x + b.width - 58, y: b.y + b.height - 58, frame: false, transparent: true, resizable: false,
      alwaysOnTop: true, hasShadow: false, skipTaskbar: true, focusable: false, backgroundColor: '#00000000',
      webPreferences: { nodeIntegration: true, contextIsolation: false },
    });
    launcher.setAlwaysOnTop(true, 'floating');
    launcher.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    launcher.loadFile(path.join(__dirname, 'launcher.html'));
  } else launcher.showInactive();
}

function createWindow() {
  const d = desk();
  const wa = screen.getPrimaryDisplay().workArea;
  const w = d.width || 720, h = d.height || 520;
  win = new BrowserWindow({
    width: w, height: h, x: wa.x + wa.width - w - 12, y: wa.y + wa.height - h - 12,
    frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, resizable: true,
    alwaysOnTop: d.alwaysOnTop !== false, skipTaskbar: true, fullscreenable: false, minWidth: 360, minHeight: 280,
    title: 'Desktop Bonk',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: false, nodeIntegration: false, backgroundThrottling: false },
  });
  win.setAlwaysOnTop(d.alwaysOnTop !== false, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  clickThrough = d.clickThrough !== false;
  if (d.position && d.position !== 'free') place(d.position);
  win.loadFile(path.join(WEB, 'index.html'));
  win.on('focus', () => send({ type: 'focus' }));
  win.on('blur', () => {
    send({ type: 'blur' });
    if (desk().visibleWhenInactive === false) win.hide();
  });
  win.once('ready-to-show', () => focusGame());
  win.webContents.on('did-finish-load', () => focusGame());
  if (process.env.DESKBONK_SMOKE) {
    // automated smoke test: start a quick match, screenshot, report, quit
    const errors = [];
    win.webContents.on('console-message', (_e, level, msg) => { if (level >= 3) errors.push(msg); });
    win.webContents.on('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, 1500));
      await win.webContents.executeJavaScript('DB.app.noBlurPause = true; DB.app.quickMatch(); 1');
      await new Promise((r) => setTimeout(r, 4000));
      const info = await win.webContents.executeJavaScript('({ native: DB.native.isNative, electron: DB.native.electron, state: DB.app.match && DB.app.match.state, round: DB.app.match && DB.app.match.round, players: DB.app.match && DB.app.match.sim.players.length, rects: DB.app.lastRects.length })');
      const img = await win.webContents.capturePage();
      fs.writeFileSync(process.env.DESKBONK_SMOKE, img.toPNG());
      console.log('SMOKE', JSON.stringify(info), 'errors', JSON.stringify(errors));
      app.quit();
    });
  }

  // click-through: the window only catches the mouse over the game's interactive UI
  setInterval(() => {
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    let want = false;
    if (clickThrough && !allInteractive) {
      const p = screen.getCursorScreenPoint(), b = win.getBounds();
      if (p.x < b.x || p.y < b.y || p.x > b.x + b.width || p.y > b.y + b.height) return;
      const lx = p.x - b.x, ly = p.y - b.y;
      want = !rects.some((r) => lx >= r[0] && lx <= r[0] + r[2] && ly >= r[1] && ly <= r[1] + r[3]);
    }
    if (want !== ignoring) { ignoring = want; win.setIgnoreMouseEvents(want); }
  }, 33);
}

// ------------------------------------------------------------------ IPC ----
ipcMain.on('bonk-boot', (e) => { e.returnValue = { version: app.getVersion(), store }; });
ipcMain.on('bonk', (_e, m) => {
  if (!m || !m.type || !win) return;
  switch (m.type) {
    case 'store': store[m.key] = m.value; saveStore(); break;
    case 'moveTo': win.setPosition(Math.round(m.x), Math.round(m.y)); break;
    case 'resizeTo': { const b = win.getBounds(); win.setBounds({ x: b.x, y: b.y, width: Math.max(360, Math.round(m.width)), height: Math.max(280, Math.round(m.height)) }); break; }
    case 'resizeEnd': { const b = win.getBounds(); send({ type: 'size', width: b.width, height: b.height, preset: 'custom' }); break; }
    case 'setSize': setSize(m.width || 720, m.height || 520); break;
    case 'setPosition': place(m.preset); break;
    case 'setLevel': win.setAlwaysOnTop(m.alwaysOnTop !== false, 'floating'); break;
    case 'setClickThrough': clickThrough = !!m.enabled; break;
    case 'interactive': allInteractive = !!m.all; rects = Array.isArray(m.rects) ? m.rects : []; break;
    case 'focus': focusGame(); break;
    case 'minimize': minimize(); break;
    case 'hide': hideArena(); break;
    case 'quit': app.quit(); break;
    case 'setHotkeys': registerHotkeys(m.toggle, m.focus); break;
    default: break;
  }
});
ipcMain.on('launcher-move', (_e, p) => { if (launcher) launcher.setPosition(Math.round(p.x), Math.round(p.y)); });
ipcMain.on('launcher-open', () => focusGame());

// ------------------------------------------------------- shortcuts & tray ----
function accel(spec) {
  if (!spec || spec === 'none') return null;
  const map = { ctrl: 'Control', alt: 'Alt', opt: 'Alt', option: 'Alt', cmd: 'Command', command: 'Command', shift: 'Shift', space: 'Space' };
  return spec.split('+').map((k) => map[k.toLowerCase()] || k.toUpperCase()).join('+');
}
function registerHotkeys(toggle, focus) {
  globalShortcut.unregisterAll();
  const t = accel(toggle || 'ctrl+alt+b'), f = accel(focus || 'ctrl+alt+g');
  try { if (t) globalShortcut.register(t, toggleArena); } catch (e) { /* taken */ }
  try { if (f) globalShortcut.register(f, focusGame); } catch (e) { /* taken */ }
}
function command(name) { focusGame(); send({ type: 'command', name }); }
function sizeTo(w, h, preset) { focusGame(); setSize(w, h); send({ type: 'size', width: w, height: h, preset }); }
function createTray() {
  let img = nativeImage.createFromPath(ICON);
  if (!img.isEmpty()) img = img.resize({ width: 18, height: 18 });
  tray = new Tray(img);
  tray.setToolTip('Desktop Bonk');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show / Hide Arena', click: toggleArena },
    { label: 'Focus Game', click: focusGame },
    { label: 'Minimize to Launcher', click: minimize },
    { type: 'separator' },
    { label: 'Quick Match', click: () => command('quick') },
    { label: 'Main Menu', click: () => command('menu') },
    { label: 'Settings…', click: () => command('settings') },
    { label: 'Map Editor', click: () => command('editor') },
    { type: 'separator' },
    { label: 'Small Arena', click: () => sizeTo(480, 360, 'small') },
    { label: 'Medium Arena', click: () => sizeTo(720, 520, 'medium') },
    { label: 'Large Arena', click: () => sizeTo(960, 680, 'large') },
    { type: 'separator' },
    { label: 'Quit Desktop Bonk', click: () => app.quit() },
  ]));
}

// ---------------------------------------------------------------- start ----
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => focusGame());
app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
  loadStore();
  createWindow();
  createTray();
  const d = desk();
  registerHotkeys(d.hotkeyToggle, d.hotkeyFocus);
});
app.on('window-all-closed', (e) => { /* keep running in the tray */ });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('activate', () => focusGame());
