'use strict';
// The scene: an ordered list of sources (bottom first) composited onto the
// output canvas, plus the editing overlay (selection box, handles, guides).
// The overlay is a separate canvas so none of it lands in the recording.
const Scene = (() => {
  const canvas = document.getElementById('out');
  const overlay = document.getElementById('overlay');
  const ctx = canvas.getContext('2d', { alpha: false });
  const octx = overlay.getContext('2d');
  const media = new Map(); // source id -> { el, stream, own }
  const listeners = new Set();
  const MIN = 24;
  let MARGIN = 0; // gap the corner buttons leave; set from Settings
  let sources = [];
  let selId = null;
  let guides = [];
  let drag = null;
  let cropId = null;
  let uid = 0;

  const W = () => canvas.width;
  const H = () => canvas.height;
  const emit = (what) => listeners.forEach((fn) => fn(what));
  const get = (id) => sources.find((s) => s.id === id);
  const selected = () => get(selId);

  function make(type, extra) {
    const s = Object.assign(
      {
        id: 's' + Date.now().toString(36) + uid++,
        type,
        name: type,
        x: 0, y: 0, w: 0, h: 0,
        visible: true,
        locked: false,
        opacity: 1,
        shape: 'rect',
        radius: 28,
        borderW: 0,
        borderColor: '#ffffff',
        mirror: false,
        crop: { l: 0, t: 0, r: 0, b: 0 },
        nat: null,
      },
      extra
    );
    place(s);
    return s;
  }

  function natural(s) {
    const m = media.get(s.id);
    if (!m) return null;
    const w = m.el.videoWidth || m.el.naturalWidth || 0;
    const h = m.el.videoHeight || m.el.naturalHeight || 0;
    return w && h ? { w, h } : null;
  }

  function ready(s) {
    const m = media.get(s.id);
    if (!m) return false;
    return m.el.tagName === 'VIDEO' ? m.el.readyState >= 2 && m.el.videoWidth > 0 : m.el.complete && m.el.naturalWidth > 0;
  }

  function croppedAspect(s) {
    const n = natural(s) || s.nat;
    if (!n) return 16 / 9;
    return (n.w * (1 - s.crop.l - s.crop.r)) / (n.h * (1 - s.crop.t - s.crop.b));
  }

  const isCam = (s) => s.type === 'phone' || s.type === 'camera';

  function center(s) {
    s.x = (W() - s.w) / 2;
    s.y = (H() - s.h) / 2;
  }

  // Sources too big to sit inside the margin go flush against the edge.
  function corner(s, pos) {
    const mx = s.w > W() - MARGIN * 2 ? 0 : MARGIN;
    const my = s.h > H() - MARGIN * 2 ? 0 : MARGIN;
    s.x = pos.includes('l') ? mx : W() - s.w - mx;
    s.y = pos.includes('t') ? my : H() - s.h - my;
  }

  function fit(s) {
    s.crop = { l: 0, t: 0, r: 0, b: 0 };
    const a = croppedAspect(s);
    let w = W();
    let h = w / a;
    if (h > H()) {
      h = H();
      w = h * a;
    }
    s.w = w;
    s.h = h;
    center(s);
  }

  // Centre-crop the source so its visible part matches the box aspect.
  function coverCrop(s) {
    const n = natural(s) || s.nat;
    s.crop = { l: 0, t: 0, r: 0, b: 0 };
    if (!n) return;
    const box = s.w / s.h;
    const src = n.w / n.h;
    if (src > box) s.crop.l = s.crop.r = (1 - box / src) / 2;
    else s.crop.t = s.crop.b = (1 - src / box) / 2;
  }

  function fill(s) {
    s.x = 0;
    s.y = 0;
    s.w = W();
    s.h = H();
    coverCrop(s);
  }

  function place(s) {
    const n = natural(s);
    if (isCam(s)) {
      s.crop = { l: 0, t: 0, r: 0, b: 0 };
      s.w = Math.round(W() * 0.24);
      s.h = Math.round(s.w / croppedAspect(s));
      if (s.shape === 'rect') s.shape = 'round';
      corner(s, 'br');
    } else if (s.type === 'image' && n) {
      const k = Math.min(1, W() / n.w, H() / n.h);
      s.w = n.w * k;
      s.h = n.h * k;
      center(s);
    } else {
      fit(s);
    }
  }

  function setShape(s, shape) {
    s.shape = shape;
    if (shape !== 'circle') return;
    const side = Math.min(s.w, s.h);
    s.x += (s.w - side) / 2;
    s.y += (s.h - side) / 2;
    s.w = s.h = side;
    coverCrop(s);
  }

  // Runs whenever a source reports real pixel dimensions. Keeps the saved
  // layout when the aspect is unchanged and repairs it when it is not (phone
  // rotated, different monitor, first frame of a brand new source).
  function onNatural(id) {
    const s = get(id);
    const n = s && natural(s);
    if (!n) return;
    const prev = s.nat;
    s.nat = n;
    if (!prev) {
      const keep = { x: s.x + s.w, y: s.y + s.h, w: s.w };
      if (isCam(s)) {
        s.h = Math.round(s.w / (n.w / n.h));
        s.x = keep.x - s.w;
        s.y = keep.y - s.h;
        if (s.shape === 'circle') setShape(s, 'circle');
      } else {
        place(s);
      }
    } else if (Math.abs(prev.w / prev.h - n.w / n.h) > 0.01) {
      if (s.refit) place(s); // switched to a monitor with a different shape
      else if (s.shape === 'circle') coverCrop(s);
      else {
        s.crop = { l: 0, t: 0, r: 0, b: 0 };
        s.h = s.w / (n.w / n.h);
      }
    }
    delete s.refit;
    emit('change');
  }

  // Crop the source to a given aspect (null clears the crop), keeping its
  // on-canvas scale and centre.
  function setCropAspect(s, aspect) {
    const n = natural(s) || s.nat;
    if (!n) return;
    const k = s.w / (n.w * (1 - s.crop.l - s.crop.r)); // canvas px per source px
    const cx = s.x + s.w / 2;
    const cy = s.y + s.h / 2;
    const c = { l: 0, t: 0, r: 0, b: 0 };
    const src = n.w / n.h;
    if (aspect && src > aspect) c.l = c.r = (1 - aspect / src) / 2;
    else if (aspect) c.t = c.b = (1 - src / aspect) / 2;
    s.crop = c;
    s.w = n.w * (1 - c.l - c.r) * k;
    s.h = n.h * (1 - c.t - c.b) * k;
    s.x = cx - s.w / 2;
    s.y = cy - s.h / 2;
  }

  // Where the whole uncropped source would sit on the canvas.
  function extents(s, box = s) {
    const kx = box.w / (1 - box.crop.l - box.crop.r);
    const ky = box.h / (1 - box.crop.t - box.crop.b);
    const left = s.mirror ? box.crop.r : box.crop.l;
    return { x: box.x - left * kx, y: box.y - box.crop.t * ky, w: kx, h: ky };
  }

  function setCropMode(id) {
    const s = id && get(id);
    cropId = s && natural(s) ? id : null;
    if (cropId) selId = cropId;
    emit('crop');
  }

  function detach(id) {
    const m = media.get(id);
    if (!m) return;
    if (m.own && m.stream) m.stream.getTracks().forEach((t) => t.stop());
    if (m.el.tagName === 'VIDEO') m.el.srcObject = null;
    media.delete(id);
  }

  function attachStream(id, stream, own = true) {
    detach(id);
    const el = document.createElement('video');
    el.muted = true;
    el.playsInline = true;
    el.srcObject = stream;
    el.addEventListener('loadedmetadata', () => onNatural(id));
    el.addEventListener('resize', () => onNatural(id));
    el.play().catch(() => {});
    media.set(id, { el, stream, own });
    emit('media');
  }

  function attachImage(id, url) {
    detach(id);
    const el = new Image();
    el.onload = () => onNatural(id);
    el.src = url;
    media.set(id, { el, stream: null, own: false });
    emit('media');
  }

  function add(s) {
    sources.push(s);
    selId = s.id;
    emit('list');
    return s;
  }

  function remove(id) {
    detach(id);
    sources = sources.filter((s) => s.id !== id);
    if (selId === id) selId = null;
    if (cropId === id) cropId = null;
    emit('list');
  }

  function reorder(id, dir) {
    const i = sources.findIndex((s) => s.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= sources.length) return;
    [sources[i], sources[j]] = [sources[j], sources[i]];
    emit('list');
  }

  function select(id) {
    if (selId === id) return;
    if (cropId && cropId !== id) cropId = null;
    selId = id;
    emit('select');
  }

  function shapePath(c, s, inset = 0) {
    const x = s.x + inset;
    const y = s.y + inset;
    const w = Math.max(0, s.w - inset * 2);
    const h = Math.max(0, s.h - inset * 2);
    c.beginPath();
    if (s.shape === 'circle') c.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    else if (s.shape === 'round') c.roundRect(x, y, w, h, Math.max(0, Math.min(s.radius - inset, w / 2, h / 2)));
    else c.rect(x, y, w, h);
  }

  function drawSource(s) {
    const m = media.get(s.id);
    if (!m || !ready(s) || s.w < 1 || s.h < 1) return;
    const n = natural(s);
    const sx = s.crop.l * n.w;
    const sy = s.crop.t * n.h;
    const sw = Math.max(1, n.w * (1 - s.crop.l - s.crop.r));
    const sh = Math.max(1, n.h * (1 - s.crop.t - s.crop.b));
    ctx.save();
    ctx.globalAlpha = s.opacity;
    if (s.shape !== 'rect') {
      shapePath(ctx, s);
      ctx.clip();
    }
    if (s.mirror) {
      ctx.translate(s.x + s.w, s.y);
      ctx.scale(-1, 1);
      ctx.drawImage(m.el, sx, sy, sw, sh, 0, 0, s.w, s.h);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    } else {
      ctx.drawImage(m.el, sx, sy, sw, sh, s.x, s.y, s.w, s.h);
    }
    ctx.restore();
    if (s.borderW > 0) {
      ctx.save();
      ctx.globalAlpha = s.opacity;
      ctx.lineWidth = s.borderW;
      ctx.strokeStyle = s.borderColor;
      shapePath(ctx, s, s.borderW / 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function draw() {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W(), H());
    for (const s of sources) if (s.visible) drawSource(s);
  }

  const HANDLES = [
    ['nw', 0, 0], ['n', 0.5, 0], ['ne', 1, 0], ['e', 1, 0.5],
    ['se', 1, 1], ['s', 0.5, 1], ['sw', 0, 1], ['w', 0, 0.5],
  ];
  const CURSOR = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };
  const scale = () => W() / (overlay.clientWidth || W()); // canvas px per screen px

  function drawOverlay() {
    const k = scale();
    octx.clearRect(0, 0, W(), H());
    for (const s of sources) {
      if (!s.visible || ready(s)) continue;
      octx.save();
      octx.setLineDash([10 * k, 8 * k]);
      octx.lineWidth = 1.5 * k;
      octx.strokeStyle = '#6b6b75';
      octx.fillStyle = '#16161acc';
      shapePath(octx, s);
      octx.fill();
      octx.stroke();
      octx.fillStyle = '#b9b9c2';
      octx.font = `600 ${13 * k}px "Segoe UI", sans-serif`;
      octx.textAlign = 'center';
      octx.textBaseline = 'middle';
      octx.fillText(s.type === 'phone' ? 'Waiting for phone' : 'Source offline', s.x + s.w / 2, s.y + s.h / 2);
      octx.restore();
    }
    octx.strokeStyle = '#ff4a3d';
    octx.lineWidth = 1 * k;
    for (const g of guides) {
      octx.beginPath();
      if (g.x != null) { octx.moveTo(g.x, 0); octx.lineTo(g.x, H()); }
      else { octx.moveTo(0, g.y); octx.lineTo(W(), g.y); }
      octx.stroke();
    }
    const s = selected();
    if (!s) return;
    const cropping = cropId === s.id && natural(s);
    const color = cropping ? '#ffb020' : '#ff4a3d';
    if (cropping) {
      // Ghost of the whole source, so you can see what the crop is hiding.
      const f = extents(s);
      const el = media.get(s.id).el;
      octx.save();
      octx.fillStyle = '#000000a6';
      octx.fillRect(0, 0, W(), H());
      octx.globalAlpha = 0.45;
      if (s.mirror) {
        octx.translate(f.x + f.w, f.y);
        octx.scale(-1, 1);
        octx.drawImage(el, 0, 0, f.w, f.h);
      } else {
        octx.drawImage(el, f.x, f.y, f.w, f.h);
      }
      octx.restore();
      octx.clearRect(s.x, s.y, s.w, s.h);
      octx.save();
      octx.setLineDash([6 * k, 6 * k]);
      octx.lineWidth = 1 * k;
      octx.strokeStyle = '#ffffff80';
      octx.strokeRect(f.x, f.y, f.w, f.h);
      octx.restore();
    }
    octx.lineWidth = 1.5 * k;
    octx.strokeStyle = color;
    octx.strokeRect(s.x, s.y, s.w, s.h);
    if (s.locked) return;
    const r = 5 * k;
    for (const [, fx, fy] of HANDLES) {
      octx.fillStyle = '#fff';
      octx.strokeStyle = color;
      octx.beginPath();
      octx.rect(s.x + s.w * fx - r, s.y + s.h * fy - r, r * 2, r * 2);
      octx.fill();
      octx.stroke();
    }
  }

  function point(e) {
    const k = scale();
    return { x: e.offsetX * k, y: e.offsetY * k };
  }

  function handleAt(p) {
    const s = selected();
    if (!s || s.locked) return null;
    const r = 9 * scale();
    for (const [name, fx, fy] of HANDLES) {
      if (Math.abs(p.x - (s.x + s.w * fx)) <= r && Math.abs(p.y - (s.y + s.h * fy)) <= r) return name;
    }
    return null;
  }

  function hit(p) {
    for (let i = sources.length - 1; i >= 0; i--) {
      const s = sources[i];
      if (s.visible && p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h) return s;
    }
    return null;
  }

  // Snap lines: the canvas edges, centre and margin, plus the edges, centre
  // and inner margin of every other visible source.
  function snapLines(self) {
    const xs = [0, W() / 2, W(), MARGIN, W() - MARGIN];
    const ys = [0, H() / 2, H(), MARGIN, H() - MARGIN];
    for (const o of sources) {
      if (o === self || !o.visible) continue;
      xs.push(o.x, o.x + o.w / 2, o.x + o.w, o.x + MARGIN, o.x + o.w - MARGIN);
      ys.push(o.y, o.y + o.h / 2, o.y + o.h, o.y + MARGIN, o.y + o.h - MARGIN);
    }
    return { x: xs, y: ys };
  }

  // Nearest snap line to any of the given positions, or null if none is close.
  function nearest(lines, positions) {
    const t = 8 * scale();
    let best = null;
    for (const pos of positions) {
      for (const line of lines) {
        const d = Math.abs(pos - line);
        if (d <= t && (!best || d < best.d)) best = { d, line, shift: line - pos };
      }
    }
    return best;
  }

  function moveTo(s, p, free) {
    let x = drag.o.x + (p.x - drag.p.x);
    let y = drag.o.y + (p.y - drag.p.y);
    guides = [];
    if (!free) {
      const lines = snapLines(s);
      const sx = nearest(lines.x, [x, x + s.w / 2, x + s.w]);
      const sy = nearest(lines.y, [y, y + s.h / 2, y + s.h]);
      if (sx) { x += sx.shift; guides.push({ x: sx.line }); }
      if (sy) { y += sy.shift; guides.push({ y: sy.line }); }
    }
    s.x = Math.round(x);
    s.y = Math.round(y);
  }

  // Crop mode: handles move the crop window over a source that stays put,
  // dragging inside the window slides it around.
  function cropDrag(s, p) {
    const o = drag.o;
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const f = extents(s, o);
    const fr = f.x + f.w;
    const fb = f.y + f.h;
    let l = o.x, t = o.y, r = o.x + o.w, b = o.y + o.h;
    if (!drag.handle) {
      const dx = clamp(p.x - drag.p.x, f.x - l, fr - r);
      const dy = clamp(p.y - drag.p.y, f.y - t, fb - b);
      l += dx; r += dx; t += dy; b += dy;
    } else {
      const h = drag.handle;
      if (h.includes('w')) l = clamp(p.x, f.x, r - MIN);
      if (h.includes('e')) r = clamp(p.x, l + MIN, fr);
      if (h.includes('n')) t = clamp(p.y, f.y, b - MIN);
      if (h.includes('s')) b = clamp(p.y, t + MIN, fb);
    }
    s.x = l; s.y = t; s.w = r - l; s.h = b - t;
    const left = Math.max(0, (l - f.x) / f.w);
    const rightCrop = Math.max(0, (fr - r) / f.w);
    s.crop.t = Math.max(0, (t - f.y) / f.h);
    s.crop.b = Math.max(0, (fb - b) / f.h);
    s.crop.l = s.mirror ? rightCrop : left;
    s.crop.r = s.mirror ? left : rightCrop;
  }

  function resizeCorner(s, p, free, ctrl) {
    const o = drag.o;
    const right = drag.handle.includes('e');
    const bottom = drag.handle.includes('s');
    const ax = right ? o.x : o.x + o.w;
    const ay = bottom ? o.y : o.y + o.h;
    let w = Math.max(MIN, right ? p.x - ax : ax - p.x);
    let h = Math.max(MIN, bottom ? p.y - ay : ay - p.y);
    const a = o.w / o.h;
    if (!free) {
      if (w / a > h) h = w / a;
      else w = h * a;
    }
    guides = [];
    if (!ctrl) {
      // Snap the edge being dragged; with the aspect locked the other follows.
      const lines = snapLines(s);
      const sx = nearest(lines.x, [right ? ax + w : ax - w]);
      const sy = nearest(lines.y, [bottom ? ay + h : ay - h]);
      if (sx && (free || !sy || sx.d <= sy.d)) {
        w = Math.max(MIN, Math.abs(sx.line - ax));
        if (!free) h = w / a;
        guides.push({ x: sx.line });
      }
      if (sy && (free || !sx || sy.d < sx.d)) {
        h = Math.max(MIN, Math.abs(sy.line - ay));
        if (!free) w = h * a;
        guides.push({ y: sy.line });
      }
    }
    s.w = Math.round(w);
    s.h = Math.round(h);
    s.x = right ? ax : ax - s.w;
    s.y = bottom ? ay : ay - s.h;
  }

  // Edge handles crop: pulling an edge in hides that side of the source,
  // pulling it back out reveals it again until the crop reaches zero.
  function cropEdge(s, p) {
    const o = drag.o;
    const hasMedia = !!natural(s);
    const h = drag.handle;
    if (h === 'e' || h === 'w') {
      const side = (h === 'e') !== s.mirror ? 'r' : 'l';
      const k = o.w / (1 - o.crop.l - o.crop.r);
      const max = hasMedia ? o.w + o.crop[side] * k : Infinity;
      const w = Math.min(max, Math.max(MIN, h === 'e' ? p.x - o.x : o.x + o.w - p.x));
      if (hasMedia) s.crop[side] = Math.max(0, o.crop[side] - (w - o.w) / k);
      s.w = w;
      if (h === 'w') s.x = o.x + o.w - w;
    } else {
      const side = h === 's' ? 'b' : 't';
      const k = o.h / (1 - o.crop.t - o.crop.b);
      const max = hasMedia ? o.h + o.crop[side] * k : Infinity;
      const hh = Math.min(max, Math.max(MIN, h === 's' ? p.y - o.y : o.y + o.h - p.y));
      if (hasMedia) s.crop[side] = Math.max(0, o.crop[side] - (hh - o.h) / k);
      s.h = hh;
      if (h === 'n') s.y = o.y + o.h - hh;
    }
  }

  overlay.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    overlay.focus();
    const p = point(e);
    let handle = handleAt(p);
    let s = selected();
    if (cropId && !handle && !(s && p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h)) setCropMode(null);
    if (!handle && !cropId) {
      s = hit(p);
      select(s ? s.id : null);
    }
    if (!s || s.locked) return;
    drag = { handle, p, crop: !!cropId, o: { x: s.x, y: s.y, w: s.w, h: s.h, crop: { ...s.crop } } };
    overlay.setPointerCapture(e.pointerId);
  });

  overlay.addEventListener('dblclick', (e) => {
    const s = hit(point(e));
    if (s && !s.locked) setCropMode(cropId === s.id ? null : s.id);
  });

  overlay.addEventListener('pointermove', (e) => {
    const p = point(e);
    const s = selected();
    if (!drag || !s) {
      const h = handleAt(p);
      overlay.style.cursor = h ? CURSOR[h] : hit(p) ? 'move' : 'default';
      return;
    }
    if (drag.crop) cropDrag(s, p);
    else if (!drag.handle) moveTo(s, p, e.ctrlKey);
    else if (drag.handle.length === 2) resizeCorner(s, p, e.shiftKey, e.ctrlKey);
    else cropEdge(s, p);
    emit('change');
  });

  const endDrag = () => {
    if (!drag) return;
    drag = null;
    guides = [];
    emit('change');
  };
  overlay.addEventListener('pointerup', endDrag);
  overlay.addEventListener('pointercancel', endDrag);

  overlay.addEventListener('keydown', (e) => {
    const s = selected();
    if (!s) return;
    const step = e.shiftKey ? 10 : 1;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key] && !s.locked) {
      s.x += moves[e.key][0];
      s.y += moves[e.key][1];
      emit('change');
      e.preventDefault();
    } else if (cropId && (e.key === 'Enter' || e.key === 'Escape')) {
      setCropMode(null);
    } else if (e.key === 'Delete') {
      remove(s.id);
    } else if (e.key === 'Escape') {
      select(null);
    }
  });

  function setSize(w, h) {
    const kx = w / W();
    const ky = h / H();
    canvas.width = overlay.width = w;
    canvas.height = overlay.height = h;
    for (const s of sources) {
      s.x *= kx; s.w *= kx;
      s.y *= ky; s.h *= ky;
      if (Math.abs(kx - ky) > 0.001 && natural(s)) {
        // Different canvas aspect: keep the source undistorted.
        const cx = s.x + s.w / 2;
        const cy = s.y + s.h / 2;
        s.h = s.w / croppedAspect(s);
        s.x = cx - s.w / 2;
        s.y = cy - s.h / 2;
      }
    }
    emit('size');
  }

  function load(list) {
    [...media.keys()].forEach(detach);
    sources = (list || []).map((s) => ({ ...s, crop: { ...s.crop } }));
    selId = null;
    emit('list');
  }

  return {
    canvas, overlay,
    on: (fn) => listeners.add(fn),
    emit,
    get, selected, select, add, remove, reorder, make, load,
    list: () => sources,
    serialize: () => sources.map((s) => ({ ...s, crop: { ...s.crop } })),
    attachStream, attachImage, detach, ready, natural,
    hasMedia: (id) => media.has(id),
    element: (id) => (media.get(id) || {}).el,
    fit, fill, center, corner, setShape, coverCrop, setCropAspect,
    setCropMode, cropping: () => cropId,
    setMargin: (v) => { MARGIN = v; },
    draw, drawOverlay, setSize,
    size: () => ({ w: W(), h: H() }),
  };
})();
