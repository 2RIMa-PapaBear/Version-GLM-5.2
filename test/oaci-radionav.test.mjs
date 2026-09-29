/* QA des symboles + annotations OACI des moyens de radionavigation
 * (présentation validée sur planche par le pilote le 27/09 —
 * test/oaci-extract/planche-radionav.html). */

import test from 'node:test';
import { equal, ok, throws } from 'node:assert';
import {
    RADIONAV_BLUE, RADIONAV_KINDS, RADIONAV_KIND_LABEL,
    radionavSymbolSvg, radionavMapSize, radionavFreqText,
    radionavAnnotationHtml, radionavLeaderLine, radionavMarkerHtml,
} from '../js/oaci-radionav.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

test('radionavSymbolSvg : VOR = hexagone + point central, bleu OACI', () => {
    const svg = radionavSymbolSvg('vor');
    ok(svg.includes('viewBox="0 0 43 39"'), 'taille document 43×39');
    ok(svg.includes('<polygon'), 'hexagone = polygone');
    ok(svg.includes('<circle'), 'point central');
    ok(svg.includes(RADIONAV_BLUE), 'bleu OACI');
    equal((svg.match(/<polygon/g) || []).length, 1, 'un seul polygone (pas de cadre)');
});

test('radionavSymbolSvg : VOR-DME = cadre + hexagone inscrit touchant les bords', () => {
    const svg = radionavSymbolSvg('vor-dme');
    ok(svg.includes('<rect'), 'cadre rectangulaire = DME');
    equal((svg.match(/<polygon/g) || []).length, 1, 'hexagone');
    ok(svg.includes('viewBox="0 0 50 38"'), 'taille document 50×38');
});

test('radionavSymbolSvg : NDB = cercle central + 3 couronnes de points + point', () => {
    const svg = radionavSymbolSvg('ndb');
    const rings = svg.match(/stroke-dasharray="0\.01 /g) || [];
    equal(rings.length, 3, '3 couronnes de points');
    ok(/r="36\.5"/.test(svg), 'couronne externe r36,5 (photo pilote)');
    ok(/r="12"/.test(svg), 'cercle central r12');
    ok(svg.includes('fill="' + RADIONAV_BLUE + '"'), 'point central plein');
});

test('radionavSymbolSvg : DME ENR = rectangle + point central', () => {
    const svg = radionavSymbolSvg('dme');
    ok(svg.includes('<rect'), 'rectangle');
    ok(svg.includes('fill="' + RADIONAV_BLUE + '"'), 'point central');
});

test('radionavSymbolSvg : TACAN = copie conforme (chemin evenodd TACAN_2 validé)', () => {
    const svg = radionavSymbolSvg('tacan');
    ok(svg.includes('fill-rule="evenodd"'), 'chemin evenodd');
    equal((svg.match(/<path/g) || []).length, 1, 'chemin unique');
});
test('radionavSymbolSvg : kind inconnu → erreur (VOR-TACAN en réserve)', () => {
    throws(() => radionavSymbolSvg('vor-tacan'), /kind inconnu/);
    ok(!RADIONAV_KINDS.includes('vor-tacan'), 'VOR-TACAN hors kinds rendus');
});
test('radionavFreqText : TACAN entre parenthèses (légende « (D) LDV (115.15) »)', () => {
    equal(radionavFreqText(115.15, 'tacan'), '(115.15)');
    equal(radionavFreqText(116.2, 'tacan'), '(116.2)');
});

test('radionavMapSize : tailles relatives du document, NDB −30 %', () => {
    deepEqualish(radionavMapSize('vor'), [24, 21], 'VOR ≈ 24 px');
    deepEqualish(radionavMapSize('vor-dme'), [28, 21], 'VOR-DME ≈ 28 px');
    deepEqualish(radionavMapSize('ndb'), [30, 30], 'NDB ≈ 30 px (78×0,385)');
    deepEqualish(radionavMapSize('dme'), [29, 21], 'DME ≈ 29 px');
});

function deepEqualish(a, b, msg) {
    equal(a[0], b[0], msg + ' — largeur');
    equal(a[1], b[1], msg + ' — hauteur');
}

test('radionavFreqText : NDB kHz entiers, VOR/DME MHz sans unité (carte papier)', () => {
    equal(radionavFreqText(413, 'ndb'), '413');
    equal(radionavFreqText(110.4, 'vor'), '110.4');
    equal(radionavFreqText(114.85, 'dme'), '114.85');
    equal(radionavFreqText(110.4, 'vor-dme'), '110.4');
    equal(radionavFreqText(null, 'vor'), '');
});

test('radionavAnnotationHtml : (D) pour VOR-DME et DME, nom posé sur le cadre, pas de type', () => {
    const roa = radionavAnnotationHtml('vor-dme', { ident: 'ROA', freq: 110.4, officialName: 'ROANNE' }, { esc });
    ok(roa.includes('(D) ROA 110.4'), 'préfixe (D) + ident + fréquence');
    ok(roa.includes('class="rn-name">ROANNE<'), 'nom sur le cadre');
    ok(!roa.includes('VOR-DME</'), 'pas de mot-type sous l encadré');

    const bne = radionavAnnotationHtml('vor', { ident: 'BNE', freq: 113.8, officialName: 'BOULOGNE' }, { esc });
    ok(bne.includes('BNE 113.8'), 'VOR simple sans préfixe');
    ok(!bne.includes('(D)'), 'pas de (D) sur un VOR simple');

    const alm = radionavAnnotationHtml('ndb', { ident: 'ALM', freq: 413, officialName: null }, { esc });
    ok(alm.includes('ALM 413'), 'NDB sans nom : encadré seul');
    ok(!alm.includes('rn-name'), 'pas de span nom');

    const bsn = radionavAnnotationHtml('dme', { ident: 'BSN', freq: 114.85, officialName: null }, { esc });
    ok(bsn.includes('(D) BSN 114.85'), 'DME ENR avec (D) (légende)');
});

test('radionavAnnotationHtml : ident échappé (XSS)', () => {
    const h = radionavAnnotationHtml('vor', { ident: '<b>X</b>', freq: null, officialName: null }, { esc });
    ok(!h.includes('<b>X</b>'), 'ident échappé');
});

test('radionavLeaderLine : vise le centre, s accroche AU-DELÀ du bord du symbole', () => {
    for (const kind of RADIONAV_KINDS) {
        const [w, h] = radionavMapSize(kind);
        const [x1, y1, x2, y2] = radionavLeaderLine(kind);
        equal(x2, w + 14, kind + ' : aboutit au milieu gauche du cadre');
        const cx = w / 2, cy = h / 2;
        // point d'accroche hors de l ellipse enveloppe (bord du dessin)
        const nx = (x1 - cx) / (w / 2 - 1), ny = (y1 - cy) / (h / 2 - 1);
        ok(Math.abs(nx * nx + ny * ny - 1) < 1e-6, kind + ' : posé sur le bord');
        // direction cadre → centre alignée
        const cross = (x2 - x1) * (cy - y1) - (y2 - y1) * (cx - x1);
        ok(Math.abs(cross) < 1e-6, kind + ' : ligne alignée sur le centre');
    }
});

test('radionavMarkerHtml : symbole seul sans étiquette, composé avec', () => {
    const bare = radionavMarkerHtml('vor', { ident: 'BNE', freq: 113.8, officialName: null }, { esc });
    ok(!bare.includes('rn-ann'), 'sans étiquette : pas d annotation');
    ok(!bare.includes('rn-lead'), 'sans étiquette : pas de trait de rappel');
    const full = radionavMarkerHtml('vor', { ident: 'BNE', freq: 113.8, officialName: 'BOULOGNE' }, { withLabel: true, esc });
    ok(full.includes('rn-ann'), 'avec étiquette : annotation');
    ok(full.includes('class="rn-lead"'), 'trait de rappel présent');
    ok(full.includes('BOULOGNE'), 'nom rendu');
});

test('RADIONAV_KIND_LABEL : libellés waypoints/popups', () => {
    equal(RADIONAV_KIND_LABEL['vor-dme'], 'VOR-DME');
    equal(RADIONAV_KIND_LABEL.dme, 'DME');
    equal(RADIONAV_KIND_LABEL.ndb, 'NDB');
});
