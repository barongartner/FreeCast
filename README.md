# FreeCast

Free screen recorder for devlogs. No account, no watermark, nothing leaves your network.

- **Scene layout** - add screens, windows, cameras and images, then drag them where you want
  them. Corners scale, edges crop, everything snaps to the canvas.
- **Phone as face cam** - scan a QR code and the phone becomes a wireless camera. The PC hosts
  the page itself; video goes phone to PC directly over the LAN.
- **Edit markers** - press a hotkey while recording to flag a spot to cut or fix. Markers land
  in the MP4 as chapters, in a text list, and in an EDL that DaVinci Resolve imports as
  timeline markers.

## Run

Needs Node 20 or newer and `ffmpeg` on the PATH.

```bash
npm install
npm start
```

On Windows, `Start FreeCast.cmd` launches it without a terminal.

## Phone camera

1. Click the phone pill in the top bar. A QR code appears.
2. Put the phone on the same network as the PC and scan the code.
3. The phone browser warns about the certificate, because FreeCast signs its own. On iPhone:
   Show Details, then visit this website.
4. Tap Start camera and allow camera access.

The first time FreeCast starts, Windows Firewall asks whether to let it accept connections.
Allow it on private networks or the phone cannot reach the page.

## Hotkeys

All of them work while another app has focus. Change them in Settings.

| Action | Default |
|---|---|
| Start or stop recording | Ctrl+Alt+R |
| Show or hide the face cam | Ctrl+Alt+C |
| Mark Cut | Ctrl+Alt+X |
| Mark Fix | Ctrl+Alt+F |

Marker keys are only held while a recording is running.

## Output

Each take produces `Recording 1.mp4` (constant frame rate H.264 and AAC, chapters at every
marker). Takes with markers also get `Recording 1 Markers.txt` and `Recording 1 Markers.edl`.
In Resolve: right-click the timeline in the media pool, Timelines, Import, Timeline Markers
from EDL.

The FreeCast window and the small recording timer are excluded from screen capture, so they
never show up in the video even when they are on screen.
