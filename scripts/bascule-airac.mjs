#!/usr/bin/env node
// ============================================================================
// BASCULE AIRAC — publie les fichiers du cycle suivant le jour de son entrée
// en vigueur : le dépôt garde les sources, la prod bascule À LA DATE.
//
//   node scripts/bascule-airac.mjs --cycle=2026-10-01 --ref=a937cce3
//        [--no-commit] [--force]
//
// Séquence :
//   1. Gardes : le cycle demandé doit être l'AIRAC EN VIGUEUR aujourd'hui
//      (sinon refus — la donnée du cycle suivant ne part jamais en avance),
//      et data/ doit être propre (pas de travail non commité écrasé).
//   2. Restaure les fichiers du cycle depuis --ref (git checkout).
//   3. Garde-fous SIA + obstacles + test radio-points (verts obligatoire).
//   4. Mode local : commit + push + attente du déploiement + toast.
//      Mode --no-commit (workflow bascule-airac.yml) : fichiers + checks
//      seulement — le workflow commite et enchaîne deploy-ftp.
//
// Pour les CYCLES FUTURS : générer les données localement (fetch-sia-airac,
// fetch-obstacles) SANS les committer, puis le jour de l'effet :
// commit + `npm run pub -- "base SIA AIRAC <date>"`. Ce script sert au cas
// particulier où les fichiers d'un cycle futur ont déjà été commités/poussés
// trop tôt : on restaure le cycle courant, et --ref republie le bon cycle à
// sa date.
// ============================================================================
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { airacInForce } from './check-sia-airac.mjs';
import { toast, waitForDeploy } from './notify-deploy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BRANCH = 'Version-2.0';

const args = process.argv.slice(2);
const arg = (name, def) => {
    const a = args.find(x => x.startsWith(`--${name}=`));
    return a ? a.slice(name.length + 3) : def;
};
const has = (name) => args.includes(`--${name}`);

const CYCLE = arg('cycle', '2026-10-01');
const REF = arg('ref', '');
const NO_COMMIT = has('no-commit');
const FORCE = has('force') || arg('force', 'false') === 'true';

const FICHIERS = [
    'data/freq-aa-sia.json', 'data/freq-services-sia.json', 'data/obstacles.json',
    'data/radio-points.json', 'data/sia-airfields.json', 'data/sia-airspaces.json',
    'data/sia-radio-layer.json', 'data/sia-runways.json', 'test/radio-points.test.mjs',
];

const git = (cmd) => execFileSync('git', cmd.split(' '), { cwd: ROOT, encoding: 'utf8' }).trim();
const ok = (m) => console.log('  ✓ ' + m);
const die = (m) => { console.error('  ✗ ' + m); process.exit(1); };

// ---- Garde 1 : le cycle demandé est celui EN VIGUEUR aujourd'hui ------------
// (la donnée du cycle suivant ne part jamais en avance — retour pilote 20/09).
const enVigueur = airacInForce();
if (enVigueur !== CYCLE && !FORCE) {
    die(`Bascule refusée : ${CYCLE} entre en vigueur le ${CYCLE} ; l'AIRAC en vigueur ` +
        `aujourd'hui est ${enVigueur}. Relancez ce jour-là (ou --force pour forcer).`);
}
ok(`AIRAC en vigueur : ${enVigueur} = cycle demandé ${CYCLE}`);

// ---- Garde 2 : data/ propre --------------------------------------------------
const sale = git('status --porcelain -- data/').split('\n').filter(Boolean);
if (sale.length) die('data/ contient du non-commité — committez ou stashez d\'abord :\n' + sale.join('\n'));
ok('data/ propre');

// ---- 1. Restauration des fichiers du cycle depuis --ref ---------------------
console.log(`Restauration du cycle ${CYCLE} depuis ${REF}…`);
git(`checkout ${REF} -- ${FICHIERS.join(' ')}`);
const rp = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'radio-points.json'), 'utf8'));
if (rp.siaAirac !== CYCLE) {
    die(`${REF} ne porte pas le cycle ${CYCLE} (trouvé : ${rp.siaAirac}) — vérifiez --ref.`);
}
ok(`radio-points.json : AIRAC ${rp.siaAirac}, ${rp.counts?.navaidsSia} navaids SIA`);

// ---- 2. Garde-fous + test (échec du script si non verts) --------------------
console.log('Garde-fous et test radio-points…');
execFileSync('node', ['scripts/check-sia-airac.mjs'], { cwd: ROOT, stdio: 'inherit' });
execFileSync('node', ['scripts/check-obstacles-airac.mjs'], { cwd: ROOT, stdio: 'inherit' });
execFileSync('node', ['--test', 'test/radio-points.test.mjs'], { cwd: ROOT, stdio: 'inherit' });
ok('Garde-fous et tests verts.');

// ---- 3. Publication ----------------------------------------------------------
if (NO_COMMIT) {
    console.log('Mode --no-commit : fichiers du cycle en place (le workflow commite).');
    process.exit(0);
}

git('add ' + FICHIERS.join(' '));
git(`commit -m "Bascule AIRAC ${CYCLE}"`);
console.log('Push…');
try {
    git(`push origin ${BRANCH}`);
} catch {
    git(`pull --rebase origin ${BRANCH}`);
    git(`push origin ${BRANCH}`);
}
const sha = git('rev-parse HEAD');
console.log(`Poussé (${sha.slice(0, 8)}) — attente du déploiement…`);
const w = await waitForDeploy(BRANCH, sha, 420);
if (w.status === 'deployed' || w.status === 'nothing') {
    ok(`Déploiement confirmé (${w.status}).`);
    try { toast('Prevol - bascule AIRAC', `Cycle ${CYCLE} en ligne.`, 'info'); } catch { }
} else {
    die(`Déploiement : ${w.status} — vérifiez l'onglet Actions du dépôt.`);
}
