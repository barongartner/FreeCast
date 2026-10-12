'use strict';
(async () => {
  const api = window.api;
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let settings = await api.getSettings();
  let capturingKey = false;
  let phoneStream = null;
  let phoneAudioKey = '';
  let afterState = null;

  const ICON = {
    eye: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/></svg>',
    eyeOff: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z"/><path d="M2.5 13.5l11-11"/></svg>',
    up: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3.5 10l4.5-4.5L12.5 10"/></svg>',
    down: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3.5 6l4.5 4.5L12.5 6"/></svg>',
  };
  const KIND = { screen: 'Screen', window: 'Window', phone: 'Phone', camera: 'Camera', image: 'Image' };

  const { h, dropdown, swatches, accelFrom } = UI;
  const isCam = (s) => s.type === 'phone' || s.type === 'camera';
  const cams = () => Scene.list().filter(isCam);

  const fmt = (ms) => {
    const s = Math.floor(ms / 1000);
    const hh = Math.floor(s / 3600);
    return (hh ? hh + ':' : '') + String(Math.floor(s / 60) % 60).padStart(hh ? 2 : 1, '0') + ':' + String(s % 60).padStart(2, '0');
  };

  let saveTimer = null;
  function save(patch) {
    settings = { ...settings, ...patch };
    return api.setSettings(patch);
  }
  function saveScene() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => api.setSettings({ scene: Scene.serialize() }), 400);
  }
  // Closing the window inside the debounce used to lose the last layout change.
  window.addEventListener('beforeunload', () => api.flushSettings({ scene: Scene.serialize() }));
  window.addEventListener('error', (e) => api.log('page-error', `${e.message} at ${String(e.filename).split('/').pop()}:${e.lineno}`));
  window.addEventListener('unhandledrejection', (e) => api.log('page-rejection', e.reason && e.reason.stack ? e.reason.stack : String(e.reason)));

  // ---------- media for sources ----------
  const fileUrl = (p) => encodeURI('file:///' + p.replace(/\\/g, '/')).replace(/#/g, '%23');

  async function acquire(s, list) {
    try {
      if (s.type === 'screen' || s.type === 'window') {
        list = list || (await api.listSources());
        const m =
          list.find((x) => x.id === s.ref.id && x.name === s.ref.name) ||
          (s.type === 'screen'
            ? list.find((x) => x.isScreen && x.displayId === s.ref.displayId) || list.find((x) => x.isScreen)
            : list.find((x) => !x.isScreen && x.name === s.ref.name));
        if (!m) return;
        s.ref = { id: m.id, name: m.name, displayId: m.displayId };
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: m.id, maxWidth: 3840, maxHeight: 2400, maxFrameRate: settings.canvas.fps } },
        });
        Scene.attachStream(s.id, stream);
      } else if (s.type === 'camera') {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { deviceId: { exact: s.deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: settings.canvas.fps } },
        });
        Scene.attachStream(s.id, stream);
      } else if (s.type === 'image') {
        Scene.attachImage(s.id, fileUrl(s.path));
      } else if (s.type === 'phone' && phoneStream) {
        Scene.attachStream(s.id, phoneStream, false);
      }
    } catch (err) {
      console.warn('source offline:', s.name, err.message);
    }
  }

  // Capture sources are opened at a frame rate, so a new rate means reopening.
  async function reacquire() {
    const list = await api.listSources();
    for (const s of Scene.list()) if (s.type === 'screen' || s.type === 'window' || s.type === 'camera') await acquire(s, list);
  }

  // ---------- modal ----------
  function openModal(title, body, cls = '') {
    $('modalTitle').textContent = title;
    $('modalBody').className = cls;
    $('modalBody').replaceChildren(...[body].flat());
    $('modal').hidden = false;
  }
  const closeModal = () => {
    $('modal').hidden = true;
    UI.closeMenus();
    if (capturingKey) api.suspendHotkeys(false);
    capturingKey = false;
  };
  $('modalClose').onclick = closeModal;
  $('modal').addEventListener('pointerdown', (e) => e.target === $('modal') && closeModal());

  // ---------- add source ----------
  async function pickCapture(type, onPick) {
    openModal(type === 'screen' ? 'Pick a screen' : 'Pick a window', h('p', { class: 'hint' }, 'Loading...'));
    const list = (await api.listSources()).filter((x) => x.isScreen === (type === 'screen'));
    const grid = h('div', { class: 'picker' }, list.map((x) =>
      h('button', { class: 'pick', onclick: () => { closeModal(); onPick(x, list); } }, h('img', { src: x.thumb }), h('span', {}, x.name))
    ));
    openModal(type === 'screen' ? 'Pick a screen' : 'Pick a window', list.length ? grid : h('p', { class: 'hint' }, 'Nothing to capture.'));
  }

  async function pickCamera(onPick) {
    try {
      (await navigator.mediaDevices.getUserMedia({ video: true })).getTracks().forEach((t) => t.stop());
    } catch {}
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    openModal('Pick a camera', cams.length
      ? h('div', { class: 'grid2' }, cams.map((d) => h('button', { onclick: () => { closeModal(); onPick(d); } }, d.label || 'Camera')))
      : h('p', { class: 'hint' }, 'No webcam or capture device found. Use the phone camera instead.'));
  }

  async function addSource(type) {
    if (type === 'screen' || type === 'window') {
      pickCapture(type, (x, list) => {
        const s = Scene.add(Scene.make(type, { name: x.name, ref: { id: x.id, name: x.name, displayId: x.displayId } }));
        acquire(s, list);
      });
    } else if (type === 'camera') {
      pickCamera((d) => acquire(Scene.add(Scene.make('camera', { name: d.label || 'Camera', deviceId: d.deviceId }))));
    } else if (type === 'image') {
      const p = await api.pickImage();
      if (p) acquire(Scene.add(Scene.make('image', { name: p.split(/[\\/]/).pop(), path: p })));
    } else if (type === 'phone') {
      acquire(Scene.add(Scene.make('phone', { name: 'Phone Camera', mirror: true })));
      if (Phone.state() !== 'live') showPhone();
    }
  }

  $('btnAdd').onclick = (e) => {
    e.stopPropagation();
    $('addMenu').hidden = !$('addMenu').hidden;
  };
  document.addEventListener('click', () => ($('addMenu').hidden = true));
  $('addMenu').querySelectorAll('button').forEach((b) => (b.onclick = () => addSource(b.dataset.add)));

  // ---------- source list ----------
  function renderList() {
    const sel = Scene.selected();
    const rows = [...Scene.list()].reverse().map((s) => {
      const btn = (html, _what, fn, on) => h('button', { class: 'icon' + (on ? ' on' : ''), html, onclick: (e) => { e.stopPropagation(); fn(); } });
      return h('div', { class: 'src' + (sel && sel.id === s.id ? ' sel' : '') + (s.visible ? '' : ' off'), onclick: () => Scene.select(s.id) },
        btn(s.visible ? ICON.eye : ICON.eyeOff, 'Show or hide', () => { s.visible = !s.visible; Scene.emit('list'); }, s.visible),
        h('span', { class: 'src-name' }, s.name),
        h('span', { class: 'src-kind' }, KIND[s.type]),
        btn(ICON.up, 'Bring forward', () => Scene.reorder(s.id, 1)),
        btn(ICON.down, 'Send back', () => Scene.reorder(s.id, -1)));
    });
    $('srcList').replaceChildren(...(rows.length ? rows : [h('p', { class: 'hint' }, 'No sources yet. Add a screen to start.')]));
  }

  // ---------- properties ----------
  let geo = null;
  let geoCrop = {};

  // A button that listens for the next key combo. While it listens the global
  // bindings are released so a combo that is already bound can be re-used.
  function keycap(getKey, setKey) {
    const btn = h('button', { class: 'keycap', onclick: async () => {
      if (capturingKey) return;
      capturingKey = true;
      await api.suspendHotkeys(true);
      btn.classList.add('listen');
      btn.textContent = 'Press keys (Backspace clears)';
      const onKey = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'Escape') return finish(getKey());
        if (e.key === 'Backspace') return finish('');
        const a = accelFrom(e);
        if (a) finish(a);
      };
      const finish = async (value) => {
        window.removeEventListener('keydown', onKey, true);
        btn.classList.remove('listen');
        setKey(value);
        btn.textContent = value || 'Not set';
        capturingKey = false;
        await api.suspendHotkeys(false);
        await saveHotkeys();
      };
      window.addEventListener('keydown', onKey, true);
    } }, getKey() || 'Not set');
    return btn;
  }

  async function saveHotkeys() {
    const r = await api.setSettings({ hotkeys: settings.hotkeys });
    $('warn').textContent = r.badHotkeys.length ? 'Could not bind (duplicate or taken by another app): ' + r.badHotkeys.join(', ') : '';
    renderMarkers();
  }

  function renderProps() {
    const s = Scene.selected();
    geo = null;
    if (!s) return $('props').replaceChildren(h('p', { class: 'hint' }, 'Select a source on the canvas.'));
    const changed = () => Scene.emit('change');
    const num = (label, key) => {
      const input = h('input', { type: 'number', value: Math.round(s[key]), oninput: () => { const v = parseFloat(input.value); if (isFinite(v)) { s[key] = key === 'w' || key === 'h' ? Math.max(24, v) : v; changed(); } } });
      return [h('label', { class: 'num' }, h('span', {}, label), input), input];
    };
    const [xl, xi] = num('X', 'x'), [yl, yi] = num('Y', 'y'), [wl, wi] = num('W', 'w'), [hl, hi] = num('H', 'h');
    geo = { x: xi, y: yi, w: wi, h: hi };
    const act = (label, fn) => h('button', { class: 'small', onclick: () => { fn(s); changed(); } }, label);
    const range = (min, max, step, value, fn, show = (v) => v) => {
      const out = h('output', {}, show(value));
      const input = h('input', { type: 'range', min, max, step, value, oninput: () => { const v = parseFloat(input.value); out.textContent = show(v); fn(v); changed(); } });
      return h('div', { class: 'row' }, input, out);
    };
    const shape = dropdown([{ value: 'rect', label: 'Rectangle' }, { value: 'round', label: 'Rounded' }, { value: 'circle', label: 'Circle' }], s.shape,
      (v) => { Scene.setShape(s, v); changed(); renderProps(); });
    const name = h('input', { type: 'text', value: s.name, oninput: () => { s.name = name.value; renderList(); saveScene(); } });
    const color = swatches(s.borderColor, (c) => { s.borderColor = c; changed(); });
    const cropping = Scene.cropping() === s.id;
    const cropBtn = h('button', { class: 'small' + (cropping ? ' active' : ''), onclick: () => Scene.setCropMode(cropping ? null : s.id) }, cropping ? 'Done cropping' : 'Crop on canvas');
    const aspect = (label, a) => act(label, (x) => Scene.setCropAspect(x, a));
    const pct = (label, side) => {
      const input = h('input', { type: 'number', min: 0, max: 95, step: 1, value: Math.round(s.crop[side] * 100), oninput: () => {
        const other = { l: 'r', r: 'l', t: 'b', b: 't' }[side];
        const v = Math.max(0, Math.min(0.95 - s.crop[other], (parseFloat(input.value) || 0) / 100));
        const horiz = side === 'l' || side === 'r';
        const span = horiz ? s.w / (1 - s.crop.l - s.crop.r) : s.h / (1 - s.crop.t - s.crop.b);
        s.crop[side] = v;
        if (horiz) s.w = span * (1 - s.crop.l - s.crop.r);
        else s.h = span * (1 - s.crop.t - s.crop.b);
        changed();
      } });
      geoCrop[side] = input;
      return h('label', { class: 'num' }, h('span', {}, label), input);
    };
    geoCrop = {};
    const sourceKey = keycap(() => (settings.hotkeys.sources || {})[s.id] || '', (v) => {
      const sources = { ...(settings.hotkeys.sources || {}) };
      if (v) sources[s.id] = v;
      else delete sources[s.id];
      settings.hotkeys = { ...settings.hotkeys, sources };
    });
    const check = (label, key) => {
      const box = h('input', { type: 'checkbox', checked: s[key], onchange: () => { s[key] = box.checked; changed(); } });
      return h('label', { class: 'row' }, box, h('span', {}, label));
    };
    const relink = s.type === 'screen' || s.type === 'window'
      ? h('button', { class: 'small', onclick: () => pickCapture(s.type, (x, list) => { s.ref = { id: x.id, name: x.name, displayId: x.displayId }; s.name = x.name; acquire(s, list); renderList(); }) }, 'Change source')
      : null;

    $('props').replaceChildren(...[
      h('div', { class: 'field' }, h('label', {}, 'Name'), name),
      h('div', { class: 'grid2' }, xl, yl, wl, hl),
      h('div', { class: 'grid4' }, act('Fit', Scene.fit), act('Fill', Scene.fill), act('Center', Scene.center), act('Full size', (x) => { const n = Scene.natural(x); if (n) { x.w = n.w * (1 - x.crop.l - x.crop.r); x.h = n.h * (1 - x.crop.t - x.crop.b); Scene.center(x); } })),
      h('div', { class: 'field' }, h('label', {}, 'Corner'), h('div', { class: 'row' },
        ['tl', 'tr', 'bl', 'br'].map((p) => act({ tl: 'TL', tr: 'TR', bl: 'BL', br: 'BR' }[p], (x) => { Scene.corner(x, p); if (isCam(x)) x.cornerPos = p; })))),
      h('div', { class: 'sep' }),
      h('div', { class: 'field' }, h('label', {}, 'Crop'), cropBtn),
      h('div', { class: 'grid5' }, aspect('None', null), aspect('16:9', 16 / 9), aspect('4:3', 4 / 3), aspect('1:1', 1), aspect('9:16', 9 / 16)),
      h('div', { class: 'grid2' }, pct('L', 'l'), pct('R', 'r'), pct('T', 't'), pct('B', 'b')),
      h('p', { class: 'hint', style: 'margin:0 2px 8px' }, cropping ? 'Drag the handles or slide the window. Enter when done.' : 'Crop values are percent. Double-click a source to crop it on the canvas.'),
      h('div', { class: 'sep' }),
      h('div', { class: 'field' }, h('label', {}, 'Shape'), shape),
      s.shape === 'round' ? h('div', { class: 'field' }, h('label', {}, 'Radius'), range(0, 200, 1, s.radius, (v) => (s.radius = v))) : null,
      h('div', { class: 'field' }, h('label', {}, 'Border'), range(0, 24, 1, s.borderW, (v) => (s.borderW = v))),
      h('div', { class: 'field', style: 'grid-template-columns:1fr' }, color),
      h('div', { class: 'field' }, h('label', {}, 'Opacity'), range(0.1, 1, 0.01, s.opacity, (v) => (s.opacity = v), (v) => Math.round(v * 100))),
      h('div', { class: 'field' }, h('label', {}, 'Options'), h('div', { class: 'row' }, check('Mirror', 'mirror'), check('Lock', 'locked'))),
      h('div', { class: 'field' }, h('label', {}, 'Show/hide key'), sourceKey),
      h('div', { class: 'sep' }),
      h('div', { class: 'grid2' }, relink, h('button', { class: 'small danger', onclick: () => Scene.remove(s.id) }, 'Remove')),
    ].filter(Boolean));
  }

  function syncGeo() {
    const s = Scene.selected();
    if (!s || !geo) return;
    for (const k of ['x', 'y', 'w', 'h']) if (document.activeElement !== geo[k]) geo[k].value = Math.round(s[k]);
    for (const k of ['l', 't', 'r', 'b']) if (geoCrop[k] && document.activeElement !== geoCrop[k]) geoCrop[k].value = Math.round(s.crop[k] * 100);
  }

  Scene.on((what) => {
    if (what === 'list' || what === 'select' || what === 'crop') { renderList(); renderProps(); }
    else if (what === 'change' || what === 'size') syncGeo();
    if (what !== 'select' && what !== 'media' && what !== 'crop') saveScene();
    if (what === 'list') pushStatus();
  });

  // ---------- stage sizing ----------
  function layoutStage() {
    const wrap = $('stageWrap');
    const { w, h: ch } = Scene.size();
    const k = Math.min((wrap.clientWidth - 36) / w, (wrap.clientHeight - 36) / ch);
    $('stage').style.width = Math.max(100, Math.floor(w * k)) + 'px';
    $('stage').style.height = Math.max(56, Math.floor(ch * k)) + 'px';
  }
  new ResizeObserver(layoutStage).observe($('stageWrap'));

  // ---------- audio ----------
  const meters = {};
  async function applyMic() {
    const a = settings.audio.mic;
    Mixer.setGain('mic', a.muted ? 0 : a.gain);
    Mixer.setDelay('mic', a.delayMs);
    if (a.deviceId === 'none') return Mixer.setStream('mic', null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: a.deviceId === 'default' ? undefined : { exact: a.deviceId }, echoCancellation: false, noiseSuppression: !!a.ns, autoGainControl: false },
      });
      Mixer.setStream('mic', stream);
    } catch (err) {
      console.warn('mic unavailable', err.message);
      Mixer.setStream('mic', null);
    }
  }

  async function applySystem() {
    const a = settings.audio.system;
    Mixer.setGain('system', a.gain);
    if (!a.on) return Mixer.setStream('system', null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { mandatory: { chromeMediaSource: 'desktop' } },
        video: { mandatory: { chromeMediaSource: 'desktop' } },
      });
      stream.getVideoTracks().forEach((t) => { t.stop(); stream.removeTrack(t); });
      Mixer.setStream('system', stream);
    } catch (err) {
      console.warn('desktop audio unavailable', err.message);
      Mixer.setStream('system', null);
    }
  }

  function applyPhoneAudio() {
    const a = settings.audio.phone;
    Mixer.setGain('phone', a.on ? a.gain : 0);
  }

  const saveAudio = () => save({ audio: settings.audio });

  function setMicMuted(muted) {
    settings.audio.mic.muted = muted;
    Mixer.setGain('mic', muted ? 0 : settings.audio.mic.gain);
    saveAudio();
    renderAudio();
    pushStatus();
  }
  function setDesktopAudio(on) {
    settings.audio.system.on = on;
    saveAudio();
    applySystem();
    renderAudio();
  }
  function setPhoneMic(on) {
    settings.audio.phone.on = on;
    saveAudio();
    applyPhoneAudio();
    renderAudio();
    pushStatus();
  }

  async function renderAudio() {
    const a = settings.audio;
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications' && d.deviceId !== 'default');
    const meter = (key) => {
      const bar = h('i');
      meters[key] = bar;
      return h('div', { class: 'meter' }, bar);
    };
    const gain = (key) => {
      const input = h('input', { type: 'range', min: 0, max: 2, step: 0.01, value: a[key].gain, oninput: () => {
        a[key].gain = parseFloat(input.value);
        if (key === 'mic') Mixer.setGain('mic', a.mic.muted ? 0 : a.mic.gain);
        else if (key === 'phone') applyPhoneAudio();
        else Mixer.setGain(key, a[key].gain);
        saveAudio();
      } });
      return input;
    };
    const micSel = dropdown([{ value: 'default', label: 'System default' }, { value: 'none', label: 'None' },
      ...devices.map((d) => ({ value: d.deviceId, label: d.label || 'Microphone' }))], a.mic.deviceId,
      (v) => { a.mic.deviceId = v; saveAudio(); applyMic(); });
    const muteBtn = h('button', { class: 'small' + (a.mic.muted ? ' active' : ''), onclick: () => setMicMuted(!a.mic.muted) }, a.mic.muted ? 'Muted' : 'Mute');
    const toggle = (key, apply) => {
      const box = h('input', { type: 'checkbox', checked: a[key].on, onchange: () => { a[key].on = box.checked; saveAudio(); apply(); } });
      return box;
    };
    $('audioRows').replaceChildren(
      h('div', { class: 'arow' },
        h('div', { class: 'arow-top' }, h('label', {}, 'Mic'), micSel),
        h('div', { class: 'arow-ctl' }, gain('mic'), muteBtn), meter('mic')),
      h('div', { class: 'arow' },
        h('div', { class: 'arow-top' }, h('label', {}, 'Desktop audio'), toggle('system', applySystem)),
        h('div', { class: 'arow-ctl' }, gain('system')), meter('system')),
      h('div', { class: 'arow' },
        h('div', { class: 'arow-top' }, h('label', {}, 'Phone mic'), toggle('phone', applyPhoneAudio)),
        h('div', { class: 'arow-ctl' }, gain('phone')), meter('phone'))
    );
  }

  // ---------- phone as the PC's webcam and mic ----------
  // Camera: frames go to the OBS Virtual Camera device (see vcam.js).
  // Mic: the phone audio is played into an output device. With a virtual audio
  // cable installed, that cable's other end is a microphone other apps can pick.
  const micOut = new Audio();
  micOut.autoplay = true;

  async function applyPhoneOut() {
    const id = settings.audio.phoneOut;
    const tracks = phoneStream ? phoneStream.getAudioTracks() : [];
    if (id === 'none' || !tracks.length) {
      micOut.srcObject = null;
      return;
    }
    try {
      await micOut.setSinkId(id);
      micOut.srcObject = new MediaStream(tracks);
      await micOut.play();
    } catch (err) {
      console.warn('phone mic output failed', err.message);
      micOut.srcObject = null;
    }
  }

  function setVcam(on) {
    settings.vcam = { ...settings.vcam, on };
    save({ vcam: settings.vcam });
    Vcam.setSource(settings.vcam.source);
    Vcam.set(on);
    renderVcam();
    pushStatus();
  }
  Vcam.onError((msg) => {
    settings.vcam = { ...settings.vcam, on: false };
    save({ vcam: settings.vcam });
    renderVcam(msg);
    pushStatus();
  });

  async function renderVcam(error) {
    const v = settings.vcam;
    const outs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications');
    const cable = outs.some((d) => /cable|voicemeeter|virtual/i.test(d.label));
    const box = h('input', { type: 'checkbox', checked: v.on, disabled: !settings.vcamAvailable, onchange: () => setVcam(box.checked) });
    const src = dropdown([{ value: 'phone', label: 'Phone camera' }, { value: 'scene', label: 'Whole scene' }], v.source,
      (value) => { settings.vcam = { ...settings.vcam, source: value }; save({ vcam: settings.vcam }); Vcam.setSource(value); });
    const out = dropdown([{ value: 'none', label: 'Off' }, ...outs.map((d) => ({ value: d.deviceId, label: d.label || 'Output' }))],
      outs.some((d) => d.deviceId === settings.audio.phoneOut) ? settings.audio.phoneOut : 'none',
      (value) => { settings.audio.phoneOut = value; saveAudio(); applyPhoneOut(); });
    const camHint = error ? error
      : !settings.vcamAvailable ? 'Needs OBS Studio installed. FreeCast feeds the virtual camera it comes with.'
      : v.on ? 'Live. In the other app, pick the camera named OBS Virtual Camera.'
      : 'Makes the phone show up as a webcam in Discord, Zoom, browsers and the rest.';
    const micHint = cable
      ? 'Pick the cable input here, then pick the cable output as the microphone in the other app.'
      : 'To use the phone as a mic in other apps, Windows needs a virtual audio cable (VB-CABLE is free). None is installed.';
    $('vcamRows').replaceChildren(
      h('div', { class: 'arow' },
        h('div', { class: 'arow-top' }, h('label', {}, 'Camera to apps'), box),
        src,
        h('p', { class: 'hint' + (error ? ' bad' : ''), style: 'margin:6px 2px 0' }, camHint)),
      h('div', { class: 'arow' },
        h('div', { class: 'arow-top' }, h('label', {}, 'Mic to apps')),
        out,
        h('p', { class: 'hint', style: 'margin:6px 2px 0' }, micHint))
    );
  }

  setInterval(() => {
    for (const [key, bar] of Object.entries(meters)) {
      const v = Mixer.level(key);
      const db = v > 0 ? 20 * Math.log10(v) : -60;
      bar.style.width = Math.max(0, Math.min(100, ((db + 60) / 60) * 100)) + '%';
      bar.classList.toggle('hot', db > -3);
    }
  }, 80);
  navigator.mediaDevices.addEventListener('devicechange', () => { renderAudio(); renderVcam(); });

  // ---------- phone ----------
  function updatePhone() {
    const state = Phone.state();
    const p = Phone.current();
    const stream = p ? p.stream : null;
    $('phonePill').className = 'pill ' + (state === 'off' ? '' : state);
    $('phoneText').textContent = state === 'live' ? 'Phone connected' : state === 'wait' ? 'Phone connecting' : 'Phone not connected';
    if (stream !== phoneStream) {
      phoneStream = stream;
      if (stream && !Scene.list().some((s) => s.type === 'phone')) Scene.add(Scene.make('phone', { name: 'Phone Camera', mirror: true }));
      for (const s of Scene.list()) {
        if (s.type !== 'phone') continue;
        if (stream) Scene.attachStream(s.id, stream, false);
        else Scene.detach(s.id);
      }
      if (stream && $('modalTitle').textContent === 'Connect your phone') closeModal();
    }
    const key = stream ? stream.id + ':' + stream.getAudioTracks().length : '';
    if (key !== phoneAudioKey) {
      phoneAudioKey = key;
      Mixer.setStream('phone', stream && stream.getAudioTracks().length ? new MediaStream(stream.getAudioTracks()) : null);
      applyPhoneAudio();
      applyPhoneOut();
    }
    pushStatus();
  }
  Phone.onChange(updatePhone);

  async function showPhone() {
    const info = await api.phoneInfo();
    if (!info.links.length) return openModal('Connect your phone', h('p', { class: 'hint' }, info.error || 'No network connection found on this PC.'));
    const img = h('img', { src: info.links[0].qr });
    const code = h('code', {}, info.links[0].url);
    const pick = info.links.length > 1
      ? dropdown(info.links.map((l) => l.ip), info.links[0].ip, (ip) => { const l = info.links.find((x) => x.ip === ip); img.src = l.qr; code.textContent = l.url; })
      : null;
    openModal('Connect your phone', h('div', { class: 'phone-box' }, img, h('div', {},
      h('ol', {},
        h('li', {}, 'Put the phone on the same Wi-Fi network as this PC.'),
        h('li', {}, 'Scan the code with the phone camera.'),
        h('li', {}, 'The browser warns about the certificate because FreeCast hosts itself. Choose Show Details, then visit this website.'),
        h('li', {}, 'Tap Start camera and allow the camera and the microphone.'),
        h('li', {}, 'To record the phone mic, tick Phone mic in the Audio panel. It stays in sync with the phone video.')),
      pick ? h('div', { class: 'field' }, h('label', {}, 'Network'), pick) : null,
      code,
      info.error ? h('p', { class: 'hint' }, 'Server problem: ' + info.error) : null,
      h('p', { class: 'hint' }, 'If the phone cannot reach the page, allow FreeCast (Electron) through Windows Firewall on private networks.'))));
  }
  $('phonePill').onclick = showPhone;

  // ---------- recording ----------
  function renderMarkers() {
    const on = Recorder.state() === 'recording';
    $('markerBtns').replaceChildren(...settings.hotkeys.markers.map((m, i) =>
      h('button', { disabled: !on, onclick: () => api.marker(i) }, 'Mark ' + m.label, h('kbd', {}, m.key || ''))));
  }

  let clock = null;
  Recorder.onState((state, extra = {}) => {
    const btn = $('btnRec');
    btn.classList.toggle('on', state === 'recording');
    btn.disabled = state === 'starting' || state === 'finalizing';
    $('recLabel').textContent = state === 'recording' ? 'Stop' : state === 'finalizing' ? 'Saving' : 'Record';
    $('recTime').classList.toggle('on', state === 'recording');
    clearInterval(clock);
    if (state === 'recording') {
      $('result').replaceChildren(h('span', {}, extra.name));
      clock = setInterval(() => ($('recTime').textContent = fmt(Recorder.elapsed())), 250);
    } else if (state === 'finalizing') {
      $('result').replaceChildren(h('span', {}, 'Finalizing ' + extra.name), h('div', { class: 'prog' }, h('i', { id: 'progBar', style: 'width:0' })));
    } else if (extra.error) {
      $('result').replaceChildren(h('span', { class: 'bad' }, extra.error));
    } else if (extra.result) {
      const r = extra.result;
      const count = r.markers ? r.markers.length : 0;
      $('result').replaceChildren(
        h('span', { class: r.ok ? '' : 'bad' }, r.ok ? `Saved ${r.name}.mp4, ${count} ${count === 1 ? 'marker' : 'markers'}` : `Finalize failed, raw capture kept: ${r.error}`),
        h('button', { class: 'small', onclick: () => api.showFile(r.file) }, 'Show in folder'));
    }
    renderMarkers();
    if (afterState) afterState(state, extra);
  });
  api.onProgress((p) => { const bar = $('progBar'); if (bar) bar.style.width = Math.round(p * 100) + '%'; });
  api.onMarker(({ marker }) => {
    if (Recorder.state() === 'recording') $('result').replaceChildren(h('span', {}, `${marker.title} at ${fmt(marker.ms)}`));
  });

  const toggleRec = () => Recorder.toggle({ fps: settings.canvas.fps, bitrateMbps: settings.bitrateMbps, audioKbps: settings.audioKbps });
  $('btnRec').onclick = toggleRec;

  // ---------- camera layouts ----------
  // Each cam is in one of three modes: corner (its normal box), full (fills
  // the canvas, its normal box remembered in s.home) or off (hidden).
  const camMode = (s) => (!s.visible ? 'off' : s.home ? 'full' : 'corner');

  function setCamMode(mode) {
    for (const s of cams()) {
      if (mode === 'full') {
        if (!s.home) s.home = { x: s.x, y: s.y, w: s.w, h: s.h, crop: { ...s.crop }, shape: s.shape, borderW: s.borderW };
        s.visible = true;
        s.shape = 'rect';
        s.borderW = 0;
        Scene.fill(s);
      } else {
        if (s.home) {
          Object.assign(s, s.home, { crop: { ...s.home.crop } });
          delete s.home;
        }
        s.visible = mode !== 'off';
      }
    }
    Scene.emit('list');
    note(mode === 'full' ? 'Cam full screen' : mode === 'off' ? 'Cam off' : 'Cam in corner');
  }

  function setCamCorner(pos) {
    for (const s of cams()) {
      if (s.home) { Object.assign(s, s.home, { crop: { ...s.home.crop } }); delete s.home; }
      s.visible = true;
      s.cornerPos = pos;
      Scene.corner(s, pos);
    }
    Scene.emit('list');
    note('Cam ' + { tl: 'top left', tr: 'top right', bl: 'bottom left', br: 'bottom right' }[pos]);
  }

  // ---------- monitors ----------
  async function switchMonitor(pick) {
    const s = (Scene.selected() && Scene.selected().type === 'screen' && Scene.selected()) || Scene.list().find((x) => x.type === 'screen');
    if (!s) return note('No screen source');
    const screens = await api.listScreens();
    if (!screens.length) return;
    let i = screens.findIndex((x) => x.id === s.ref.id);
    if (i < 0) i = screens.findIndex((x) => x.displayId === s.ref.displayId);
    const next = typeof pick === 'number' ? pick : (Math.max(0, i) + pick.step + screens.length) % screens.length;
    const target = screens[next];
    if (!target) return note('No monitor ' + (next + 1));
    if (target.id !== s.ref.id) {
      if (s.name === s.ref.name) s.name = target.name;
      s.ref = { id: target.id, name: target.name, displayId: target.displayId };
      s.refit = true;
      await acquire(s, screens);
      Scene.emit('list');
    }
    note(screens.length > 1 ? 'Recording monitor ' + (next + 1) : 'Only one monitor');
  }

  // ---------- hotkey actions ----------
  const ACTIONS = [
    ['Recording', [
      ['record', 'Start or stop recording', () => toggleRec()],
      ['showApp', 'Show or hide the FreeCast window', null],
    ]],
    ['Face cam', [
      ['camCycle', 'Cycle cam: corner, full screen, off', () => setCamMode({ corner: 'full', full: 'off', off: 'corner' }[cams().length ? camMode(cams()[0]) : 'off'])],
      ['camCornerMode', 'Cam in corner', () => setCamMode('corner')],
      ['camFull', 'Cam full screen', () => setCamMode('full')],
      ['camOff', 'Cam off', () => setCamMode('off')],
      ['cam', 'Show or hide cam', () => setCamMode(cams().some((s) => s.visible) ? 'off' : 'corner')],
      ['camBig', 'Toggle cam full screen', () => setCamMode(cams().some((s) => s.home) ? 'corner' : 'full')],
      ['camCorner', 'Move cam to the next corner', () => { const order = ['br', 'bl', 'tl', 'tr']; const c = cams()[0]; setCamCorner(order[(order.indexOf((c && c.cornerPos) || 'br') + 1) % 4]); }],
      ['camTL', 'Cam to top left', () => setCamCorner('tl')],
      ['camTR', 'Cam to top right', () => setCamCorner('tr')],
      ['camBL', 'Cam to bottom left', () => setCamCorner('bl')],
      ['camBR', 'Cam to bottom right', () => setCamCorner('br')],
    ]],
    ['Monitors', [
      ['nextMonitor', 'Record the next monitor', () => switchMonitor({ step: 1 })],
      ['prevMonitor', 'Record the previous monitor', () => switchMonitor({ step: -1 })],
      ['monitor1', 'Record monitor 1', () => switchMonitor(0)],
      ['monitor2', 'Record monitor 2', () => switchMonitor(1)],
      ['monitor3', 'Record monitor 3', () => switchMonitor(2)],
    ]],
    ['Audio', [
      ['micMute', 'Mute or unmute the mic', () => { setMicMuted(!settings.audio.mic.muted); note(settings.audio.mic.muted ? 'Mic muted' : 'Mic live'); }],
      ['desktopMute', 'Desktop audio on or off', () => { setDesktopAudio(!settings.audio.system.on); note(settings.audio.system.on ? 'Desktop audio on' : 'Desktop audio off'); }],
      ['phoneMic', 'Phone mic on or off', () => { setPhoneMic(!settings.audio.phone.on); note(settings.audio.phone.on ? 'Phone mic on' : 'Phone mic off'); }],
    ]],
    ['PC webcam', [
      ['vcam', 'Send the camera to other apps, on or off', () => { setVcam(!settings.vcam.on); note(settings.vcam.on ? 'Webcam output on' : 'Webcam output off'); }],
    ]],
  ];
  const ACTION_FN = Object.fromEntries(ACTIONS.flatMap(([, list]) => list.map(([id, , fn]) => [id, fn])));

  function note(text) {
    api.hudNote(text);
    pushStatus();
  }

  // What the status box shows under the timer.
  function pushStatus() {
    if (!settings) return;
    const a = settings.audio;
    const c = cams()[0];
    const mics = [!a.mic.muted && a.mic.deviceId !== 'none' && 'Mic', a.phone.on && phoneStream && 'Phone mic'].filter(Boolean);
    api.hudStatus({
      mic: mics.length ? mics.join(' + ') : 'Mic muted',
      micOff: !mics.length,
      cam: c ? 'Cam ' + camMode(c) : 'No cam',
      extra: settings.vcam && settings.vcam.on ? 'Webcam out' : '',
    });
  }

  api.onHotkey((id) => {
    if (capturingKey) return;
    if (id.startsWith('source:')) {
      const s = Scene.get(id.slice(7));
      if (!s) return;
      s.visible = !s.visible;
      Scene.emit('list');
      return note(s.name + (s.visible ? ' shown' : ' hidden'));
    }
    if (ACTION_FN[id]) ACTION_FN[id]();
  });

  // ---------- settings ----------
  function showSettings() {
    const hk = settings.hotkeys;
    const field = (label, control) => h('div', { class: 'field' }, h('label', {}, label), control);
    // Output path: a folder you can type or browse to, plus a name pattern.
    const preview = h('code', { class: 'pathprev' }, '');
    const showPreview = async () => { preview.textContent = 'Next file: ' + (await api.previewName()); };
    const dir = h('input', { type: 'text', value: settings.outputDir, spellcheck: 'false', oninput: async () => { const v = dir.value.trim(); if (v) { await save({ outputDir: v }); showPreview(); } } });
    const base = h('input', { type: 'text', value: settings.baseName, spellcheck: 'false', oninput: async () => { await save({ baseName: base.value.trim() || 'Recording {n}' }); showPreview(); } });
    showPreview();

    const setCanvas = (w, hh) => { Scene.setSize(w, hh); layoutStage(); save({ canvas: { ...settings.canvas, w, h: hh } }); customW.value = w; customH.value = hh; };
    const sizes = [
      [1280, 720, '720p'], [1600, 900, '900p'], [1920, 1080, '1080p'], [2560, 1440, '1440p'], [3840, 2160, '4K'],
      [1920, 1200, '16:10'], [2560, 1600, '16:10'], [2560, 1080, 'ultrawide'], [3440, 1440, 'ultrawide'],
      [1080, 1920, 'vertical'], [720, 1280, 'vertical'], [1080, 1350, '4:5'], [1080, 1080, 'square'],
    ];
    const cur = `${settings.canvas.w}x${settings.canvas.h}`;
    const sizeOpts = sizes.map(([w, hh, tag]) => ({ value: `${w}x${hh}`, label: `${w} x ${hh}  (${tag})` }));
    if (!sizeOpts.some((o) => o.value === cur)) sizeOpts.unshift({ value: cur, label: `${settings.canvas.w} x ${settings.canvas.h}  (custom)` });
    const size = dropdown(sizeOpts, cur, (v) => { const [w, hh] = v.split('x').map(Number); setCanvas(w, hh); });
    const customW = h('input', { type: 'number', min: 320, max: 7680, step: 2, value: settings.canvas.w });
    const customH = h('input', { type: 'number', min: 240, max: 4320, step: 2, value: settings.canvas.h });
    const applyCustom = h('button', { style: 'flex:none', onclick: () => {
      const even = (v, lo, hi) => Math.round(Math.max(lo, Math.min(hi, +v || lo)) / 2) * 2;
      setCanvas(even(customW.value, 320, 7680), even(customH.value, 240, 4320));
      showSettings();
    } }, 'Apply');
    const fps = dropdown([15, 20, 24, 25, 30, 48, 50, 60, 75, 90, 120, 144].map((v) => ({ value: v, label: v + ' fps' })), settings.canvas.fps,
      async (v) => { await save({ canvas: { ...settings.canvas, fps: v } }); startTicker(); reacquire(); });
    const bitrate = dropdown([2, 4, 6, 8, 10, 12, 16, 20, 24, 32, 40, 50, 60, 80, 100].map((v) => ({ value: v, label: v + ' Mbps' })), settings.bitrateMbps, (v) => save({ bitrateMbps: v }));
    const fin = dropdown([{ value: 'cfr', label: 'Constant frame rate (best for editing)' }, { value: 'fast', label: 'Fast copy (instant, variable frame rate)' }],
      settings.finalize, (v) => save({ finalize: v }));
    const crf = dropdown([{ value: 12, label: 'Near lossless (huge files)' }, { value: 15, label: 'Very high' }, { value: 18, label: 'High' }, { value: 21, label: 'Balanced' }, { value: 24, label: 'Small files' }, { value: 28, label: 'Smallest' }],
      settings.crf, (v) => save({ crf: v }));
    const audioKbps = dropdown([96, 128, 160, 192, 256, 320].map((v) => ({ value: v, label: v + ' kbps' })), settings.audioKbps, (v) => save({ audioKbps: v }));
    const hud = dropdown([{ value: 'always', label: 'Always on screen' }, { value: 'recording', label: 'Only while recording' }, { value: 'off', label: 'Off' }],
      settings.statusBox, (v) => save({ statusBox: v }));
    const hudCorner = dropdown([{ value: 'tr', label: 'Top right' }, { value: 'tl', label: 'Top left' }, { value: 'br', label: 'Bottom right' }, { value: 'bl', label: 'Bottom left' }],
      settings.statusCorner, (v) => save({ statusCorner: v }));
    const margin = h('input', { type: 'number', min: 0, max: 300, step: 4, value: settings.cornerMargin, oninput: () => { const v = Math.max(0, +margin.value || 0); Scene.setMargin(v); save({ cornerMargin: v }); } });
    const hide =h('input', { type: 'checkbox', checked: settings.hideFromCapture, onchange: () => save({ hideFromCapture: hide.checked }) });
    const delay = h('input', { type: 'number', min: 0, max: 1000, step: 10, value: settings.audio.mic.delayMs, oninput: () => { settings.audio.mic.delayMs = +delay.value || 0; Mixer.setDelay('mic', settings.audio.mic.delayMs); saveAudio(); } });
    const ns = h('input', { type: 'checkbox', checked: settings.audio.mic.ns, onchange: () => { settings.audio.mic.ns = ns.checked; saveAudio(); applyMic(); } });

    const markerRows = hk.markers.map((m, i) => {
      const label = h('input', { type: 'text', value: m.label, oninput: () => { m.label = label.value.trim() || 'Marker'; saveHotkeys(); } });
      const color = dropdown(['Red', 'Yellow', 'Green', 'Blue', 'Cyan', 'Pink', 'Purple'], m.color, (v) => { m.color = v; saveHotkeys(); });
      const del = h('button', { class: 'icon', onclick: async () => { hk.markers.splice(i, 1); await saveHotkeys(); showSettings(); } }, 'x');
      return h('div', { class: 'markrow' }, label, color, keycap(() => m.key, (v) => (m.key = v)), del);
    });
    const addMarker = h('button', { class: 'small', onclick: async () => { hk.markers.push({ label: 'Marker', key: '', color: 'Blue' }); await saveHotkeys(); showSettings(); } }, 'Add a marker type');
    const actionRows = ACTIONS.flatMap(([group, list]) => [
      h('h3', {}, group + ' keys'),
      ...list.map(([id, label]) => h('div', { class: 'keyrow' }, h('label', {}, label), keycap(() => hk[id] || '', (v) => (hk[id] = v)))),
    ]);
    const sourceRows = Scene.list().map((s) => h('div', { class: 'keyrow' }, h('label', {}, 'Show or hide ' + s.name),
      keycap(() => (hk.sources || {})[s.id] || '', (v) => { hk.sources = { ...(hk.sources || {}) }; if (v) hk.sources[s.id] = v; else delete hk.sources[s.id]; })));

    openModal('Settings', [
      h('h3', {}, 'Output'),
      field('Folder', h('div', { class: 'row' }, dir, h('button', { style: 'flex:none', onclick: async () => { const p = await api.pickDir(); if (p) { dir.value = p; await save({ outputDir: p }); showPreview(); } } }, 'Browse'))),
      field('File name', base),
      h('p', { class: 'hint', style: 'margin:0 0 6px 158px' }, 'Type or paste any folder. Name tokens: {n} counter, {date} Oct 12, {isodate} 2026-10-12, {time} 5-26 PM. A slash makes a subfolder, like {date}/Devlog {n}.'),
      h('div', { style: 'margin:0 0 12px 158px' }, preview),
      h('h3', {}, 'Video'),
      field('Canvas size', size),
      field('Custom size', h('div', { class: 'row' }, customW, customH, applyCustom)),
      field('Frame rate', fps),
      field('Capture bitrate', bitrate),
      field('Finalize', fin),
      field('Finished quality', crf),
      field('Audio bitrate', audioKbps),
      h('p', { class: 'hint' }, 'Frame rates above 60 only help if the monitor and this PC can keep up; if the recording stutters, go back down.'),
      h('h3', {}, 'Hotkeys'),
      h('p', { class: 'hint' }, 'Every key below works while any other app has focus. Click a key box, press the combo. Function, numpad and navigation keys can be bound on their own; letters and digits need Ctrl, Alt, Shift or Win.'),
      ...actionRows,
      h('h3', {}, 'Marker keys (active while recording)'),
      ...markerRows,
      addMarker,
      sourceRows.length ? h('h3', {}, 'Source keys') : null,
      ...sourceRows,
      h('h3', {}, 'Status box'),
      field('Show', hud),
      field('Home corner', hudCorner),
      h('p', { class: 'hint' }, 'The status box sits on your monitor, never in the video, and jumps out of the way when the mouse reaches it.'),
      h('h3', {}, 'Other'),
      field('Corner margin (px)', h('div', { class: 'row' }, margin, h('span', { class: 'hint', style: 'margin:0' }, 'Gap the corner buttons and keys leave'))),
      field('Hide FreeCast', h('label', { class: 'row' }, hide, h('span', {}, 'Keep this window out of the recording'))),
      field('Mic delay (ms)', h('div', { class: 'row' }, delay, h('span', { class: 'hint', style: 'margin:0' }, 'Raise it if your voice leads your lips'))),
      field('Mic cleanup', h('label', { class: 'row' }, ns, h('span', {}, 'Noise suppression'))),
    ].filter(Boolean), 'settings');
  }
  $('btnSettings').onclick = showSettings;

  // ---------- render loop ----------
  // Ticks come from a worker because worker timers keep running at full rate
  // when the window is covered or minimized, which is exactly when we record.
  let ticker = null;
  function startTicker() {
    if (ticker) ticker.terminate ? ticker.terminate() : clearInterval(ticker);
    const tick = () => {
      Scene.draw();
      Vcam.tick();
      if (!document.hidden) Scene.drawOverlay();
    };
    try {
      const src = 'let t;onmessage=e=>{clearInterval(t);t=setInterval(()=>postMessage(0),e.data)}';
      ticker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      ticker.onmessage = tick;
      ticker.postMessage(1000 / settings.canvas.fps);
    } catch {
      ticker = setInterval(tick, 1000 / settings.canvas.fps);
    }
  }

  // ---------- boot ----------
  Scene.setMargin(settings.cornerMargin);
  Scene.setSize(settings.canvas.w, settings.canvas.h);
  layoutStage();
  startTicker();
  if (settings.badHotkeys.length) $('warn').textContent = 'Could not bind (duplicate or taken by another app): ' + settings.badHotkeys.join(', ');

  const list = await api.listSources();
  if (settings.scene && settings.scene.length) {
    Scene.load(settings.scene);
    for (const s of Scene.list()) await acquire(s, list);
  } else {
    const main = list.find((x) => x.isScreen);
    if (main) {
      const s = Scene.add(Scene.make('screen', { name: main.name, ref: { id: main.id, name: main.name, displayId: main.displayId } }));
      await acquire(s, list);
    }
  }
  Scene.select(null);
  renderList();
  renderProps();
  renderMarkers();
  await applyMic();
  await applySystem();
  applyPhoneAudio();
  await renderAudio();
  await renderVcam();
  if (settings.vcam.on && !settings.selftest) setVcam(true);
  pushStatus();

  // ---------- selftest ----------
  if (settings.selftest) {
    const main = list.find((x) => x.isScreen);
    const cam = Scene.add(Scene.make('screen', { name: 'Fake Cam', ref: { id: main.id, name: main.name, displayId: main.displayId } }));
    await acquire(cam, list);
    for (let i = 0; i < 80 && !Scene.list().every(Scene.ready); i++) await sleep(100);
    cam.w = 460; cam.h = 300;
    Scene.setShape(cam, 'circle');
    Scene.corner(cam, 'br');
    cam.borderW = 6;
    Scene.select(null);
    Scene.select(cam.id);
    // UI states that the recording itself cannot show.
    cam.type = 'camera';
    cam.crop = { l: 0.2, t: 0.1, r: 0.3, b: 0.25 };
    Scene.setCropMode(cam.id);
    await sleep(300);
    await api.selftest('shot', 'Crop.png');
    Scene.setCropMode(null);
    Scene.setShape(cam, 'circle');
    Scene.corner(cam, 'br');
    setCamMode('full');
    await sleep(300);
    await api.selftest('shot', 'Cam Full.png');
    setCamMode('corner');
    showSettings();
    await sleep(200);
    document.querySelector('#modalBody .select').click();
    await sleep(200);
    await api.selftest('shot', 'Settings.png');
    $('modalBody').scrollTop = 520;
    UI.closeMenus();
    await sleep(200);
    await api.selftest('shot', 'Settings Keys.png');
    closeModal();
    setVcam(true); // the fake cam goes out as the PC webcam for the length of the take
    await sleep(300);
    await api.selftest('hudshot', 'Status Box.png');
    afterState = (state, extra) => {
      if (state === 'idle' && (extra.result || extra.error)) api.selftest('done', extra.result || extra);
    };
    toggleRec();
    await sleep(2000);
    await api.selftest('marker', 0);
    await api.selftest('minimize');
    await sleep(3000);
    await api.selftest('marker', 1);
    await sleep(1500);
    await api.selftest('restore');
    await sleep(1200);
    await api.selftest('shot', 'UI.png');
    Recorder.stop();
  }
})();
