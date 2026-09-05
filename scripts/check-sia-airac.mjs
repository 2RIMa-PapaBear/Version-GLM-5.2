#!/usr/bin/env node
// ============================================================================
// CHECK SIA AIRAC — garde-fou de fraîcheur de la base OFFICIELLE XML SIA.
//
//   node scripts/check-sia-airac.mjs
//
// Les données issues de l'export XML bd SIA — terrains France (identité +
// horaires ATS/AFIS + avitaillement + téléphone exploitant), pistes
// officielles, espaces aériens, fréquences services/A-A, radio-phares —
// sont extraites par fetch-sia-airac.mjs d'un XML téléchargé MANUELLEMENT
// sur le portail SIA (rubrique Produits numériques). Rien n'est
// automatisable : ce contrôle échoue (exit 1 → job GitHub en échec →
// notification) dès que la base est en retard sur le cycle AIRAC en
// vigueur, tant qu'elle n'a pas été régénérée :
//   1. télécharger le nouvel XML_SIA_<date>.xml sur le portail SIA, le
//      poser dans « telechargement AIRAC/ » ;
//   2. node scripts/fetch-sia-airac.mjs --xml="telechargement AIRAC/XML_SIA_<date>.xml" ;
//   3. publier (npm run pub -- "base SIA AIRAC <date>").
//
// Référence du « cycle courant » : l'AIRAC de data/freq-sia.json — c'est la
// vérité terrain (probed chaque jour par fetch-freq-sia.mjs sur le site du
// SIA). À défaut (fichier absent) : la série SIA ancrée au 2026-07-09,
// pas de 28 j, en vigueur aujourd'hui.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Même ancre/pas que fetch-freq-sia.mjs (série SIA observée).
const AIRAC_ANCHOR = Date.UTC(2026, 6, 9);
const AIRAC_DAY_MS = 28 * 86400000;

/** AIRAC en vigueur aujourd'hui selon la série SIA (repli sans freq-sia.json). */
export function airacInForce(now = Date.now()) {
    const k = Math.max(0, Math.floor((now - AIRAC_ANCHOR) / AIRAC_DAY_MS));
    return new Date(AIRAC_ANCHOR + k * AIRAC_DAY_MS).toISOString().slice(0, 10);
}

/** Bases issues du XML bd SIA et leur fichier data/ respectif. */
export const SIA_XML_BASES = {
    'sia-airfields': 'terrains (identité, horaires ATS, avitaillement, tél)',
    'sia-runways': 'pistes officielles',
    'sia-airspaces': 'espaces aériens',
    'freq-services-sia': 'fréquences organismes',
    'freq-aa-sia': 'fréquences AFIS/A-A',
};

/**
 * Contrôle de fraîcheur (pur, testable).
 * @param {Object<string,Object|null>} bases Contenus des fichiers data/ (clé = nom base).
 * @param {Object|null} freqSia Contenu data/freq-sia.json (référence).
 * @param {number} [now] Horloge injectable.
 * @returns {{ok:boolean, level:'ok'|'alerte', details:Array, reference:string, message:string}}
 */
export function checkSiaAirac(bases, freqSia, now = Date.now()) {
    const reference = freqSia?.airac || airacInForce(now);
    const srcRef = freqSia?.airac ? 'freq-sia.json (édition sondée)' : 'série SIA 28 j (repli)';
    const details = [];
    let ok = true;

    for (const [file, label] of Object.entries(SIA_XML_BASES)) {
        const b = bases[file];
        const airac = b?.airac || '';
        let etat;
        if (!airac) {
            etat = `absente/vide`;
            ok = false;
        } else if (airac < reference) {
            etat = `RETARD (${airac} < ${reference})`;
            ok = false;
        } else {
            etat = airac > reference ? `en avance (${airac})` : `à jour (${airac})`;
        }
        details.push({ base: file, label, airac: airac || '?', etat });
    }

    const message = ok
        ? `Base XML SIA à jour (AIRAC ${details[0]?.airac}).`
        : `Base XML SIA EN RETARD sur le cycle ${reference} (${srcRef}) : télécharger le nouvel XML_SIA sur le portail SIA dans « telechargement AIRAC/ », puis node scripts/fetch-sia-airac.mjs --xml=... + pub.`;
    return { ok, level: ok ? 'ok' : 'alerte', details, reference, message };
}

// ---- CLI (job GitHub : échec = alerte visible + notification) ----
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f + '.json'), 'utf8')); } catch { return null; } };
    const bases = {};
    for (const file of Object.keys(SIA_XML_BASES)) bases[file] = read(file);
    const r = checkSiaAirac(bases, read('freq-sia'));
    if (process.env.GITHUB_STEP_SUMMARY) {
        fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
            `### Garde-fou base XML SIA (terrains/horaires/pistes/espaces)\n\n| Base | AIRAC | État |\n|---|---|---|\n`
            + r.details.map(d => `| ${d.base} (${d.label}) | ${d.airac} | ${d.etat} |`).join('\n')
            + `\n\nVerdict : ${r.ok ? '✅ ' : '⚠️ '}${r.message}\n`);
    }
    console.log((r.ok ? '::notice::' : '::error::') + r.message);
    for (const d of r.details) console.log(`  ${d.base}=${d.airac} ${d.etat}`);
    process.exit(r.ok ? 0 : 1);
}
