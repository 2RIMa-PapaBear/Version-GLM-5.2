// Décodeur PNG minimal (zlib + unfilter) + scan de lignes bleues SIV.
// Usage : node test/png-scan.mjs image.png
import fs from 'node:fs';
import zlib from 'node:zlib';

const buf = fs.readFileSync(process.argv[2]);
if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('pas un PNG');

let pos = 8, w = 0, h = 0, bitDepth = 8, colorType = 6;
const idat = [];
while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
        w = data.readUInt32BE(0); h = data.readUInt32BE(4);
        bitDepth = data[8]; colorType = data[9];
        if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) throw new Error(`PNG non géré (depth=${bitDepth}, color=${colorType})`);
    } else if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
}
const bpp = colorType === 6 ? 4 : 3;
const raw = zlib.inflateSync(Buffer.concat(idat));
const stride = w * bpp;
const px = Buffer.alloc(h * stride);
let p = 0;
for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    for (let x = 0; x < stride; x++) {
        const c = raw[p++], a = x >= bpp ? px[y * stride + x - bpp] : 0;
        const b = y > 0 ? px[(y - 1) * stride + x] : 0;
        const cc = y > 0 && x >= bpp ? px[(y - 1) * stride + x - bpp] : 0;
        let v;
        switch (filter) {
            case 0: v = c; break;
            case 1: v = c + a; break;
            case 2: v = c + b; break;
            case 3: v = c + ((a + b) >> 1); break;
            default: {
                const pa = Math.abs(b - cc), pb = Math.abs(a - cc), pc = Math.abs(a + b - 2 * cc);
                v = c + (pa <= pb && pa <= pc ? a : pb <= pc ? b : cc);
            }
        }
        px[y * stride + x] = v & 0xff;
    }
}

const isBlue = (r, g, b) => b > 200 && g > 140 && r < 170 && b > r + 40;
const rows = [];
for (let y = 0; y < h; y++) {
    let n = 0, x0 = -1, x1 = -1;
    for (let x = 0; x < w; x++) {
        const i = y * stride + x * bpp;
        if (isBlue(px[i], px[i + 1], px[i + 2])) { n++; if (x0 < 0) x0 = x; x1 = x; }
    }
    if (n > 100) rows.push({ y, n, x0, x1 });
}
// Regroupe en bandes verticales contiguës.
const bands = [];
for (const r of rows) {
    const last = bands[bands.length - 1];
    if (last && r.y - last.y1 <= 2) { last.y1 = r.y; last.max = Math.max(last.max, r.n); last.x0 = Math.min(last.x0, r.x0); last.x1 = Math.max(last.x1, r.x1); }
    else bands.push({ y0: r.y, y1: r.y, max: r.n, x0: r.x0, x1: r.x1 });
}
console.log(`PNG ${w}x${h} — ${bands.length} bande(s) bleue(s) larges :`);
bands.forEach(b => console.log(`  y ${b.y0}-${b.y1} (h=${b.y1 - b.y0}) x ${b.x0}-${b.x1} max/ligne=${b.max}`));
