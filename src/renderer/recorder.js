'use strict';
// Records the composited canvas plus the mixed audio. Chunks stream to disk
// through the main process every second, so a crash loses a second, not a take.
const Recorder = (() => {
  const TYPES = [
    ['video/x-matroska;codecs=avc1,opus', 'mkv'],
    ['video/webm;codecs=h264,opus', 'webm'],
    ['video/webm;codecs=vp9,opus', 'webm'],
    ['video/webm;codecs=vp8,opus', 'webm'],
  ];
  let rec = null;
  let t0 = 0;
  let writes = Promise.resolve();
  let state = 'idle'; // idle | starting | recording | finalizing
  let onState = () => {};

  const set = (s, extra) => {
    state = s;
    onState(s, extra);
  };

  async function start({ fps, bitrateMbps }) {
    if (state !== 'idle') return;
    set('starting');
    const [mime, ext] = TYPES.find(([m]) => MediaRecorder.isTypeSupported(m)) || [];
    if (!mime) return set('idle', { error: 'No supported recording format.' });
    const info = await window.api.recStart({ ext });
    if (info.error) return set('idle', { error: info.error });

    const video = Scene.canvas.captureStream(fps).getVideoTracks()[0];
    const stream = new MediaStream([video, ...Mixer.stream.getAudioTracks()]);
    rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrateMbps * 1e6, audioBitsPerSecond: 192000 });
    writes = Promise.resolve();
    rec.ondataavailable = (e) => {
      if (!e.data.size) return;
      writes = writes.then(async () => window.api.recChunk(await e.data.arrayBuffer()));
    };
    rec.onstart = () => {
      t0 = Date.now();
      window.api.recStarted(t0);
      set('recording', { name: info.name });
    };
    rec.onstop = async () => {
      const durationMs = Date.now() - t0;
      video.stop();
      set('finalizing', { name: info.name });
      await writes;
      const result = await window.api.recStop({ durationMs, fps, h264: /avc1|h264/.test(mime) });
      rec = null;
      set('idle', { result: { ...result, durationMs, mime } });
    };
    rec.onerror = (e) => console.error('recorder error', e.error);
    rec.start(1000);
  }

  function stop() {
    if (state === 'recording' && rec) rec.stop();
  }

  return {
    start,
    stop,
    toggle: (opts) => (state === 'recording' ? stop() : start(opts)),
    state: () => state,
    elapsed: () => (state === 'recording' ? Date.now() - t0 : 0),
    onState(fn) { onState = fn; },
  };
})();
