// Garde du module partagé scripts/lib/sia-navaids.mjs — la BASE SIA des
// radiophares et points VFR (RÈGLE PILOTE 16/09 : « la base, ce sont les
// fichiers SIA, à compléter par openAIP — et non l'inverse ») que le robot
// fetch-radio-points.mjs ré-applique à chaque crawl depuis
// data/sia-radio-layer.json, avec contrôle d'intégrité avant écriture
// (incident 14/09 : écrasement openAIP — navaids ET VRP officiels perdus).
import test from 'node:test';
import { ok, equal, deepEqual } from 'node:assert/strict';
import { parseSiaNavaids, parseSiaVrps, mergeIntoRadioPoints, applySiaVrps, verifySiaLayer } from '../scripts/lib/sia-navaids.mjs';

// Extrait minimal d'un export XML SIA (structure réelle : RadioNav par
// lk="[LF][TYPE IDENT]", NavFix LF avec NavType/Ident/coordonnées).
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<Export effDate="2026-09-03">
  <RadioNav lk="[LF][VOR-DME BMC]"><Frequence>113,75</Frequence><NomPhraseo>BORDEAUX</NomPhraseo><Portee>100</Portee></RadioNav>
  <RadioNav lk="[LF][NDB MVN]"><Frequence>355</Frequence><NomPhraseo>MOISDON</NomPhraseo></RadioNav>
  <RadioNav lk="[LF][VOR FOO]"><Frequence>xxx</Frequence></RadioNav>
  <NavFix lk="[LF][VOR-DME BMC]"><NavType>VOR-DME</NavType><Ident>BMC</Ident><Latitude>44.98060</Latitude><Longitude>-0.70861</Longitude></NavFix>
  <NavFix lk="[LF][NDB MVN]"><NavType>NDB</NavType><Ident>MVN</Ident><Latitude>47.89889</Latitude><Longitude>-2.42583</Longitude></NavFix>
  <NavFix lk="[LF][TACAN TAC]"><NavType>TACAN</NavType><Ident>TAC</Ident><Latitude>45.0</Latitude><Longitude>1.0</Longitude></NavFix>
  <NavFix lk="[LF][VOR SEUL]"><NavType>VOR</NavType><Ident>SEUL</Ident><Latitude>47.0</Latitude><Longitude>-3.0</Longitude></NavFix>
  <NavFix lk="[LFDD][VOR ETR]"><NavType>VOR</NavType><Ident>ETR</NavType><Latitude>48.0</Latitude><Longitude>7.0</Longitude></NavFix>
</Export>`;

test('parseSiaNavaids : RadioNav + NavFix LF, TACAN et hors-France écartés', () => {
    const sia = parseSiaNavaids(XML);
    equal(sia.effDate, '2026-09-03');
    equal(sia.navaids.length, 3, 'BMC, MVN, SEUL (TACAN exclu, LFDD exclu)');
    const bmc = sia.navaids.find((n) => n.ident === 'BMC');
    equal(bmc.k, 'vor');
    equal(bmc.f, 113.75);
    equal(bmc.u, 2);
    deepEqual([bmc.n, bmc.r], ['BORDEAUX', 100]);
    const mvn = sia.navaids.find((n) => n.ident === 'MVN');
    equal(mvn.u, 1, 'NDB en kHz');
    equal(mvn.r, null, 'sans portée');
    const seul = sia.navaids.find((n) => n.ident === 'SEUL');
    equal(seul.f, null, 'pas de RadioNav → pas de fréquence officielle');
});

test('mergeIntoRadioPoints : rapprochement ident+proximité, anti-collision mondiale, ajout des absents', () => {
    const sia = parseSiaNavaids(XML);
    const rp = {
        navaids: [
            ['vor', 'BMC', 44.98, -0.7, 113.7, 2],       // ≈ BMC openAIP → rapproché
            ['vor', 'BMC', 48.85, 2.35, 117.5, 2],       // même ident loin (Paris) → NON rapproché
            ['ndb', 'AUTRE', 47.9, -2.4, 350, 1],        // autre terrain → intact
        ],
    };
    const st = mergeIntoRadioPoints(rp, sia, { effDate: '2026-09-03' });
    equal(st.total, 3);
    equal(st.added, 2, 'SEUL et MVN absents d openAIP → ajoutés');
    equal(rp.counts.navaidsSia, 3);
    equal(rp.siaAirac, '2026-09-03');
    // BMC proche : fréquence OFFICIELLE + méta [nom, portée].
    const bmc = rp.navaids.find((n) => n[1] === 'BMC' && Math.abs(n[2] - 44.98) < 0.01);
    equal(bmc[4], 113.75, 'fréquence officielle RadioNav');
    deepEqual(bmc[6], ['BORDEAUX', 100], 'méta 7e élément');
    // BMC de Paris : INTACT (l ident seul ne suffit pas — collision mondiale).
    const bmcParis = rp.navaids.find((n) => n[1] === 'BMC' && Math.abs(n[2] - 48.85) < 0.01);
    equal(bmcParis[4], 117.5, 'openAIP conservé (pas de rapprochement lointain)');
    equal(bmcParis[6], undefined);
    // AUTRE intact.
    equal(rp.navaids.filter((n) => n[1] === 'AUTRE').length, 1);
    // Les SIA absents d openAIP sont ajoutés avec leur méta.
    const seul = rp.navaids.find((n) => n[1] === 'SEUL');
    ok(seul, 'SEUL ajouté');
    // MVN n existe pas côté openAIP (AUTRE est un autre ident, proche mais
    // différent) → MVN est AJOUTÉ, sans doublon.
    const mvn = rp.navaids.filter((n) => n[1] === 'MVN');
    equal(mvn.length, 1, 'MVN ajouté une seule fois');
    equal(mvn[0][6][0], 'MOISDON', 'méta portée du RadioNav');
});

const XML_VRP = `<?xml version="1.0" encoding="UTF-8"?>
<Export effDate="2026-09-03">
  <NavFix lk="[LF][VFR VRP-CAVAILLON]"><NavType>VFR</NavType><Ident>VRP-Cavaillon</Ident><Latitude>43.83</Latitude><Longitude>5.05</Longitude><Description>VRP-Cavaillon (Pont TGV sur la Durance)</Description></NavFix>
  <NavFix lk="[LF][VFR VRP-NODESC]"><NavType>VFR</NavType><Ident>VRP-SansDesc</Ident><Latitude>47.0</Latitude><Longitude>-3.0</Longitude></NavFix>
  <NavFix lk="[LFDD][VFR ETR]"><NavType>VFR</NavType><Ident>VRP-Etranger</Ident><Latitude>48.0</Latitude><Longitude>7.0</Longitude></NavFix>
</Export>`;

test('parseSiaVrps + applySiaVrps : VRP officiels REMPLACENT openAIP FR (base SIA)', () => {
    const vrps = parseSiaVrps(XML_VRP);
    equal(vrps.length, 2, 'LF uniquement (LFDD écarté)');
    deepEqual(vrps[0], ['VRP-Cavaillon', 43.83, 5.05, 'FR', 'VRP-Cavaillon (Pont TGV sur la Durance)']);
    equal(vrps[1][4], null, 'sans description → null, pas de 5e élément vide');

    const rp = { vrps: [['VRP openAIP FR', 43.8, 5.0, 'FR'], ['5 NM N', 8.69, 124.45, 'PH']] };
    applySiaVrps(rp, vrps, { effDate: '2026-09-03' });
    equal(rp.counts.vrpsSia, 2);
    equal(rp.siaVrpAirac, '2026-09-03');
    equal(rp.vrps.filter(v => v[3] === 'FR').length, 2, 'openAIP FR écarté, remplacé par les officiels');
    equal(rp.vrps.filter(v => v[3] === 'PH').length, 1, 'le reste du monde est conservé');
});

test('verifySiaLayer : un navaid SIA dégradé (fréquence perdue) est REFUSÉ', () => {
    const snap = { navaids: [{ k: 'vor', ident: 'BMC', lat: 44.9806, lon: -0.70861, f: 113.75, u: 2, n: 'BORDEAUX', r: 100 }], vrps: [] };
    const bon = { navaids: [['vor', 'BMC', 44.9806, -0.70861, 113.75, 2, ['BORDEAUX', 100]]], vrps: [] };
    equal(verifySiaLayer(bon, snap), null, 'fichier conforme → null');
    const degrade = { navaids: [['vor', 'BMC', 44.9806, -0.70861, 999.9, 2, ['BORDEAUX', 100]]], vrps: [] };
    ok(/BMC/.test(verifySiaLayer(degrade, snap)), 'fréquence non officielle → anomalie nommée');
    const sansVrps = { navaids: bon.navaids, vrps: [] };
    const snapVrps = { ...snap, vrps: [['a', 1, 1, 'FR', null], ['b', 2, 2, 'FR', null]] };
    ok(/VRP SIA/.test(verifySiaLayer(sansVrps, snapVrps)), 'VRP manquants → anomalie');
});
