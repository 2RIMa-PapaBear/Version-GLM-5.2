// TEMSI (B3 v2) — tests : parseur Worker (sur la capture RÉELLE du
// 16/09), libellés UTC/locale, plus proche échéance, heure cible.
import test from 'node:test';
import { ok, equal, deepEqual } from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { parseTemsiLayers } = await import('../worker/index.js');
const { temsiLabels, nearestEcheance, temsiTargetMs } = await import('../js/temsi.js');

// Extrait RÉEL de get_domaine_layers_echeances.php?domaine=19 (recon 16/09).
const CAPTURE = `<span>TEMSI SFC -FL 150</span><br><table><tr>
<td><a onclick="goCartesAnim(1,'20260916150000',19,20,'0px','0px','0px','0px');">15 UTC</a><br>
<img onclick="return newwindow('affiche_image.php?mode=pdf&type=sigwx/fr/france&date=20260916150000&time=1');"></td>
<td><a onclick="goCartesAnim(1,'20260916180000',19,20,'0px','0px','0px','0px');">18 UTC</a><br>
<img onclick="return newwindow('affiche_image.php?mode=pdf&type=sigwx/fr/france&date=20260916180000&time=1');"></td></tr></table>
<span>WINTEM FL 020 - 100</span><br><table><tr>
<td><a onclick="goCartesAnim(2,'20260916150000',19,20,'0px','0px','0px','0px');">15 UTC</a><br>
<img onclick="affiche_image.php?mode=pdf&type=wintemp/fr/france/fl020&date=20260916150000"></td>
<td><a onclick="goCartesAnim(2,'20260916210000',19,20,'0px','0px','0px','0px');">21 UTC</a></td></tr></table>`;

test('parseTemsiLayers : couches France + échéances (capture réelle)', () => {
    const layers = parseTemsiLayers(CAPTURE);
    equal(layers.length, 2);
    equal(layers[0].key, 'temsi');
    equal(layers[0].type, 'sigwx/fr/france');
    deepEqual(layers[0].echeances.map(e => e.utc), ['20260916150000', '20260916180000']);
    equal(layers[0].echeances[0].label, '15h UTC');
    equal(layers[1].key, 'wintem');
    equal(layers[1].type, 'wintemp/fr/france/fl020');
    deepEqual(layers[1].echeances.map(e => e.utc), ['20260916150000', '20260916210000']);
    // La capture réelle complète (si présente) passe aussi.
    const capPath = path.join(process.env.TEMP || '/tmp', 'dom19.html');
    if (fs.existsSync(capPath)) {
        const html = new TextDecoder('windows-1252').decode(fs.readFileSync(capPath));
        const real = parseTemsiLayers(html);
        ok(real.length >= 2, `capture réelle : ${real.length} couches`);
        ok(real[0].echeances.length >= 2);
    }
});

test('parseTemsiLayers : HTML inattendu → [] (jamais de couches fantômes)', () => {
    deepEqual(parseTemsiLayers('<html>login</html>'), []);
    deepEqual(parseTemsiLayers(''), []);
});

test('temsiLabels : UTC + heure locale', () => {
    const l = temsiLabels('20260916150000');
    equal(l.utc, '15h00 UTC');
    ok(/^\d{2}h\d{2}$/.test(l.loc), 'heure locale formatée : ' + l.loc);
    // Heure locale = rendu LOCAL de 15:00Z (indépendant du fuseau de la
    // machine — CI en UTC, dev en UTC+2 ; avant : assertion « ≠ 15h00 »
    // qui échouait sur un runner UTC).
    const d = new Date(Date.UTC(2026, 8, 16, 15, 0, 0));
    const p = (n) => String(n).padStart(2, '0');
    equal(l.loc, `${p(d.getHours())}h${p(d.getMinutes())}`, 'conversion locale exacte');
    equal(temsiLabels('xx').utc, '?', 'date invalide → ?');
});

test('nearestEcheance + temsiTargetMs : mise en avant intelligente', () => {
    const echs = [{ utc: '20260916150000' }, { utc: '20260916180000' }, { utc: '20260916210000' }];
    // Cible 17h10 → la plus proche est 18h.
    const target = Date.parse('2026-09-16T17:10:00Z');
    equal(nearestEcheance(echs, target).utc, '20260916180000');
    equal(nearestEcheance([], target), null);
    equal(nearestEcheance(null, target), null);
    // Sans plan : cible ≈ maintenant + 1 h.
    const t1 = temsiTargetMs();
    ok(Math.abs(t1 - (Date.now() + 3600000)) < 5000, 'sans plan : now + 1 h');
});
