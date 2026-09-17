#!/usr/bin/env node
// ============================================================================
// FETCH SUP SIA — Suppléments AIP série A (France métropole) → data/sup-sia.json.
//
//   node scripts/fetch-sup-sia.mjs
//
// Source OFFICIELLE : portail SIA, page « SUP AIP METROPOLE »
//   https://www.sia.aviation-civile.gouv.fr/documents/supaip/aip/id/6
// (page publique, ~121 Sup en vigueur : numéro, objet, validité, tags
// IFR/VFR/AIRAC, PDF par documents/download/f/d/<id>/ — publics).
// RÈGLE PILOTE : la base, ce sont les fichiers SIA (cf. sia-priority-rule).
// Intégré au robot hebdo (.github/workflows/update-radio-points.yml).
//
// Le parseur (parseSupRows) est EXPORTÉ et testé sur capture réelle
// (test/sup-sia.test.mjs) ; l'exécution principale est gardée par un test
// d'import.meta.url pour rester importable sous Node sans effet de bord.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'sup-sia.json');
const PAGE = 'https://www.sia.aviation-civile.gouv.fr/documents/supaip/aip/id/6';

/** Parse la page SIA → items [{num, subject, start, end, ifr, vfr, airac, url, docId}]. Pur. */
export function parseSupRows(html) {
    const items = [];
    const rows = html.match(/<tr class="tr_ligne_document[^"]*">[\s\S]*?<\/tr>/g) || [];
    for (const row of rows) {
        const url = (row.match(/href="([^"]*documents\/download\/f\/d\/(\d+)\/?)"/) || [])[1];
        if (!url) continue;
        const docId = (row.match(/documents\/download\/f\/d\/(\d+)/) || [])[1];
        // Texte nettoyé de la ligne. L'objet est DOUBLEMENT échappé côté SIA
        // (des balises <p>…</p> y figurent en &lt;p&gt;) : décoder les entités
        // D'ABORD, retirer les balises ENSUITE, puis décoder le reste.
        const decode = (x) => x
            .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"')
            .replace(/&#39;|&rsquo;/g, "'").replace(/&eacute;/g, 'é').replace(/&egrave;/g, 'è')
            .replace(/&ecirc;/g, 'ê').replace(/&agrave;/g, 'à').replace(/&ccedil;/g, 'ç')
            .replace(/&laquo;/g, '«').replace(/&raquo;/g, '»')
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
            .replace(/&amp;/g, '&');
        let txt = decode(row)
            .replace(/<img[^>]*>/g, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const num = (txt.match(/\b(\d{2,4})\/(\d{4})\b/) || [])[0] || '';
        if (!num) continue;
        // Validité : « Valide du YYYY-MM-DD au YYYY-MM-DD ».
        const start = (txt.match(/Valide du (\d{4}-\d{2}-\d{2})/) || [])[1] || null;
        const end = (txt.match(/au (\d{4}-\d{2}-\d{2})/) || [])[1] || null;
        // Objet : tout ce qui suit le numéro, jusqu'à « Valide du ».
        const subject = (txt.replace(num, '').split(/Valide du /)[0] || '').replace(/^[\s:–-]+/, '').trim();
        // Tags : cochés = présence de « checked » dans la rangée ; les libellés
        // IFR/VFR/AIRAC apparaissent dans l'ordre en fin de ligne nettoyée.
        const vfr = /name="VFR"[^>]*checked/.test(row);
        const ifr = /name="IFR"[^>]*checked/.test(row);
        const airac = /name="AIRAC"[^>]*checked/.test(row);
        items.push({ num, subject, start, end, ifr, vfr, airac, url, docId });
    }
    // Les plus récentes d'abord (numéro décroissant, année décroissante).
    items.sort((a, b) => {
        const [na, ya] = a.num.split('/').map(Number);
        const [nb, yb] = b.num.split('/').map(Number);
        return (yb - ya) || (nb - na);
    });
    return items;
}

async function main() {
    console.log('Récupération de la page SUP AIP MÉTROPOLE…');
    const res = await fetch(PAGE, {
        // Politesse : le robot passe une fois par semaine.
        headers: { 'user-agent': 'metar-taf-visualiseur/1.0 (robot hebdo, préparation VFR)' },
        signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const html = await res.text();
    const items = parseSupRows(html);
    if (items.length < 20) {
        // Le SIA publie en permanence >100 Sup en vigueur : moins de 20 lignes
        // = page au format inattendu → refus (jamais de base silencieusement vide).
        throw new Error(`page inattendue : ${items.length} Sup seulement (format changé ?)`);
    }
    const out = { generatedAt: new Date().toISOString(), count: items.length, items };
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(out));
    const vfr = items.filter(i => i.vfr).length;
    console.log(`OK : ${OUT} — ${items.length} Sup en vigueur (dont ${vfr} VFR, ${items.length - vfr} IFR seules)`);
}

const isMain = import.meta.url === pathToFileURLSafe(process.argv[1] || '');
function pathToFileURLSafe(p) {
    try { return new URL('file:///' + String(p).replace(/\\/g, '/')).href; } catch { return ''; }
}
if (isMain) main().catch((e) => { console.error('ÉCHEC :', e.message); process.exit(1); });
