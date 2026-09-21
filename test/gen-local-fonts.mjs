// Auto-hébergement des polices DM Sans (variable) / DM Mono (statique) :
// télécharge les woff2 depuis Google Fonts, déduplique par URL (la police
// variable couvre toute la plage de graisses) et génère css/fonts.css avec
// des chemins locaux. Usage : node test/gen-local-fonts.mjs
import fs from 'node:fs';
import path from 'node:path';

const CSS2_URL = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap';
// UA moderne → Google sert du woff2 avec sous-ensembles unicode-range.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const css = await (await fetch(CSS2_URL, { headers: { 'User-Agent': UA } })).text();
fs.mkdirSync('fonts', { recursive: true });

// ---- Parse de tous les @font-face (ordre du fichier → sous-ensemble) --------
const entries = [];
let pos = 0;
while (true) {
    const start = css.indexOf('@font-face', pos);
    if (start < 0) break;
    const end = css.indexOf('}', start);
    const face = css.slice(start, end);
    const subset = (css.slice(pos, start).match(/\/\*\s*([a-z-]+)\s*\*\/\s*$/) || [])[1] || 'x';
    entries.push({
        subset,
        url: face.match(/url\(([^)]+)\)/)[1],
        family: face.match(/font-family:\s*'([^']+)'/)[1],
        weights: face.match(/font-weight:\s*([0-9 ]+);/)[1].trim(),
        unicode: (face.match(/unicode-range:\s*([^;]+);/) || [])[1] || '',
    });
    pos = end + 1;
}

// ---- Déduplication par URL : la police variable couvre toute la plage --------
const byUrl = new Map();
for (const e of entries) {
    if (!byUrl.has(e.url)) byUrl.set(e.url, { ...e, min: Infinity, max: 0 });
    const f = byUrl.get(e.url);
    for (const w of e.weights.split(' ').map(Number)) {
        f.min = Math.min(f.min, w);
        f.max = Math.max(f.max, w);
    }
}

// ---- Téléchargement + css/fonts.css ------------------------------------------
let out = '/* Polices auto-hébergées (DM Sans variable, DM Mono) — générées par\n' +
          '   test/gen-local-fonts.mjs. Fichiers sources : Google Fonts (licence OFL).\n' +
          '   Aucun appel réseau vers Google au chargement des pages. */\n';
let ko = 0;
for (const [, e] of byUrl) {
    const buf = Buffer.from(await (await fetch(e.url, { headers: { 'User-Agent': UA } })).arrayBuffer());
    const wTxt = e.min === e.max ? String(e.min) : `${e.min}-${e.max}`;
    const file = `${e.family.replace(/\s+/g, '')}-${wTxt}-${e.subset}.woff2`;
    fs.writeFileSync(path.join('fonts', file), buf);
    ko += buf.length / 1024;
    out += `\n@font-face {\n  font-family: '${e.family}';\n  font-style: normal;\n  font-weight: ${wTxt};\n  font-display: swap;\n  src: url('../fonts/${file}') format('woff2');\n  ${e.unicode ? `unicode-range: ${e.unicode};\n  ` : ''}}\n`;
}
fs.writeFileSync('css/fonts.css', out);
console.log(`${byUrl.size} fichiers woff2 uniques → fonts/ (${Math.round(ko)} Ko), css/fonts.css généré.`);
