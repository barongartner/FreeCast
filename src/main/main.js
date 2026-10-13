'use strict';
const { app, BrowserWindow, ipcMain, globalShortcut, desktopCapturer, screen, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const QRCode = require('qrcode');
const { startServer, lanIPs } = require('./server');
const { finalize, writeMarkerFiles } = require('./finalize');
const vcam = require('./vcam');

const SELFTEST = process.argv.includes('--selftest');
const NO_PROTECT = !!process.env.FREECAST_NO_PROTECT;

// The compositor lives in the main window and has to keep drawing while that
// window is covered or minimized, so every background throttle is switched off.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,WebRtcHideLocalIpsWithMdns');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Where settings live. Not under AppData on purpose: when FreeCast is started
// from inside a packaged (MSIX) app such as the Claude desktop app, Windows
// silently redirects that process's AppData writes into the package's private
// storage. The app then had two profiles, one per way of launching it, and
// settings looked like they never saved. The home folder is not redirected.
const PROFILE = SELFTEST
  ? path.join(app.getPath('temp'), 'FreeCast Selftest')
  : process.env.FREECAST_PROFILE || path.join(os.homedir(), '.freecast');
app.setPath('userData', PROFILE);

// One-time move from the old AppData profile(s): take the most recently saved
// settings, and the phone certificate that sits next to them.
function migrateProfile() {
  if (SELFTEST || process.env.FREECAST_PROFILE || fs.existsSync(path.join(PROFILE, 'settings.json'))) return;
  const old = [];
  if (process.env.APPDATA) old.push(path.join(process.env.APPDATA, 'FreeCast'));
  try {
    const packages = path.join(process.env.LOCALAPPDATA || '', 'Packages');
    for (const name of fs.readdirSync(packages)) old.push(path.join(packages, name, 'LocalCache', 'Roaming', 'FreeCast'));
  } catch {}
  let best = null;
  for (const dir of old) {
    try {
      const mtime = fs.statSync(path.join(dir, 'settings.json')).mtimeMs;
      if (!best || mtime > best.mtime) best = { dir, mtime };
    } catch {}
  }
  if (!best) return;
  fs.mkdirSync(PROFILE, { recursive: true });
  for (const file of ['settings.json', 'cert.json']) {
    try {
      fs.copyFileSync(path.join(best.dir, file), path.join(PROFILE, file));
    } catch {}
  }
}
migrateProfile();

// Anything that goes wrong lands in a log next to the settings, so a crash
// leaves something to read afterwards.
function logLine(kind, detail) {
  try {
    fs.mkdirSync(PROFILE, { recursive: true });
    fs.appendFileSync(path.join(PROFILE, 'freecast.log'), `${new Date().toISOString()} ${kind} ${detail}\n`);
  } catch {}
}
process.on('uncaughtException', (err) => logLine('main-exception', err && err.stack ? err.stack : String(err)));
process.on('unhandledRejection', (err) => logLine('main-rejection', err && err.stack ? err.stack : String(err)));
app.on('render-process-gone', (_e, wc, d) => logLine('renderer-gone', `${d.reason} exit=${d.exitCode} url=${wc.getURL().split('/').pop()}`));
app.on('child-process-gone', (_e, d) => logLine('child-gone', `${d.type} ${d.reason} exit=${d.exitCode}`));

const DEFAULT_OUT = fs.existsSync('F:\\Space') ? 'F:\\Space\\FreeCast' : path.join(os.homedir(), 'Videos', 'FreeCast');
const DEFAULTS = {
  outputDir: SELFTEST ? path.join(DEFAULT_OUT, 'Selftest') : DEFAULT_OUT,
  baseName: 'Recording',
  port: 8443,
  token: null,
  hideFromCapture: true,
  statusBox: 'always', // always | recording | off
  statusCorner: 'tr',
  cornerMargin: 0,
  finalize: 'cfr',
  bitrateMbps: 12,
  crf: 18, // x264 quality of the finished MP4; lower is better and bigger
  audioKbps: 192,
  canvas: { w: 1920, h: 1080, fps: 30 },
  hotkeys: {
    // Every string here is an action id the renderer knows (see ACTIONS in
    // app.js). An empty string means unbound.
    record: 'Ctrl+Alt+R',
    cam: 'Ctrl+Alt+C',
    camCycle: 'Ctrl+Alt+V',
    camCorner: '',
    camBig: '',
    micMute: 'Ctrl+Alt+M',
    desktopMute: '',
    phoneMic: '',
    nextMonitor: 'Ctrl+Alt+N',
    prevMonitor: '',
    monitor1: '',
    monitor2: '',
    monitor3: '',
    showApp: '',
    markers: [
      { label: 'Cut', key: 'Ctrl+Alt+X', color: 'Red' },
      { label: 'Fix', key: 'Ctrl+Alt+F', color: 'Yellow' },
    ],
    sources: {}, // source id -> key that shows or hides that source
  },
  audio: {
    mic: { deviceId: 'default', gain: 1, muted: false, delayMs: 0, ns: false },
    system: { on: true, gain: 1 },
    phone: { on: false, gain: 1 },
    phoneOut: 'none', // output device the phone mic is played into (a virtual cable makes it a PC mic)
  },
  vcam: { on: false, source: 'phone' }, // phone | scene
  scene: null,
  window: null, // last position and size of the main window
};

let settings = null;
let settingsFile = null;
let win = null;
let hud = null;
let server = null;
let rec = null; // { dir, name, raw, stream, markers, t0 }
let badHotkeys = [];
let hotkeysSuspended = false;
let hudCorner = 'tr';
const HUD_W = 280;
const HUD_H = 58;
let stim = null;

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
function merge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) out[k] = isObj(v) && isObj(base[k]) ? merge(base[k], v) : v;
  return out;
}

function loadSettings() {
  settingsFile = path.join(app.getPath('userData'), 'settings.json');
  let saved = {};
  if (SELFTEST) fs.rmSync(settingsFile, { force: true }); // every selftest starts from defaults
  try {
    saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  } catch {}
  settings = merge(DEFAULTS, saved);
  if (!settings.token) settings.token = require('crypto').randomBytes(8).toString('hex');
  saveSettings();
}

let saveTimer = null;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
      fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
    } catch (err) {
      logLine('settings-save-failed', err.message);
    }
  }, 200);
}

// Write now, without the debounce. Used when the app is about to go away.
function flushSettings() {
  clearTimeout(saveTimer);
  try {
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
  } catch (err) {
    logLine('settings-save-failed', err.message);
  }
}

function send(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}
function sendHud(data) {
  if (hud && !hud.isDestroyed()) hud.webContents.send('hud', data);
}

function registerHotkeys() {
  globalShortcut.unregisterAll();
  badHotkeys = [];
  const reg = (key, fn) => {
    if (!key) return;
    try {
      if (!globalShortcut.register(key, fn)) badHotkeys.push(key);
    } catch {
      badHotkeys.push(key);
    }
  };
  if (hotkeysSuspended) return;
  const hk = settings.hotkeys;
  for (const [id, key] of Object.entries(hk)) {
    if (typeof key !== 'string') continue;
    reg(key, id === 'showApp' ? toggleWindow : () => send('hotkey', id));
  }
  for (const [sourceId, key] of Object.entries(hk.sources || {})) reg(key, () => send('hotkey', `source:${sourceId}`));
  // Marker keys are only held while recording so they stay free otherwise.
  if (rec) hk.markers.forEach((m, i) => reg(m.key, () => addMarker(i)));
}

function toggleWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized() || !win.isVisible()) {
    win.restore();
    win.focus();
  } else if (win.isFocused()) {
    win.minimize();
  } else {
    win.focus();
  }
}

function addMarker(index) {
  const def = settings.hotkeys.markers[index];
  if (!rec || !rec.t0 || !def) return;
  const n = rec.markers.filter((m) => m.label === def.label).length + 1;
  const marker = { ms: Date.now() - rec.t0, label: def.label, color: def.color, title: `${def.label} ${n}` };
  rec.markers.push(marker);
  send('marker', { marker, count: rec.markers.length });
  sendHud({ type: 'marker', title: marker.title, count: rec.markers.length });
}

// Turns the file name pattern into the next free name under dir. Tokens:
// {n} counter, {date} "Oct 12", {isodate} "2026-10-12", {time} "5-26 PM".
// A slash in the pattern makes a subfolder. A pattern with no tokens at all
// gets a counter added, so "Devlog" gives Devlog 1, Devlog 2 and so on.
function nextName(dir, pattern) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const hour = now.getHours() % 12 || 12;
  let p = String(pattern || '').trim() || 'Recording {n}';
  if (!/\{(n|date|isodate|time)\}/i.test(p)) p += ' {n}';
  p = p
    .replace(/\{date\}/gi, `${now.toLocaleString('en-US', { month: 'short' })} ${now.getDate()}`)
    .replace(/\{isodate\}/gi, `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`)
    .replace(/\{time\}/gi, `${hour}-${pad(now.getMinutes())} ${now.getHours() >= 12 ? 'PM' : 'AM'}`);
  p = p
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.replace(/[<>:"|?*\x00-\x1f]/g, '').trim().replace(/\.+$/, ''))
    .filter((part) => part && part !== '..')
    .join('/') || 'Recording {n}';
  const taken = (stem) => {
    const full = path.join(dir, stem);
    const leaf = path.basename(full).toLowerCase();
    try {
      return fs.readdirSync(path.dirname(full)).some((f) => f.toLowerCase() === `${leaf}.mp4` || f.toLowerCase().startsWith(`${leaf}.raw.`));
    } catch {
      return false;
    }
  };
  if (!/\{n\}/i.test(p)) {
    if (!taken(p)) return p;
    p += ' {n}';
  }
  for (let n = 1; ; n++) {
    const stem = p.replace(/\{n\}/gi, String(n));
    if (!taken(stem)) return stem;
  }
}

// ---------- window chrome ----------
// The window is frameless, so close, minimise, zoom and edge resizing are
// driven from the page. Zoom is done by hand (fill the work area, remember the
// old bounds) because maximising a transparent window is unreliable on Windows.
const MIN_W = 1180;
const MIN_H = 720;
let zoomed = null; // the bounds to go back to while the window fills the screen
let resizing = null;

function onSomeDisplay(b) {
  return screen.getAllDisplays().some((d) => b.x < d.workArea.x + d.workArea.width - 80 && b.x + b.width > d.workArea.x + 80 && b.y >= d.workArea.y - 10 && b.y < d.workArea.y + d.workArea.height - 60);
}

function sendWindowState() {
  if (!win || win.isDestroyed()) return;
  send('win:state', { focused: win.isFocused(), maximized: !!zoomed || win.isMaximized() });
}

function rememberBounds() {
  if (!win || win.isDestroyed() || zoomed || win.isMaximized() || win.isMinimized() || SELFTEST) return;
  settings.window = win.getBounds();
  saveSettings();
}

function toggleZoom() {
  if (zoomed) {
    win.setBounds(zoomed);
    zoomed = null;
  } else {
    zoomed = win.getBounds();
    win.setBounds(screen.getDisplayMatching(zoomed).workArea);
  }
  sendWindowState();
}

function windowCommand(cmd) {
  if (!win || win.isDestroyed()) return;
  if (cmd === 'close') win.close();
  else if (cmd === 'minimize') win.minimize();
  else if (cmd === 'zoom') toggleZoom();
}

// A grip was pressed: follow the cursor until it is released.
function resizeStart(edge) {
  resizeEnd();
  if (zoomed) return;
  const from = { cursor: screen.getCursorScreenPoint(), bounds: win.getBounds() };
  resizing = setInterval(() => {
    const c = screen.getCursorScreenPoint();
    const dx = c.x - from.cursor.x;
    const dy = c.y - from.cursor.y;
    const b = { ...from.bounds };
    if (edge.includes('right')) b.width = Math.max(MIN_W, from.bounds.width + dx);
    if (edge.includes('bottom')) b.height = Math.max(MIN_H, from.bounds.height + dy);
    if (edge.includes('left')) {
      b.width = Math.max(MIN_W, from.bounds.width - dx);
      b.x = from.bounds.x + from.bounds.width - b.width;
    }
    if (edge.includes('top')) {
      b.height = Math.max(MIN_H, from.bounds.height - dy);
      b.y = from.bounds.y + from.bounds.height - b.height;
    }
    win.setBounds(b);
  }, 16);
}

function resizeEnd() {
  if (!resizing) return;
  clearInterval(resizing);
  resizing = null;
  rememberBounds();
}

function createWindows() {
  const preload = path.join(__dirname, 'preload.js');
  // No title bar and a transparent window, so the page can draw Mac-style
  // chrome with rounded corners. The page clips itself to the rounded shape.
  const saved = !SELFTEST && settings.window && onSomeDisplay(settings.window) ? settings.window : null;
  win = new BrowserWindow({
    width: saved ? saved.width : 1500,
    height: saved ? saved.height : 900,
    x: saved ? saved.x : undefined,
    y: saved ? saved.y : undefined,
    minWidth: MIN_W,
    minHeight: MIN_H,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    title: 'FreeCast',
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.ico'),
    show: false,
    webPreferences: { preload, backgroundThrottling: false },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), SELFTEST ? { query: { selftest: '1' } } : undefined);
  win.once('ready-to-show', () => {
    win.show();
    // Set again once visible: display affinity does not always stick to a hidden window.
    win.setContentProtection(settings.hideFromCapture && !NO_PROTECT);
    sendWindowState();
  });
  win.setContentProtection(settings.hideFromCapture && !NO_PROTECT);
  for (const ev of ['focus', 'blur', 'maximize', 'unmaximize', 'restore']) win.on(ev, sendWindowState);
  win.webContents.on('did-finish-load', sendWindowState);
  // Debug: FREECAST_SHOT=<file.png> saves a picture of the window a few seconds
  // after it loads, then quits. For checking the look without a selftest take.
  if (process.env.FREECAST_SHOT) {
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      // FREECAST_SHOT_JS runs in the page first, to put it in the state worth looking at.
      if (process.env.FREECAST_SHOT_JS) await win.webContents.executeJavaScript(process.env.FREECAST_SHOT_JS).catch(() => {});
      await new Promise((r) => setTimeout(r, 600));
      fs.writeFileSync(process.env.FREECAST_SHOT, (await win.webContents.capturePage()).toPNG());
      app.quit();
    }, 5000));
  }
  win.on('resized', rememberBounds);
  win.on('moved', rememberBounds);
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
  });
  win.on('close', (e) => {
    if (!rec || SELFTEST) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Keep recording', 'Quit anyway'],
      defaultId: 0,
      cancelId: 0,
      message: 'A recording is running.',
      detail: 'Quitting now leaves the raw capture file unfinalized in the output folder.',
    });
    if (choice === 0) e.preventDefault();
  });
  win.on('closed', () => app.quit());

  hud = new BrowserWindow({
    width: HUD_W,
    height: HUD_H,
    frame: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#0f1c44',
    webPreferences: { preload, backgroundThrottling: false },
  });
  hud.setAlwaysOnTop(true, 'screen-saver');
  hud.loadFile(path.join(__dirname, '..', 'renderer', 'hud.html'));
  hud.webContents.once('did-finish-load', updateHud);
  setInterval(dodgeMouse, 100);

  if (SELFTEST) {
    // A fast counter on screen, so extracted frames prove capture kept moving.
    stim = new BrowserWindow({ width: 420, height: 150, x: 40, y: 40, frame: false, alwaysOnTop: true, focusable: false, skipTaskbar: true, webPreferences: { backgroundThrottling: false } });
    stim.loadURL('data:text/html,<body style="margin:0;background:%23fff;font:700 90px monospace"><div id=a></div><script>setInterval(()=>a.textContent=Math.floor(performance.now()/100),50)</script>');
  }
}

// ---------- status box ----------
// A small always-on-top window on the monitor, excluded from capture. It can
// not be click-through (see below), so instead it jumps to the other side of
// the screen whenever the mouse gets near it.
function hudSpot(corner) {
  const a = screen.getPrimaryDisplay().workArea;
  const m = 14;
  return {
    x: corner.includes('l') ? a.x + m : a.x + a.width - HUD_W - m,
    y: corner.includes('t') ? a.y + m : a.y + a.height - HUD_H - m,
  };
}

function placeHud(corner) {
  hudCorner = corner;
  const p = hudSpot(corner);
  hud.setBounds({ x: p.x, y: p.y, width: HUD_W, height: HUD_H });
}

function updateHud() {
  if (!hud || hud.isDestroyed()) return;
  const want = settings.statusBox === 'always' || (settings.statusBox === 'recording' && !!rec);
  if (!want) return hud.hide();
  if (!hud.isVisible()) {
    placeHud(settings.statusCorner);
    hud.showInactive();
    // Applied after show, and the window is never made click-through: display
    // affinity does not stick to a hidden or layered window on Windows 10.
    hud.setContentProtection(!NO_PROTECT);
  }
}

function dodgeMouse() {
  if (!hud || hud.isDestroyed() || !hud.isVisible()) return;
  const c = screen.getCursorScreenPoint();
  const near = (p, pad) => c.x >= p.x - pad && c.x <= p.x + HUD_W + pad && c.y >= p.y - pad && c.y <= p.y + HUD_H + pad;
  const home = settings.statusCorner;
  if (near(hudSpot(hudCorner), 16)) {
    placeHud(hudCorner[0] + (hudCorner[1] === 'r' ? 'l' : 'r'));
  } else if (hudCorner !== home && !near(hudSpot(home), 70)) {
    placeHud(home);
  }
}

function setupIpc() {
  ipcMain.handle('settings:get', () => ({ ...settings, badHotkeys, selftest: SELFTEST, serverError: server && server.error, vcamAvailable: vcam.isAvailable() }));
  ipcMain.handle('settings:set', (_e, patch) => {
    settings = merge(settings, patch);
    // Hotkeys replace wholesale so removed markers and source keys really go.
    if (patch.hotkeys) settings.hotkeys = merge(DEFAULTS.hotkeys, patch.hotkeys);
    if (patch.hotkeys) settings.hotkeys.sources = patch.hotkeys.sources || {};
    saveSettings();
    if (patch.hotkeys) registerHotkeys();
    if ('statusBox' in patch || 'statusCorner' in patch) {
      if (hud.isVisible()) placeHud(settings.statusCorner);
      updateHud();
    }
    if ('hideFromCapture' in patch) win.setContentProtection(settings.hideFromCapture && !NO_PROTECT);
    return { badHotkeys };
  });

  // The page sends its last unsaved state as it closes; synchronous so the
  // write finishes before the window is gone.
  ipcMain.on('settings:flush', (e, patch) => {
    if (patch && !SELFTEST) settings = merge(settings, patch);
    flushSettings();
    e.returnValue = true;
  });
  ipcMain.on('win:command', (_e, cmd) => windowCommand(cmd));
  ipcMain.on('win:resize-start', (_e, edge) => resizeStart(String(edge)));
  ipcMain.on('win:resize-end', resizeEnd);
  ipcMain.on('log', (_e, kind, detail) => logLine(String(kind), String(detail).slice(0, 2000)));

  // While the settings sheet is listening for a new combo, the old bindings
  // are released, otherwise the OS swallows the keypress before the app sees it.
  ipcMain.handle('hotkeys:suspend', (_e, on) => {
    hotkeysSuspended = !!on;
    registerHotkeys();
  });
  ipcMain.on('hud:note', (_e, text) => sendHud({ type: 'note', text }));
  ipcMain.on('hud:status', (_e, status) => sendHud({ type: 'status', ...status }));
  ipcMain.handle('vcam:start', (_e, o) => vcam.start(o));
  ipcMain.on('vcam:frame', (_e, nv12) => vcam.write(nv12));
  ipcMain.on('vcam:stop', () => vcam.stop());
  ipcMain.handle('screens:list', async () => {
    const list = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
    return list.map((s) => ({ id: s.id, name: s.name, displayId: s.display_id, isScreen: true }));
  });

  ipcMain.handle('sources:list', async () => {
    const list = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 200 } });
    return list
      .filter((s) => s.name !== 'FreeCast' && !s.thumbnail.isEmpty())
      .map((s) => ({ id: s.id, name: s.name, displayId: s.display_id, isScreen: s.id.startsWith('screen:'), thumb: s.thumbnail.toDataURL() }));
  });

  ipcMain.handle('phone:info', async () => {
    if (!server) return { error: 'Phone server is off in selftest.', links: [] };
    const links = [];
    for (const ip of lanIPs()) {
      const url = `https://${ip}:${server.port}/cam?t=${settings.token}`;
      links.push({ ip, url, qr: await QRCode.toDataURL(url, { margin: 2, width: 420 }) });
    }
    return { error: server.error, links };
  });
  ipcMain.on('signal:send', (_e, { id, msg }) => server && server.send(id, msg));

  ipcMain.handle('dialog:dir', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: settings.outputDir });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('dialog:image', async () => {
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'] }],
    });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.on('shell:show', (_e, p) => (fs.existsSync(p) ? shell.showItemInFolder(p) : shell.openPath(settings.outputDir)));

  ipcMain.handle('rec:start', (_e, { ext }) => {
    if (rec) return { error: 'Already recording.' };
    // The pattern may carry subfolders, so the take's real folder and name
    // are split back out of the full path.
    const full = path.join(settings.outputDir, nextName(settings.outputDir, settings.baseName));
    const dir = path.dirname(full);
    const name = path.basename(full);
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      return { error: `Cannot create ${dir}: ${err.message}` };
    }
    const raw = path.join(dir, `${name}.raw.${ext}`);
    rec = { dir, name, raw, stream: fs.createWriteStream(raw), markers: [], t0: null };
    rec.stream.on('error', (err) => logLine('recording-write-failed', err.message));
    registerHotkeys();
    return { name };
  });
  ipcMain.handle('rec:preview', () => path.join(settings.outputDir, `${nextName(settings.outputDir, settings.baseName)}.mp4`));
  ipcMain.on('rec:started', (_e, t0) => {
    if (!rec) return;
    rec.t0 = t0;
    updateHud();
    sendHud({ type: 'start', t0 });
  });
  ipcMain.handle('rec:chunk', (_e, buf) => {
    if (rec) rec.stream.write(Buffer.from(buf));
  });
  ipcMain.on('rec:marker', (_e, i) => addMarker(i));
  ipcMain.handle('rec:stop', async (_e, { durationMs, fps, h264 }) => {
    if (!rec) return { ok: false, error: 'Not recording.' };
    const r = rec;
    rec = null;
    registerHotkeys();
    sendHud({ type: 'stop' });
    updateHud();
    await new Promise((res) => r.stream.end(res));
    const base = path.join(r.dir, r.name);
    const out = `${base}.mp4`;
    const sidecars = writeMarkerFiles(base, r.name, r.markers, fps);
    const result = await finalize({
      raw: r.raw,
      out,
      markers: r.markers,
      durationMs,
      fps,
      mode: settings.finalize,
      crf: settings.crf,
      audioKbps: settings.audioKbps,
      h264,
      onProgress: (p) => send('progress', p),
    });
    if (result.ok) fs.rmSync(r.raw, { force: true });
    return { ...result, file: result.ok ? out : r.raw, name: r.name, markers: r.markers, sidecars };
  });

  ipcMain.handle('selftest', async (_e, cmd, data) => {
    if (!SELFTEST) return null;
    if (cmd === 'minimize') win.minimize();
    if (cmd === 'restore') win.restore();
    if (cmd === 'zoom') toggleZoom();
    if (cmd === 'bounds') return { ...win.getBounds(), zoomed: !!zoomed, work: screen.getPrimaryDisplay().workArea };
    if (cmd === 'marker') addMarker(data || 0);
    if (cmd === 'shot') {
      const img = await win.webContents.capturePage();
      fs.mkdirSync(settings.outputDir, { recursive: true });
      fs.writeFileSync(path.join(settings.outputDir, data), img.toPNG());
    }
    if (cmd === 'hudshot') {
      const img = await hud.webContents.capturePage();
      fs.writeFileSync(path.join(settings.outputDir, data), img.toPNG());
    }
    if (cmd === 'done') {
      process.stdout.write(`SELFTEST ${JSON.stringify(data)}\n`);
      setTimeout(() => app.quit(), 300);
    }
    return true;
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    app.setAppUserModelId('com.barongartner.freecast'); // own taskbar group and icon, not Electron's
    loadSettings();
    if (!SELFTEST) {
      server = startServer({
        port: settings.port,
        token: settings.token,
        certDir: app.getPath('userData'),
        phoneDir: path.join(__dirname, '..', 'phone'),
        assetsDir: path.join(__dirname, '..', '..', 'assets'),
        onSignal: (id, msg) => send('signal', { id, msg }),
      });
    }
    setupIpc();
    createWindows();
    registerHotkeys();
  });
  app.on('will-quit', () => {
    if (settings) flushSettings();
    globalShortcut.unregisterAll();
    vcam.stop();
  });
}
