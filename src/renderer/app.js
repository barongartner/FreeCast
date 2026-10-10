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

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null) el.append(kid);
    return el;
  }

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

  // ---------- modal ----------
  function openModal(title, body, cls = '') {
    $('modalTitle').textContent = title;
    $('modalBody').className = cls;
    $('modalBody').replaceChildren(...[body].flat());
    $('modal').hidden = false;
  }
  const closeModal = () => {
    $('modal').hidden = true;
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
      const btn = (html, title, fn, on) => h('button', { class: 'icon' + (on ? ' on' : ''), title, html, onclick: (e) => { e.stopPropagation(); fn(); } });
      return h('div', { class: 'src' + (sel && sel.id === s.id ? ' sel' : '') + (s.visible ? '' : ' off'), onclick: () => Scene.select(s.id) },
        btn(s.visible ? ICON.eye : ICON.eyeOff, 'Show or hide', () => { s.visible = !s.visible; Scene.emit('list'); }, s.visible),
        h('span', { class: 'src-name', title: s.name }, s.name),
        h('span', { class: 'src-kind' }, KIND[s.type]),
        btn(ICON.up, 'Bring forward', () => Scene.reorder(s.id, 1)),
        btn(ICON.down, 'Send back', () => Scene.reorder(s.id, -1)));
    });
    $('srcList').replaceChildren(...(rows.length ? rows : [h('p', { class: 'hint' }, 'No sources yet. Add a screen to start.')]));
  }

  // ---------- properties ----------
  let geo = null;
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
    const shape = h('select', { onchange: () => { Scene.setShape(s, shape.value); changed(); renderProps(); } },
      ['rect', 'round', 'circle'].map((v) => h('option', { value: v, selected: s.shape === v }, { rect: 'Rectangle', round: 'Rounded', circle: 'Circle' }[v])));
    const name = h('input', { type: 'text', value: s.name, oninput: () => { s.name = name.value; renderList(); saveScene(); } });
    const color = h('input', { type: 'color', value: s.borderColor, oninput: () => { s.borderColor = color.value; changed(); } });
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
      h('div', { class: 'grid4' }, act('Fit', Scene.fit), act('Fill', Scene.fill), act('Center', Scene.center), act('Uncrop', (x) => { const a = Scene.natural(x); x.crop = { l: 0, t: 0, r: 0, b: 0 }; if (a) x.h = x.w / (a.w / a.h); })),
      h('div', { class: 'field' }, h('label', {}, 'Snap to'), h('div', { class: 'row' },
        ['tl', 'tr', 'bl', 'br'].map((p) => act({ tl: 'TL', tr: 'TR', bl: 'BL', br: 'BR' }[p], (x) => Scene.corner(x, p))))),
      h('div', { class: 'sep' }),
      h('div', { class: 'field' }, h('label', {}, 'Shape'), shape),
      s.shape === 'round' ? h('div', { class: 'field' }, h('label', {}, 'Radius'), range(0, 200, 1, s.radius, (v) => (s.radius = v))) : null,
      h('div', { class: 'field' }, h('label', {}, 'Border'), h('div', { class: 'row' }, range(0, 24, 1, s.borderW, (v) => (s.borderW = v)), color)),
      h('div', { class: 'field' }, h('label', {}, 'Opacity'), range(0.1, 1, 0.01, s.opacity, (v) => (s.opacity = v), (v) => Math.round(v * 100))),
      h('div', { class: 'field' }, h('label', {}, 'Options'), h('div', { class: 'row' }, check('Mirror', 'mirror'), check('Lock', 'locked'))),
      h('div', { class: 'sep' }),
      h('div', { class: 'grid2' }, relink, h('button', { class: 'small danger', onclick: () => Scene.remove(s.id) }, 'Remove')),
    ].filter(Boolean));
  }

  function syncGeo() {
    const s = Scene.selected();
    if (!s || !geo) return;
    for (const k of ['x', 'y', 'w', 'h']) if (document.activeElement !== geo[k]) geo[k].value = Math.round(s[k]);
  }

  Scene.on((what) => {
    if (what === 'list') { renderList(); renderProps(); }
    else if (what === 'select') { renderList(); renderProps(); }
    else if (what === 'change' || what === 'size') syncGeo();
    if (what !== 'select' && what !== 'media') saveScene();
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

  async function renderAudio() {
    const a = settings.audio;
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications' && d.deviceId !== 'default');
    const meter = (key) => {
      const bar = h('i');
      meters[key] = bar;
      return h('div', { class: 'meter' }, bar);
    };
    const gain = (key) => {
      const input = h('input', { type: 'range', min: 0, max: 2, step: 0.01, value: a[key].gain, title: 'Volume', oninput: () => {
        a[key].gain = parseFloat(input.value);
        if (key === 'mic') Mixer.setGain('mic', a.mic.muted ? 0 : a.mic.gain);
        else if (key === 'phone') applyPhoneAudio();
        else Mixer.setGain(key, a[key].gain);
        saveAudio();
      } });
      return input;
    };
    const micSel = h('select', { onchange: () => { a.mic.deviceId = micSel.value; saveAudio(); applyMic(); } },
      h('option', { value: 'default', selected: a.mic.deviceId === 'default' }, 'System default'),
      h('option', { value: 'none', selected: a.mic.deviceId === 'none' }, 'None'),
      devices.map((d) => h('option', { value: d.deviceId, selected: a.mic.deviceId === d.deviceId }, d.label || 'Microphone')));
    const muteBtn = h('button', { class: 'small' + (a.mic.muted ? ' active' : ''), onclick: () => { a.mic.muted = !a.mic.muted; muteBtn.classList.toggle('active', a.mic.muted); muteBtn.textContent = a.mic.muted ? 'Muted' : 'Mute'; Mixer.setGain('mic', a.mic.muted ? 0 : a.mic.gain); saveAudio(); } }, a.mic.muted ? 'Muted' : 'Mute');
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

  setInterval(() => {
    for (const [key, bar] of Object.entries(meters)) {
      const v = Mixer.level(key);
      const db = v > 0 ? 20 * Math.log10(v) : -60;
      bar.style.width = Math.max(0, Math.min(100, ((db + 60) / 60) * 100)) + '%';
      bar.classList.toggle('hot', db > -3);
    }
  }, 80);
  navigator.mediaDevices.addEventListener('devicechange', renderAudio);

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
    }
  }
  Phone.onChange(updatePhone);

  async function showPhone() {
    const info = await api.phoneInfo();
    if (!info.links.length) return openModal('Connect your phone', h('p', { class: 'hint' }, info.error || 'No network connection found on this PC.'));
    const img = h('img', { src: info.links[0].qr });
    const code = h('code', {}, info.links[0].url);
    const pick = info.links.length > 1
      ? h('select', { onchange: () => { const l = info.links[pick.selectedIndex]; img.src = l.qr; code.textContent = l.url; } }, info.links.map((l) => h('option', {}, l.ip)))
      : null;
    openModal('Connect your phone', h('div', { class: 'phone-box' }, img, h('div', {},
      h('ol', {},
        h('li', {}, 'Put the phone on the same Wi-Fi network as this PC.'),
        h('li', {}, 'Scan the code with the phone camera.'),
        h('li', {}, 'The browser warns about the certificate because FreeCast hosts itself. Choose Show Details, then visit this website.'),
        h('li', {}, 'Tap Start camera and allow camera access.')),
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
        h('span', { class: r.ok ? '' : 'bad', title: r.error || r.file }, r.ok ? `Saved ${r.name}.mp4, ${count} ${count === 1 ? 'marker' : 'markers'}` : `Finalize failed, raw capture kept: ${r.error}`),
        h('button', { class: 'small', onclick: () => api.showFile(r.file) }, 'Show in folder'));
    }
    renderMarkers();
    if (afterState) afterState(state, extra);
  });
  api.onProgress((p) => { const bar = $('progBar'); if (bar) bar.style.width = Math.round(p * 100) + '%'; });
  api.onMarker(({ marker }) => {
    if (Recorder.state() === 'recording') $('result').replaceChildren(h('span', {}, `${marker.title} at ${fmt(marker.ms)}`));
  });

  const toggleRec = () => Recorder.toggle({ fps: settings.canvas.fps, bitrateMbps: settings.bitrateMbps });
  $('btnRec').onclick = toggleRec;
  api.onHotkey((key) => {
    if (capturingKey) return;
    if (key === 'record') toggleRec();
    if (key === 'cam') {
      const cams = Scene.list().filter((s) => s.type === 'phone' || s.type === 'camera');
      const show = !cams.some((s) => s.visible);
      cams.forEach((s) => (s.visible = show));
      Scene.emit('list');
    }
  });

  // ---------- settings ----------
  function accelFrom(e) {
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;
    let key = null;
    if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
    else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
    else if (/^F\d{1,2}$/.test(e.key)) key = e.key;
    if (!key) return null;
    const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean);
    if (!mods.length && !/^F\d/.test(key)) return null;
    return [...mods, key].join('+');
  }

  function showSettings() {
    const hk = JSON.parse(JSON.stringify(settings.hotkeys));
    const field = (label, control) => h('div', { class: 'field' }, h('label', {}, label), control);
    const keycap = (getKey, setKey) => {
      const btn = h('button', { class: 'keycap', onclick: () => {
        capturingKey = true;
        btn.classList.add('listen');
        btn.textContent = 'Press the keys...';
        const onKey = (e) => {
          e.preventDefault();
          if (e.key === 'Escape') return finish(getKey());
          if (e.key === 'Backspace') return finish('');
          const a = accelFrom(e);
          if (a) finish(a);
        };
        const finish = async (value) => {
          window.removeEventListener('keydown', onKey, true);
          capturingKey = false;
          btn.classList.remove('listen');
          setKey(value);
          btn.textContent = value || 'None';
          const r = await save({ hotkeys: hk });
          $('warn').textContent = r.badHotkeys.length ? 'Hotkey taken by another app: ' + r.badHotkeys.join(', ') : '';
          renderMarkers();
        };
        window.addEventListener('keydown', onKey, true);
      } }, getKey() || 'None');
      return btn;
    };
    const dir = h('input', { type: 'text', value: settings.outputDir, readonly: true });
    const base = h('input', { type: 'text', value: settings.baseName, oninput: () => save({ baseName: base.value.trim() || 'Recording' }) });
    const sizes = [[1920, 1080], [2560, 1440], [1280, 720], [1920, 1200], [1080, 1920]];
    const cur = `${settings.canvas.w}x${settings.canvas.h}`;
    const size = h('select', { onchange: () => { const [w, hh] = size.value.split('x').map(Number); Scene.setSize(w, hh); layoutStage(); save({ canvas: { ...settings.canvas, w, h: hh } }); } },
      sizes.map(([w, hh]) => h('option', { value: `${w}x${hh}`, selected: cur === `${w}x${hh}` }, `${w} x ${hh}`)));
    const fps = h('select', { onchange: () => { save({ canvas: { ...settings.canvas, fps: +fps.value } }); startTicker(); } },
      [30, 60].map((v) => h('option', { value: v, selected: settings.canvas.fps === v }, v + ' fps')));
    const bitrate = h('select', { onchange: () => save({ bitrateMbps: +bitrate.value }) },
      [6, 8, 12, 16, 24, 40].map((v) => h('option', { value: v, selected: settings.bitrateMbps === v }, v + ' Mbps')));
    const fin = h('select', { onchange: () => save({ finalize: fin.value }) },
      h('option', { value: 'cfr', selected: settings.finalize === 'cfr' }, 'Constant frame rate (best for editing)'),
      h('option', { value: 'fast', selected: settings.finalize === 'fast' }, 'Fast copy (instant, variable frame rate)'));
    const hide = h('input', { type: 'checkbox', checked: settings.hideFromCapture, onchange: () => save({ hideFromCapture: hide.checked }) });
    const delay = h('input', { type: 'number', min: 0, max: 1000, step: 10, value: settings.audio.mic.delayMs, oninput: () => { settings.audio.mic.delayMs = +delay.value || 0; Mixer.setDelay('mic', settings.audio.mic.delayMs); saveAudio(); } });
    const ns = h('input', { type: 'checkbox', checked: settings.audio.mic.ns, onchange: () => { settings.audio.mic.ns = ns.checked; saveAudio(); applyMic(); } });

    const markerRows = hk.markers.map((m, i) => {
      const label = h('input', { type: 'text', value: m.label, oninput: async () => { m.label = label.value.trim() || 'Marker'; await save({ hotkeys: hk }); renderMarkers(); } });
      const color = h('select', { onchange: () => { m.color = color.value; save({ hotkeys: hk }); } },
        ['Red', 'Yellow', 'Green', 'Blue', 'Cyan', 'Pink', 'Purple'].map((c) => h('option', { selected: m.color === c }, c)));
      return field('Marker ' + (i + 1), h('div', { class: 'row' }, label, color, keycap(() => m.key, (v) => (m.key = v))));
    });

    openModal('Settings', [
      h('h3', {}, 'Output'),
      field('Folder', h('div', { class: 'row' }, dir, h('button', { style: 'flex:none', onclick: async () => { const p = await api.pickDir(); if (p) { dir.value = p; save({ outputDir: p }); } } }, 'Browse'))),
      field('File name', base),
      field('Canvas', h('div', { class: 'row' }, size, fps)),
      field('Capture bitrate', bitrate),
      field('Finalize', fin),
      h('h3', {}, 'Hotkeys (work in any app)'),
      field('Start or stop', keycap(() => hk.record, (v) => (hk.record = v))),
      field('Show or hide cam', keycap(() => hk.cam, (v) => (hk.cam = v))),
      ...markerRows,
      h('p', { class: 'hint' }, 'Marker keys are only active while recording. Backspace clears a hotkey.'),
      h('h3', {}, 'Other'),
      field('Hide FreeCast', h('label', { class: 'row' }, hide, h('span', {}, 'Keep this window out of the recording'))),
      field('Mic delay (ms)', h('div', { class: 'row' }, delay, h('span', { class: 'hint', style: 'margin:0' }, 'Raise it if your voice leads your lips'))),
      field('Mic cleanup', h('label', { class: 'row' }, ns, h('span', {}, 'Noise suppression'))),
    ], 'settings');
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
  Scene.setSize(settings.canvas.w, settings.canvas.h);
  layoutStage();
  startTicker();
  if (settings.badHotkeys.length) $('warn').textContent = 'Hotkey taken by another app: ' + settings.badHotkeys.join(', ');

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
