// Tests — résolution des fréquences radio des zones SIV/CTR/TMA/CTA
// pour la carte imprimable (js/airspace-freq.js) : extraction de la
// ville du nom de zone, index des services officiels (VHF uniquement,
// Tour avant Sol), priorités de la chaîne (champ f SIA > services >
// legs openAIP du dédoublonnage) et règle pilote TWR-pour-CTR /
// APP-pour-TMA. Aucune invention : null si aucune source.
import test from 'node:test';
import { ok, equal } from 'node:assert/strict';
const { zoneCity, buildServicesIndex, zoneFreqInfo, aaAfisFreqText }
    = await import('../js/airspace-freq.js');

// Index synthétique minimal (le vrai fichier est chargé par la
// maquette ; les tests n'en dépendent pas).
const IDX = buildServicesIndex({
    services: {
        'TWR QUIMPER Tour': [{ freq: '118.625' }],
        'TWR QUIMPER Sol': [{ freq: '121.850' }],
        'TWR LORIENT Tour': [{ freq: '122.700' }, { freq: '281.550' }],   // UHF à écarter
        'TWR RENNES Tour': [{ freq: '120.505' }],
        'TWR RENNES Sol': [{ freq: '121.730' }],
        'APP RENNES Approche': [{ freq: '134.200' }, { freq: '120.350' }],
        'APP LORIENT Approche': [{ freq: '122.100' }, { freq: '231.875' }],
        'FIS LA ROCHELLE Information': [{ freq: '124.205' }],
        'TWR ST-BRIEUC Tour': [{ freq: '118.430' }],
        'ATIS RENNES .': [{ freq: '136.405' }],        // hors périmètre
        'A/A QUIMPER .': [{ freq: '118.625' }],        // hors périmètre
    },
});

test('buildServicesIndex : TWR/APP/FIS seuls, VHF uniquement, Tour ≠ Sol', () => {
    const twrQ = IDX.filter(s => s.cityRaw === 'QUIMPER');
    equal(twrQ.length, 2, 'Tour et Sol sont TOUS DEUX indexés (rôles distincts)');
    ok(twrQ.some(s => s.role === 'TOUR') && twrQ.some(s => s.role === 'SOL'));
    const lor = IDX.find(s => s.family === 'TWR' && s.city === 'LORIENT');
    equal(lor.freqs.length, 1, 'le 281.550 (UHF) est écarté');
    equal(lor.freqs[0], '122.700');
    ok(!IDX.some(s => s.family === 'ATIS' || s.family === 'A/A'), 'ATIS et A/A hors index');
});

test('zoneCity : le nom de zone réduit à sa ville', () => {
    equal(zoneCity('TMA RENNES 1'), 'RENNES');
    equal(zoneCity('CTR DINARD 01'), 'DINARD');
    equal(zoneCity('CTA NANTES A'), 'NANTES');
    equal(zoneCity('SIV RENNES COTENTIN C'), 'RENNES COTENTIN');
    equal(zoneCity('TMA AQUITAINE 2-1'), 'AQUITAINE');
    equal(zoneCity('SIV NANTES 2.1'), 'NANTES');
    equal(zoneCity('CTR BRETAGNE'), 'BRETAGNE');
    equal(zoneCity('TMA LA ROCHELLE 1'), 'LA ROCHELLE');
    equal(zoneCity(''), '');
});

test('zoneFreqInfo : champ f SIA propre prioritaire (SIV)', () => {
    const siv = { name: 'SIV RENNES SUD A', frequencies: [{ value: '134.000', name: 'RENNES INFO' }] };
    equal(zoneFreqInfo(siv, 'SIV', IDX).freq, '134.000');
    equal(zoneFreqInfo(siv, 'SIV', IDX).tag, 'RENNES INFO');
});

test('zoneFreqInfo : règle TWR pour une CTR, APP pour une TMA/CTA', () => {
    const ctr = zoneFreqInfo({ name: 'CTR QUIMPER', frequencies: [] }, 'CTR', IDX);
    equal(ctr.freq, '118.625');
    equal(ctr.tag, 'QUIMPER TWR');
    // La tour LORIENT ne propose que 122.700 en VHF (281.550 UHF écarté).
    const ctrL = zoneFreqInfo({ name: 'CTR LORIENT' }, 'CTR', IDX);
    equal(ctrL.freq, '122.700');
    const tma = zoneFreqInfo({ name: 'TMA RENNES 1' }, 'TMA', IDX);
    equal(tma.freq, '134.200');
    equal(tma.tag, 'RENNES APP');
    const cta = zoneFreqInfo({ name: 'CTA NANTES A' }, 'CTA', IDX);
    equal(cta, null, 'aucun service NANTES dans l index synthétique : JAMAIS inventé');
});

test('zoneFreqInfo : jamais « Sol », préfixe de ville, ST ≡ SAINT', () => {
    // TWR RENNES Sol (121.730) ne doit jamais être choisi.
    const ctr = zoneFreqInfo({ name: 'CTR RENNES' }, 'CTR', IDX);
    equal(ctr.freq, '120.505');
    // « RENNES » ≡ « RENNES COTENTIN » par préfixe mot entier.
    const tma = zoneFreqInfo({ name: 'TMA RENNES COTENTIN 1' }, 'TMA', IDX);
    equal(tma.freq, '134.200');
    // ST-BRIEUC (zone) ≡ SAINT BRIEUC normalisé.
    const i2 = buildServicesIndex({ services: { 'TWR SAINT-BRIEUC Tour': [{ freq: '118.430' }] } });
    equal(zoneFreqInfo({ name: 'CTR ST BRIEUC' }, 'CTR', i2).freq, '118.430');
});

test('zoneFreqInfo : legs openAIP du dédoublonnage en dernier recours', () => {
    const z = { name: 'CTR BEAUVAIS', frequencies: [], _oaFreqs: [{ value: '123.985', name: 'BEAUVAIS TWR' }] };
    const r = zoneFreqInfo(z, 'CTR', []);
    equal(r.freq, '123.985');
    equal(r.tag, 'BEAUVAIS TWR');
});

test('zoneFreqInfo : familles hors périmètre et zones inconnues', () => {
    equal(zoneFreqInfo({ name: 'D-18' }, 'DANGER', IDX), null);
    equal(zoneFreqInfo(null, 'CTR', IDX), null);
    equal(zoneFreqInfo({ name: 'CTR INCONNU' }, 'CTR', IDX), null);
    equal(zoneFreqInfo({ name: 'CTR UHF SEUL', _oaFreqs: [{ value: '281.550' }] }, 'CTR', IDX), null,
        'une fréquence UHF n est jamais affichée');
});

// Fréquences A/A-AFIS des terrains (retour pilote 22/09) : AFIS prioritaire,
// A/A ajoutée seulement si distincte, jamais de TWR/ATIS/UHF.
test('aaAfisFreqText : AFIS prioritaire, A/A si distincte, rien sinon', () => {
    equal(aaAfisFreqText([
        { type: 'AFIS', value: '122.605' }, { type: 'A/A', value: '122.605' },
    ]), '122.605 AFIS', 'A/A identique à l AFIS : une seule ligne');
    equal(aaAfisFreqText([{ type: 'A/A', value: '123.355' }]), '123.355 A/A', 'LFOO : A/A seule');
    equal(aaAfisFreqText([
        { type: 'AFIS', value: '119.905' }, { type: 'A/A', value: '130.000' },
    ]), '119.905 AFIS · 130.000 A/A', 'les deux quand elles diffèrent');
    equal(aaAfisFreqText([{ type: 'TWR', value: '118.625' }, { type: 'ATIS', value: '126.930' }]), null,
        'ni TWR ni ATIS : rien');
    equal(aaAfisFreqText([{ type: 'AFIS', value: '281.550' }]), null, 'UHF écartée');
    equal(aaAfisFreqText([]), null);
    equal(aaAfisFreqText(null), null);
});

// Le legs openAIP est posé par le dédoublonnage SIA : test d intégration
// direct sur _dropOpenAipDuplicates (le jumeau conservé hérite des
// fréquences de la copie écartée, champ _oaFreqs).
test('_dropOpenAipDuplicates : la copie openAIP écartée lègue ses fréquences', async () => {
    const { _dropOpenAipDuplicates } = await import('../js/airspaces.js');
    const twin = {
        name: 'CTR QUIMPER', type: 4, _sia: true,
        lowerLimit: { value: 0, unit: 1 }, upperLimit: { value: 1500, unit: 1 },
        frequencies: [], geometry: { type: 'Polygon', coordinates: [[[-4.3, 47.9], [-4.0, 47.9], [-4.0, 48.1], [-4.3, 48.1], [-4.3, 47.9]]] },
    };
    const dup = {
        name: 'CTR QUIMPER', type: 4,
        lowerLimit: { value: 0, unit: 1 }, upperLimit: { value: 1500, unit: 1 },
        frequencies: [{ value: '118.625', name: 'QUIMPER TWR' }],
        geometry: twin.geometry,
    };
    const out = _dropOpenAipDuplicates([twin, dup], [twin]);
    equal(out.length, 1);
    equal(out[0], twin, 'l item SIA passe tel quel');
    ok(Array.isArray(twin._oaFreqs) && twin._oaFreqs.length === 1, 'fréquence léguée');
    equal(twin._oaFreqs[0].value, '118.625');
});
