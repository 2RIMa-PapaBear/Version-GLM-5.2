// PDF -> PNG via Brave headless piloté en CDP (déterministe : on ATTEND
// le titre RENDER_DONE posé par _pdf2png.html avant la capture — le
// --virtual-time-budget de --screenshot ne couvre pas la chaîne
// fetch -> worker pdfjs -> render).
// Usage : node test/_pdf2png-cdp.mjs <pdf-absolu-ou-relatif> <png-sortie> [scale]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [, , pdfArg, pngArg, scaleArg, pageArg] = process.argv;
if (!pdfArg || !pngArg) { console.error('usage: _pdf2png-cdp.mjs <pdf> <png> [scale] [page]'); process.exit(2); }
const pdfAbs = path.resolve(pdfArg);
const pngAbs = path.resolve(pngArg);
const scale = Number(scaleArg || 2);
const pageNo = Number(pageArg || 1);

const BRAVE = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
const PORT = 9331;
const url = 'file:///' + encodeURI(path.join(root, 'test', '_pdf2png.html').replace(/\\/g, '/'))
    + `?file=${encodeURIComponent(pdfAbs.replace(/\\/g, '/'))}&scale=${scale}&page=${pageNo}`;

const proc = spawn(BRAVE, [
    '--headless=new', '--disable-gpu', '--no-first-run',
    '--allow-file-access-from-files', '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`,
    `--window-size=${Math.ceil(595.28 * scale) + 1},${Math.ceil(419.53 * scale) + 1}`,
    'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findTarget() {
    for (let i = 0; i < 40; i++) {
        try {
            const res = await fetch(`http://127.0.0.1:${PORT}/json`);
            const list = await res.json();
            const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
            if (page) return page;
        } catch { /* pas encore prêt */ }
        await sleep(250);
    }
    throw new Error('Brave CDP injoignable');
}

const target = await findTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
    }
};
const send = (method, params = {}) => new Promise((res) => {
    const id = ++seq;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
});

await send('Page.enable');
await send('Page.navigate', { url });

let title = '';
for (let i = 0; i < 120; i++) {
    await sleep(250);
    const r = await send('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
    title = r?.result?.result?.value || '';
    if (title.startsWith('RENDER_')) break;
}
if (title !== 'RENDER_DONE') {
    console.error('échec du rendu :', title || 'timeout');
    process.exitCode = 1;
} else {
    // Dimensions exactes du canvas -> capture CLIPPÉE au pixel près
    // (la fenêtre headless peut différer du canvas : DPI, chrome).
    const dim = await send('Runtime.evaluate', {
        expression: 'JSON.stringify({w:document.querySelector("canvas").width,h:document.querySelector("canvas").height})',
        returnByValue: true,
    });
    const { w, h } = JSON.parse(dim?.result?.result?.value || '{}');
    const shot = await send('Page.captureScreenshot', {
        format: 'png',
        clip: { x: 0, y: 0, width: w, height: h, scale: 1 },
    });
    fs.writeFileSync(pngAbs, Buffer.from(shot.result.data, 'base64'));
    console.log(`OK : ${pngAbs} (${(fs.statSync(pngAbs).size / 1024).toFixed(0)} Ko, ${w}x${h})`);
}

try { ws.close(); } catch { /* déjà fermé */ }
proc.kill();
await sleep(300);
process.exit(process.exitCode || 0);
