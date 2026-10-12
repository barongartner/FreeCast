'use strict';
// Sends the phone camera (or the whole scene) out as a PC webcam. Frames are
// drawn to a small canvas, converted to NV12 here, and handed to the main
// process, which writes them into the OBS Virtual Camera buffer.
const Vcam = (() => {
  const MAX = 1280;
  const FPS = 30;
  let on = false;
  let source = 'phone'; // phone | scene
  let size = '';
  let ready = false;
  let busy = false;
  let worker = null;
  let last = 0;
  let onError = () => {};

  const even = (n) => Math.max(2, Math.round(n / 2) * 2);

  // What to send this frame: an element plus the region of it to draw.
  function pick() {
    if (source === 'scene') {
      const { w, h } = Scene.size();
      const k = Math.min(1, MAX / Math.max(w, h));
      return { el: Scene.canvas, sx: 0, sy: 0, sw: w, sh: h, w: even(w * k), h: even(h * k), mirror: false };
    }
    const s = Scene.list().find((x) => (x.type === 'phone' || x.type === 'camera') && Scene.ready(x));
    if (!s) return null;
    const n = Scene.natural(s);
    const sw = n.w * (1 - s.crop.l - s.crop.r);
    const sh = n.h * (1 - s.crop.t - s.crop.b);
    const k = Math.min(1, MAX / Math.max(sw, sh));
    return { el: Scene.element(s.id), sx: n.w * s.crop.l, sy: n.h * s.crop.t, sw, sh, w: even(sw * k), h: even(sh * k), mirror: s.mirror };
  }

  // BT.709 limited range; chroma is taken from the top-left pixel of each 2x2.
  function toNv12(rgba, w, h, out) {
    let yi = 0;
    let ci = w * h;
    for (let y = 0; y < h; y++) {
      const chromaRow = (y & 1) === 0;
      let p = y * w * 4;
      for (let x = 0; x < w; x++, p += 4) {
        const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
        out[yi++] = ((47 * r + 157 * g + 16 * b + 128) >> 8) + 16;
        if (chromaRow && (x & 1) === 0) {
          out[ci++] = ((-26 * r - 87 * g + 112 * b + 128) >> 8) + 128;
          out[ci++] = ((112 * r - 102 * g - 10 * b + 128) >> 8) + 128;
        }
      }
    }
  }

  // The scale, pixel readback and colour conversion run in a worker. Done on
  // the page's own thread they take longer than a frame on this class of CPU,
  // the timer queue backs up, and the whole app stops responding. One frame is
  // in flight at a time; if the worker is still busy the next frame is skipped.
  function startWorker() {
    const body = `
      let cv = null, cx = null;
      ${toNv12.toString()}
      onmessage = (e) => {
        const { frame, p, w, h } = e.data;
        if (!cv || cv.width !== w || cv.height !== h) {
          cv = new OffscreenCanvas(w, h);
          cx = cv.getContext('2d', { willReadFrequently: true, alpha: false });
        }
        if (frame) {
          if (p.mirror) cx.setTransform(-1, 0, 0, 1, w, 0);
          cx.drawImage(frame, p.sx, p.sy, p.sw, p.sh, 0, 0, w, h);
          cx.setTransform(1, 0, 0, 1, 0, 0);
          frame.close();
        } else {
          cx.fillStyle = '#0e0e10';
          cx.fillRect(0, 0, w, h);
          cx.fillStyle = '#9a9aa3';
          cx.font = '600 34px "Segoe UI", sans-serif';
          cx.textAlign = 'center';
          cx.textBaseline = 'middle';
          cx.fillText('FreeCast: phone not connected', w / 2, h / 2);
        }
        const out = new Uint8Array((w * h * 3) / 2);
        toNv12(cx.getImageData(0, 0, w, h).data, w, h, out);
        postMessage({ out, w, h }, [out.buffer]);
      };`;
    worker = new Worker(URL.createObjectURL(new Blob([body], { type: 'text/javascript' })));
    worker.onmessage = (e) => {
      busy = false;
      if (on && ready && size === `${e.data.w}x${e.data.h}`) window.api.vcamFrame(e.data.out);
    };
    worker.onerror = () => { busy = false; };
  }

  async function resize(w, h) {
    size = `${w}x${h}`;
    ready = false;
    const r = await window.api.vcamStart({ w, h, fps: FPS });
    if (r.error) {
      on = false;
      size = '';
      onError(r.error);
      return;
    }
    ready = size === `${w}x${h}`;
  }

  function tick() {
    if (!on) return;
    const now = performance.now();
    if (now - last < 1000 / FPS - 4) return;
    last = now;
    const p = pick();
    const w = p ? p.w : MAX;
    const h = p ? p.h : 720;
    if (size !== `${w}x${h}`) {
      resize(w, h);
      return;
    }
    if (!ready || busy) return;
    if (!worker) startWorker();
    let frame = null;
    if (p) {
      try {
        frame = new VideoFrame(p.el, { timestamp: Math.round(now * 1000) });
      } catch {
        return; // no picture available this instant
      }
    }
    busy = true;
    const info = p ? { sx: p.sx, sy: p.sy, sw: p.sw, sh: p.sh, mirror: p.mirror } : null;
    worker.postMessage({ frame, p: info, w, h }, frame ? [frame] : []);
  }

  function set(enabled) {
    on = enabled;
    size = '';
    ready = false;
    busy = false;
    if (!enabled) window.api.vcamStop();
  }

  return {
    tick,
    set,
    isOn: () => on,
    setSource(v) { source = v; },
    onError(fn) { onError = fn; },
  };
})();
