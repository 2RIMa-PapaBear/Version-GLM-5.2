// FICHES ICARUS (FFA) — tests : intégrité de data/icarus.json (source
// officielle FFA uniquement), graceful degradation Node du chargeur,
// hasIcarus/icarusEntry sur l'index injecté (LFRV = NON couvert).
import test from 'node:test';
import { ok, equal } from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const m = await import('../js/icarus.js');

const j = JSON.parse(fs.readFileSync(path.join(root, 'data', 'icarus.json'), 'utf8'));

test('icarus.json : enveloppe officielle FFA (portail, source, count)', () => {
    ok(/^https:\/\/ffa-aero\.fr\//.test(j.portalUrl), 'portail officiel FFA : ' + j.portalUrl);
    ok(/FFA/.test(j.source), 'source nommée FFA');
    const codes = Object.keys(j.icaos);
    equal(j.count, codes.length, `count ${j.count} = ${codes.length} entrées`);
    ok(codes.length >= 55, 'couverture officielle relevée (61 au 27/09/2026)');
    ok(/ffa-aero\.fr/.test(j.source) || /ffa-aero\.fr/.test(j.practiceUrl || ''), 'traçabilité source');
});

test('icarus.json : codes et URLs bien formés, uniques, liens sortants officiels', () => {
    const codes = Object.keys(j.icaos);
    ok(codes.every(c => /^(LF|TF)[A-Z]{2}$/.test(c)), 'codes OACI LF/TF');
    equal(new Set(codes).size, codes.length, 'pas de doublon');
    for (const [c, e] of Object.entries(j.icaos)) {
        ok(e.name && e.name.length >= 3, `${c} : nom présent`);
        ok(/^https:\/\/ffa-aero\.fr\//.test(e.url), `${c} : lien sortant vers le site officiel FFA`);
    }
});

test('icarus.json : couverture attendue — LFRV absent, LFRN/LFER/LFOO présents', () => {
    // LFRV Vannes : NON couvert (cas négatif du terrain du pilote).
    equal(j.icaos.LFRV, undefined, 'LFRV non couvert');
    for (const c of ['LFRN', 'LFER', 'LFOO']) {
        ok(j.icaos[c], `${c} couvert`);
    }
    // Outre-mer inclus dans le relevé officiel (Martinique / Guadeloupe).
    ok(j.icaos.TFFF && j.icaos.TFFC, 'TFFF/TFFC outre-mer couverts');
});

test('loadIcarusIndex : Node sans réseau/IDB → null sans lever', async () => {
    const idx = await m.loadIcarusIndex();
    equal(idx, null, 'échec complet propre en Node (fetch relatif impossible)');
    equal(m.hasIcarus('LFRN'), false, 'non couvert tant que l index n est pas chargé');
});

test('hasIcarus/icarusEntry : index injecté — couverture et cas null', () => {
    m._setIcarusIndexForTests(j);
    equal(m.hasIcarus('LFRN'), true, 'Rennes couvert');
    equal(m.hasIcarus('lfrn'), true, 'normalisation casse');
    equal(m.hasIcarus('LFRV'), false, 'Vannes non couvert');
    equal(m.hasIcarus(''), false);
    equal(m.hasIcarus(null), false);
    equal(m.hasIcarus('XXXX'), false, 'code inconnu');
    const e = m.icarusEntry('LFOO');
    ok(e && /^https:\/\/ffa-aero\.fr\//.test(e.url), 'entrée LFOO : lien officiel');
    ok(/SABLES/.test(e.name), 'entrée LFOO : nom');
    m._setIcarusIndexForTests(null);
    equal(m.icarusEntry('LFOO'), null, 'index absent → null');
});
