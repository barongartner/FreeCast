'use strict';
// Desktop end of the phone camera link. The phone makes the offer; signalling
// rides through the main process, media goes phone to PC directly over the LAN.
const Phone = (() => {
  const peers = new Map(); // phone id -> { pc, stream }
  let onChange = () => {};

  function current() {
    for (const p of peers.values()) if (p.stream && p.pc.connectionState === 'connected') return p;
    for (const p of peers.values()) if (p.stream) return p;
    return null;
  }

  function close(id) {
    const p = peers.get(id);
    if (!p) return;
    p.pc.onconnectionstatechange = null;
    p.pc.close();
    peers.delete(id);
    onChange();
  }

  async function offer(id, sdp) {
    close(id);
    const pc = new RTCPeerConnection({ iceServers: [] });
    const p = { pc, stream: null };
    peers.set(id, p);
    pc.onicecandidate = (e) => {
      if (e.candidate) window.api.signal(id, { type: 'candidate', candidate: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      try { e.receiver.playoutDelayHint = 0; } catch {}
      p.stream = e.streams[0] || new MediaStream([e.track]);
      onChange();
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') close(id);
      else onChange();
    };
    await pc.setRemoteDescription({ type: 'offer', sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    window.api.signal(id, { type: 'answer', sdp: answer.sdp });
  }

  window.api.onSignal(({ id, msg }) => {
    if (!msg) return;
    if (msg.type === 'offer') offer(id, msg.sdp).catch(() => close(id));
    else if (msg.type === 'candidate') {
      const p = peers.get(id);
      if (p) p.pc.addIceCandidate(msg.candidate).catch(() => {});
    } else if (msg.type === 'bye') close(id);
  });

  return {
    current,
    state() {
      const p = current();
      if (p) return p.pc.connectionState === 'connected' ? 'live' : 'wait';
      return peers.size ? 'wait' : 'off';
    },
    onChange(fn) { onChange = fn; },
  };
})();
