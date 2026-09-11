// Capture PNG de la page « alternates » de l'aperçu PDF (pdfjs vendor +
// Brave headless — recette visuelle du projet).
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/test/_pdf-view.html';
    fs.readFile(path.join(root, p), (e, d) => {
        if (e) { res.writeHead(404); res.end(); return; }
        const mime = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png' }[path.extname(p)] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' }); res.end(d);
    });
});
await new Promise(r => server.listen(8664, r));

fs.writeFileSync(path.join(root, 'test', '_pdf-view.html'), `<!doctype html><meta charset="utf-8">
<canvas id="c"></canvas>
<script src="/vendor/pdfjs-3.11.174.min.js"></script>
<script>
(async () => {
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs-worker-3.11.174.min.js';
    const raw = await fetch('/Apercu_Log-nav_3pages.pdf').then(r => r.arrayBuffer());
    const pdf = await pdfjsLib.getDocument({ data: raw }).promise;
    // Page contenant les alternates : cherche le titre dans les 4 pages.
    let pageNo = 2;
    for (let i = 1; i <= pdf.numPages; i++) {
        const t = await (await pdf.getPage(i)).getTextContent();
        if (t.items.some(it => /Alternates le long/.test(it.str))) { pageNo = i; break; }
    }
    const page = await pdf.getPage(pageNo);
    const vp = page.getViewport({ scale: 2 });
    const c = document.getElementById('c');
    c.width = vp.width; c.height = vp.height;
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    document.title = 'RENDER_OK:' + pageNo;
})();
</script>`);

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe', headless: 'new', args: ['--disable-gpu', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 1300 });
await page.goto('http://127.0.0.1:8664/test/_pdf-view.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction(() => document.title.startsWith('RENDER_OK'), { timeout: 30000 });
const pageNo = (await page.title()).split(':')[1];
await page.screenshot({ path: 'test/apercu-alternates-pdf.png', fullPage: true });
console.log(`Page ${pageNo} (alternates) capturée → test/apercu-alternates-pdf.png`);
await browser.close(); server.close();
fs.rmSync(path.join(root, 'test', '_pdf-view.html'), { force: true });
