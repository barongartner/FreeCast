# Repo opened, first working recorder, first round of feedback - Saturday Oct 10

*Time worked: 30m (4:36 PM to 5:06 PM)*

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

**4:58 PM - Baron recorded a take and sent a screenshot: a dropdown list showed up in the video.**
The Shape dropdown's list was floating in his recording with no FreeCast window around it.
Cause: a native `<select>` list is its own OS window, and capture exclusion is set per window,
so the main window was hidden and its popup was not. Same goes for the native colour dialog and
for tooltips. Fix: `src/renderer/ui.js` with a dropdown and a colour swatch row built from plain
elements inside the page, every `<select>` and `<input type="color">` replaced, every `title`
tooltip removed. File and folder dialogs are still native and will show if opened mid-take.

Same message, five more asks:

- **More keybinds, fully customizable.** Hotkeys are now a flat map of action id to key in
  settings, registered generically in main. Actions: record, show or hide the app window, cam
  cycle / corner / full / off / show-hide / toggle full / next corner / four direct corners,
  next / previous monitor and monitor 1 to 3, mic mute, desktop audio, phone mic. Marker types
  can be added and removed. Any source can get its own show or hide key (Properties, or the
  bottom of Settings). Key capture takes function, numpad and navigation keys on their own and
  anything else with Ctrl, Alt, Shift or Win. While a key box is listening, all global bindings
  are released, because Windows swallows a bound combo before the app can see it.
- **Use the iPhone's mic.** The phone page now always sends its mic (asks for camera and mic
  together, falls back to video only if refused). Tick Phone mic in the Audio panel to mix it
  in. It travels in the same stream as the video, so it is in sync with the picture without the
  mic delay setting. The Mic button on the phone is now a mute.
- **Custom crop for the camera.** Crop mode: double-click a source or press Crop on canvas. The
  whole source shows dimmed, with a crop window you resize by any handle or slide around. Also
  aspect presets (None, 16:9, 4:3, 1:1, 9:16) and L/R/T/B percent fields.
- **"Snap-to guides on the screen recording don't work."** My reading: he dragged the cam next
  to the letterboxed screen source and nothing snapped, because snapping only knew about the
  canvas. Sources now snap to the edges and centre of every other visible source, corner resize
  snaps too, and the red guide lines show for both.
- **Keybind to change monitor.** Next / previous / direct. Swaps the capture on the selected
  screen source (or the first one) and refits it only if the new monitor has a different shape.

**Between 4:58 PM and 5:06 PM - More asks while that was in progress.**

- **"TL TR BL BR don't put it in the corner."** They left a fixed 40 px gap. The gap is now a
  setting, Corner margin, default 0, so the buttons and keys go flush.
- **One key for cam full screen / corner / off, corner changeable.** Cam modes: corner, full
  (fills the canvas; the corner box is remembered in `home` and restored), off. Default
  Ctrl+Alt+V cycles them.
- **A status box on the monitor that is not in the video and moves when the mouse reaches it.**
  The recording timer window became an always-on status box: Ready or the running time, marker
  count, mic state, cam mode, and a short note whenever a hotkey fires. It jumps to the other
  side of the screen when the cursor gets within 16 px and goes home when the cursor leaves.
  Show always / only while recording / off, and the home corner, are settings.
- **"Where the hell is the repo."** It was local only. Pushed to GitHub as a private repo.
- **"Can it do livestreams to Instagram."** Not yet. Instagram Live Producer takes RTMP with a
  stream key, and ffmpeg can push the canvas there. Parked until he says go.

**5:06 PM - Selftest extended and passing.**
The selftest now also screenshots crop mode, cam full screen, the Settings sheet with a dropdown
open, the key list, and the status box, and wipes its own settings first so runs do not pile up
sources. Recording still verifies: 1080p, 30 fps, chapters, status box absent from the frames.
Not tested: every hotkey action fired from the keyboard, monitor switching (this PC has one
display), and anything involving the real phone.

## Decisions

| Decision | Rationale |
|---|---|
| No native popups anywhere in the UI | Popup windows escape capture exclusion and end up in the video |
| Status box dodges the mouse, not click-through | A click-through window is a layered window, and capture exclusion does not stick to those on Windows 10 |
| Phone mic always sent, mixed on the PC side | One permission prompt on the phone, and the PC decides what gets recorded |
| Corner margin defaults to 0 | "Corner" should mean the corner |
| Electron, not a browser tab | Global hotkeys while another app has focus; capture exclusion for the app's own windows |
| Phone link is WebRTC over the LAN, signalling by long-poll | Low latency, nothing leaves the network, works on iOS Safari with a self-signed cert |
| Record with MediaRecorder, finalize with ffmpeg | The scene is composited in a canvas already; ffmpeg turns the variable frame rate capture into something editors like |
| Markers as chapters plus text plus Resolve EDL | Chapters travel inside the file; the EDL puts coloured markers on a Resolve timeline |
| Recordings default to `F:\Space\FreeCast` | C: is 96 percent full; a 1080p take is several GB per hour |
| Caches on F: | Same reason |

## Open

- **Phone link is untested on the real phone.** Server, page and signalling relay are tested;
  the camera stream, the phone mic, and whether iOS allows the mic prompt alongside the camera
  prompt all need Baron's iPhone. Expect a Windows Firewall prompt on first launch (allow on
  private networks) and a certificate warning on the phone.
- **Lip sync with the PC mic.** Phone video arrives roughly 100 to 200 ms after the PC mic.
  There is a mic delay setting. Using the phone mic sidesteps it.
- **Instagram live.** Asked about, not built. RTMP push through ffmpeg; needs a professional
  Instagram account and a stream key per broadcast.
- **Monitor switching is untested.** One display on this PC.
- **Snap reading unconfirmed.** If "snap-to guides don't work" meant something else, redo it.
- **Source keys outlive their source.** Removing a source leaves its key in settings.
- **No pause.** Stop and start a new take for now.
- **One scene.** Cam modes and per-source keys cover most of it; no full scene switching.
- **No packaged build.** Runs from source with `npm start` or `Start FreeCast.cmd`.
- **Which editor he cuts in is unknown.** The EDL targets Resolve; other editors would need
  their own marker format.
