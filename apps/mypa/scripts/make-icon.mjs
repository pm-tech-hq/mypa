/**
 * Generates the myPA app icon — a black rounded tile holding three white
 * "widgets", the board motif. Pure Node, no image deps.
 *
 *   node apps/mypa/scripts/make-icon.mjs
 *
 * Outputs: resources/icon.png (256), resources/icon-512.png,
 *          resources/icon.svg, src/renderer/public/icon.png
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// design in a 256 space: [x, y, w, h, r]
const TILE = [18, 18, 220, 220, 52];
const WIDGETS = [
  [52, 58, 58, 140, 16], // left, tall
  [126, 58, 78, 62, 16], // right, top
  [126, 136, 78, 62, 16], // right, bottom
];
const INK = [17, 17, 17, 255];
const PAPER = [255, 255, 255, 255];

function inRoundRect(px, py, x, y, w, h, r) {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  const inX = px >= x + r && px <= x + w - r;
  const inY = py >= y + r && py <= y + h - r;
  if (inX || inY) return true;
  const cx = px < x + r ? x + r : x + w - r;
  const cy = py < y + r ? y + r : y + h - r;
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

function render(size) {
  const S = 4; // supersample
  const k = (size / 256) * S;
  const tile = TILE.map((v) => v * k);
  const widgets = WIDGETS.map((w) => w.map((v) => v * k));
  const out = Buffer.alloc(size * size * 4);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const x = px * S + sx + 0.5;
          const y = py * S + sy + 0.5;
          let c = null;
          if (inRoundRect(x, y, ...tile)) c = INK;
          for (const wr of widgets) if (inRoundRect(x, y, ...wr)) c = PAPER;
          if (c) {
            r += c[0];
            g += c[1];
            b += c[2];
            a += c[3];
          }
        }
      }
      const n = S * S;
      const i = (py * size + px) * 4;
      out[i] = Math.round(r / n);
      out[i + 1] = Math.round(g / n);
      out[i + 2] = Math.round(b / n);
      out[i + 3] = Math.round(a / n);
    }
  }
  return out;
}

/* ---- minimal PNG encoder --------------------------------------------- */

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  const stride = 1 + size * 4;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter: none
    rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---- svg ------------------------------------------------------------- */

function svg() {
  const rr = (a, fill) =>
    `<rect x="${a[0]}" y="${a[1]}" width="${a[2]}" height="${a[3]}" rx="${a[4]}" fill="${fill}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  ${rr(TILE, "#111111")}
  ${WIDGETS.map((w) => rr(w, "#ffffff")).join("\n  ")}
</svg>
`;
}

/* ---- ico (Windows) ---------------------------------------------------
 * Vista+ accepts a PNG-compressed image directly inside an ICO container,
 * so this just wraps a few PNG sizes in the minimal ICONDIR/ICONDIRENTRY
 * structure — no BMP/DIB encoding, no image-processing dep. */

function encodeIco(pngsBySize) {
  const count = pngsBySize.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);

  const entries = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  const chunks = [header, entries];

  pngsBySize.forEach(({ size, png }, i) => {
    const e = i * 16;
    entries[e] = size >= 256 ? 0 : size; // 0 means 256
    entries[e + 1] = size >= 256 ? 0 : size;
    entries[e + 2] = 0; // color count (n/a, 32bpp)
    entries[e + 3] = 0; // reserved
    entries.writeUInt16LE(1, e + 4); // planes
    entries.writeUInt16LE(32, e + 6); // bit count
    entries.writeUInt32LE(png.length, e + 8); // size of image data
    entries.writeUInt32LE(offset, e + 12); // offset of image data
    offset += png.length;
    chunks.push(png);
  });

  return Buffer.concat(chunks);
}

/* ---- write --------------------------------------------------------- */

mkdirSync(join(root, "resources"), { recursive: true });
mkdirSync(join(root, "src/renderer/public"), { recursive: true });

writeFileSync(join(root, "resources/icon.png"), encodePng(256, render(256)));
writeFileSync(join(root, "resources/icon-512.png"), encodePng(512, render(512)));
writeFileSync(join(root, "resources/icon.svg"), svg());
writeFileSync(join(root, "src/renderer/public/icon.png"), encodePng(256, render(256)));

const icoSizes = [16, 32, 48, 256];
writeFileSync(
  join(root, "resources/icon.ico"),
  encodeIco(icoSizes.map((size) => ({ size, png: encodePng(size, render(size)) }))),
);

console.log(
  "icon written → resources/icon.{png,ico,svg}, resources/icon-512.png",
);
