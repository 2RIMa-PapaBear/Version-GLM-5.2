// Contrôle géométrique : les 8 lignes alternates du log de nav tiennent
// au-dessus du pied de page (PDF jsPDF non compressé : "x y Td\n(txt) Tj",
// origine y en BAS de page, A5 = 595 pt).
import fs from 'node:fs';

const raw = fs.readFileSync('Apercu_Log-nav_3pages.pdf', 'latin1');
const codes = ['LFPT', 'LFPK', 'LFPO', 'LFOJ', 'LFPX', 'LFAR', 'LFLY\\*', 'LFHS\\*'];
const found = [];
for (const c of codes) {
    const re = new RegExp(`([\\d.-]+) Td\\s*\\(${c}\\)`, 'g');
    let m;
    while ((m = re.exec(raw))) found.push({ c: c.replace('\\', ''), y: parseFloat(m[1]) });
}
found.sort((a, b) => b.y - a.y);
console.log('Lignes alternates (y, origine bas) :');
found.forEach(f => console.log(`  ${f.c.padEnd(6)} y=${f.y.toFixed(1)}`));

let failures = 0;
const ko = m => { failures++; console.log('KO  ' + m); };
const ok = m => console.log('OK  ' + m);
if (found.length !== 8) ko(`${found.length}/8 lignes trouvées`); else ok('8 lignes rendues');
const gaps = found.slice(1).map((f, i) => found[i].y - f.y);
if (gaps.every(g => Math.abs(g - 15) < 0.6)) ok(`interlignes réguliers (${gaps.map(g => g.toFixed(1)).join(', ')})`);
else ko(`interlignes : ${gaps.map(g => g.toFixed(1)).join(', ')}`);
const maxY = Math.max(...found.map(f => f.y));
const minY = Math.min(...found.map(f => f.y));
if (minY > 45 && maxY < 560) ok(`y ∈ [${minY.toFixed(0)}, ${maxY.toFixed(0)}] — au-dessus du pied de page`);
else ko(`y ∈ [${minY}, ${maxY}] déborde`);

console.log(failures ? `${failures} ÉCHEC(S)` : 'TOUT OK');
process.exit(failures ? 1 : 0);
