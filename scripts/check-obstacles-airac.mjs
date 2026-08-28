#!/usr/bin/env node
// ============================================================================
// CHECK OBSTACLES AIRAC — garde-fou de fraîcheur de la base obstacles SIA.
//
//   node scripts/check-obstacles-airac.mjs
//
// Les obstacles (data/obstacles.json) sont extraits d'un export AIXM OM
// téléchargé MANUELLEMENT sur le portail SIA (même page que le XML_SIA).
// Ce contrôle échoue (exit 1 → job GitHub en échec → notification) dès que
// la base est en retard sur le cycle AIRAC en vigueur, tant qu'elle n'a pas
// été régénérée :
//   1. télécharger le nouvel AIXM4.5_all_FR_OM_<date>.xml sur le portail SIA
//      (rubrique Produits numériques / export XML), le poser dans
//      « telechargement AIRAC/ » ;
//   2. node scripts/fetch-obstacles.mjs  (prend le XML le plus récent) ;
//   3. publier (npm run pub -- "obstacles AIRAC <date>").
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

/**
 * Contrôle de fraîcheur (pur, testable).
 * @param {Object|null} obstacles Contenu data/obstacles.json (ou absent).
 * @param {Object|null} freqSia Contenu data/freq-sia.json (ou absent).
 * @param {number} [now] Horloge injectable.
 * @returns {{ok:boolean, level:'ok'|'alerte', airac:string, reference:string,
 *            message:string}}
 */
export function checkObstaclesAirac(obstacles, freqSia, now = Date.now()) {
    const reference = freqSia?.airac || airacInForce(now);
    const srcRef = freqSia?.airac ? 'freq-sia.json (édition sondée)' : 'série SIA 28 j (repli)';

    if (!obstacles || !Array.isArray(obstacles.obstacles) || !obstacles.obstacles.length) {
        return {
            ok: false, level: 'alerte', airac: '?', reference,
            message: `data/obstacles.json absent ou vide — générer la base : télécharger AIXM4.5_all_FR_OM_<date>.xml (portail SIA) dans « telechargement AIRAC/ », puis node scripts/fetch-obstacles.mjs + pub.`,
        };
    }
    const airac = obstacles.airac || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(airac)) {
        return {
            ok: false, level: 'alerte', airac: airac || '?', reference,
            message: `data/obstacles.json sans date AIRAC (${airac || 'absente'}) — régénérer via node scripts/fetch-obstacles.mjs.`,
        };
    }
    if (airac < reference) {
        return {
            ok: false, level: 'alerte', airac, reference,
            message: `Obstacles SIA EN RETARD : base AIRAC ${airac} < cycle en vigueur ${reference} (${srcRef}). Télécharger le nouvel AIXM4.5_all_FR_OM sur le portail SIA dans « telechargement AIRAC/ », puis node scripts/fetch-obstacles.mjs + pub.`,
        };
    }
    const etat = airac > reference ? `en avance (${airac} > ${reference} — édition publiée en anticipation)` : `à jour (${airac})`;
    return { ok: true, level: 'ok', airac, reference, message: `Obstacles SIA ${etat}.` };
}

// ---- CLI (job GitHub : échec = alerte visible + notification) ----
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8')); } catch { return null; } };
    const r = checkObstaclesAirac(read('obstacles.json'), read('freq-sia.json'));
    if (process.env.GITHUB_STEP_SUMMARY) {
        fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
            `### Garde-fou obstacles SIA\n\n| | |\n|---|---|\n| Base obstacles | AIRAC **${r.airac}** |\n| Cycle en vigueur | **${r.reference}** |\n| Verdict | ${r.ok ? '✅ ' : '⚠️ ' }${r.message} |\n`);
    }
    console.log((r.ok ? '::notice::' : '::error::') + r.message);
    console.log(`base=${r.airac} référence=${r.reference} (${r.ok ? 'OK' : 'ALERTE'})`);
    process.exit(r.ok ? 0 : 1);
}
