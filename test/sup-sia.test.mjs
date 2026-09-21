// SUP AIP SIA (B4) — tests : parseur sur structure RÉELLE de la page
// SIA (capture 16/09), validité, mise en avant « votre vol » (ICAO cités).
import test from 'node:test';
import { ok, equal, deepEqual } from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { parseSupRows } = await import('../scripts/fetch-sup-sia.mjs');
const { supActiveOn, supMatches } = await import('../js/sup-sia.js');

// Extrait fidèle d'une rangée SIA (ids réels du 16/09).
const ROW_208 = `<tr class="tr_ligne_document ">
    <td class="td_icone_liste_document"><img title="PDF Icon" src="/pdf_icon.png"></td>
    <td class="td_lien_liste_document">
        <a target="_blank" class="lien_sup_aip" href="https://www.sia.aviation-civile.gouv.fr/documents/download/f/d/15082869/">
            <b>208/2026</b> <span>&lt;p&gt;Création de 10 zones réglementées temporaires (ZRT) pour l&rsquo;exercice BACCARAT 2026.&lt;/p&gt; <i></i></span>
        </a>
    </td>
    <td class="td_validite_liste_document"> Valide du 2026-09-28 au 2026-10-07 </td>
    <td><div class="state-selected">
        <span><input type="checkbox" name="IFR" value="IFR" checked /><label>IFR</label></span>
        <span><input type="checkbox" name="VFR" value="VFR" checked /><label>VFR</label></span>
        <span><input type="checkbox" name="AIRAC" value="AIRAC" /><label>AIRAC</label></span>
    </div></td>
</tr>`;
const ROW_LFMK = ROW_208
    .replace('208/2026', '206/2026')
    .replace('15082869', '15082865')
    .replace(/Valide du [^<]*/, 'Valide du 2026-09-12 au 2026-09-17')
    .replace('Création de 10 zones réglementées temporaires (ZRT) pour l&rsquo;exercice BACCARAT 2026.',
        'Création de trois Zones Réglementées Temporaires (ZRT) pour une manifestation aérienne à Carcassonne – Salvaza (LFMK)');

test('parseSupRows : numéro, objet nettoyé, validité, tags cochés, PDF', () => {
    const items = parseSupRows(ROW_208 + ROW_LFMK);
    equal(items.length, 2);
    const a = items.find(i => i.num === '208/2026');
    equal(a.docId, '15082869');
    ok(a.url.includes('documents/download/f/d/15082869'));
    equal(a.start, '2026-09-28');
    equal(a.end, '2026-10-07');
    equal(a.vfr, true); equal(a.ifr, true); equal(a.airac, false);
    ok(/BACCARAT/.test(a.subject) && !/&lt;|&#|<p>/.test(a.subject), 'objet décodé : ' + a.subject);
    // Tri : numéro décroissant d'abord.
    equal(items[0].num, '208/2026');
});

test('parseSupRows : page inattendue → [] ; rangée sans PDF ignorée', () => {
    deepEqual(parseSupRows('<html>portail</html>'), []);
    deepEqual(parseSupRows('<tr class="tr_ligne_document "><td>sans lien</td></tr>'), []);
});

test('supActiveOn : bornes incluses, champs absents tolérés', () => {
    const s = { start: '2026-09-10', end: '2026-09-20' };
    equal(supActiveOn(s, '2026-09-10'), true);
    equal(supActiveOn(s, '2026-09-20'), true);
    equal(supActiveOn(s, '2026-09-21'), false);
    equal(supActiveOn(s, '2026-09-09'), false);
    equal(supActiveOn({ start: null, end: null }, '2026-01-01'), true, 'sans bornes = toujours');
});

test('supMatches : ICAO du plan cités dans l objet (mise en avant « votre vol »)', () => {
    const s = { subject: 'manifestation aérienne à Carcassonne – Salvaza (LFMK)' };
    deepEqual(supMatches(s, ['LFRV', 'LFOO']), [], 'rien si le terrain du plan n est pas cité');
    deepEqual(supMatches(s, ['LFRV', 'LFMK']), ['LFMK']);
    deepEqual(supMatches({ subject: 'ZRT France entière' }, ['LFRV']), []);
});

test('supMatchesNames : nom du terrain cité sans code OACI (ex. « région de FIGARI (2A) »)', async () => {
    const m = await import('../js/sup-sia.js');
    const sup = { subject: 'Création de deux zones réglementées temporaires dans la région de FIGARI (2A)' };
    const candidats = [
        { icao: 'LFKF', name: 'Figari Sud Corse' },
        { icao: 'LFRV', name: 'Vannes/Meucon' },
    ];
    deepEqual(m.supMatchesNames(sup, candidats), ['LFKF'], 'FIGARI cité → LFKF');
    // Mots de moins de 4 lettres ne suffisent pas (« SUD » seul dans l objet).
    deepEqual(m.supMatchesNames({ subject: 'zone au SUD de la zone' }, candidats), [],
        'mot court ignoré');
    // AccentInsensitive : « Bihoué » cité → LFRH.
    deepEqual(m.supMatchesNames(
        { subject: 'ZRT à proximité de Lann Bihoué' },
        [{ icao: 'LFRH', name: 'Lann Bihoué' }]), ['LFRH']);
    deepEqual(m.supMatchesNames(sup, []), [], 'aucun candidat → aucun match');
    // Mots génériques : « Saint-Dizier » ne matche pas « Saint-Nazaire Montoir »
    // via le seul mot SAINT (retour pilote 20/09 — Sup hors secteur en tête).
    deepEqual(m.supMatchesNames(
        { subject: 'création de zones réglementées à Saint-Dizier (LFSI)' },
        [{ icao: 'LFRZ', name: 'Saint-Nazaire Montoir' }]), []);
    // « Lyon Saint-Exupéry (LFLL) » ne matche pas un candidat voisin non lyonnais.
    deepEqual(m.supMatchesNames(
        { subject: 'travaux sur l AD Lyon Saint-Exupéry (LFLL)' },
        [{ icao: 'LFRZ', name: 'Saint-Nazaire Montoir' }]), []);
    // Le premier mot significatif du nom suffit : « Saint-Nazaire Montoir » cité → LFRZ.
    deepEqual(m.supMatchesNames(
        { subject: 'manœuvres autour de Saint-Nazaire Montoir' },
        [{ icao: 'LFRZ', name: 'Saint-Nazaire Montoir' }]), ['LFRZ']);
});

test('capture réelle : la base générée est conforme (si présente)', () => {
    const p = path.join(root, 'data', 'sup-sia.json');
    if (!fs.existsSync(p)) return;
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    ok(j.count >= 20, `${j.count} Sup`);
    ok(j.items.every(i => /^\d{2,4}\/\d{4}$/.test(i.num)), 'numéros bien formés');
    ok(j.items.every(i => i.url && i.docId), 'PDF liés');
    ok(j.items.filter(i => !i.start || !i.end).length <= 2, 'dates quasi exhaustives');
});

test('régions & pertinence trajet : ICAO + régions citées + alias cardinaux', async () => {
    const m = await import('../js/sup-sia.js');
    // Boîtes : Vannes = Bretagne ; LFMK (Carcassonne) = Occitanie/Nouvelle-Aquitaine.
    ok(m.regionsForPoint(47.66, -2.76).includes('Bretagne'), 'Vannes → Bretagne');
    ok(m.regionsForPoint(43.21, 2.30).includes('Occitanie'), 'LFMK → Occitanie');
    equal(m.regionsForPoint(0, 0).length, 0, 'hors France → aucune');
    // « région Sud-Est » (PERSEE) compte pour un plan touchant l'Occitanie.
    const sudEst = m.supRelevance({ subject: "exercice PERSEE dans la région Sud-Est" }, ['Occitanie']);
    deepEqual(sudEst.regions, ['Sud-Est'], 'alias Sud-Est');
    // Aucune promotion croisée : Nîmes ≠ plan Bretagne.
    deepEqual(m.supRelevance({ subject: 'région de Nîmes' }, ['Bretagne']).regions, []);
    // « Bretagne » citée = pertinente pour un plan breton.
    deepEqual(m.supRelevance({ subject: 'parachutage en Bretagne' }, ['Bretagne']).regions, ['Bretagne']);
});
