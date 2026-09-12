// Fusion PIB du repli tronçons (retour pilote 12/09 « SOFIA HTTP 400 » sur
// LFRV → LFRE → LFFO → LFOO → LFTA → LFBH) : SOFIA rejette les couloirs qui
// reviennent en arrière ; le worker interroge alors chaque tronçon et
// fusionne. Ici : dédup FIR par id, ADDep/ADDes premier/dernier, recompte.
import test from 'node:test';
import assert from 'node:assert';
import { mergeNotamLists, mergePibChunks } from '../worker/fusion-pib.mjs';

const notam = (id) => ({ id: String(id), series: 'A', number: id, qLine: { traffic: 'V' } });

// PIB de tronçon synthétique : ADDep rempli, ADDes rempli, FIR avec 1 NOTAM.
const chunk = (dep, arr, firIds, extra = {}) => ({
    pibUid: `uid-${dep}`,
    validFrom: '2026-09-12T12:00:00Z',
    listnotams: {
        ADDep: { code: dep, name: `N${dep}`, procedures: firIds.map(notam) },
        ADDes: { code: arr, name: `N${arr}`, balisage: firIds.map(notam) },
        ADDeg: [], ADSur: [], Other: [],
        FIR: {
            organisation_espace_procedures: [{
                code23: 'AT',
                sortedNotamsByImpactedAerodromes: [{
                    code: 'LFRB', name: 'BREST',
                    sortedNotamsByPurpose: [{ purpose: 'NBO', notam: firIds.map(notam) }],
                }],
            }],
        },
        ...extra,
    },
});

test('mergeNotamLists : union dédupliquée par id', () => {
    assert.deepEqual(mergeNotamLists([notam(1), notam(2)], [notam(2), notam(3)]).map(n => n.id), ['1', '2', '3']);
    assert.deepEqual(mergeNotamLists(null, [notam(1)]).map(n => n.id), ['1']);
});

test('mergePibChunks : ADDep du premier tronçon, ADDes du dernier', () => {
    const out = mergePibChunks([chunk('LFRV', 'LFTA', [10]), chunk('LFTA', 'LFBH', [20])]);
    assert.equal(out.listnotams.ADDep.code, 'LFRV', 'départ global = tronçon 1');
    assert.equal(out.listnotams.ADDes.code, 'LFBH', 'arrivée globale = dernier tronçon');
});

test('mergePibChunks : FIR fusionnée, NOTAM communs aux 2 tronçons comptés une fois', () => {
    // 10 couvre les 2 tronçons, 20 uniquement le second.
    const out = mergePibChunks([chunk('LFRV', 'LFTA', [10]), chunk('LFTA', 'LFBH', [10, 20])]);
    const fir = out.listnotams.FIR.organisation_espace_procedures;
    const notams = fir[0].sortedNotamsByImpactedAerodromes[0].sortedNotamsByPurpose[0].notam;
    assert.deepEqual(notams.map(n => n.id), ['10', '20'], 'dédup par id');
    // Recompte GLOBAL dédupliqué (un NOTAM cité dans plusieurs catégories
    // ou sur plusieurs tronçons ne compte qu'une fois) : {10, 20}.
    assert.equal(out.nbNotams, 2, 'recompte = NOTAM distincts');
});

test('mergePibChunks : ADDeg fusionnés par terrain, tronçons vides tolérés', () => {
    const avecDeg = chunk('A', 'B', [1], {
        ADDeg: [{ code: 'LFRE', name: 'ROCHE', procedures: [notam(5)] }],
    });
    const out = mergePibChunks([avecDeg, chunk('B', 'C', [2], {
        ADDeg: [{ code: 'LFRE', name: 'ROCHE', balisage: [notam(5), notam(6)] }],
    }), null]);
    const deg = out.listnotams.ADDeg;
    assert.equal(deg.length, 1, 'un seul bloc LFRE');
    const ids = Object.values(deg[0]).filter(Array.isArray).flat().map(n => n.id).sort();
    assert.deepEqual(ids, ['5', '6'], 'dégagements dédupliqués');
    assert.equal(out.pibUid, 'uid-A', 'en-tête du premier tronçon');
});

test('mergePibChunks : aucun chunk exploitable → erreur explicite', () => {
    assert.throws(() => mergePibChunks([null, { listnotams: null }]), /aucun tronçon/);
});
