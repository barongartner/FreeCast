'use strict';
// Audio mixer: mic, system audio (WASAPI loopback) and phone mic, each through
// its own delay and gain into one recording destination.
const Mixer = (() => {
  const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
  const dest = ctx.createMediaStreamDestination();
  const chans = {};

  // A silent source keeps the audio track flowing when nothing is connected,
  // which keeps the recorder's audio and video clocks together.
  const keep = ctx.createConstantSource();
  const mute = ctx.createGain();
  mute.gain.value = 0;
  keep.connect(mute).connect(dest);
  keep.start();

  for (const key of ['mic', 'system', 'phone']) {
    const delay = ctx.createDelay(2);
    const gain = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    delay.connect(gain);
    gain.connect(dest);
    gain.connect(analyser);
    chans[key] = { delay, gain, analyser, node: null, stream: null, buf: new Float32Array(1024) };
  }

  function setStream(key, stream) {
    const c = chans[key];
    if (c.node) c.node.disconnect();
    if (c.stream && c.stream !== stream) c.stream.getTracks().forEach((t) => t.stop());
    c.node = null;
    c.stream = stream || null;
    if (stream && stream.getAudioTracks().length) {
      c.node = ctx.createMediaStreamSource(stream);
      c.node.connect(c.delay);
    }
    ctx.resume();
  }

  function setGain(key, value) {
    chans[key].gain.gain.value = value;
  }

  function setDelay(key, ms) {
    chans[key].delay.delayTime.value = Math.max(0, Math.min(2, ms / 1000));
  }

  function level(key) {
    const c = chans[key];
    if (!c.node) return 0;
    c.analyser.getFloatTimeDomainData(c.buf);
    let peak = 0;
    for (let i = 0; i < c.buf.length; i++) peak = Math.max(peak, Math.abs(c.buf[i]));
    return peak;
  }

  return { ctx, stream: dest.stream, setStream, setGain, setDelay, level, has: (key) => !!chans[key].node };
})();
