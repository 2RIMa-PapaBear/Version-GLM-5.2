/* ================================================================
 * CARTES TEMSI / WinTEM / FRONTS DU DOSSIER DE VOL (pilote 02/10)
 * ================================================================
 *
 * « Intégrer les cartes TEMSI, WinTEM et la carte des fronts couvrant
 *  la TOTALITÉ du vol (date et heures), à la suite de la page Météo
 *  au dossier :
 *   - TEMSI  : page HORIZONTALE pleine, une page par carte ;
 *   - WinTEM : page VERTICALE pleine, une page par carte ;
 *   - fronts : page VERTICALE pleine, une page par carte (2 si
 *      possible et nécessaire).
 *  Les trois HORODATÉES. »
 *
 * SÉLECTION : chaque carte AEROWEB porte une échéance ponctuelle
 * (séries 3 h WinTEM, 6-12 h TEMSI/fronts) ; elle est réputée valable
 * du MILIEU avec l'échéance précédente au MILIEU avec la suivante.
 * Une carte est retenue si sa plage recouvre la fenêtre de vol
 * [génération du dossier, arrivée prévue] — un vol à cheval sur deux
 * échéances retient les DEUX : c'est ce qui couvre la totalité du vol.
 * Fronts plafonnés à 2 pages (première + dernière retenues).
 *
 * DÉGRADATION : chaque source dégrade SEULE — relais injoignable ou
 * image manquante → carte absente, jamais de dossier en échec.
 *
 * Le rendu PDF (pages, orientation, ajustement sans déformation) est
 * dans navlog-pdf.js (drawSigwxPages) ; ce module collecte.
 * ================================================================ */
import { fetchTemsiList, fetchTemsiImageBlob, temsiLabels } from './temsi.js';
import { fetchFrontsList, fetchFrontsImageBlob } from './fronts.js';

const UTC14_RE = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/;

/** « 20261002150000 » → ms UTC (NaN si mal formé). */
export function utc14ToMs(utc) {
    return Date.parse(String(utc).replace(UTC14_RE, '$1-$2-$3T$4:$5:$6Z'));
}

/** Échéances dont la plage de validité (milieux voisins) recouvre la
 *  fenêtre de vol [startMs, endMs] — PUR, testé sous Node.
 *  @param {Array} echeances [{utc}] ou ['YYYYMMDDHHMMSS'] (ordre libre)
 *  @param {number} maxN plafond (fronts : 2 → première + dernière)
 *  @returns {Array<{utc, ts}>} échéances retenues, triées, originales. */
export function selectEcheancesForWindow(echeances, startMs, endMs, maxN = Infinity) {
    const items = [];
    for (const e of echeances || []) {
        const utc = typeof e === 'string' ? e : e?.utc;
        const ts = utc14ToMs(utc);
        if (Number.isFinite(ts)) items.push({ utc: String(utc), ts });
    }
    items.sort((a, b) => a.ts - b.ts);
    if (!items.length) return [];

    // Plages de validité par milieux ; aux extrémités de la série,
    // demi-espacement (borné à 3 h — une échéance seule ≈ ±3 h).
    const gaps = items.slice(1).map((it, i) => items[i + 1].ts - items[i].ts).filter(g => g > 0);
    const half = gaps.length ? Math.min(Math.max(...gaps) / 2, 3 * 3600e3) : 3 * 3600e3;
    let sel = items.filter((it, i) => {
        const a = i === 0 ? it.ts - half : (items[i - 1].ts + it.ts) / 2;
        const b = i === items.length - 1 ? it.ts + half : (it.ts + items[i + 1].ts) / 2;
        // Chevauchement STRICT : une plage qui ne fait que TOUCHER une
        // borne du vol (départ ou arrivée pile à la frontière de deux
        // cartes) ne compte pas — la carte voisine couvre déjà ce point.
        return b > startMs && a < endMs;
    });
    if (!sel.length) {
        // Liste sans aucun recouvrement (p. ex. TEMSI à échéance unique) :
        // la carte la plus proche du milieu du vol vaut mieux que rien.
        const c = (startMs + endMs) / 2;
        sel = [items.reduce((best, it) => Math.abs(it.ts - c) < Math.abs(best.ts - c) ? it : best)];
    }
    if (sel.length > maxN) sel = [sel[0], sel[sel.length - 1]];
    return sel;
}

/** Blob image AEROWEB (tout format — le WinTEM est un PNG gris 2 bits
 *  que jsPDF n'embarque pas de façon fiable) → JPEG dataURL pleine
 *  définition. Le décodage est fait par le NAVIGATEUR (canvas) :
 *  convention déjà retenue pour les VAC et graphiques TAF du dossier.
 *  null hors navigateur ou en échec. */
async function blobToJpeg(blob, quality = 0.92) {
    if (typeof document === 'undefined') return null;
    const url = URL.createObjectURL(blob);
    try {
        const img = await new Promise((resolve, reject) => {
            const i = new Image();
            i.onload = () => resolve(i);
            i.onerror = () => reject(new Error('décodage image impossible'));
            i.src = url;
        });
        const c = document.createElement('canvas');
        c.width = img.naturalWidth || 1;
        c.height = img.naturalHeight || 1;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';   // fond blanc : le JPEG n'a pas d'alpha
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0);
        return { data: c.toDataURL('image/jpeg', quality), w: c.width, h: c.height };
    } catch (e) {
        console.warn('conversion carte impossible :', e.message);
        return null;
    } finally {
        URL.revokeObjectURL(url);
    }
}

/** Collecte les cartes du dossier : TEMSI (toutes couches), WinTEM,
 *  fronts — une entrée par carte retenue, dans l'ordre pilote.
 *  @param {Object} o { totalMin } durée de vol prévue (min) — la fenêtre
 *    couverte va de la génération à l'arrivée prévue.
 *  @returns {Promise<Array<{kind, title, when, img, fmt, w, h}>>} */
export async function collectSigwxCharts({ totalMin, isFr = true } = {}) {
    const start = Date.now();
    const end = start + (Number.isFinite(+totalMin) && +totalMin > 0 ? +totalMin : 60) * 60000;

    // Listes en parallèle ; chaque liste dégrade seule (null → absent).
    const [tList, fList] = await Promise.all([fetchTemsiList(), fetchFrontsList()]);

    const jobs = [];
    for (const layer of (tList?.layers || [])) {
        const kind = layer.key === 'wintem' ? 'wintem' : 'temsi';
        for (const e of selectEcheancesForWindow(layer.echeances, start, end)) {
            jobs.push({ kind, layer, e });
        }
    }
    for (const layer of (fList?.layers || [])) {
        for (const e of selectEcheancesForWindow(layer.echeances, start, end, 2)) {
            jobs.push({ kind: 'fronts', layer, e });
        }
    }

    // Images séquentiellement (chargement doux, ~100-280 Ko chacune) ;
    // chaque carte dégrade seule.
    const charts = [];
    for (const j of jobs) {
        const blob = j.kind === 'fronts'
            ? await fetchFrontsImageBlob(j.layer.type, j.e.utc)
            : await fetchTemsiImageBlob(j.layer.type, j.e.utc);
        const img = blob ? await blobToJpeg(blob) : null;
        if (!img) continue;
        const lab = temsiLabels(j.e.utc);
        const d = new Date(j.e.ts);
        const day = d.toLocaleDateString(isFr ? 'fr-FR' : 'en-GB', { weekday: 'short', day: '2-digit', month: '2-digit' });
        charts.push({
            kind: j.kind,
            title: j.kind === 'fronts'
                ? `${isFr ? 'Fronts' : 'Fronts'} · ${j.layer.label}`
                : String(j.layer.label || (j.kind === 'wintem' ? 'WinTEM' : 'TEMSI')),
            when: `${isFr ? 'Valable' : 'Valid'} ${lab.utc} (${lab.loc}) · ${day}`,
            img: img.data, fmt: 'JPEG', w: img.w, h: img.h,
        });
    }
    return charts;
}
