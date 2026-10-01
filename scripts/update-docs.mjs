#!/usr/bin/env node
// ============================================================================
// UPDATE DOCS — journal des versions automatique (notice + README), demandé
// par le pilote le 06/09 : « la notice et le README doivent être remis à
// jour à chaque gros changement ».
//
//   node scripts/update-docs.mjs
//
// Un « gros changement » = un commit de pub (les messages de commit sont
// rédigés pour ça). Le script lit git log depuis la dernière entrée
// enregistrée (marqueur <!-- docs:lastSha --> posé dans CHAQUE document)
// et insère les nouvelles entrées en tête du journal du README, rabattu
// à 15 entrées (historique complet dans git). Les NOTICES utilisateur ne
// portent PAS de journal (choix pilote 06/09 : rien de technique dedans).
//
// Appelé automatiquement par pub.mjs juste AVANT le commit : les docs
// partent avec le changement qu'ils décrivent.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_ENTREES = 15;

const git = (args) => execSync(`git ${args}`, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 }).trim();
const gitOk = (args) => { try { git(args); return true; } catch { return false; } };
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Commits de changement (bumps exclus) entre lastSha..HEAD, croissant. */
function commitsDepuis(lastSha) {
    let range = lastSha ? `${lastSha}..HEAD` : 'HEAD~40..HEAD';
    let lignes;
    try { lignes = git(`log --reverse --no-merges --format=%H%x09%ad%x09%s --date=short ${range}`); }
    catch { lignes = git('log --reverse --no-merges --format=%H%x09%ad%x09%s --date=short -40'); }
    return lignes.split('\n').filter(Boolean).map(l => {
        const [sha, date, sujet] = l.split('\t');
        return { sha, date, sujet };
    }).filter(c => !/^\[deploy\] bump/i.test(c.sujet));
}

/** Version ?v= bumpée par ce commit (index.html), si repérable. */
function versionDuCommit(sha) {
    try {
        const diff = git(`show --format= --unified=0 ${sha} -- index.html`);
        return diff.match(/app\.js\?v=([\d.]+)/)?.[1] || null;
    } catch { return null; }
}

/** Traite UN document : { file, ancreFin (regex), entree(e), habillage }.
 * habillage = { titre, debut, fin, motifEntree } ; les entrées s'insèrent
 * juste après « debut », les plus récentes en tête. */
function majDoc({ file, ancreFin, entree, habillage }) {
    const p = path.join(ROOT, file);
    let s = fs.readFileSync(p, 'utf8');

    if (!s.includes('<!-- docs:lastSha')) {
        const mFin = s.match(ancreFin);
        if (!mFin) { console.warn(`  ${file} : ancre introuvable — ignoré`); return; }
        const a = mFin.index;
        s = s.slice(0, a) + `${habillage.titre}\n<!-- docs:lastSha=aucun -->\n${habillage.debut}\n${habillage.fin}\n\n` + s.slice(a);
        fs.writeFileSync(p, s);
    }

    // AUTO-RÉPARATION (28/09) : les marqueurs debut/fin peuvent être perdus
    // dans une édition manuelle — l'insertion échouait alors en SILENCE
    // (le lastSha avançait, les entrées n'étaient jamais écrites : journal
    // resté figé au 06/09 malgré des dizaines de pubs). On les recrée
    // autour des entrées existantes : debut sous le titre, fin devant le
    // marqueur lastSha.
    if (!s.includes(habillage.debut)) {
        const reTitre = new RegExp(habillage.titre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[ \\t]*\\r?\\n', 'm');
        const mT = s.match(reTitre);
        if (!mT || !s.includes('<!-- docs:lastSha=')) {
            console.warn(`  ${file} : titre/marqueur introuvables — ignoré`);
            return;
        }
        const apresTitre = mT.index + mT[0].length;
        s = s.slice(0, apresTitre) + habillage.debut + '\n' + s.slice(apresTitre);
        const iMarq = s.indexOf('<!-- docs:lastSha=');
        s = s.slice(0, iMarq) + habillage.fin + '\n' + s.slice(iMarq);
        fs.writeFileSync(p, s);
        console.warn(`  ${file} : marqueurs debut/fin RECÉÉS (perdus — le journal était figé)`);
    }

    const m = s.match(/<!-- docs:lastSha=([0-9a-f]+|aucun) -->/);
    let lastSha = m[1] === 'aucun' ? null : m[1];
    // SHA MORT (filter-repo 01/10 : d204aeb0 disparu) : git log/rev-list
    // échouaient sur le range, le catch vidait les entrées → « déjà à jour »
    // en silence, journal figé — même panne que le 06/09. Un lastSha qui
    // n'est pas un ancêtre de HEAD vaut NULL : repli HEAD~40 + dédoublonnage
    // ci-dessous. (NB : PAS de ^{commit} — le caret est mangé par cmd.exe
    // sous execSync Windows, la validation échouait alors TOUJOURS.)
    if (lastSha && !gitOk(`merge-base --is-ancestor ${lastSha} HEAD`)) {
        console.warn(`  ${file} : lastSha ${lastSha.slice(0, 8)} inconnu (filter-repo ?) — repli sur l'historique récent, doublons filtrés`);
        lastSha = null;
    }
    let entrees = commitsDepuis(lastSha);
    if (lastSha) {
        try {
            const set = new Set(git(`rev-list ${lastSha}..HEAD`).split('\n').filter(Boolean));
            entrees = entrees.filter(e => set.has(e.sha));
        } catch { entrees = []; }
    } else {
        // Repli : ancre DATE (la plus récente entrée du journal), pas SHA —
        // un pull --rebase de pub réécrit les SHA et tuerait lastSha à
        // chaque livraison. Ne journaliser que les commits AUSSI récents ou
        // plus récents ; les entrées anciennes rabattues hors MAX_ENTREES
        // ne se réinsèrent ainsi jamais en boucle.
        const d = s.slice(s.indexOf(habillage.debut)).match(/\d{4}-\d{2}-\d{2}/);
        if (d) entrees = entrees.filter(e => e.date >= d[0]);
    }
    entrees = entrees.map(e => ({ ...e, version: versionDuCommit(e.sha) }));
    // Ceinture : une entrée déjà présente au caractère près (date + version +
    // sujet tronqué déterministes) n'est jamais réinsérée.
    entrees = entrees.filter(e => !s.includes(entree(e)));
    if (!entrees.length) { console.log(`  ${file} : déjà à jour`); return; }

    const bloc = entrees.slice().reverse().map(entree).join('\n');
    s = s.replace(/<!-- docs:lastSha=(?:[0-9a-f]+|aucun) -->/, `<!-- docs:lastSha=${entrees[entrees.length - 1].sha} -->`)
         .replace(habillage.debut, `${habillage.debut}\n${bloc}`);
    fs.writeFileSync(p, s);

    // Rabat à MAX_ENTREES : supprime les entrées les plus anciennes.
    const re = new RegExp(habillage.motifEntree, 'gm');
    const items = s.match(re) || [];
    if (items.length > MAX_ENTREES) {
        for (const it of items.slice(MAX_ENTREES)) s = s.replace(it + '\n', '').replace(it, '');
        fs.writeFileSync(p, s);
    }
    console.log(`  ${file} : +${entrees.length} entrée(s)`);
}

const court = (t, n = 140) => t.length > n ? t.slice(0, n).replace(/\s+\S*$/, '') + '…' : t;

majDoc({
    file: 'README.md',
    ancreFin: /^## Crédits & licences$/m,
    entree: (e) => `- **${e.date}${e.version ? ` · v${e.version}` : ''}** — ${court(e.sujet)}`,
    habillage: {
        titre: '## Journal des versions',
        debut: '<!-- debut journal -->',
        fin: '<!-- fin journal -->',
        motifEntree: '^- \\*\\*\\d{4}-\\d{2}-\\d{2}.*$',
    },
});

console.log('update-docs terminé.');
