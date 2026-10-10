'use strict';
const { app, BrowserWindow, ipcMain, globalShortcut, desktopCapturer, screen, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const QRCode = require('qrcode');
const { startServer, lanIPs } = require('./server');
const { finalize, writeMarkerFiles } = require('./finalize');

const SELFTEST = process.argv.includes('--selftest');
const NO_PROTECT = !!process.env.FREECAST_NO_PROTECT;

// The compositor lives in the main window and has to keep drawing while that
// window is covered or minimized, so every background throttle is switched off.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,WebRtcHideLocalIpsWithMdns');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (SELFTEST) app.setPath('userData', path.join(app.getPath('temp'), 'FreeCast Selftest'));

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
  },
  scene: null,
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
    } catch {}
  }, 200);
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

function nextName(dir, base) {
  let taken = [];
  try {
    taken = fs.readdirSync(dir).map((f) => f.toLowerCase());
  } catch {}
  for (let n = 1; ; n++) {
    const stem = `${base} ${n}`.toLowerCase();
    if (!taken.some((f) => f === `${stem}.mp4` || f.startsWith(`${stem}.raw.`))) return `${base} ${n}`;
  }
}

function createWindows() {
  const preload = path.join(__dirname, 'preload.js');
  win = new BrowserWindow({
    width: 1500,
    height: 900,
    minWidth: 1100,
    minHeight: 680,
    backgroundColor: '#0e0e10',
    title: 'FreeCast',
    show: false,
    webPreferences: { preload, backgroundThrottling: false },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), SELFTEST ? { query: { selftest: '1' } } : undefined);
  win.once('ready-to-show', () => win.show());
  win.setContentProtection(settings.hideFromCapture && !NO_PROTECT);
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
    backgroundColor: '#141416',
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
  ipcMain.handle('settings:get', () => ({ ...settings, badHotkeys, selftest: SELFTEST, serverError: server && server.error }));
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

  // While the settings sheet is listening for a new combo, the old bindings
  // are released, otherwise the OS swallows the keypress before the app sees it.
  ipcMain.handle('hotkeys:suspend', (_e, on) => {
    hotkeysSuspended = !!on;
    registerHotkeys();
  });
  ipcMain.on('hud:note', (_e, text) => sendHud({ type: 'note', text }));
  ipcMain.on('hud:status', (_e, status) => sendHud({ type: 'status', ...status }));
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
    const dir = settings.outputDir;
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      return { error: `Cannot create ${dir}: ${err.message}` };
    }
    const name = nextName(dir, settings.baseName || 'Recording');
    const raw = path.join(dir, `${name}.raw.${ext}`);
    rec = { dir, name, raw, stream: fs.createWriteStream(raw), markers: [], t0: null };
    registerHotkeys();
    return { name };
  });
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
    loadSettings();
    if (!SELFTEST) {
      server = startServer({
        port: settings.port,
        token: settings.token,
        certDir: app.getPath('userData'),
        phoneDir: path.join(__dirname, '..', 'phone'),
        onSignal: (id, msg) => send('signal', { id, msg }),
      });
    }
    setupIpc();
    createWindows();
    registerHotkeys();
  });
  app.on('will-quit', () => globalShortcut.unregisterAll());
}
