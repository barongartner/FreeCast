# FreeCast working context

Free screen recorder for devlogs. Electron app: OBS-style scene layout, phone as a wireless
face cam over the LAN (QR code, self-hosted, no account), global hotkeys that drop edit
markers into the recording.

## Journal

- JOURNAL.md is Baron's way of keeping different Claude sessions up to date and concurrent.
- **EVERYTHING** is to be documented properly and thoroughly.
- Include everything we make, code, and issues over our full time
- Every session, as you work, update the Journal, once a session is started, start a new heading with the date and brief title that is dynamically updated as we work, as well as time worked (I am most likely to drop sessions at my own will, so track time worked as *time from first prompt* to *time to most recent prompt* (and is updated as each prompt is sent)).
- Basically, it should include a summarized timeline of every prompt sent, and a chronological story.

Read JOURNAL.md at the start of every session, before anything else.

Entry format: one `#` per session, `# [Title] - Friday Aug 7`, with
`*Time worked: 1h 21m (9:36 PM to 10:57 PM)*` in italics directly under it. Then a
`## Timeline` of `**9:36 PM - What happened.**` blocks. Dates are spelled out with the
weekday, times are 12-hour with AM/PM. Update the title and time on every prompt. Close with
Decisions and Open sections.

Run `date` before writing any timestamp and never estimate one:

```bash
date '+%A %b %-d'
date '+%-I:%M %p'
```

## House rules

- ASCII only in repo files. No em dashes or en dashes; use the punctuation the sentence needs.
- Use the Edit tool on existing files. No scripted rewrites of source.
- npm and Electron caches live on F: because C: is nearly full. Before any install:
  `export npm_config_cache=F:/Space/npm-cache ELECTRON_CACHE=F:/Space/electron-cache`
- Recordings default to `F:\Space\FreeCast`. Intermediates (`*.raw.mkv`) are deleted once the
  MP4 is finalized.

## Layout

| Path | What |
|---|---|
| `src/main/main.js` | Electron main: windows, settings, global hotkeys, recording file IO |
| `src/main/server.js` | HTTPS server for the phone page plus the long-poll signalling relay |
| `src/main/finalize.js` | ffmpeg pass to MP4, chapter metadata, marker sidecars |
| `src/renderer/scene.js` | Sources, compositing, the on-canvas editor |
| `src/renderer/audio.js` | Mixer: mic, desktop audio, phone mic |
| `src/renderer/phone.js` | Desktop end of the WebRTC link |
| `src/renderer/recorder.js` | MediaRecorder on the canvas, chunks streamed to disk |
| `src/renderer/app.js` | UI wiring, settings, selftest driver |
| `src/phone/phone.html` | The page the phone opens from the QR code |

## Verifying

`npm run selftest` records about 8 seconds with a second circular source, minimizes the window
mid-take, fires both marker types, finalizes, and prints a `SELFTEST {...}` line. It writes to
`F:\Space\FreeCast\Selftest`; probe the MP4 and pull frames from it, then delete the folder.
ffmpeg exits 0 on broken output, so always look at frames. The selftest does not cover the
phone link; that needs the real phone.
