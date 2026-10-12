'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (fn) => ipcRenderer.on(channel, (_e, data) => fn(data));

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  flushSettings: (patch) => ipcRenderer.sendSync('settings:flush', patch),
  log: (kind, detail) => ipcRenderer.send('log', kind, detail),
  listSources: () => ipcRenderer.invoke('sources:list'),
  listScreens: () => ipcRenderer.invoke('screens:list'),
  suspendHotkeys: (on) => ipcRenderer.invoke('hotkeys:suspend', on),
  hudNote: (text) => ipcRenderer.send('hud:note', text),
  hudStatus: (status) => ipcRenderer.send('hud:status', status),
  vcamStart: (o) => ipcRenderer.invoke('vcam:start', o),
  vcamFrame: (nv12) => ipcRenderer.send('vcam:frame', nv12),
  vcamStop: () => ipcRenderer.send('vcam:stop'),
  phoneInfo: () => ipcRenderer.invoke('phone:info'),
  signal: (id, msg) => ipcRenderer.send('signal:send', { id, msg }),
  onSignal: on('signal'),
  pickDir: () => ipcRenderer.invoke('dialog:dir'),
  pickImage: () => ipcRenderer.invoke('dialog:image'),
  showFile: (p) => ipcRenderer.send('shell:show', p),
  recStart: (o) => ipcRenderer.invoke('rec:start', o),
  previewName: () => ipcRenderer.invoke('rec:preview'),
  recStarted: (t0) => ipcRenderer.send('rec:started', t0),
  recChunk: (buf) => ipcRenderer.invoke('rec:chunk', buf),
  recStop: (o) => ipcRenderer.invoke('rec:stop', o),
  marker: (i) => ipcRenderer.send('rec:marker', i),
  onMarker: on('marker'),
  onHotkey: on('hotkey'),
  onProgress: on('progress'),
  onHud: on('hud'),
  selftest: (cmd, data) => ipcRenderer.invoke('selftest', cmd, data),
});
