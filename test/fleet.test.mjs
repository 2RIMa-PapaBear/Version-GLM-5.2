// Tests du module flotte (js/aircraft-fleet.js) sous Node, avec un stub
// localStorage. Tourne via `npm test`.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Stub localStorage (aircraft-fleet.js y persiste la flotte).
const _store = new Map();
globalThis.localStorage = {
    getItem: (k) => (_store.has(k) ? _store.get(k) : null),
    setItem: (k, v) => _store.set(k, String(v)),
    removeItem: (k) => _store.delete(k),
};

const fleet = await import('../js/aircraft-fleet.js');
const acdb = await import('../js/aircraft-database.js');

beforeEach(() => { _store.clear(); });

describe('flotte — vitesse/conso de croisière', () => {
    test('avion par défaut (C172) : champs perf présents', () => {
        const ac = fleet.getActiveAircraft();
        assert.equal(ac.cruiseSpeedKt, 110);
        assert.equal(ac.fuelBurnLph, 35);
    });

    test('addAircraft enregistre la perf ; valeurs invalides → null', () => {
        const ac = fleet.addAircraft({ name: 'DR400', groundRoll: 500, fiftyFt: 1100, cruiseSpeedKt: 105, fuelBurnLph: 22 });
        assert.equal(ac.cruiseSpeedKt, 105);
        assert.equal(ac.fuelBurnLph, 22);
        const bad = fleet.addAircraft({ name: 'X', groundRoll: 500, fiftyFt: 1100, cruiseSpeedKt: 'abc', fuelBurnLph: -5 });
        assert.equal(bad.cruiseSpeedKt, null);
        assert.equal(bad.fuelBurnLph, null);
    });

    test('updateAircraft PARTIEL : préserve nom/immat/distances, met à jour la perf', () => {
        const ac = fleet.addAircraft({ name: 'DR400', registration: 'F-GKAZ', groundRoll: 500, fiftyFt: 1100, cruiseSpeedKt: 105 });
        const up = fleet.updateAircraft(ac.id, { cruiseSpeedKt: 115, fuelBurnLph: 24 });
        assert.equal(up.name, 'DR400');
        assert.equal(up.registration, 'F-GKAZ');
        assert.equal(up.groundRoll, 500);
        assert.equal(up.fiftyFt, 1100);
        assert.equal(up.cruiseSpeedKt, 115);
        assert.equal(up.fuelBurnLph, 24);
    });

    test('updateAircraft partiel : champ perf absent reste null', () => {
        const ac = fleet.addAircraft({ name: 'X', groundRoll: 500, fiftyFt: 1100 });
        const up = fleet.updateAircraft(ac.id, { cruiseSpeedKt: 95 });
        assert.equal(up.cruiseSpeedKt, 95);
        assert.equal(up.fuelBurnLph, null);
    });

    // Régression _doSave() du modal flotte : les inputs vitesse/conso existaient
    // mais n'étaient pas lus à l'enregistrement (valeurs perdues en ajout,
    // modifications ignorées en édition).
    test('jeu complet du formulaire flotte : strings → nombres, vides → null', () => {
        // Ajout : .value des inputs (chaînes) converties par _sanitize.
        const ac = fleet.addAircraft({
            name: 'DR400', groundRoll: '500', fiftyFt: '1100', safetyMargin: '20',
            cruiseSpeedKt: '105', fuelBurnLph: '22',
        });
        assert.equal(ac.cruiseSpeedKt, 105);
        assert.equal(ac.fuelBurnLph, 22);
        // Édition : champ vidé volontairement → null (retour aux défauts).
        const up = fleet.updateAircraft(ac.id, {
            name: 'DR400', groundRoll: '500', fiftyFt: '1100', safetyMargin: '20',
            cruiseSpeedKt: '', fuelBurnLph: null,
        });
        assert.equal(up.cruiseSpeedKt, null);
        assert.equal(up.fuelBurnLph, null);
    });
});

describe('flotte — régression id (bug updateAircraft)', () => {
    test('updateAircraft PRÉSERVE l\'id (sélection/ édition restent possibles)', () => {
        const ac = fleet.addAircraft({ name: 'DR400', groundRoll: 500, fiftyFt: 1100 });
        const up = fleet.updateAircraft(ac.id, { cruiseSpeedKt: 115, fuelBurnLph: 24 });
        assert.equal(up.id, ac.id);
        fleet.setActiveAircraft(ac.id);
        assert.equal(fleet.getActiveAircraft().name, 'DR400');
    });

    test('getFleet RÉPARE les enregistrements sans id et restaure la sélection', () => {
        // Flotte corrompue par le bug : 1er avion sans id, actif périmé.
        _store.set('ac-fleet', JSON.stringify([
            { name: 'Cessna 172 SP', type: 'C172', groundRoll: 830, fiftyFt: 1400, safetyMargin: 20 },
            { id: 'ac_sain', name: 'DR400', groundRoll: 500, fiftyFt: 1100, safetyMargin: 20 },
        ]));
        _store.set('ac-active-id', JSON.stringify('ac_efface'));
        const repaired = fleet.getFleet();
        assert.ok(repaired.every(a => typeof a.id === 'string' && a.id.length > 0));
        // L'actif périmé retombe sur le premier réparé, pas sur le hasard.
        assert.equal(fleet.getActiveAircraft().name, 'Cessna 172 SP');
        // La réparation est persistée : un 2e accès est stable.
        assert.ok(fleet.getFleet().every(a => a.id));
    });
});

describe('flotte — export / import', () => {
    const WB = { emptyMassKg: 740, emptyArmMm: 2.393, envelope: [[740, 2393], [1050, 2450], [1050, 2600], [740, 2600]], stations: [{ name: 'Pilote', armMm: 2400, maxKg: 130 }] };

    test('normalizeFleetImport : charge valide normalisée, ids et actif conservés', () => {
        const norm = fleet.normalizeFleetImport({
            app: 'metar-taf-pwa', kind: 'fleet', version: 1,
            fleet: [
                { id: 'a1', name: 'DR400-140', registration: 'f-xxxx', type: 'DR400', groundRoll: 170, fiftyFt: 335, safetyMargin: 20, cruiseSpeedKt: 110, fuelBurnLph: 30, wb: WB },
                { id: 'a2', name: 'Cessna 172', registration: '', type: 'C172' },
            ],
            activeId: 'a2',
        });
        assert.ok(norm);
        assert.equal(norm.fleet.length, 2);
        assert.equal(norm.fleet[0].id, 'a1');
        assert.equal(norm.fleet[0].registration, 'F-XXXX', 'immat majusculée');
        assert.equal(norm.fleet[0].wb.emptyMassKg, 740, 'bloc centrage conservé');
        assert.equal(norm.activeId, 'a2');
    });

    test('normalizeFleetImport : rejets (null, vide, mauvais type, plan de vol, entrée non objet, > 30)', () => {
        assert.equal(fleet.normalizeFleetImport(null), null);
        assert.equal(fleet.normalizeFleetImport({ fleet: [] }), null);
        assert.equal(fleet.normalizeFleetImport({ fleet: 'x' }), null);
        assert.equal(fleet.normalizeFleetImport({ kind: 'plan', fleet: [{ name: 'x' }] }), null);
        assert.equal(fleet.normalizeFleetImport({ fleet: [{ name: 'ok' }, 42] }), null);
        assert.equal(fleet.normalizeFleetImport({ fleet: Array.from({ length: 31 }, () => ({ name: 'x' })) }), null);
    });

    test('normalizeFleetImport : id manquant régénéré, actif inconnu → 1ᵉʳ avion, défauts comblés', () => {
        const norm = fleet.normalizeFleetImport({ fleet: [{ name: 'Sans id' }] });
        assert.ok(norm);
        assert.match(norm.fleet[0].id, /^ac_/);
        assert.equal(norm.activeId, norm.fleet[0].id);
        assert.equal(norm.fleet[0].groundRoll, 830, 'défaut C172 comblé');
    });

    test('importFleetData : remplace flotte + actif (aller-retour avec exportFleetData)', () => {
        fleet.addAircraft({ name: 'DR400-140', registration: 'F-GABC', groundRoll: 170, fiftyFt: 335, wb: WB });
        const dump = fleet.exportFleetData();
        assert.equal(dump.kind, 'fleet');
        assert.equal(dump.fleet.length, 2);   // défaut C172 + DR400
        assert.ok(fleet.importFleetData(dump));
        assert.equal(fleet.getFleet().length, 2);
        assert.equal(fleet.getActiveAircraftId(), dump.activeId, 'actif préservé');
        // Charge invalide : refusée, flotte intacte.
        assert.equal(fleet.importFleetData({}), false);
        assert.equal(fleet.getFleet().length, 2);
    });
});

describe('flotte — export / import d\'UN avion', () => {
    const WB = { emptyMassKg: 740, emptyArmMm: 2.393, envelope: [[740, 2393], [1050, 2450], [1050, 2600], [740, 2600]], stations: [{ name: 'Pilote', armMm: 2400, maxKg: 130 }] };

    test('exportAircraftData : conteneur flotte monoplace, centrage inclus', () => {
        const ac = fleet.addAircraft({ name: 'DR400-140', registration: 'F-GABC', groundRoll: 170, fiftyFt: 335, wb: WB });
        const dump = fleet.exportAircraftData(ac.id);
        assert.equal(dump.kind, 'fleet');
        assert.equal(dump.single, true);
        assert.equal(dump.fleet.length, 1);
        assert.equal(dump.fleet[0].wb.emptyMassKg, 740);
        assert.equal(fleet.exportAircraftData('inconnu'), null);
    });

    test('importAircraftData : remplace l\'avion en conservant id et actif', () => {
        const a = fleet.addAircraft({ name: 'Ancien', registration: 'F-OLD', groundRoll: 200, fiftyFt: 400 });
        const b = fleet.addAircraft({ name: 'Autre', registration: 'F-OTH' });
        fleet.setActiveAircraft(b.id);
        const dump = fleet.exportAircraftData(a.id);
        // Modifie la charge : nouveau nom + centrage complet.
        dump.fleet[0].name = 'DR400 neuf';
        dump.fleet[0].wb = WB;
        const res = fleet.importAircraftData(a.id, dump);
        assert.equal(res.ok, true);
        const apres = fleet.getFleet().find(x => x.id === a.id);
        assert.equal(apres.name, 'DR400 neuf');
        assert.equal(apres.wb.emptyMassKg, 740);
        assert.equal(fleet.getActiveAircraftId(), b.id, 'avion actif inchangé');
    });

    test('importAircraftData : refuse fichiers multi-avions et invalides', () => {
        const a = fleet.addAircraft({ name: 'Cible' });
        assert.equal(fleet.importAircraftData(a.id, { fleet: [{ name: 'x' }, { name: 'y' }] }).reason, 'not-single');
        assert.equal(fleet.importAircraftData(a.id, null).reason, 'not-single');
        assert.equal(fleet.importAircraftData(a.id, { fleet: [42] }).reason, 'not-single');
        assert.equal(fleet.importAircraftData('inconnu', { fleet: [{ name: 'x' }] }).reason, 'not-found');
        assert.equal(fleet.getFleet().find(x => x.id === a.id).name, 'Cible', 'cible intacte après refus');
    });

    test('aller-retour complet : export monoplace → import flotte (ajout)', () => {
        const a = fleet.addAircraft({ name: 'Transféré', registration: 'F-TRF', wb: WB });
        const dump = fleet.exportAircraftData(a.id);
        assert.ok(fleet.importFleetData(dump), 'un fichier monoplace est une flotte valide (remplace tout)');
        assert.equal(fleet.getFleet().length, 1);
        assert.equal(fleet.getFleet()[0].name, 'Transféré');
    });
});

// VR / seuil chrono décollage (item ⑤, 09/09) — vitesses de rotation
// représentatives de la base avions.
import { VR_KT, vrForType, chronoThresholdKt } from '../js/aircraft-database.js';

test('vrForType : valeurs connues et fallback monomoteur club', () => {
    assert.equal(vrForType('C172'), 55);
    assert.equal(vrForType('DR400-180'), 55);
    assert.equal(vrForType('PA18'), 45, 'le Super Cub décolle tôt');
    assert.equal(vrForType('SR22'), 75);
    assert.equal(vrForType('INEXISTANT'), 55, 'type inconnu → 55 kt');
    assert.equal(vrForType(undefined), 55);
    // Tous les types de la base ont une VR renseignée (pas de 55 implicite oublié)
    const sansVr = Object.keys(VR_KT).filter(t => !Number.isFinite(VR_KT[t]));
    assert.deepEqual(sansVr, []);
});

test('chronoThresholdKt : VR − 5 kt, plancher 10 kt', () => {
    assert.equal(chronoThresholdKt(55), 50);
    assert.equal(chronoThresholdKt(45), 40);
    assert.equal(chronoThresholdKt(13), 10, 'plancher bas');
    assert.equal(chronoThresholdKt(90), 85);
});

// ---- A3 : limites par avion (vent traversier, réserve perso, atterrissage) --
describe('flotte — limites par avion (A3)', () => {
    test('limite traversier enregistrée si valide, null sinon (seuils génériques conservés)', () => {
        const ok = fleet.addAircraft({ name: 'WT9', groundRoll: 500, fiftyFt: 1100, xwindLimitKt: 12 });
        assert.equal(ok.xwindLimitKt, 12);
        const vide = fleet.addAircraft({ name: 'X', groundRoll: 500, fiftyFt: 1100 });
        assert.equal(vide.xwindLimitKt, null);
        const absurde = fleet.addAircraft({ name: 'Y', groundRoll: 500, fiftyFt: 1100, xwindLimitKt: 99 });
        assert.equal(absurde.xwindLimitKt, null, '> 40 kt écarté');
    });

    test('réserve perso : clamp 0–60, défaut 0', () => {
        assert.equal(fleet.addAircraft({ name: 'A', groundRoll: 1, fiftyFt: 2 }).reserveExtraMin, 0);
        assert.equal(fleet.addAircraft({ name: 'B', groundRoll: 1, fiftyFt: 2, reserveExtraMin: 15 }).reserveExtraMin, 15);
        assert.equal(fleet.addAircraft({ name: 'C', groundRoll: 1, fiftyFt: 2, reserveExtraMin: 90 }).reserveExtraMin, 60);
    });

    // Carburant UTILISABLE (L, manuel de vol) : plafonne l'emport du centrage.
    test('carburant utilisable : enregistré si valide, null sinon (capacité du poste sinon)', () => {
        assert.equal(fleet.addAircraft({ name: 'WT9', groundRoll: 500, fiftyFt: 1100, usableFuelL: 113 }).usableFuelL, 113);
        assert.equal(fleet.addAircraft({ name: 'X', groundRoll: 1, fiftyFt: 2 }).usableFuelL, null);
        assert.equal(fleet.addAircraft({ name: 'Y', groundRoll: 1, fiftyFt: 2, usableFuelL: 0 }).usableFuelL, null);
        assert.equal(fleet.addAircraft({ name: 'Z', groundRoll: 1, fiftyFt: 2, usableFuelL: 5000 }).usableFuelL, null);
    });

    test('références atterrissage optionnelles ; C172 par défaut les porte (POH)', () => {
        const def = fleet.getActiveAircraft();   // flotte neuve → C172 par défaut
        assert.equal(def.ldgRoll, 725);
        assert.equal(def.ldgFifty, 1400);
        const sans = fleet.addAircraft({ name: 'DR400', groundRoll: 500, fiftyFt: 1100 });
        assert.equal(sans.ldgRoll, null);
        assert.equal(sans.ldgFifty, null);
    });
});

// ---- Base avions (js/aircraft-database.js) : fiche complète Dynamic WT9 ----
// Intégrée le 17/09 depuis la config flotte du pilote (export JSON, version
// LSA 600 kg), sans l'immatriculation. La fiche étendue pré-remplit TOUT le
// formulaire via l'autocomplétion du nom (fleet-ui.js _applySuggestion).
describe('base avions — Dynamic WT9 LSA (fiche complète)', () => {
    test('recherche « wt9 » : la fiche complète est trouvée et intègre tous les champs', () => {
        const res = acdb.searchAircraft('wt9');
        const wt9 = res.find(a => a.type === 'WT9-LSA');
        assert.ok(wt9, 'WT9 LSA trouvé');
        assert.equal(wt9.name, 'Dynamic WT9 LSA');
        assert.equal(wt9.groundRoll, 540);
        assert.equal(wt9.fiftyFt, 1148);
        assert.equal(wt9.ldgRoll, 246);
        assert.equal(wt9.ldgFifty, 863);
        assert.equal(wt9.safetyMargin, 15);
        assert.equal(wt9.cruiseSpeedKt, 100);
        assert.equal(wt9.fuelBurnLph, 18);
        assert.equal(wt9.usableFuelL, 113, '119 L de capacité − 6 L inutilisables (pilote)');
        assert.equal(wt9.xwindLimitKt, 25);
        assert.equal(wt9.reserveExtraMin, 5);
    });

    test('bloc centrage embarqué : masse/CG à vide, MTOW 600, enveloppe, 4 postes dont carburant', () => {
        const wt9 = acdb.AIRCRAFT_DB.find(a => a.type === 'WT9-LSA');
        assert.ok(wt9.wb);
        assert.equal(wt9.wb.emptyMassKg, 354);
        assert.equal(wt9.wb.emptyArmMm, 2641);
        assert.equal(wt9.wb.mtowKg, 600, 'MTOW LSA enregistré (verdict dépassement)');
        assert.equal(wt9.wb.fuelDensity, 0.72);
        assert.ok(wt9.wb.envelope.length >= 3, 'au moins 3 points d\'enveloppe');
        assert.equal(wt9.wb.stations.length, 4);
        assert.ok(wt9.wb.stations.some(s => s.fuel), 'poste carburant présent');
        // La fiche doit passer telle quelle le sanitize flotte (ajout réel).
        const ac = fleet.addAircraft({ ...wt9 });
        assert.equal(ac.wb.emptyMassKg, 354);
        assert.equal(ac.wb.mtowKg, 600);
        assert.equal(ac.wb.stations.length, 4);
        assert.equal(ac.ldgRoll, 246);
    });

    test('la base ne contient JAMAIS d\'immatriculation ni d\'id (données personnelles)', () => {
        for (const ac of acdb.AIRCRAFT_DB) {
            assert.equal('registration' in ac, false, `${ac.name} sans immatriculation`);
            assert.equal(ac.id, undefined, `${ac.name} sans id`);
        }
        assert.ok(!JSON.stringify(acdb.AIRCRAFT_DB).includes('F-H'), 'aucun préfixe F-H');
    });

    test('VR_KT couvre tous les types de la base (chrono GPS)', () => {
        for (const ac of acdb.AIRCRAFT_DB) {
            assert.ok(acdb.VR_KT[ac.type] != null, `VR manquante pour ${ac.type}`);
        }
        assert.equal(acdb.VR_KT['WT9-LSA'], 50, 'VR WT9 LSA (pilote)');
        assert.equal(acdb.vrForType('WT9'), 50, 'rétro-compat : flotte existante type WT9');
        assert.equal(acdb.VR_KT.BULLDOG, 60, 'régression BULLOG/BULLDOG corrigée');
    });
});
