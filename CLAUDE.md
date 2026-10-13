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

## Look

Apple glass, per Baron's playbook (memory `feedback_apple_gui_playbook.md`, numbers in
`Documents\Claude\Misc\iOS 27 Kit Rules.md`, working example in `Documents\Photo Larp`).

- Panels are `.glass` over a plain dark window with `#ambient`, a blurred copy of the scene,
  behind them. No colour gradient: Baron had the drifting colour orbs removed on Oct 12.
- Corners are concentric: window radius 34 (the kit's Window), panels inset by `--edge` with
  radius `--radius` minus `--edge`. Change them together or the two curves stop matching.
- Minimise and restore play the genie on `src/renderer/genie.html`, an overlay window; zoom
  glides. Both are in `main.js`. Never use `setOpacity` or `setIgnoreMouseEvents` on the main
  window to hide it: either makes it a layered window and it starts showing up in recordings.
- `FREECAST_DEMO=1` (with `FREECAST_PROFILE` and `FREECAST_NO_PROTECT=1`) runs minimise,
  restore, zoom and unzoom by itself and quits. Film it with
  `ffmpeg -f gdigrab -framerate 60 -t 8 -i desktop` and read the frames. A window that seems to
  vanish after a scripted restore is usually just behind Baron's foreground app.
- `FREECAST_SHOT=<file.png>` with `FREECAST_PROFILE=<scratch dir>` saves a picture of the window
  and quits. Use it to check the look; it does not flash the selftest counter on his screen.
- The main window is frameless and transparent. The page clips itself to a 26 px rounded shape,
  draws the traffic lights, and has its own drag strip and resize grips. Zoom is done by hand in
  `main.js` (`toggleZoom`). After touching any of it, check zoom, restore, minimise, focus away
  and back, drag, and every edge. The selftest covers zoom and restore only.
- Capture exclusion still has to hold. The selftest proves it: FreeCast must not appear in the
  frames of its own recording.
- Do not name a body class after a component class. `body.rec` once inherited the Record
  button's styles and painted the whole window red.
- Accent is `#0088ff`. Red is for recording only.

## House rules

- ASCII only in repo files. No em dashes or en dashes; use the punctuation the sentence needs.
- Use the Edit tool on existing files. No scripted rewrites of source.
- npm and Electron caches live on F: because C: is nearly full. Before any install:
  `export npm_config_cache=F:/Space/npm-cache ELECTRON_CACHE=F:/Space/electron-cache`
- Recordings default to `F:\Space\FreeCast`. Intermediates (`*.raw.mkv`) are deleted once the
  MP4 is finalized.

## Profile and logs

Settings, the phone certificate and `freecast.log` live in `C:\Users\baron\.freecast`. Not in
AppData: a process started from a packaged app (the Claude desktop app is one) gets its AppData
writes redirected into the package's private storage, which gave FreeCast two profiles and made
settings look like they never saved. Read `freecast.log` first when Baron reports a crash.

Set `FREECAST_PROFILE` to a scratch folder to run a second copy next to the real one. Do not
start the real app from a Claude session to "check" settings without that variable unless Baron
asked for a relaunch.

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
| `src/main/vcam.js` | Writes NV12 frames into the OBS Virtual Camera shared-memory queue (koffi, kernel32) |
| `src/renderer/vcam.js` | Picks phone camera or scene, converts to NV12 in a worker, hands frames to main |
| `src/renderer/ui.js` | DOM helper, in-page dropdown, segmented control, grouped rows, colour swatches, key combo capture |
| `src/renderer/apple.css` | The whole look: glass panels, Mac window chrome, kit-sized controls |
| `src/renderer/app.js` | UI wiring, settings, selftest driver |
| `src/phone/phone.html` | The page the phone opens from the QR code |
| `assets/*.svg` | Logo sources: `logo` (mark), `icon` and `icon-small` (app tile), `lockup` (mark plus wordmark), `-dark` variants for light backgrounds |
| `assets/github/` | GitHub-facing images: README lockups for light and dark themes, and `social-preview.png` (1280x640, uploaded by hand under repo Settings, Social preview) |
| `tools/build-icons.js` | Rebuilds every PNG and `icon.ico` from the SVGs: `npx electron tools/build-icons.js` |

## Verifying

`npm run selftest` records about 8 seconds with a second circular source, minimizes the window
mid-take, fires both marker types, finalizes, and prints a `SELFTEST {...}` line. It writes to
`F:\Space\FreeCast\Selftest`; probe the MP4 and pull frames from it, then delete the folder.
ffmpeg exits 0 on broken output, so always look at frames. The selftest does not cover the
phone link; that needs the real phone.
