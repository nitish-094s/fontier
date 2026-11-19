// Renders the NSIS installer artwork (24-bit BMP, the format NSIS requires) from the SVGs in design/.
// Run: node design/build-installer-art.cjs
const { Resvg } = require('@resvg/resvg-js');
const fs = require('fs');
const path = require('path');

const out = path.join(__dirname, '..', 'src-tauri', 'installer');
fs.mkdirSync(out, { recursive: true });

function toBmp(rgba, w, h, bg = [0x11, 0x11, 0x11]) {
  const rowSize = Math.ceil((w * 3) / 4) * 4;
  const pixelBytes = rowSize * h;
  const buf = Buffer.alloc(54 + pixelBytes);
  buf.write('BM', 0);
  buf.writeUInt32LE(54 + pixelBytes, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(w, 18);
  buf.writeInt32LE(h, 22); // positive height = bottom-up rows
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(pixelBytes, 34);
  buf.writeInt32LE(2835, 38);
  buf.writeInt32LE(2835, 42);
  for (let y = 0; y < h; y++) {
    const row = 54 + (h - 1 - y) * rowSize;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = rgba[i + 3] / 255;
      // flatten any transparency onto the background colour
      const [r, g, b] = [0, 1, 2].map((c) => Math.round(rgba[i + c] * a + bg[c] * (1 - a)));
      buf[row + x * 3] = b;
      buf[row + x * 3 + 1] = g;
      buf[row + x * 3 + 2] = r;
    }
  }
  return buf;
}

const render = (name, w) =>
  new Resvg(fs.readFileSync(path.join(__dirname, `${name}.svg`), 'utf8'), {
    fitTo: { mode: 'width', value: w },
    font: { loadSystemFonts: true, defaultFontFamily: 'Segoe UI' },
  }).render();

/** Places an RGBA image onto a solid canvas (premultiplied-safe since the art is opaque). */
function compose(w, h, bg, layers) {
  const px = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) px.set([...bg, 255], i * 4);
  for (const { img, x, y } of layers) {
    for (let j = 0; j < img.height; j++) {
      const ty = y + j;
      if (ty < 0 || ty >= h) continue;
      for (let i = 0; i < img.width; i++) {
        const tx = x + i;
        if (tx < 0 || tx >= w) continue;
        const s = (j * img.width + i) * 4;
        const a = img.pixels[s + 3] / 255;
        const d = (ty * w + tx) * 4;
        for (let c = 0; c < 3; c++) px[d + c] = Math.round(img.pixels[s + c] + px[d + c] * (1 - a));
      }
    }
  }
  return { pixels: px, width: w, height: h };
}

// NSIS artwork. Sidebar 164x314: the construction-sheet art for the Welcome and Finish pages.
// Header 150x57: the small Fontier mark at the top of the inner pages (installer and uninstaller).
const sidebar = render('installer-sidebar', 164);
const header = render('installer-header', 150);
fs.writeFileSync(path.join(out, 'sidebar.bmp'), toBmp(sidebar.pixels, sidebar.width, sidebar.height, [0x11, 0x11, 0x11]));
fs.writeFileSync(path.join(out, 'header.bmp'), toBmp(header.pixels, header.width, header.height, [0xff, 0xff, 0xff]));
fs.writeFileSync(path.join(__dirname, 'installer-sidebar.png'), sidebar.asPng());
fs.writeFileSync(path.join(__dirname, 'installer-header.png'), header.asPng());
console.log(`sidebar.bmp ${sidebar.width}x${sidebar.height}, header.bmp ${header.width}x${header.height}`);
