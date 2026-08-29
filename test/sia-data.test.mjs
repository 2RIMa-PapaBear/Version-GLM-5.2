// Tests des données auxiliaires officielles SIA (pistes, déclinaison,
// élévation — data/sia-runways.json / sia-airfields.json) : helpers purs
// de js/sia-data.js + cohérence des fichiers générés.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
    _importForTests, getSiaRunways, siaRunwayFor, getSiaAirfield,
    getOfficialDeclination, siaRunwayLengthFt, siaSurfaceCode, siaThresholds,
} from '../js/sia-data.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rw = JSON.parse(readFileSync(path.join(ROOT, 'data', 'sia-runways.json'), 'utf8'));
const af = JSON.parse(readFileSync(path.join(ROOT, 'data', 'sia-airfields.json'), 'utf8'));

test('sia-data : données générées cohérentes', () => {
    assert.ok(rw.count >= 600, `au moins 600 pistes (trouvé ${rw.count})`);
    assert.equal(Object.values(rw.items).reduce((a, v) => a + v.length, 0), rw.count);
    // Longueurs en MÈTRES : aucune piste française ne dépasse 5000 m.
    for (const [icao, list] of Object.entries(rw.items)) {
        assert.match(icao, /^LF[A-Z0-9]{2}$/);
        for (const r of list) {
            assert.ok(r.len > 50 && r.len < 5000, `${icao} longueur suspecte : ${r.len}`);
            assert.match(r.d, /^\d{2}[LRC]?(\/\d{2}[LRC]?)?$/, 'paire (ou piste monodirectionnelle)');
        }
    }
    assert.ok(af.items.length >= 500);
});

test('sia-data : LFEQ Quiberon — 775 m revêtue, seuils avec altitudes', () => {
    const q = rw.items.LFEQ;
    assert.ok(q, 'LFEQ présent');
    assert.equal(q[0].d, '11/29');
    assert.equal(q[0].len, 775);
    assert.equal(q[0].surf, 'revêtue');
    assert.equal(q[0].t1.id, '11');
    assert.equal(typeof q[0].t1.altFt, 'number');
    assert.equal(typeof q[0].t2.altFt, 'number');
});

test('sia-data : recherche de piste et longueur en pieds', () => {
    _importForTests(rw.items, af.items);
    const r = siaRunwayFor('lfeq', '29');
    assert.equal(r.d, '11/29');
    assert.equal(siaRunwayLengthFt('LFEQ', '29'), Math.round(775 * 3.28084));
    assert.equal(siaRunwayLengthFt('LFEQ'), Math.round(775 * 3.28084), 'piste principale par défaut');
    assert.equal(siaRunwayFor('LFEQ', '36'), null, 'numéro absent');
    assert.equal(siaRunwayLengthFt('KJFK'), null, 'hors France → null (repli openAIP)');
});

test('sia-data : revêtement officiel → code standard', () => {
    assert.equal(siaSurfaceCode('revêtue'), 'ASP');
    assert.equal(siaSurfaceCode('macadam'), 'ASP');
    assert.equal(siaSurfaceCode('béton bitumineux'), 'ASP');
    assert.equal(siaSurfaceCode('herbe'), 'GRS');
    assert.equal(siaSurfaceCode(''), null);
    assert.equal(siaSurfaceCode('non revêtue'), 'GRV');
});

test('sia-data : seuils au format runways-geo', () => {
    _importForTests(rw.items, af.items);
    const t = siaThresholds('LFEQ');
    assert.equal(t.length, 1);
    assert.equal(t[0].desig, '11');
    assert.equal(t[0].desig2, '29');
    assert.ok(Number.isFinite(t[0].lat) && Number.isFinite(t[0].lat2));
    assert.equal(siaThresholds('KJFK').length, 0);
});

test('sia-data : déclinaison et élévation officielles', () => {
    _importForTests(rw.items, af.items);
    const q = getSiaAirfield('LFEQ');
    assert.equal(q.elevFt, 38);
    assert.ok(Math.abs(q.magVar - 0.24) < 1e-9, 'magVar LFEQ = 0.24°');
    assert.equal(getOfficialDeclination('LFEQ'), 0.24);
    assert.equal(getOfficialDeclination('KJFK'), null, 'hors France → null (repli WMM)');
    // Tous les terrains ont une déclinaison raisonnable (France : ±10°).
    for (const t of af.items) {
        if (typeof t.magVar === 'number') assert.ok(Math.abs(t.magVar) < 10, `${t.code} magVar suspecte : ${t.magVar}`);
    }
});
