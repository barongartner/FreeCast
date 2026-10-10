'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (fn) => ipcRenderer.on(channel, (_e, data) => fn(data));

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  listSources: () => ipcRenderer.invoke('sources:list'),
  phoneInfo: () => ipcRenderer.invoke('phone:info'),
  signal: (id, msg) => ipcRenderer.send('signal:send', { id, msg }),
  onSignal: on('signal'),
  pickDir: () => ipcRenderer.invoke('dialog:dir'),
  pickImage: () => ipcRenderer.invoke('dialog:image'),
  showFile: (p) => ipcRenderer.send('shell:show', p),
  recStart: (o) => ipcRenderer.invoke('rec:start', o),
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
