// ============================================================================
// FUSION PIB — Repli « tronçon par tronçon » des dossiers SOFIA.
//
// SOFIA rejette les couloirs multi-segments qui reviennent en arrière
// (HTTP 400, message générique « consultez la FAQ ») : LFRV→LFTA→LFBH
// (descente vers Tarbes puis retour nord-ouest) échoue alors que chaque
// tronçon isolé — une ligne droite — est toujours accepté.
//
// Quand l'appel global échoue, le worker interroge la route tronçon par
// tronçon et fusionne les dossiers avec ce module :
//   - ADDep  = dossier du PREMIER tronçon (départ global) ;
//   - ADDes  = dossier du DERNIER tronçon (arrivée globale) ;
//   - ADDeg / ADSur / Other = fusion par terrain, NOTAM dédupliqués par id ;
//   - FIR = fusion catégorie → code23 → aérodrome impacté → purpose,
//     NOTAM dédupliqués par id (le même NOTAM couvre souvent 2 tronçons) ;
//   - nbNotams = recompte dédupliqué (l'en-tête du dossier doit rester vrai).
//
// Module PUR (aucune dépendance Worker) → testé par test/fusion-pib.test.mjs.
// ============================================================================

/** Union de deux listes de NOTAM, dédupliquée par id. */
export function mergeNotamLists(a = [], b = []) {
    const seen = new Set((a || []).map(n => String(n?.id ?? '')));
    return [...(a || []), ...(b || []).filter(n => n && !seen.has(String(n.id ?? '')))];
}

/** Compte les NOTAM d'un bloc AD ({ code, name, cat: [notams] }). */
const countAdBlock = (blk) => Object.values(blk || {})
    .reduce((s, v) => s + (Array.isArray(v) ? v.length : 0), 0);

/** Fusionne les listes d'un bloc AD dans `ex` : un NOTAM n'y figure qu'une
 *  seule fois, dans la catégorie de sa première apparition (à cheval sur
 *  2 tronçons, SOFIA peut classer le même NOTAM différemment). */
function mergeAdBlock(ex, blk) {
    const ids = new Set(Object.values(ex).filter(Array.isArray).flat().map(n => String(n?.id ?? '')));
    for (const [k, v] of Object.entries(blk)) {
        if (!Array.isArray(v)) continue;
        for (const n of v) {
            const key = String(n?.id ?? '');
            if (!n || ids.has(key)) continue;
            ids.add(key);
            (ex[k] = ex[k] || []).push(n);
        }
    }
    return ex;
}

/** Fusionne des dossiers PIB de tronçons consécutifs en un dossier global. */
export function mergePibChunks(chunks) {
    const valid = (chunks || []).filter(c => c && c.listnotams);
    if (!valid.length) throw new Error('aucun tronçon exploitable');
    const first = valid[0], last = valid[valid.length - 1];

    const L = {};
    L.ADDep = first.listnotams.ADDep || {};
    L.ADDes = last.listnotams.ADDes || {};

    // ADDeg / ADSur / Other : fusion par terrain (dédup par id via
    // mergeAdBlock), puis APLATIS en {catégorie: [NOTAM]} — la MÊME FORME
    // que le dossier direct (M14, audit 27/09 : le client notam.js énumère
    // les CATÉGORIES de listnotams.ADDeg/ADSur/Other ; l'ancien rendu en
    // blocs [{code, cat: […]}] affichait « 0 NOTAM », cassait le compteur
    // et privait l'annexe PDF et l'AZBA des dégagements/survolés/autres —
    // les tests encodeaient les deux formes contradictoires).
    for (const key of ['ADDeg', 'ADSur', 'Other']) {
        const blocks = [];
        for (const c of valid) {
            for (const blk of (c.listnotams[key] || [])) {
                const ex = blocks.find(x => (x.code || '') === (blk.code || ''));
                if (ex) mergeAdBlock(ex, blk);
                else blocks.push(blk);
            }
        }
        const cat = {};
        for (const blk of blocks)
            for (const [k, list] of Object.entries(blk))
                if (Array.isArray(list)) cat[k] = mergeNotamLists(cat[k] || [], list);
        L[key] = cat;
    }

    // FIR : {catégorie: [{code23, sortedNotamsByImpactedAerodromes: […]}]}
    const fir = {};
    for (const c of valid) {
        for (const [cat, groups] of Object.entries(c.listnotams.FIR || {})) {
            const arr = fir[cat] = fir[cat] || [];
            for (const grp of (Array.isArray(groups) ? groups : [])) {
                let ex = arr.find(g => g.code23 === grp.code23);
                if (!ex) {
                    ex = { ...grp, sortedNotamsByImpactedAerodromes: [] };
                    arr.push(ex);
                }
                for (const ae of (grp.sortedNotamsByImpactedAerodromes || [])) {
                    let exAe = ex.sortedNotamsByImpactedAerodromes.find(x => x.code === ae.code);
                    if (!exAe) {
                        exAe = { ...ae, sortedNotamsByPurpose: [], notam: [] };
                        ex.sortedNotamsByImpactedAerodromes.push(exAe);
                    }
                    for (const pu of (ae.sortedNotamsByPurpose || [])) {
                        let exPu = exAe.sortedNotamsByPurpose.find(x => x.purpose === pu.purpose);
                        if (!exPu) { exPu = { ...pu, notam: [] }; exAe.sortedNotamsByPurpose.push(exPu); }
                        exPu.notam = mergeNotamLists(exPu.notam, pu.notam);
                    }
                    exAe.notam = mergeNotamLists(exAe.notam, ae.notam);
                }
            }
        }
    }
    L.FIR = fir;

    // Recompte dédupliqué global (l'en-tête « N NOTAM » doit rester vrai).
    const ids = new Set();
    const tally = (list) => (list || []).forEach(n => n?.id && ids.add(String(n.id)));
    tally(Object.values(L.ADDep).flat());
    tally(Object.values(L.ADDes).flat());
    for (const key of ['ADDeg', 'ADSur', 'Other'])
        tally(Object.values(L[key]).flat());
    for (const groups of Object.values(fir))
        for (const grp of groups)
            for (const ae of (grp.sortedNotamsByImpactedAerodromes || [])) {
                tally(ae.notam);
                for (const pu of (ae.sortedNotamsByPurpose || [])) tally(pu.notam);
            }

    return { ...first, listnotams: L, nbNotams: ids.size };
}
