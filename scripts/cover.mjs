// Generates cover.png (800x534) for gladys-threema: plain Node, no dependency.
// A house sending a message bubble along a dotted path to a phone, on a dark
// green gradient (no brand logo).
// Usage: node scripts/cover.mjs cover.png
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const W = 800;
const H = 534;
const px = Buffer.alloc(W * H * 3);
const set = (x, y, [r, g, b], a = 1) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = px[i] * (1 - a) + r * a;
  px[i + 1] = px[i + 1] * (1 - a) + g * a;
  px[i + 2] = px[i + 2] * (1 - a) + b * a;
};
const skyAt = (x, y) => {
  const t = (x / W) * 0.7 + (y / H) * 0.3;
  return [30 + 20 * t, 70 + 60 * t, 60 + 30 * t];
};
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    set(x, y, skyAt(x, y));
  }
}
const white = [255, 255, 255];
const dark = [28, 38, 64];
const green = [90, 210, 130];
const disc = (cx, cy, r, color, alpha = 1) => {
  for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y += 1) {
    for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x += 1) {
      const a = Math.max(0, Math.min(1, r - Math.hypot(x - cx, y - cy) + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};
const box = (x0, y0, x1, y1, r, color, alpha = 1) => {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const cx = Math.min(Math.max(x, x0 + r), x1 - r);
      const cy = Math.min(Math.max(y, y0 + r), y1 - r);
      const a = Math.max(0, Math.min(1, r - Math.hypot(x - cx, y - cy) + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};

const grey = [150, 158, 172];
const amber = [245, 180, 60];

disc(400, 270, 260, white, 0.05);

// The house: a roof (triangle) and a body with a door.
for (let y = 150; y < 240; y += 1) {
  const k = (y - 150) / 90;
  for (let x = Math.round(170 - 110 * k); x <= Math.round(170 + 110 * k); x += 1) set(x, y, white);
}
box(80, 238, 260, 380, 10, white);
box(150, 300, 190, 380, 6, dark);
disc(145, 270, 14, amber);

// The message bubble with lines of text, above the path.
box(300, 120, 520, 250, 24, white, 0.95);
for (let y = 0; y < 3; y += 1) {
  const x1 = [480, 450, 410][y];
  box(330, 150 + y * 30, x1, 166 + y * 30, 8, grey);
}
for (let y = 249; y < 290; y += 1) {
  const k = (y - 249) / 41;
  for (let x = Math.round(340 - 6 * k); x <= Math.round(390 - 50 * k); x += 1)
    set(x, y, white, 0.95);
}

// The dotted path from the house to the phone, with an arrow head.
for (let x = 280; x <= 560; x += 22) disc(x, 330, 6, green);
for (let i = 0; i < 26; i += 1) {
  for (let w = -3; w <= 3; w += 1) {
    set(560 + i, 330 - 26 + i + w, green);
    set(560 + i, 330 + 26 - i + w, green);
  }
}

// The phone.
box(610, 150, 730, 410, 22, dark);
box(622, 175, 718, 375, 8, white, 0.92);
box(635, 195, 705, 225, 10, green);
box(635, 240, 690, 262, 9, grey);
disc(670, 392, 8, grey);

// PNG encoding.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 2;
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y += 1) {
  raw[y * (W * 3 + 1)] = 0;
  px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
}
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(process.argv[2] ?? 'cover.png', png);
console.log('cover', png.length, 'bytes');
