// Rasterizes assets/icon.svg into icon.ico (Windows) and icon.png,
// using Electron's bundled Chromium for SVG rendering and
// pure-Node ICO assembly. Run with:  electron.exe tools/make-icons.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ASSETS = path.join(__dirname, '..', 'assets');
const SVG = fs.readFileSync(path.join(ASSETS, 'icon.svg'), 'utf8');

// All sizes we may need across formats.
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

function log(...a) { process.stdout.write(a.join(' ') + '\n'); }

async function renderPNG(win, size) {
  const dataUrl = await win.webContents.executeJavaScript(`(async () => {
    const svg = ${JSON.stringify(SVG)};
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const c = document.createElement('canvas');
    c.width = ${size}; c.height = ${size};
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, ${size}, ${size});
    ctx.drawImage(img, 0, 0, ${size}, ${size});
    return c.toDataURL('image/png');
  })()`);
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

function buildICO(pngs) {
  // pngs: array of {size, buf}. ICO supports up to 256 (stored as 0).
  const entries = pngs.filter(p => p.size <= 256);
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);            // reserved
  header.writeUInt16LE(1, 2);            // type = icon
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + dir.length;
  entries.forEach((p, i) => {
    const o = i * 16;
    dir.writeUInt8(p.size >= 256 ? 0 : p.size, o + 0); // width
    dir.writeUInt8(p.size >= 256 ? 0 : p.size, o + 1); // height
    dir.writeUInt8(0, o + 2);            // palette
    dir.writeUInt8(0, o + 3);            // reserved
    dir.writeUInt16LE(1, o + 4);         // color planes
    dir.writeUInt16LE(32, o + 6);        // bits per pixel
    dir.writeUInt32LE(p.buf.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += p.buf.length;
  });
  return Buffer.concat([header, dir, ...entries.map(p => p.buf)]);
}

function buildICNS(pngs) {
  // OSType per size for PNG-encoded entries (modern macOS reads PNG fine).
  const TYPES = { 16: 'icp4', 32: 'icp5', 64: 'icp6', 128: 'ic07', 256: 'ic08', 512: 'ic09', 1024: 'ic10' };
  const chunks = [];
  pngs.forEach(p => {
    const type = TYPES[p.size];
    if (!type) return;
    const head = Buffer.alloc(8);
    head.write(type, 0, 'ascii');
    head.writeUInt32BE(8 + p.buf.length, 4);
    chunks.push(head, p.buf);
  });
  const body = Buffer.concat(chunks);
  const file = Buffer.alloc(8);
  file.write('icns', 0, 'ascii');
  file.writeUInt32BE(8 + body.length, 4);
  return Buffer.concat([file, body]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 100, height: 100, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<!doctype html><html><body></body></html>');

  const pngs = [];
  for (const size of SIZES) {
    const buf = await renderPNG(win, size);
    pngs.push({ size, buf });
    log('rendered', size + 'px', '(' + buf.length + ' bytes)');
  }

  const ico = buildICO(pngs);
  fs.writeFileSync(path.join(ASSETS, 'icon.ico'), ico);
  log('wrote icon.ico', ico.length, 'bytes');

  const png512 = pngs.find(p => p.size === 512).buf;
  fs.writeFileSync(path.join(ASSETS, 'icon.png'), png512);
  log('wrote icon.png', png512.length, 'bytes');

  win.destroy();
  app.quit();
}).catch(err => { log('ERROR', err && err.stack || String(err)); app.exit(1); });
