# Settings that would not stick, more options, the Apple look - Monday Oct 12

*Time worked: 3h 3m (5:26 PM to 8:29 PM)*

## Timeline

**5:26 PM - "Settings aren't persistent."**
True, and not for the reason I first went looking for. The save code worked. The app had two
profiles. Electron keeps settings under `%APPDATA%\FreeCast`. The Claude desktop app is an MSIX
package, and Windows redirects AppData writes made by anything started from inside a packaged
app into that package's private storage
(`%LOCALAPPDATA%\Packages\Claude_...\LocalCache\Roaming\FreeCast`). So every copy of FreeCast I
launched from a Claude session read and wrote one settings file, and every copy Baron launched
himself read and wrote another. Whatever he set up in one was missing in the other.

How it was found: the settings file I could see had not been touched since my last launch the
day before, although his copy had been running since 5:25 PM and writes at startup. A second
copy on a scratch profile wrote its file fine, the disk was not full, the file was writable.
Then the redirected folder turned up under Packages.

Fix: the profile now lives in `C:\Users\baron\.freecast`, which is not redirected, so there is
one profile however the app is started. On first run it copies over whichever old
`settings.json` was saved most recently, plus the phone certificate next to it. Settings are
also flushed synchronously when the window closes and when the app quits; before, a change made
in the last 200 to 400 ms before closing was lost.

I did not relaunch the app after this fix, on purpose. From inside a Claude session the old real
profile is hidden behind the redirected copy, so a launch from here would migrate the stale
one. Baron has to open it himself the first time.

**Between 5:26 PM and 5:32 PM - "Also it just crashed."**
Unexplained. The app's processes were all still alive and responding when I looked, the take he
had running (Recording 2) had finalized, and Windows logged nothing. There was no log to read
because FreeCast did not keep one. It does now: `freecast.log` in the profile folder records
main-process exceptions, a renderer or GPU process dying, page errors, and failed settings or
recording writes. Next crash leaves evidence. Need from Baron: what it looked like.

**Between 5:26 PM and 5:32 PM - "Add more framerate options and everything."**

- Frame rate: 15, 20, 24, 25, 30, 48, 50, 60, 75, 90, 120, 144. Changing it reopens the capture
  sources, since they are opened at a rate.
- Canvas: 720p, 900p, 1080p, 1440p, 4K, two 16:10 sizes, two ultrawides, two verticals, 4:5,
  square, and a custom width and height.
- Capture bitrate: 2 to 100 Mbps.
- New: finished quality (x264 CRF 12 to 28) and audio bitrate (96 to 320 kbps).
- Phone page: 480p to 4K, 24/30/60 fps, upload bitrate scaled to the resolution, and the phone
  remembers its own quality, rate, camera and mic mute between visits.

**Between 5:26 PM and 5:32 PM - "And custom output file paths."**
The folder field can be typed or pasted into, not only browsed. The file name is a pattern:
`{n}` counter, `{date}` (Oct 12), `{isodate}` (2026-10-12), `{time}` (5-26 PM), and a slash
makes a subfolder, so `{date}/Devlog {n}` works. A pattern with no tokens gets a counter, which
keeps the old "Recording 1, Recording 2" behaviour. Settings shows the full path of the next
file as you type.

**5:32 PM - Checked.**
Selftest passes on the new build and its log is empty. The name pattern was run against the real
recordings folder: "Recording" gives Recording 4, "{date}/Devlog {n}" gives Oct 12/Devlog 1,
illegal characters are stripped. Looked at the Settings sheet in a screenshot. Not tested: the
migration itself (it only runs for real on Baron's first launch), frame rates above 30 in an
actual take, and the phone options.

**8:18 PM - Relayed from the Photo Larp session: redo the GUI in the Apple look.**
Not typed here by Baron. The Photo Larp session passed on his words, "tell the remote control
claude code chat to update it", said right after the Apple GUI playbook was saved. Both of us
read "it" as FreeCast's interface. The app was not running, so nothing of his was restarted.

Read first: the playbook, the Photo Larp retrospective, Photo Larp's stylesheet, and the kit
rules for text styles, colours, lists, menus, segmented controls, sliders, toggles and windows.
I did not open the Figma pages in his Chrome. The components here are the ones Photo Larp
already matched against the kit and he approved, carried over, plus kit numbers for the rest.

What changed:

- **`src/renderer/apple.css`** replaces `styles.css`. Glass panels with a bright rim, over three
  drifting colour orbs and a blurred live copy of the scene. Left panel, right inspector, a top
  capsule (logo, phone status, Settings) and a bottom capsule (Record, timer, markers).
- **Controls:** capsule buttons, grouped rows with hairline separators, toggle switches in place
  of checkboxes, sliders with a filled track and a pill knob, pop-up buttons with up and down
  chevrons, menus as glass popovers with a tick on the current item and a blue highlight, a
  sliding segmented control for the source shape, sheets with a blurred scrim and a Done button.
- **Colour:** accent blue `#0088ff` for selection, focus, sliders and primary buttons; green for
  switches; red kept for recording. Selection handles on the canvas are blue, guides yellow.
- **Window:** frameless and transparent with 26 px corners, Mac traffic lights (x, bar, split
  square, dark shade of each colour on hover, grey when the window is not focused), a drag strip
  across the top, grips on every edge and corner. Zoom fills the work area and returns to the
  exact old bounds. Window position and size are now remembered.
- **Phone page:** glass capsule controls and a blue Start button.
- The status box was left as it is: he asked for that navy box specifically.

Problems on the way:

1. The first screenshot was a solid red window. I had put a `rec` class on `body` to pause the
   backdrop while recording, and `.rec` is the Record button's class, so the body took the
   button's red gradient and 42 px height. Renamed to `recording`.
2. Dropdown menus opened behind the Settings sheet. Raised above it.
3. The backdrop was nearly black, so the glass read as grey. Orbs turned up, and the scene copy
   is blended on top instead of replacing them.

The risk I checked before anything else: capture exclusion on a transparent window. Earlier it
failed to stick on a click-through window. It holds here: the selftest's recording does not
contain FreeCast.

**8:26 PM - Checked.**
Selftest passes: recording fine, zoom fills the work area, restore returns the exact bounds,
log empty. Looked at the main window, Settings with a menu open, and a real desktop grab of a
debug copy with the corner enlarged: the corner is smooth, not stepped. Not tested by hand:
dragging the window, the eight resize grips, minimise from the yellow light, snapping to screen
edges, and how the blur costs frames during a real take on this GPU.

**Between 8:26 PM and 8:29 PM - "Get rid of gradient background", then a small screenshot of
the window's top-left corner with no words.**
The gradient: the three drifting colour orbs are removed, markup and styles both. Behind the
panels is now a plain dark window with only the soft blurred copy of the scene. The gradient I
had put on the phone's start screen went too.

The corner screenshot: my reading is that the two curves did not match. The window corner was
radius 26 and the panel inside it radius 30 at a 14 px inset, so the gap between them swelled
through the bend. Now the window is radius 34 (the kit's Window component), panels sit 10 px in
with radius 24, and the curves are concentric. Checked on an enlarged capture. If the complaint
was something else in that crop (the thin rim line, the light's position), it is still open.

Added `FREECAST_SHOT`, a debug switch that saves a picture of the window and quits, so looks
can be checked without running the selftest and flashing its counter on his monitor.

## Decisions

| Decision | Rationale |
|---|---|
| No colour gradient behind the glass | Baron's call, the same evening it went in |
| Window radius 34, panels 24 at a 10 px inset | Concentric corners; 34 is the kit's window radius |
| Apple glass look, components carried from Photo Larp | Baron's playbook; those components were already matched to the kit and approved |
| Transparent frameless window, zoom done by hand | Rounded corners need transparency; maximising a transparent window is unreliable on Windows |
| Backdrop holds still while recording | A moving backdrop re-renders every blur each frame, on the same GPU that is compositing the take |
| Status box left navy and square | He specified it two days ago; a rounded one needs a transparent window, and that window has to stay out of the capture |
| Profile in `~\.freecast`, not AppData | AppData is redirected for processes started from a packaged app; two profiles is how settings "did not save" |
| Keep a log file | A crash with nothing written down cannot be diagnosed |
| File names are a pattern with tokens | Covers dated folders and custom names without a save dialog per take |

## Open

- **Window handling needs his hands.** Drag, the eight grips, minimise, snap. If native snap to
  screen edges misbehaves on the transparent window, that is the place to look.
- **Glass cost during a take is unmeasured.** If recordings stutter with the window visible,
  drop the blur while recording.
- **"It" was read as FreeCast's interface.** If he meant something else, this was the wrong job.
- **The crash is not diagnosed.** Waiting on a description, or on the next one landing in
  `freecast.log`.
- **High frame rates are offered, not proven.** The compositor and encoder share one old CPU.
- **The old AppData profiles are left in place.** Harmless; delete once the new one is confirmed.

# Logo, GitHub assets, and the phone as a PC webcam - Sunday Oct 11

*Time worked: 2h 4m (3:58 PM to 6:02 PM)*

## Timeline

**3:58 PM - Baron asked for a logo, good quality, and a favicon.**
The mark: a rounded screen with a circle biting into its bottom-right corner. The circle is the
face cam sitting in the corner of the recording and, in the brand red, the record light. Two
colours, flat, no gradients; it holds up at 16 px. Screen is `#f2f2f3` on dark backgrounds and
`#141416` on light ones; the dot is always `#ff4a3d`. Wordmark is Segoe UI Bold.

Sources are hand-written SVG in `assets/`: `logo.svg` and `logo-dark.svg` (mark only),
`icon.svg` (mark on a dark tile, the app icon), `icon-small.svg` (same mark drawn bigger and
heavier for 16 to 48 px), `lockup.svg` and `lockup-dark.svg` (mark plus wordmark).

`tools/build-icons.js` rasterizes them with Electron itself, since nothing else on the PC
renders SVG with system fonts: `icon.ico` (16, 24, 32, 48 from the small drawing; 64, 128, 256
from the full one), `icon-512.png`, `icon-256.png`, `apple-touch-icon.png`, `favicon-32.png`,
`logo.png`. Two bugs on the way: the script quit after the first render because closing the
only window quits an Electron app by default, and the mark sat low and right in the tile
because it was centred on the screen rectangle and not on the whole mark.

Wired in: window and taskbar icon (plus an app user model id so Windows stops grouping it
under Electron), the brand mark in the app header, favicon and home-screen icon and start
screen logo on the phone page. The phone server answers `/favicon.ico`,
`/apple-touch-icon.png` and `/logo.svg` without the token, because browsers ask for those on
their own.

**Between 3:58 PM and 4:01 PM - "Add an asset folder for GitHub."**
`assets/github/`: `lockup.png` and `lockup-dark.png` for the README, which now swaps them by
theme with a `picture` element, and `social-preview.png` at 1280x640 with the lockup and a
one-line pitch. The social preview cannot be set from the command line; it is uploaded by hand
under the repo's Settings, Social preview.

**4:01 PM - Checked.**
Looked at the rendered icon, both lockups, the 32 px favicon enlarged, the social preview, and
the app header from a selftest screenshot. Selftest still passes. Not looked at: the taskbar
icon and the phone's home-screen icon.

**4:02 PM - "Why big white box and counting numbers" and "remove that subtitle, it sucks ass."**
The white box was the selftest's on-screen counter, flashing up on his monitor each time the
selftest ran. Told him what it was; warn before running the selftest while he is at the PC.
The subtitle was the one-line pitch under the lockup on the social preview. Removed; the
preview is now the lockup alone, centred.

**4:06 PM - "Make the blinking recording indicator not blink, just navy."**
The dot in the status box is now a steady navy (`#2747a8`) while recording, grey when idle.
Pure navy `#000080` disappears against the box's near-black background, so it is a navy
bright enough to see. The blink animation is gone.

**5:52 PM - "No, the red dot should be red and the box a steady navy. Also expand it so you
can use the phone camera as just the PC's camera, and mic as well."**
I had the navy on the wrong thing. Now: the status box itself is navy (`#0f1c44`) at all times,
the recording dot is a steady red, grey when idle. The red background flash on a marker is gone
too, since "steady" rules it out; a marker now just shows its name in bold white for a moment.

Phone as the PC's webcam, for other apps (Discord, Zoom, browsers):

- A camera other apps can see needs a driver. OBS Studio is installed here and ships one, "OBS
  Virtual Camera", which reads frames from a named shared-memory queue (`OBSVirtualCamVideo`).
  Anything that writes that queue becomes the camera. `src/main/vcam.js` does that through
  kernel32 with the `koffi` FFI package: an 80 byte header, three NV12 frame slots, layout taken
  from OBS's `shared-memory-queue.c`.
- `src/renderer/vcam.js` picks the phone camera (honouring its crop and mirror) or the whole
  scene, scales it to at most 1280 on the long side, converts to NV12 and hands it to main.
- New left panel, Phone as PC webcam: Camera to apps (on/off, Phone camera or Whole scene) and
  Mic to apps (an output device picker). New hotkey action for the camera toggle. The status
  box shows "Webcam out" while it is live.

Two things broke on the way, both found by the selftest:

1. Wrapping the shared memory in a Buffer killed the app outright (`napi_get_last_error_info`).
   Electron forbids ArrayBuffers that point at outside memory. Every write is now a
   `RtlMoveMemory` copy into the mapping.
2. With webcam output on, the app froze. Scaling, reading back and converting a frame on the
   page's own thread took longer than a frame, the tick queue backed up, and timers starved. The
   work now runs in a worker, one frame in flight at a time, skipping frames when it is busy.

Phone as the PC's mic: not possible without a virtual audio cable driver, and none is installed
(sound devices on this PC: Realtek, AMD, NVIDIA, Intel). FreeCast's half is built: Mic to apps
plays the phone mic into any output device. Once a cable such as VB-CABLE is installed, pick its
input there and its output as the microphone in the other app. Installing a driver is Baron's
call and his click; I did not download or install anything.

**6:02 PM - Verified.**
First a bare test pattern, then the real thing: with webcam output on during a selftest take,
`ffmpeg -f dshow -i video="OBS Virtual Camera"` returned a live frame of the fake cam, cropped
the way the source was cropped. The take recorded alongside it kept exact timing (counter read
55, 75, 95 at 2, 4, 6 seconds) including while minimized. Not tested: the real phone as the
source, a real app such as Discord picking the camera, and the mic path, which has nothing to
play into yet.

## Decisions

| Decision | Rationale |
|---|---|
| Status box is navy, recording dot steady red, nothing blinks or flashes | Baron's call, corrected after I put the navy on the dot |
| Webcam output rides on OBS's virtual camera | It is already installed and trusted here; writing our own camera driver is a different project |
| Webcam conversion runs in a worker and drops frames under load | Doing it on the page thread froze the app on this CPU |
| No driver installs without Baron | A virtual audio cable is a system change; his decision |
| No tagline on the social preview | Baron's call; the lockup stands on its own |
| One mark, two colours, no gradients | Has to read at 16 px and match the flat UI |
| SVG is the source, PNG and ICO are built | One place to change the logo; `npx electron tools/build-icons.js` rebuilds everything |
| Built images are committed | The app, the phone page and the README need them without a build step |

## Open

- **Phone as PC mic needs a virtual audio cable.** VB-CABLE is the usual free one. Until it is
  installed, Mic to apps has nowhere useful to send the audio.
- **Webcam output is tied to OBS being installed**, and the device shows up in other apps under
  the name "OBS Virtual Camera", not FreeCast. OBS itself cannot run its own virtual camera at
  the same time.
- **Webcam output untested with the real phone and a real app.**
- **Social preview is not uploaded.** Needs Baron in the repo settings, or leave it.
- **No packaged build yet**, so the .exe itself still carries Electron's icon; the window and
  taskbar use ours.

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
