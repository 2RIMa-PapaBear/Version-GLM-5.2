// Zones P — rangée de croix « XXX » rouges vers l'INTÉRIEUR (pilote 30/09)
// : noyau 2D pur (_crossSegments2D, partagé carte écran / carte PDF) et
// déclinaison lat/lon (_pZoneCrossSegments). Propriétés attendues :
//   - DEUX segments par croix, perpendiculaires, de longueur = size ;
//   - toutes les croix EN CONTACT avec la limite (pilote 30/09 : la
//     pointe côté ligne la touche, peinte par l'épaisseur du trait) SANS
//     JAMAIS la franchir — écart géométrique = inset − size·√½/2 ;
//   - les croix SE TOUCHENT le long de la limite (pas = size·√½) ;
//   - ORIENTATION : chaque croix pivote avec la ligne qui la porte
//     (équivariance par rotation du noyau) ;
//   - anneau parcouru dans un sens ou l'autre : mêmes résultats ;
//   - réflexion de l'axe y (coordonnées PDF, y vers le bas) : invariant —
//     le côté intérieur reste le bon sans aucun drapeau ;
//   - zone trop petite : aucune croix (pas de bouillie).
import test from 'node:test';
import assert from 'node:assert/strict';
import { _crossSegments2D, _pZoneCrossSegments } from '../js/airspaces.js';

// Carré géo CCW 0.1° × 0.1° vers lat 47 — même convention que le module :
// anneaux [lat, lon].
const SQ_CCW = [[47.0, -1.0], [47.0, -0.9], [47.1, -0.9], [47.1, -1.0]];
// inset = demi-emprise + 30 m de cheveu (couvert par l'épaisseur du trait
// à l'écran) : la pointe côté ligne reste à ~30 m du bord = contact peint.
const SPEC = { size: 300, spacing: 300 * Math.SQRT1_2, inset: 300 * Math.SQRT1_2 / 2 + 30 };

const kLat = 111320, kLon47 = 111320 * Math.cos(47 * Math.PI / 180);
// La rangée vit sur la LIGNE PORTEUSE (offset en mitre de inset) : pour
// le carré, rectangle en retrait de inset de chaque côté.
const rowPerimSq = 2 * ((0.1 * kLat - 2 * SPEC.inset) + (0.1 * kLon47 - 2 * SPEC.inset));
const expectedCount = Math.max(2, Math.round(rowPerimSq / SPEC.spacing));

test('_pZoneCrossSegments : deux segments par croix, effectif = périmètre PORTEUR / pas', () => {
    const segs = _pZoneCrossSegments(SQ_CCW, SPEC);
    assert.equal(segs.length % 2, 0, 'un nombre PAIR de segments (2 par croix)');
    assert.equal(segs.length / 2, expectedCount);
});

test('_pZoneCrossSegments : croix EN CONTACT avec la limite, sans la franchir', () => {
    // Contact = pointe la plus proche à inset − demi-emprise (30 m ici),
    // y compris aux angles convexes (garde de coin) ; jamais dehors.
    const gap = SPEC.inset - SPEC.size / 2 * Math.SQRT1_2;   // mètres
    const eps = 1e-9;
    let minLat = 99, maxLat = -99, minLon = 99, maxLon = -99;
    for (const seg of _pZoneCrossSegments(SQ_CCW, SPEC)) {
        for (const [lat, lon] of seg) {
            minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
            minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
        }
    }
    // Jamais dehors (les coins ont la garde +2 % : strictement dedans).
    assert.ok(minLat > 47.0 - eps && maxLat < 47.1 + eps, 'lat hors carré');
    assert.ok(minLon > -1.0 - eps && maxLon < -0.9 + eps, 'lon hors carré');
    // Contact : une pointe à ≤ gap + marge du bord, sur CHAQUE côté.
    const tol = 1e-7;
    assert.ok(minLat < 47.0 + gap / kLat + tol, `pas de contact au sud (${minLat})`);
    assert.ok(maxLat > 47.1 - gap / kLat - tol, `pas de contact au nord (${maxLat})`);
    assert.ok(minLon < -1.0 + gap / kLon47 + tol, `pas de contact à l ouest (${minLon})`);
    assert.ok(maxLon > -0.9 - gap / kLon47 - tol, `pas de contact à l est (${maxLon})`);
});

test('_pZoneCrossSegments : sens de parcours inversé (CW) — mêmes croix, dedans', () => {
    const cw = [...SQ_CCW].reverse();
    const segs = _pZoneCrossSegments(cw, SPEC);
    // Le périmètre est identique mais l ORIGINE du parcours change : la
    // répartition peut différer d UNE croix (arrondi), pas plus.
    assert.ok(Math.abs(segs.length / 2 - expectedCount) <= 1, 'même effectif à ±1');
    for (const seg of segs) {
        for (const [lat, lon] of seg) {
            assert.ok(lat > 47.0 && lat < 47.1 && lon > -1.0 && lon < -0.9);
        }
    }
});

test('_pZoneCrossSegments : sommet de fermeture dupliqué toléré', () => {
    const closed = [...SQ_CCW, SQ_CCW[0]];
    assert.equal(_pZoneCrossSegments(closed, SPEC).length,
        _pZoneCrossSegments(SQ_CCW, SPEC).length);
});

test('_pZoneCrossSegments : zone trop petite → aucune croix', () => {
    // Carré de 80 m de côté : périmètre 320 m < size·1.2 = 360 m.
    const mini = [[47.0, -1.0], [47.0, -1.0 + 80 / kLon47], [47.0 + 80 / kLat, -1.0 + 80 / kLon47], [47.0 + 80 / kLat, -1.0]];
    assert.deepEqual(_pZoneCrossSegments(mini, { size: 300, spacing: 300, inset: 60 }), []);
});

// Noyau 2D : forme des croix + contact côte à côte + axe y inversé (PDF).
const SQ2D = [[0, 0], [100, 0], [100, 100], [0, 100]];   // CCW en y vers le haut
const SPEC2D = { size: 10, spacing: 10 * Math.SQRT1_2, inset: 10 * Math.SQRT1_2 / 2 + 0.3 };

test('_crossSegments2D : croix perpendiculaires de longueur size, centrées sur la normale intérieure', () => {
    const segs = _crossSegments2D(SQ2D, SPEC2D);
    // Première croix : sur l'arête de départ (y=0), normale intérieure = +y.
    const [s1, s2] = [segs[0], segs[1]];
    const len = (s) => Math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]);
    assert.ok(Math.abs(len(s1) - 10) < 1e-9 && Math.abs(len(s2) - 10) < 1e-9, 'diagonales = size');
    const dot = (s1[1][0] - s1[0][0]) * (s2[1][0] - s2[0][0]) + (s1[1][1] - s1[0][1]) * (s2[1][1] - s2[0][1]);
    assert.ok(Math.abs(dot) < 1e-9, 'traits perpendiculaires');
    const cy = (s1[0][1] + s1[1][1]) / 2;
    assert.ok(Math.abs(cy - SPEC2D.inset) < 1e-9, `centrée à inset (y=${cy})`);
});

test('_crossSegments2D : les croix SE TOUCHENT le long d une même arête', () => {
    const segs = _crossSegments2D(SQ2D, SPEC2D);
    const centers = [];
    for (let i = 0; i + 1 < segs.length; i += 2) {
        centers.push([(segs[i][0][0] + segs[i][1][0]) / 2, (segs[i][0][1] + segs[i][1][1]) / 2]);
    }
    // Croix de l'arête du bas : centres à y = inset, triés par x.
    const bottom = centers.filter(([x, y]) => Math.abs(y - SPEC2D.inset) < 1e-6).sort((a, b) => a[0] - b[0]);
    assert.ok(bottom.length >= 2, 'au moins deux croix sur l arête du bas');
    const half = SPEC2D.size / 2 * Math.SQRT1_2;
    for (let i = 1; i < bottom.length; i++) {
        const gap = (bottom[i][0] - half) - (bottom[i - 1][0] + half);
        // Jamais de JOUR (gap ≤ 0.5) ; aux coins convexes la garde d écart
        // repousse la croix voisine → léger chevauchement, borné au pas.
        assert.ok(gap <= 0.5, `croix ${i - 1}-${i} : jour de ${gap}`);
        assert.ok(gap >= -SPEC2D.spacing, `croix ${i - 1}-${i} : chevauchement excessif ${gap}`);
    }
});

test('_crossSegments2D : ORIENTATION — la croix pivote avec sa ligne (équivariance)', () => {
    // Pilote 30/09 : « les X doivent suivre l orientation de la ligne qui
    // les concerne ». Tourner l anneau DOIT tourner les croix pareil : le
    // noyau est équivariant par rotation (aucun X figé droit).
    const a = 30 * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    const rot = ([x, y]) => [x * ca - y * sa, x * sa + y * ca];
    const ref = _crossSegments2D(SQ2D, SPEC2D);
    const got = _crossSegments2D(SQ2D.map(rot), SPEC2D);
    assert.equal(got.length, ref.length);
    for (let i = 0; i < ref.length; i++) {
        for (let j = 0; j < 2; j++) {
            const [x1, y1] = got[i][j], [x2, y2] = rot(ref[i][j]);
            assert.ok(Math.hypot(x1 - x2, y1 - y2) < 1e-6, `croix ${i / 2} non tournée avec la ligne`);
        }
    }
});

test('_crossSegments2D : pointe très aiguë — aucune pointe de croix ne sort', () => {
    // Aiguille fine (base 100, hauteur 4) : la garde de coin ne peut pas
    // tout couvrir près de la pointe — le filet de sécurité écarte les
    // croix fautives plutôt que de laisser déborder.
    const needle = [[0, 0], [100, 0], [50, 4]];
    const segs = _crossSegments2D(needle, { size: 6, spacing: 6 * Math.SQRT1_2, inset: 1.2 });
    const inside = (x, y) => {
        let c = false;
        for (let i = 0, j = needle.length - 1; i < needle.length; j = i++) {
            const a = needle[i], b = needle[j];
            if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
        }
        return c;
    };
    for (const s of segs) {
        for (const [x, y] of s) assert.ok(inside(x, y), `point (${x.toFixed(2)}, ${y.toFixed(2)}) hors de l aiguille`);
    }
});

test('_crossSegments2D : CERCLE densifié — rangée régulière sur la ligne porteuse (P 34)', () => {
    // Pilote 30/09 : « sur les cercles ce n'est pas bon du tout ». Un
    // cercle polygonal (densification SIA ~3-10°/sommet) : les croix
    // doivent être RÉGULIÈRES sur le cercle en retrait — l'espacement se
    // mesure sur la ligne porteuse, pas sur la limite.
    const R = 500, N = 72;
    const circ = [];
    for (let i = 0; i < N; i++) {
        const a = (i / N) * 2 * Math.PI;
        circ.push([R * Math.cos(a), R * Math.sin(a)]);
    }
    const CS = { size: 30, spacing: 30 * Math.SQRT1_2, inset: 30 * Math.SQRT1_2 / 2 + 1 };
    const segs = _crossSegments2D(circ, CS);
    assert.ok(segs.length >= 20, `assez de croix (${segs.length / 2})`);
    const centers = [];
    for (let i = 0; i + 1 < segs.length; i += 2) {
        centers.push([(segs[i][0][0] + segs[i][1][0]) / 2, (segs[i][0][1] + segs[i][1][1]) / 2]);
    }
    // Consecutives (ordre du parcours) : espacement ~spacing, JAMAIS
    // d'empilement (avant le fix, les gardes de coin tassaient les croix
    // des petits arcs au même point).
    for (let i = 1; i < centers.length; i++) {
        const d = Math.hypot(centers[i][0] - centers[i - 1][0], centers[i][1] - centers[i - 1][1]);
        assert.ok(d > CS.spacing * 0.5 && d < CS.spacing * 1.5,
            `croix ${i - 1}-${i} : écart ${d.toFixed(1)} (attendu ~${CS.spacing.toFixed(1)})`);
    }
    // Fermeture de la boucle : dernière → première aussi régulière.
    const dClose = Math.hypot(centers[0][0] - centers[centers.length - 1][0], centers[0][1] - centers[centers.length - 1][1]);
    assert.ok(dClose > CS.spacing * 0.5 && dClose < CS.spacing * 1.5, `fermeture : écart ${dClose.toFixed(1)}`);
    // Tout dedans ; centres sur le cercle en retrait.
    for (const s of segs) {
        for (const [x, y] of s) assert.ok(Math.hypot(x, y) <= R + 1e-9, 'point hors du cercle');
    }
    for (const [x, y] of centers) {
        const r = Math.hypot(x, y);
        assert.ok(Math.abs(r - (R - CS.inset)) < CS.size * 0.2, `centre à ${r.toFixed(1)} du centre (attendu ~${R - CS.inset})`);
    }
});

test('_crossSegments2D : HACHURES « /// » (R/D/CBA) — un trait +45°, contact, côte à côte', () => {
    // Pilote 30/09 : zones R/D/frontalières = même ligne que les P, mais
    // des ////// à la place des croix — EN CONTACT avec la limite.
    const segs = _crossSegments2D(SQ2D, SPEC2D, true);
    const xref = _crossSegments2D(SQ2D, SPEC2D, false);
    assert.equal(segs.length * 2, xref.length, 'UNE hachure là où la croix a deux traits');
    // Première hachure : sur l'arête du bas, bras à +45° (montant vers
    // la droite = « / »), longueur size, centre à inset.
    const s = segs[0];
    const len = Math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]);
    assert.ok(Math.abs(len - SPEC2D.size) < 1e-9, 'longueur = size');
    const ang = Math.atan2(s[1][1] - s[0][1], s[1][0] - s[0][0]);
    assert.ok(Math.abs(ang - Math.PI / 4) < 1e-9, `bras à +45° (ang=${ang})`);
    const cy = (s[0][1] + s[1][1]) / 2;
    assert.ok(Math.abs(cy - SPEC2D.inset) < 1e-9, 'centrée sur la ligne porteuse');
    // Contact avec la limite : extrémité basse à inset − demi-emprise.
    const ymin = Math.min(s[0][1], s[1][1]);
    assert.ok(Math.abs(ymin - (SPEC2D.inset - SPEC2D.size / 2 * Math.SQRT1_2)) < 1e-9, 'touche la limite');
    // Côte à côte : hachures de l'arête du bas sans jour (même règle que
    // les croix, l emprise le long de l arête est identique).
    const centers = segs.map((g) => [(g[0][0] + g[1][0]) / 2, (g[0][1] + g[1][1]) / 2]);
    const bottom = centers.filter(([x, y]) => Math.abs(y - SPEC2D.inset) < 1e-6).sort((a, b) => a[0] - b[0]);
    const half = SPEC2D.size / 2 * Math.SQRT1_2;
    for (let i = 1; i < bottom.length; i++) {
        const gap = (bottom[i][0] - half) - (bottom[i - 1][0] + half);
        assert.ok(gap <= 0.5 && gap >= -SPEC2D.spacing, `hachures ${i - 1}-${i} : écart ${gap}`);
    }
});

test('_crossSegments2D : HACHURES sur CERCLE — rangée régulière (une par pas)', () => {
    const R = 500, N = 72;
    const circ = [];
    for (let i = 0; i < N; i++) {
        const a = (i / N) * 2 * Math.PI;
        circ.push([R * Math.cos(a), R * Math.sin(a)]);
    }
    const CS = { size: 30, spacing: 30 * Math.SQRT1_2, inset: 30 * Math.SQRT1_2 / 2 + 1 };
    const segs = _crossSegments2D(circ, CS, true);
    const centers = segs.map((g) => [(g[0][0] + g[1][0]) / 2, (g[0][1] + g[1][1]) / 2]);
    assert.ok(centers.length >= 20, `assez de hachures (${centers.length})`);
    for (let i = 1; i < centers.length; i++) {
        const d = Math.hypot(centers[i][0] - centers[i - 1][0], centers[i][1] - centers[i - 1][1]);
        assert.ok(d > CS.spacing * 0.5 && d < CS.spacing * 1.5, `hachures ${i - 1}-${i} : ${d.toFixed(1)}`);
    }
    for (const g of segs) {
        for (const [x, y] of g) assert.ok(Math.hypot(x, y) <= R + 1e-9, 'point hors du cercle');
    }
});

test('_crossSegments2D : réflexion de l axe y (PDF) — croix dedans, côté intérieur correct', () => {
    // Le même carré vu en coordonnées écran : y croît vers le bas. La
    // réflexion retourne ensemble le signe de l'aire et la normale
    // intérieure : les croix doivent être identiques (au miroir près).
    const flipped = SQ2D.map(([x, y]) => [x, 100 - y]);
    const segs = _crossSegments2D(flipped, SPEC2D);
    assert.equal(segs.length, _crossSegments2D(SQ2D, SPEC2D).length, 'même effectif');
    for (const s of segs) {
        for (const [x, y] of s) {
            assert.ok(x > 0 && x < 100 && y > 0 && y < 100, `point (${x}, ${y}) hors du carré`);
        }
    }
});
