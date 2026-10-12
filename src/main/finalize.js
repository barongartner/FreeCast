'use strict';
// Turns the raw MediaRecorder capture into an editor-friendly MP4 and writes
// the marker sidecars (plain text list + DaVinci Resolve marker EDL).
const { spawn } = require('child_process');
const fs = require('fs');

const pad = (n, l = 2) => String(n).padStart(l, '0');

function hms(ms) {
  const s = Math.floor(ms / 1000);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

// Resolve timelines start at 01:00:00:00, so marker timecodes carry that hour.
function timecode(ms, fps, startHour = 1) {
  const frames = Math.round((ms / 1000) * fps);
  const s = Math.floor(frames / fps);
  return `${pad(Math.floor(s / 3600) + startHour)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${pad(frames % fps)}`;
}

function writeMarkerFiles(base, title, markers, fps) {
  if (!markers.length) return [];
  const txt = `${base} Markers.txt`;
  const edl = `${base} Markers.edl`;
  fs.writeFileSync(
    txt,
    markers.map((m) => `${hms(m.ms)}.${pad(Math.floor(m.ms % 1000), 3)}  ${m.title}`).join('\r\n') + '\r\n'
  );
  const frameMs = 1000 / fps;
  let out = `TITLE: ${title}\r\nFCM: NON-DROP FRAME\r\n\r\n`;
  markers.forEach((m, i) => {
    const a = timecode(m.ms, fps);
    const b = timecode(m.ms + frameMs, fps);
    out += `${pad(i + 1, 3)}  001      V     C        ${a} ${b} ${a} ${b}  \r\n`;
    out += ` |C:ResolveColor${m.color || 'Red'} |M:${m.title} |D:1\r\n\r\n`;
  });
  fs.writeFileSync(edl, out);
  return [txt, edl];
}

function chapterMeta(markers, durationMs) {
  const esc = (s) => String(s).replace(/([=;#\\\n])/g, '\\$1');
  const pts = markers.length && markers[0].ms <= 0 ? [...markers] : [{ ms: 0, title: 'Start' }, ...markers];
  let out = ';FFMETADATA1\n';
  pts.forEach((p, i) => {
    const end = i + 1 < pts.length ? pts[i + 1].ms : Math.max(durationMs, p.ms + 1);
    if (end <= p.ms) return;
    out += `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${Math.round(p.ms)}\nEND=${Math.round(end)}\ntitle=${esc(p.title)}\n`;
  });
  return out;
}

function finalize({ raw, out, markers, durationMs, fps, mode, crf = 18, audioKbps = 192, h264, onProgress }) {
  return new Promise((resolve) => {
    const args = ['-y', '-hide_banner', '-i', raw];
    let metaPath = null;
    if (markers.length) {
      metaPath = `${raw}.ffmeta`;
      fs.writeFileSync(metaPath, chapterMeta(markers, durationMs));
      args.push('-i', metaPath, '-map_metadata', '1', '-map_chapters', '1');
    }
    args.push('-map', '0:v:0', '-map', '0:a?');
    if (mode === 'fast' && h264) args.push('-c:v', 'copy');
    else args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-r', String(fps), '-fps_mode', 'cfr');
    args.push('-c:a', 'aac', '-b:a', `${audioKbps}k`, '-movflags', '+faststart', out);

    let tail = '';
    const done = (res) => {
      if (metaPath) fs.rmSync(metaPath, { force: true });
      resolve(res);
    };
    let ff;
    try {
      ff = spawn('ffmpeg', args, { windowsHide: true });
    } catch (err) {
      done({ ok: false, error: err.message });
      return;
    }
    ff.stderr.on('data', (d) => {
      const s = d.toString();
      tail = (tail + s).slice(-2000);
      const m = /time=(\d+):(\d+):(\d+\.\d+)/.exec(s);
      if (m && durationMs > 0) {
        const t = (+m[1] * 3600 + +m[2] * 60 + +m[3]) * 1000;
        onProgress(Math.min(1, t / durationMs));
      }
    });
    ff.on('error', (err) => done({ ok: false, error: `ffmpeg did not start: ${err.message}` }));
    ff.on('close', (code) => {
      if (code === 0 && fs.existsSync(out) && fs.statSync(out).size > 0) done({ ok: true });
      else done({ ok: false, error: tail.trim().split(/\r?\n/).slice(-3).join(' | ') || `ffmpeg exit ${code}` });
    });
  });
}

module.exports = { finalize, writeMarkerFiles };
