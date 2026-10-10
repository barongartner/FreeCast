# Repo opened, first working recorder - Saturday Oct 10

*Time worked: 14m (4:36 PM to 4:50 PM)*

## Timeline

**4:36 PM - Baron asked for a new repo: a full screen recorder for devlogs.**
The brief, in his words: no webcam, so the phone is the camera. PC is on wired LAN, phone is
on Wi-Fi. Something self-hosted (mini app or website), scan a QR code, phone connects and
becomes the face cam. OBS-style sources so he can line up what gets recorded and where the
face cam sits. A keybind while recording that leaves a marker in the video for spots that
need cutting or editing. Keep a JOURNAL.md like Laneway.

Named it FreeCast, in the family with FreeFlow and FreeVoice. Repo at
`C:\Users\baron\Documents\FreeCast`.

**4:41 PM - Stack picked: Electron.**
A plain browser page cannot hold a global hotkey, and the marker key has to work while he is
in his editor or a game, not in the recorder. Electron gives global shortcuts, screen capture
without a picker, and a window that can be excluded from capture. Toolchain on the PC: Node
24.14.1, npm 11.11.0, ffmpeg 8.1. C: had 12 GB free, so the npm and Electron caches went to
`F:\Space\npm-cache` and `F:\Space\electron-cache`. Electron 38.8.6 installed.

**4:41 PM to 4:47 PM - Wrote the app.**

- `src/main/server.js` - HTTPS server on port 8443 with a self-signed certificate (the phone
  camera API only works on a secure page). Serves the phone page and relays WebRTC signalling.
  Signalling is long-poll over fetch, not a WebSocket: iOS Safari refuses a WebSocket to a
  self-signed host even after the page warning is accepted. A random token in the QR URL gates
  every request. Certificate is valid 800 days because iOS rejects anything over 825.
- `src/phone/phone.html` - the page the phone opens. Start camera, flip front and back, 720p
  or 1080p, optional phone mic, wake lock, automatic reconnect when the PC app restarts.
- `src/renderer/scene.js` - sources drawn bottom to top onto a 1920x1080 canvas. Source types:
  screen, window, phone camera, webcam or capture card, image. Editor on a separate overlay
  canvas so handles never get recorded. Corner handles scale (Shift frees the aspect), edge
  handles crop, moves snap to edges, centre and a 40 px margin (Ctrl disables snapping). Shapes:
  rectangle, rounded, circle. Border, opacity, mirror, lock, z-order.
- `src/renderer/audio.js` - mixer for mic, desktop audio (loopback) and phone mic, each with
  gain, a level meter, and a delay on the mic for lip sync against the phone video.
- `src/renderer/recorder.js` - MediaRecorder on the canvas stream, H.264 in Matroska, one
  chunk per second written straight to disk through the main process.
- `src/main/finalize.js` - ffmpeg pass to constant frame rate MP4 with chapters at each marker,
  plus `Name Markers.txt` and `Name Markers.edl` (Resolve timeline marker format).
- `src/main/main.js` - windows, settings in userData, global hotkeys, recording file IO, and a
  small always-on-top timer window that flashes when a marker lands.

Hotkey defaults: Ctrl+Alt+R record, Ctrl+Alt+C show or hide cam, Ctrl+Alt+X "Cut" marker,
Ctrl+Alt+F "Fix" marker. Marker keys are registered only while recording.

**4:47 PM - First selftest passed, two bugs found in the frames.**
`npm run selftest` records 8 seconds, minimizes the window mid-take, fires both markers and
finalizes. Output was a valid 1920x1080 30 fps MP4 with three chapters and both sidecars.
Bugs seen in the captured UI and frames:

1. The recording timer window showed up in the recording. Content protection did not apply to
   it. Cause: it was set while the window was hidden, and the window was click-through, which
   makes it a layered window. Fix: apply protection after showing it and drop click-through.
2. The Properties panel printed the word "null" where the radius slider is hidden.

Also fixed: the mic dropdown showed "None" while the setting was "default" when no input
device was plugged in. "System default" is now always an option.

**4:49 PM - Second selftest, verified with an on-screen counter.**
Added a fast counter window to the selftest so frames prove capture kept moving. Frames at
1.0, 3.0, 4.5 and 6.5 seconds read 31, 51, 66 and 86 (tenths of a second), so timing is exact
and capture did not stall during the 4.5 seconds the window was minimized. The timer window no
longer appears in the recording. Phone server tested on 10.0.0.249: page serves, bad token gets
403, an offer posted by a fake phone reaches the app side and the answer comes back on the poll.

## Decisions

| Decision | Rationale |
|---|---|
| Electron, not a browser tab | Global hotkeys while another app has focus; capture exclusion for the app's own windows |
| Phone link is WebRTC over the LAN, signalling by long-poll | Low latency, nothing leaves the network, works on iOS Safari with a self-signed cert |
| Record with MediaRecorder, finalize with ffmpeg | The scene is composited in a canvas already; ffmpeg turns the variable frame rate capture into something editors like |
| Markers as chapters plus text plus Resolve EDL | Chapters travel inside the file; the EDL puts coloured markers on a Resolve timeline |
| Recordings default to `F:\Space\FreeCast` | C: is 96 percent full; a 1080p take is several GB per hour |
| Caches on F: | Same reason |

## Open

- **Phone link is untested on the real phone.** Server, page and signalling relay are tested;
  the camera stream itself needs Baron's iPhone. Expect a Windows Firewall prompt on first
  launch (allow on private networks) and a certificate warning on the phone.
- **Lip sync.** Phone video arrives roughly 100 to 200 ms after the mic. There is a mic delay
  setting; the right value has to be found by clapping on camera.
- **No pause.** Stop and start a new take for now.
- **One scene.** No scene switching yet, only show or hide cam on a hotkey.
- **No packaged build.** Runs from source with `npm start` or `Start FreeCast.cmd`.
- **Which editor he cuts in is unknown.** The EDL targets Resolve; other editors would need
  their own marker format.
- **No GitHub remote yet.** Local repo only.
