// Rend la page 1 de la légende SCAN-OACI en PNG ×6 (pdfjs-dist + @napi-rs/canvas,
// installés sans --save). Usage : node test/oaci-extract/render-page1.mjs [chemin PDF]
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const req = createRequire(import.meta.url);
const { getDocument } = await import(req.resolve('pdfjs-dist/legacy/build/pdf.mjs', { paths: [path.resolve('.')] }));
const { createCanvas } = req('@napi-rs/canvas');
const pdfPath = process.argv[2] || 'G:/Bureau/GEOGRAPHICALGRIDSYSTEMS.MAPS.SCAN-OACI-legend.pdf';
const SCALE = 6;
const doc = await getDocument({ url: 'file:///' + pdfPath.split(path.sep).join('/'), useSystemFonts: true }).promise;
const page = await doc.getPage(1);
const vp = page.getViewport({ scale: SCALE });
const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
const ctx = canvas.getContext('2d');
ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height);
await page.render({
    canvasContext: ctx, viewport: vp,
    canvasFactory: {
        create: (w, h) => { const c = createCanvas(w, h); return { canvas: c, context: c.getContext('2d') }; },
        reset: (o, w, h) => { o.canvas.width = w; o.canvas.height = h; },
        destroy: o => { o.canvas.width = 0; },
    },
}).promise;
fs.mkdirSync('test/oaci-extract', { recursive: true });
fs.writeFileSync('test/oaci-extract/page1.png', canvas.toBuffer('image/png'));
console.log('Rendu :', canvas.width + 'x' + canvas.height, '→ test/oaci-extract/page1.png');
