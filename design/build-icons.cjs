// Builds the Windows app icon set: the full construction drawing (fontier-icon.svg) from 24 px up,
// the plain F + dot (fontier-tray.svg) only for the tiny 16 and 20 px sizes where guides would smudge.
// Run: node design/build-icons.cjs   (after `npx tauri icon design/fontier-icon-1024.png`)
const { Resvg } = require('@resvg/resvg-js');
const fs = require('fs');
const path = require('path');

const here = __dirname;
const icons = path.join(here, '..', 'src-tauri', 'icons');
const svg = (name) => fs.readFileSync(path.join(here, name), 'utf8');
const render = (src, size) => new Resvg(src, { fitTo: { mode: 'width', value: size } }).render().asPng();

const full = svg('fontier-icon.svg');
const simple = svg('fontier-tray.svg');
const sizes = [16, 20, 24, 32, 48, 64, 128, 256];
const pngs = sizes.map((s) => ({ size: s, data: render(s <= 20 ? simple : full, s) }));

// ICO container with PNG-compressed entries.
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(pngs.length, 4);
const dir = Buffer.alloc(16 * pngs.length);
let offset = 6 + dir.length;
pngs.forEach(({ size, data }, i) => {
  const o = i * 16;
  dir.writeUInt8(size >= 256 ? 0 : size, o);
  dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
  dir.writeUInt8(0, o + 2);
  dir.writeUInt8(0, o + 3);
  dir.writeUInt16LE(1, o + 4);
  dir.writeUInt16LE(32, o + 6);
  dir.writeUInt32LE(data.length, o + 8);
  dir.writeUInt32LE(offset, o + 12);
  offset += data.length;
});
fs.writeFileSync(path.join(icons, 'icon.ico'), Buffer.concat([header, dir, ...pngs.map((p) => p.data)]));
fs.writeFileSync(path.join(icons, 'tray.png'), render(full, 64));
console.log('icon.ico sizes:', sizes.join(', '), '| tray.png from the full drawing');
