/* QA du module radio-points (radiophares VOR/NDB + points VFR mondiaux).
 * Fonctions pures + chargeur avec fetch injecté (IndexedDB absent sous
 * Node : les branches de repli sont exercées aussi). */

import test from 'node:test';
import assert from 'node:test';
import { strictEqual, deepStrictEqual, ok, equal } from 'node:assert';
import {
    classifyNavaid, parseRadioPoints, parseObstacles, filterBbox, visibleKinds,
    formatFreq, loadRadioPoints, loadObstacles, WEEK_MS, LAYER_MIN_ZOOM,
    OBSTACLE_CATS,
} from '../js/radio-points.js';

test('classifyNavaid : bande kHz = NDB, bande 108-118 MHz = VOR', () => {
    equal(classifyNavaid(355, 1), 'NDB', '355 kHz');
    equal(classifyNavaid(323, 1), 'NDB', '323 kHz');
    equal(classifyNavaid(113.3, 2), 'VOR', '113.3 MHz');
    equal(classifyNavaid(114.3, 2), 'VOR', '114.3 MHz');
    equal(classifyNavaid(400, null), 'NDB', 'sans unité, plage kHz');
    equal(classifyNavaid(112, null), 'VOR', 'sans unité, plage MHz');
});

test('parseRadioPoints : séparation VOR/NDB/VRP et rejet des points invalides', () => {
    const parsed = parseRadioPoints({
        generatedAt: '2026-08-22T12:00:00.000Z',
        counts: { navaids: 4, vrps: 2 },
        navaids: [
            [4, 'LGL', 48.79056, 0.53028, 112.7, 2],
            [2, 'AN', 47.5, 3.2, 355, 1],
            [0, 'X', null, 2, 110, 2],            // lat invalide → rejet
            [1, 'Y', 10, 20, null, 2],            // freq absente → conservé
        ],
        vrps: [
            ['AC', 49.44806, 0.90528, 'FR'],
            ['', 49, 1, 'FR'],                    // sans nom → rejet
        ],
    });
    equal(parsed.vor.length, 2, '2 VOR');
    equal(parsed.ndb.length, 1, '1 NDB');
    equal(parsed.vrp.length, 1, '1 VRP');
    equal(parsed.vrp[0].cc, 'FR', 'pays conservé');
    equal(parsed.vor[1].freq, null, 'freq null tolérée');
    equal(parsed.generatedAt, '2026-08-22T12:00:00.000Z');
    equal(parseRadioPoints({}), null, 'format invalide → null');
    equal(parseRadioPoints(null), null, 'absence → null');
});

test('parseRadioPoints : VRP SIA avec description (5ᵉ élément)', () => {
    const parsed = parseRadioPoints({
        navaids: [[4, 'LGL', 48.79, 0.53, 112.7, 2]],
        vrps: [
            ['MM-CV', 43.81083, 5.04222, 'FR', 'VRP-Cavaillon (Pont TGV sur la Durance)'],
            ['AC', 49.44806, 0.90528, 'FR'],
            ['XX', 10, 20, 'PH', ''],
        ],
    });
    equal(parsed.vrp[0].desc, 'VRP-Cavaillon (Pont TGV sur la Durance)');
    equal(parsed.vrp[0].sia, true, 'point marqué officiel SIA');
    equal(parsed.vrp[1].desc, null, 'openAIP sans description');
    equal(parsed.vrp[1].sia, false);
    equal(parsed.vrp[2].sia, false, 'hors France jamais marqué SIA');
});

// Fusion SIA des navaids France (VOR-DME inclus depuis le 29/08, fréquences
// officielles <RadioNav>) — cohérence du fichier généré.
test('radio-points.json : navaids SIA France (VOR/VOR-DME/NDB + RadioNav)', async () => {
    const { readFile } = await import('node:fs/promises');
    const json = JSON.parse(await readFile(new URL('../data/radio-points.json', import.meta.url), 'utf8'));
    ok(json.counts?.navaidsSia >= 115, `≥115 navaids officiels SIA (${json.counts?.navaidsSia})`);
    // Les 7 VOR-DME absents d'openAIP, avec leur fréquence officielle.
    const ATTENDUS = { BT: 116.1, CNM: 111.4, LSE: 114.75, MEN: 115.3, ROA: 110.4, TOU: 117.7, CAV: 111.65 };
    for (const [ident, freq] of Object.entries(ATTENDUS)) {
        const hit = json.navaids.find(n => n[1] === ident && n[2] > 41 && n[2] < 50 && n[3] > -5 && n[3] < 9);
        ok(hit, `${ident} présent en France`);
        equal(hit[4], freq, `${ident} fréquence officielle ${freq}`);
    }
    // Pas de détournement d'ident : l'entrée openAIP « LDV » champenoise ne
    // doit PAS avoir été écrasée par le TACAN breton (collision mesurée).
    const ldv = json.navaids.filter(n => n[1] === 'LDV');
    ok(ldv.every(n => Math.abs(n[2] - 48.53) < 0.01), 'LDV inchangé (garde de proximité)');
});

test('filterBbox : cadre simple et antiméridien (est < ouest)', () => {
    const pts = [
        { lat: 0, lon: 0 }, { lat: 0, lon: 10 },
        { lat: 0, lon: 178 }, { lat: 0, lon: -178 },
        { lat: 50, lon: 178 },                   // hors latitude
    ];
    deepStrictEqual(filterBbox(pts, -5, -5, 15, 5).map(p => p.lon), [0, 10], 'cadre simple');
    // Cadre traversant ±180° : [170,180] ∪ [-180,-170]
    deepStrictEqual(filterBbox(pts, 170, -5, -170, 5).map(p => p.lon), [178, -178], 'antiméridien');
});

test('visibleKinds : VOR, NDB et points VFR AU MÊME niveau de zoom ; obstacles plus locaux', () => {
    deepStrictEqual(visibleKinds(5), { vor: false, ndb: false, vrp: false, obstacle: false }, 'z5 : rien');
    deepStrictEqual(visibleKinds(6), { vor: true, ndb: true, vrp: true, obstacle: false }, 'z6 : les trois couches, pas les obstacles');
    deepStrictEqual(visibleKinds(LAYER_MIN_ZOOM.obstacle), { vor: true, ndb: true, vrp: true, obstacle: true }, 'z seuil obstacles : tout');
    const zs = [LAYER_MIN_ZOOM.vor, LAYER_MIN_ZOOM.ndb, LAYER_MIN_ZOOM.vrp];
    ok(new Set(zs).size === 1, `seuils identiques (${zs.join('/')})`);
    ok(LAYER_MIN_ZOOM.obstacle > zs[0], 'obstacles = couche plus locale (8 900 points FR)');
});

test('formatFreq : kHz entiers, MHz à 1-2 décimales', () => {
    equal(formatFreq(355, 1), '355 kHz');
    equal(formatFreq(113.3, 2), '113.3 MHz');
    equal(formatFreq(110, 2), '110.0 MHz');
    equal(formatFreq(null, 2), '');
});

test('loadRadioPoints : fetch puis cache mémoire, repli sans réseau', async () => {
    const file = {
        generatedAt: '2026-08-22T00:00:00.000Z',
        navaids: [[1, 'AAA', 1, 2, 110, 2]],
        vrps: [['PP', 3, 4, 'FR']],
    };
    let calls = 0;
    const fetchImpl = async (url) => { calls++; return { ok: true, json: async () => file }; };
    const r1 = await loadRadioPoints({ fetchImpl, now: 1000 });
    equal(r1.vor.length, 1, 'VOR chargé');
    equal(r1.vrp[0].name, 'PP', 'VRP chargé');
    equal(r1.stale, false, 'frais');
    ok(calls === 1, 'un seul fetch');

    // Sans réseau et sans cache (Node) : null silencieux.
    const r2 = await loadRadioPoints({ fetchImpl: () => Promise.reject(new Error('off')), now: 2000 });
    equal(r2, null, 'échec sans cache → null');

    // URL : suffixe anti-cache après une semaine (vérifiée sur le fetch).
    let seenUrl = '';
    const fetchUrl = async (url) => { seenUrl = url; return { ok: true, json: async () => file }; };
    await loadRadioPoints({ fetchImpl: fetchUrl, now: 1000 });
    ok(!seenUrl.includes('?t='), 'frais : pas de contournement');
    await loadRadioPoints({ fetchImpl: fetchUrl, now: 1000 + WEEK_MS + 1 });
    ok(seenUrl.includes('?t='), 'périmé : contournement cache HTTP');
});

test('le fichier data/radio-points.json généré est conforme et mondial', async () => {
    const { readFile } = await import('node:fs/promises');
    const json = JSON.parse(await readFile(new URL('../data/radio-points.json', import.meta.url), 'utf8'));
    const parsed = parseRadioPoints(json);
    ok(parsed, 'parsable');
    ok(parsed.vor.length > 2000, `VOR mondiaux plausibles (${parsed.vor.length})`);
    ok(parsed.ndb.length > 1000, `NDB mondiaux plausibles (${parsed.ndb.length})`);
    ok(parsed.vrp.length > 5000, `points VFR mondiaux plausibles (${parsed.vrp.length})`);
    ok(parsed.generatedAt, 'horodatage présent');
    // Points VFR français présents (échantillon Pays de la Loire).
    const fr = parsed.vrp.filter(p => p.cc === 'FR');
    ok(fr.length > 400, `points VFR France plausibles (${fr.length})`);
});

test('parseObstacles : familles SIA, balisage, rejets ; loadObstacles sans réseau', async () => {
    equal(OBSTACLE_CATS.length, 6, '6 familles d\'obstacles');
    const parsed = parseObstacles({
        generatedAt: '2026-08-29T00:00:00.000Z',
        airac: '2026-09-03',
        obstacles: [
            [0, 43.43, 2.23, 410, 1657, 1, '22033', 'Eolienne(s)'],   // éolienne éclairée
            [1, 48.49, -1.92, 167, 318, 0, '12004', 'Pylône'],        // pylône non éclairé
            [3, 47.5, -0.5, 98, 350, 1, null, 'Château d\'eau'],      // sans numéro
            [4, 48.85, 2.35, null, 220, 0, 'T1', 'Tour'],             // sans hauteur
            [9, 44.2, 4.2, 50, 300, 1, 'X', 'Derrick'],               // cat hors enum → AUTRE (5)
            [0, null, 4.3, 50, 300, 1, 'Y', 'Eolienne(s)'],           // lat invalide → rejet
        ],
    });
    equal(parsed.obstacles.length, 5, '5 valides sur 6');
    deepStrictEqual(parsed.obstacles[0], { cat: 0, lat: 43.43, lon: 2.23, hFt: 410, elevFt: 1657, lgt: 1, name: '22033', type: 'Eolienne(s)' });
    equal(parsed.obstacles[1].lgt, 0, 'balisage non → 0');
    equal(parsed.obstacles[2].name, '', 'numéro absent → chaîne vide');
    equal(parsed.obstacles[3].hFt, null, 'hauteur inconnue → null');
    equal(parsed.obstacles[4].cat, 5, 'catégorie inconnue → AUTRE');
    equal(parsed.airac, '2026-09-03', 'date AIRAC conservée');
    equal(parseObstacles({}), null, 'format invalide → null');

    // Chargeur : fetch injecté OK, puis repli null sans réseau (pas d'IDB sous Node).
    const file = { generatedAt: 'x', obstacles: [[0, 1, 2, 80, 300, 1, 'E1', 'Eolienne(s)']] };
    const r1 = await loadObstacles({ fetchImpl: async () => ({ ok: true, json: async () => file }), now: 1000 });
    equal(r1.obstacles.length, 1, 'chargé');
    equal(r1.stale, false, 'frais');
    const r2 = await loadObstacles({ fetchImpl: () => Promise.reject(new Error('off')), now: 2000 });
    equal(r2, null, 'échec sans cache → null');
});

test('le fichier data/obstacles.json généré est conforme (SIA officiel)', async () => {
    const { readFile } = await import('node:fs/promises');
    const json = JSON.parse(await readFile(new URL('../data/obstacles.json', import.meta.url), 'utf8'));
    const parsed = parseObstacles(json);
    ok(parsed, 'parsable');
    equal(json.source, 'SIA', 'source officielle SIA');
    ok(json.airac, 'date AIRAC présente');
    ok(parsed.obstacles.length > 10000, `volume France plausible (${parsed.obstacles.length})`);
    ok(parsed.obstacles.length < 20000, 'pas de dérive mondiale');
    const cats = new Map();
    let lit = 0;
    for (const o of parsed.obstacles) { cats.set(o.cat, (cats.get(o.cat) ?? 0) + 1); if (o.lgt) lit++; }
    ok((cats.get(0) ?? 0) > 5000, `éoliennes dominantes (${cats.get(0)})`);
    ok((cats.get(1) ?? 0) > 500, `pylônes/mâts présents (${cats.get(1)})`);
    ok((cats.get(3) ?? 0) > 100, `châteaux d'eau présents (${cats.get(3)})`);
    ok(lit > 5000, `balisage lumineux renseigné (${lit} éclairés)`);
    // Coordonnées : grande majorité métropole + reste en territoires français
    // (Réunion, Nouvelle-Calédonie, Polynésie, Antilles…).
    const metro = parsed.obstacles.filter(o => o.lat > 40 && o.lat < 52 && o.lon > -6 && o.lon < 10).length;
    ok(metro > parsed.obstacles.length * 0.9, `métropole dominante (${metro}/${parsed.obstacles.length})`);
    ok(parsed.obstacles.every(o => Number.isFinite(o.lat) && Number.isFinite(o.lon)), 'coordonnées finies');
});
