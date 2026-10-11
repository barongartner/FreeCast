'use strict';
// Rasterizes the SVGs in assets/ into the PNGs and the .ico the app, the
// phone page and the README use. Run: npx electron tools/build-icons.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ASSETS = path.join(__dirname, '..', 'assets');

async function render(file, w, h) {
  const win = new BrowserWindow({ show: false, width: w, height: h, frame: false, transparent: true, webPreferences: { offscreen: true } });
  await win.loadFile(path.join(ASSETS, file)); // the SVG is the document, scaled to the window by its viewBox
  await new Promise((r) => setTimeout(r, 400));
  const img = await win.webContents.capturePage();
  win.destroy();
  return img.resize({ width: w, height: h, quality: 'best' });
}

// An .ico is a small directory followed by the images; PNG payloads are valid.
function ico(images) {
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(({ size, png }, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(size >= 256 ? 0 : size, e);
    head.writeUInt8(size >= 256 ? 0 : size, e + 1);
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(png.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...images.map((x) => x.png)]);
}

app.disableHardwareAcceleration();
app.on('window-all-closed', () => {}); // windows come and go between renders; do not quit on the first close
app.whenReady().then(async () => {
  const save = (name, img) => fs.writeFileSync(path.join(ASSETS, name), img.toPNG());
  const big = await render('icon.svg', 1024, 1024);
  const small = await render('icon-small.svg', 1024, 1024);
  const at = (img, size) => img.resize({ width: size, height: size, quality: 'best' });

  save('icon-512.png', at(big, 512));
  save('icon-256.png', at(big, 256));
  save('apple-touch-icon.png', at(big, 180));
  save('favicon-32.png', at(small, 32));
  fs.writeFileSync(path.join(ASSETS, 'icon.ico'), ico([
    ...[16, 24, 32, 48].map((size) => ({ size, png: at(small, size).toPNG() })),
    ...[64, 128, 256].map((size) => ({ size, png: at(big, size).toPNG() })),
  ]));
  save('logo.png', await render('logo.svg', 1024, 1024));
  // GitHub-facing images: README lockups for both themes and the social preview.
  save('github/lockup.png', await render('lockup.svg', 1340, 400));
  save('github/lockup-dark.png', await render('lockup-dark.svg', 1340, 400));
  save('github/social-preview.png', await render('github/social-preview.svg', 1280, 640));
  app.quit();
});
