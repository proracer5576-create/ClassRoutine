import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const size = 256;
const raw = Buffer.alloc((size * 4 + 1) * size);

function insideRoundedSquare(x, y, inset, radius) {
  const left = inset, right = size - inset - 1, top = inset, bottom = size - inset - 1;
  if (x >= left + radius && x <= right - radius && y >= top && y <= bottom) return true;
  if (y >= top + radius && y <= bottom - radius && x >= left && x <= right) return true;
  const cx = x < left + radius ? left + radius : right - radius;
  const cy = y < top + radius ? top + radius : bottom - radius;
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

for (let y = 0; y < size; y += 1) {
  const row = y * (size * 4 + 1);
  raw[row] = 0;
  for (let x = 0; x < size; x += 1) {
    const offset = row + 1 + x * 4;
    let color = [0, 0, 0, 0];
    if (insideRoundedSquare(x, y, 10, 54)) color = [34, 111, 94, 255];
    if ((x - 195) ** 2 + (y - 61) ** 2 < 25 ** 2) color = [248, 190, 70, 255];
    const check = Math.min(
      distanceToSegment(x, y, 65, 134, 111, 179),
      distanceToSegment(x, y, 111, 179, 195, 86)
    );
    if (check < 14 && x > 48 && x < 211 && y > 66 && y < 198) color = [255, 249, 231, 255];
    raw[offset] = color[0]; raw[offset + 1] = color[1]; raw[offset + 2] = color[2]; raw[offset + 3] = color[3];
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let value = n;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  name.copy(out, 4); data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8);
  return out;
}

const header = Buffer.alloc(13);
header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4);
header[8] = 8; header[9] = 6; header[10] = 0; header[11] = 0; header[12] = 0;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", header),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0))
]);

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
await fs.mkdir(path.join(root, "build"), { recursive: true });
await fs.writeFile(path.join(root, "build", "icon.png"), png);
console.log(`Generated ${path.join(root, "build", "icon.png")}`);
