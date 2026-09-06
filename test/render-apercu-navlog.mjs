// Génère des HTML auto-contenus (pdf.js inline, worker en blob, PDF en data
// URL) prêts pour une capture Edge headless, une page par fichier.
// Usage : node test/render-apercu-navlog.mjs [nom-du-pdf] [préfixe-sortie]
//   ex. node test/render-apercu-navlog.mjs Apercu_Log-nav_3pages_10wp.pdf Apercu_10wp
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pdfName = process.argv[2] || 'Apercu_Log-nav_3pages.pdf';
const prefix = process.argv[3] || 'Apercu';

const pdfB64 = fs.readFileSync(path.join(root, pdfName)).toString('base64');
const pdfjsSrc = fs.readFileSync(path.join(root, 'vendor', 'pdfjs-3.11.174.min.js'), 'utf8');
const workerSrc = fs.readFileSync(path.join(root, 'vendor', 'pdfjs-worker-3.11.174.min.js'), 'utf8');

const html = (only) => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  body { margin: 8px; background: #404040; }
  canvas { display: block; margin: 0 auto 8px auto; background: #fff; box-shadow: 0 0 4px #000; }
</style></head>
<body>
<script>${pdfjsSrc}<\/script>
<script>
  const blob = new Blob([${JSON.stringify(workerSrc)}], { type: 'text/javascript' });
  pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
  (async () => {
    const doc = await pdfjsLib.getDocument({ data: atob(${JSON.stringify(pdfB64)}) }).promise;
    const scale = 2;
    for (let i = 1; i <= doc.numPages; i++) {
      if (${only || 0} && i !== ${only || 0}) continue;
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = vp.width; canvas.height = vp.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      document.body.appendChild(canvas);
    }
    document.title = 'DONE';
  })();
</script>
</body></html>`;

const outs = [path.join(root, `${prefix}_render.html`)];
for (const p of [1, 2, 3, 4, 5, 6]) outs.push(path.join(root, `${prefix}_render_p${p}.html`));
fs.writeFileSync(outs[0], html(0));
for (const p of [1, 2, 3, 4, 5, 6]) fs.writeFileSync(outs[p - 1 + 1], html(p));
console.log(`OK : ${outs.map(o => path.basename(o)).join(', ')}`);
