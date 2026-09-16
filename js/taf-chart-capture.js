/* ================================================================
 * TAF CHART CAPTURE — Graphique TAF → PNG pour le PDF dossier (B1)
 * ================================================================
 *
 * Option 1 (arbitrage pilote 13/09) : le graphique des messages TAF
 * de l'ARRIVÉE et du DÉGAGEMENT est capturé depuis le moteur RÉEL de
 * l'app (genererGraphique → dessinerGraphique) par SUBSTITUTION
 * TEMPORAIRE du champ de message :
 *
 *   1. sauvegarde de l'état écran (champ, caches de rendu, thème,
 *      devicePixelRatio) ;
 *   2. thème CLAIR forcé + devicePixelRatio porté à 2.5 → le canvas
 *      est rendu en haute résolution d'impression (dessinerGraphique
 *      dimensionne le canvas par dpr) ;
 *   3. le message du terrain est posé dans le champ, genererGraphique
 *      rend le graphique → toDataURL('image/png') + ratio hauteur/largeur ;
 *   4. restauration COMPLÈTE puis re-rendu du message d'origine.
 *
 * Effet de bord assumé : les widgets suivent le terrain substitué
 * pendant ~200 ms (aucun fetch — caches chauds) puis reviennent.
 * ================================================================ */

import { state } from './core.js';

/**
 * @param {string} rawTaf message TAF brut (ou METAR) du terrain à grapher.
 * @returns {Promise<{png:string, ratio:number}|null>} image PNG data-URL +
 *   ratio hauteur/largeur du canvas rendu ; null silencieux en échec.
 */
export async function captureTafChartPng(rawTaf) {
    let mod = null;
    try {
        // Import dynamique : app.js importe le générateur du PDF, l'inverse
        // en statique créerait un cycle.
        mod = await import('./app.js');
    } catch { return null; }
    if (!mod?.genererGraphique) return null;

    const input = document.getElementById('tafInput');
    const canvas = document.getElementById('tafCanvas');
    if (!input || !canvas || !String(rawTaf || '').trim()) return null;

    const html = document.documentElement;
    const wasLight = html.classList.contains('theme-light');
    const savedDpr = window.devicePixelRatio;
    const savedVal = input.value;
    const savedW = state.chartRenderWidthOverride ?? null;
    const saved = {
        lastRenderState: state.lastRenderState,
        lastCacheKey: state.lastCacheKey,
        lastParsed: state.lastParsed,
        requestedIcao: state.requestedIcao,
        manualTargetHour: state.manualTargetHour,
        forcedRunway: state.forcedRunway,
        chartNoSunLayer: !!state.chartNoSunLayer,
    };

    try {
        html.classList.add('theme-light');          // impression : thème clair
        window.devicePixelRatio = 2;                // ~327 dpi en A5 : net à l'impression
        // Capture au FORMAT D'IMPRESSION (retour pilote 16/09 : « graphiques
        // TAF adaptés à la largeur de la page, quel que soit l'appareil ») :
        // le moteur dimensionne le canvas sur la LARGEUR ÉCRAN du conteneur
        // — sur téléphone le graphe est étroit (ratio ~1.1) et la page Météo
        // du dossier le réduisait à ~60 % de la largeur utile. La 1re
        // tentative (style.width forcé sur le conteneur) a été écrasée par
        // le CSS mobile sur le téléphone du pilote : l'override passe
        // DIRECTEMENT par le moteur (state.chartRenderWidthOverride, lu par
        // dessinerGraphique) — indépendant du DOM.
        state.chartRenderWidthOverride = 760;
        input.value = String(rawTaf);
        state.lastRenderState = null;
        state.lastCacheKey = null;
        // -1 = heure hors fenêtre du TAF : _drawArrivalCursor ne dessine
        // NI le curseur NI l'étiquette « heure d'arrivée prévue » (retour
        // immédiat sur valeur hors [startH, endH]) — graphique « brut »
        // pour le dossier (retour pilote 13/09).
        state.manualTargetHour = -1;
        // Sans le fond gris de la nuit (couche soleil) à l'impression.
        state.chartNoSunLayer = true;
        mod.genererGraphique();

        // Le dessin réel est planifié dans un requestAnimationFrame par
        // updateFinalUI (ui-module) : attendre DEUX frames pour que le
        // canvas contienne le graphe DEMANDÉ avant de le figer — sans
        // cela, on photographiait le graphe précédent (le METAR affiché).
        // Repli minuteur 250 ms : l'onglet PDF du dossier s'ouvre AVANT la
        // génération, la page passe en arrière-plan et Chrome SUSPEND les
        // rAF des pages masquées — sans repli, la génération gelait pour
        // toujours (reproduit en QA headless, valable aussi si le pilote
        // change d'onglet pendant l'impression).
        await new Promise((r) => {
            let done = false;
            const fin = () => { if (!done) { done = true; clearTimeout(timer); r(); } };
            const timer = setTimeout(fin, 250);
            requestAnimationFrame(() => requestAnimationFrame(fin));
        });

        // JPEG fin : un graphe TAF riche en PNG pèse ~600 Ko (dégradés du
        // soleil),JPEG 0.92 le ramène ~200 Ko pour un dossier ~1 Mo.
        const png = canvas.toDataURL('image/jpeg', 0.92);
        const ratio = canvas.width > 0 ? canvas.height / canvas.width : 0.4;
        if (!png || png.length < 200 || ratio <= 0 || ratio > 2) return null;
        return { png, ratio, fmt: 'JPEG' };
    } catch (e) {
        console.warn('capture graphique TAF ignorée :', e.message);
        return null;
    } finally {
        // Restauration intégrale de l'écran, quel que soit le résultat.
        try {
            window.devicePixelRatio = savedDpr;
            if (!wasLight) html.classList.remove('theme-light');
            input.value = savedVal;
            state.chartRenderWidthOverride = savedW;   // AVANT le re-rendu : largeur écran
            Object.assign(state, saved);
            state.lastRenderState = null;           // force le re-rendu d'origine
            mod.genererGraphique();
        } catch {   }
    }
}
