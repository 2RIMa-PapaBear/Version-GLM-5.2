/* ================================================================
 * WB UI — Widget dashboard « Centrage »
 * ================================================================
 *
 * Panneau repliable sous « Performance décollage », relié à l'avion
 * actif de la flotte. Affiche le centrogramme (enveloppe + points
 * décollage / arrivée / ZFW), permet de saisir le chargement du jour
 * (postes de l'avion, carburant embarqué — pré-rempli du plan de nav,
 * modifiable) et donne le verdict dedans/dehors enveloppe + marge MTOW.
 * L'essence consommée n'apparaît qu'en mode NAVIGATION : lecture seule,
 * issue du plan de vol (trajet à destination). En vol local elle n'a
 * pas lieu d'être (point Arrivée confondu avec le Décollage).
 *
 * La configuration (enveloppe, postes, masse à vide, unités) se gère
 * dans la fenêtre Flotte : ce widget ne fait que consommer/afficher.
 * ================================================================ */

import { state, escapeHtml } from './core.js';
import { makeCollapsible } from './collapsible.js';
import { getFlightMode } from './flight-mode.js';
import { getActiveAircraft, usableFuelOf } from './aircraft-fleet.js';
import { computeLocalFuelDevis } from './flight-planner.js';
import {
    computeWb, resolveLoads, writeWbLoads, mountWbChart,
    armFromMm, massFromKg, massToKg, armDecimals,
} from './wb-core.js';

let _chartDispose = null;
// Pop-up « carburant insuffisant » déjà affiché pour l'épisode courant
// (reset dès que l'embarqué atteint le requis, re-alerte ensuite si rechute).
let _fuelWarnActive = false;

/** Carburant requis. En navigation : plan actif {totalL, tripFuelL, reserveL}.
 *  En vol local (A4) : devis partagé computeLocalFuelDevis (flight-planner.js)
 *  — durée + roulage + réserve finale légale 20 min / 15 ULM (+perso) +
 *  INUTILISABLE du manuel de vol — null sans durée. */
function _requiredFuel() {
    if (getFlightMode() === 'nav') {
        const f = state._lastNavPlan?.plan?.fuel;
        return (f && f.totalL > 0) ? f : null;
    }
    const min = parseInt(document.getElementById('wb-local-min')?.value, 10);
    if (!Number.isFinite(min) || min <= 0) return null;
    // Fiche 26 : le devis local n'est PLUS recodé ici — la même fonction
    // alimente la tuile Carburant du dossier et le log PDF local, pour que
    // l'inutilisable ne puisse plus manquer quelque part.
    return computeLocalFuelDevis(min, getActiveAircraft());
}

/** Masse affichée (unité de l'avion) → chaîne arrondie. */
const _m = (kg, u) => Math.round(massFromKg(kg, u));
/** Bras mm → chaîne dans l'unité de l'avion (décimales selon l'unité). */
const _a = (mm, u) => String(+(armFromMm(mm, u).toFixed(armDecimals(u))));

/** Parse une saisie (accepte la virgule décimale). */
const _num = (v) => parseFloat(String(v ?? '').replace(',', '.'));

/**
 * Affiche/masque le widget centrage pour l'avion actif.
 * @param {string|null} icao Code OACI courant (null = masquer, comme
 *   les autres widgets du dashboard : le centrage se consulte en
 *   préparation de vol, une fois un terrain sélectionné).
 */
export function refreshWbWidget(icao = state.requestedIcao) {
    const container = document.getElementById('wb-widget');
    if (!container) return;

    if (!icao) {
        container.style.display = 'none';
        return;
    }
    const ac = getActiveAircraft();
    if (!ac?.wb) {
        container.style.display = 'none';
        return;
    }

    const isFr = state.lang === 'fr';
    const body = makeCollapsible(container, isFr ? 'Centrage' : 'Weight & balance', 'scale');

    // Bouton « Flotte » dans le header repliable (même pattern que le
    // widget Performance décollage) : accès direct à la configuration.
    const header = container.querySelector('.collapsible-header');
    if (header && !header.querySelector('#wb-fleet-btn')) {
        const lblManage = isFr ? 'Gérer la flotte' : 'Manage fleet';
        const fleetBtn = document.createElement('button');
        fleetBtn.id = 'wb-fleet-btn';
        fleetBtn.className = 'fleet-open-btn';
        fleetBtn.title = lblManage;
        fleetBtn.style.cssText = 'background:none; border:1px solid var(--border-color); color:var(--text-muted); border-radius:6px; padding:3px 8px; font-size:11px; cursor:pointer; display:flex; align-items:center; gap:4px; margin-left:auto; margin-right:8px;';
        fleetBtn.innerHTML = `<i data-lucide="plane" style="width:13px;height:13px;"></i> ${isFr ? 'Flotte' : 'Fleet'}`;
        fleetBtn.addEventListener('click', (e) => e.stopPropagation());
        // Fenêtre Flotte chargée à la demande (audit 26/09 : 48 Ko de JS
        // hors boot ; même motif que flight-file.js).
        fleetBtn.addEventListener('click', () => {
            import('./fleet-ui.js').then(({ openFleetManager }) => openFleetManager(() => { refreshWbWidget(icao); }));
        });
        header.appendChild(fleetBtn);
        if (window.lucide) window.lucide.createIcons({ root: header });
    }

    _render(body, ac, isFr);
    container.style.display = 'block';
}

/** Construit le widget une fois, puis recalcule à chaque saisie. */
function _render(body, ac, isFr) {
    const wb = ac.wb;
    const u = wb.units;
    const plan = state._lastNavPlan?.plan;
    const loads = resolveLoads(ac.id, plan);
    // L'essence consommée n'existe qu'en navigation (lecture seule, plan
    // de vol) : en vol local le point Arrivée est confondu avec le Décollage.
    const isNav = getFlightMode() === 'nav';

    // Postes sans bras (saisie incomplète côté flotte) : ignorés ici.
    const usable = (s) => s.armMm != null && isFinite(s.armMm);
    const stations = wb.stations.filter(s => !s.fuel && usable(s));
    const fuelSt = wb.stations.find(s => s.fuel && usable(s));

    // Grille « chargement du jour » : 4 cellules MAX par ligne ; le carburant
    // complète la ligne des postes dès qu'une colonne est libre (retour
    // pilote 19/09), sinon il ouvre la ligne suivante avec la durée (vol
    // local) et les postes restants.
    const stCell = (s) => `
        <label class="wb-load">
            <span class="wb-load-lab"><span class="lab">${escapeHtml(s.name)}</span>${s.maxKg ? ` <span class="val">Max ${_m(s.maxKg, u.mass)}</span>` : ''}</span>
            <input type="number" step="any" min="0" name="wb-load" aria-label="Masse embarquée au poste" class="wb-load-in" data-key="st:${escapeHtml(s.name)}" data-max="${s.maxKg || ''}" value="${loads.masses[s.name] ?? ''}" placeholder="0">
            <input type="range" name="wb-load-range" aria-label="Réglage de la masse" class="wb-load-range" data-key="st:${escapeHtml(s.name)}" min="0" max="${s.maxKg ? Math.max(1, Math.round(massFromKg(s.maxKg, u.mass))) : 150}" step="1" value="${Math.round(massFromKg(loads.masses[s.name] || 0, u.mass))}">
        </label>`;
    // Plafond d'emport : carburant UTILISABLE du manuel de vol = capacité
    // du poste carburant du centrage − inutilisable (ex. WT9 : 119 − 6 =
    // 113 L). Sans bloc centrage, pas de plafond.
    const unusableL = (ac.unusableFuelL > 0) ? ac.unusableFuelL : 0;
    const usableL = usableFuelOf(ac);
    const fuelMaxL = usableL;
    const fuelCell = fuelSt ? `
        <label class="wb-load wb-load-fuel" title="${isFr
            ? (isNav
                ? 'Quantité totale embarquée au décollage — pré-remplie du plan de nav (trajet + réserve), modifiable.'
                : 'Quantité totale embarquée au décollage — saisie libre, mémorisée pour cet avion.')
            : (isNav
                ? 'Total fuel at takeoff — pre-filled from the nav plan (trip + reserve), editable.'
                : 'Total fuel at takeoff — free entry, saved for this aircraft.')}${unusableL > 0 && fuelSt?.maxKg && unusableL < fuelSt.maxKg ? (isFr
                ? ` Inutilisable du manuel de vol : ${unusableL} L — plafond = capacité ${fuelSt.maxKg} − ${unusableL} = ${usableL} L utilisables.`
                : ` Unusable fuel from the POH: ${unusableL} L — cap = capacity ${fuelSt.maxKg} − ${unusableL} = ${usableL} L usable.`) : ''}${fuelMaxL ? (isFr
                ? ' Blocage (pilote 03/10) : toute saisie au-delà de ce plafond est ramenée au max.'
                : ' Hard cap (pilot 03/10): any entry beyond this limit snaps back to the max.') : ''}">
            <span class="wb-load-lab"><span class="lab">${isFr ? 'Carburant embarqué (L)' : 'Fuel on board (L)'}</span>${fuelMaxL ? ` <span class="val">Max ${fuelMaxL}</span>` : ''}</span>
            <input type="number" step="any" min="0"${fuelMaxL ? ` max="${fuelMaxL}"` : ''} id="wb-fuel-l" data-key="fuel" data-max="${fuelMaxL || ''}" value="${loads.fuelL || ''}" placeholder="0">
            <input type="range" name="wb-load-range" aria-label="Réglage de la masse" class="wb-load-range" data-key="fuel" min="0" max="${fuelMaxL ? Math.max(1, Math.round(fuelMaxL)) : 200}" step="1" value="${Math.round(loads.fuelL || 0)}">
        </label>` : '';
    // Essence consommée (navigation) : la CELLULE visible « Consommée
    // (L) » est retirée (retour pilote 03/10 — le devis du plan repris
    // ci-dessous affiche le trajet, l'info était dupliquée) ; le champ
    // caché subsiste : _recalc le relit pour le point Arrivée et le
    // graphe (embarqué − consommée).
    const burnHidden = (fuelSt && isNav)
        ? `<input type="hidden" id="wb-burn-l" data-key="burn" value="${loads.burnL || ''}">`
        : '';
    // Vol local : devis carburant par DURÉE ESTIMÉE (A4) — durée + ROZ 30 min
    // (majorée de la réserve perso de l'avion) ; le requis s'affiche et le
    // champ « Carburant embarqué » passe en rouge s'il est insuffisant.
    // La durée et son devis partagent un même cadre (retour pilote 19/09) :
    // l'input est la tête du cadre, le devis se dessine dessous dans
    // #wb-local-devis (rempli par _recalc, inchangé).
    let savedMin = '';
    try { savedMin = String(parseInt(localStorage.getItem('wb-local-min'), 10) || ''); } catch {   }
    const durationGroup = (fuelSt && !isNav) ? `
        <div class="wb-duration-group" title="${isFr ? 'Carburant requis = durée de vol prévue + roulage 10 min (départ et arrivée) + réserve finale légale 20 min, 15 min en ULM (vol local de jour en vue du terrain) + réserve perso et carburant inutilisable de l\u2019avion (fenêtre Flotte).' : 'Required fuel = planned duration + 10 min taxi (out and in) + final legal reserve 20 min, 15 min for microlights (day local flight in sight of the field) + the aircraft\u2019s personal reserve and unusable fuel (Fleet window).'}">
            <div class="wb-duration-head">
                <span class="lab">${isFr ? 'Durée de vol prévue (min)' : 'Planned flight duration (min)'}</span>
                <div class="wb-duration-ctl">
                    <button type="button" class="wb-step-btn" data-step="-5" aria-label="${isFr ? 'Moins 5 minutes' : 'Minus 5 minutes'}" title="${isFr ? 'Moins 5 minutes' : 'Minus 5 minutes'}"><i data-lucide="minus"></i></button>
                    <div class="wb-duration-field">
                        <input type="number" step="5" min="0" max="600" id="wb-local-min" value="${savedMin}" placeholder="0">
                        <span class="wb-unit">Min</span>
                    </div>
                    <button type="button" class="wb-step-btn" data-step="5" aria-label="${isFr ? 'Plus 5 minutes' : 'Plus 5 minutes'}" title="${isFr ? 'Plus 5 minutes' : 'Plus 5 minutes'}"><i data-lucide="plus"></i></button>
                </div>
            </div>
            <div class="wb-fuel-grid" id="wb-local-devis"></div>
        </div>` : '';
    // Devis carburant du PLAN en navigation (retour pilote 03/10 : « cette
    // ligne doit être reprise dans centrage, mise en forme identique au
    // mode local ») — même cadre une-ligne que le devis local, sans la
    // tête « durée » (elle vient du plan de vol). Rempli par _recalc.
    const devisNav = (fuelSt && isNav) ? `
        <div class="wb-duration-group" title="${isFr ? 'Carburant requis du plan de vol : trajet + dégagement éventuel + roulage et intégration + réserve finale + inutilisable du manuel de vol (fenêtre Flotte).' : 'Required fuel from the flight plan: trip + alternate if any + taxi and integration + final reserve + unusable fuel from the POH (Fleet window).'}">
            <div class="wb-fuel-grid" id="wb-local-devis"></div>
        </div>` : '';
    const line1 = stations.slice(0, 4);
    const rest = stations.slice(4);
    // Carburant en bout de la ligne des postes s'il reste une colonne ;
    // ligne pleine (4 postes) → il ouvre la ligne suivante comme avant.
    const fuelUp = !!fuelCell && line1.length >= 1 && line1.length <= 3;

    body.innerHTML = `
        <div class="wb-ac-line">
            <span class="wb-ac-reg">${escapeHtml(ac.registration || ac.name)}${ac.type ? ' · ' + escapeHtml(ac.type) : ''}</span>
            <span class="wb-units">${u.mass} / ${u.arm}</span>
        </div>
        <div class="fleet-wb-sub">${isFr ? `CHARGEMENT DU JOUR (${u.mass.toUpperCase()})` : `TODAY'S LOADING (${u.mass.toUpperCase()})`}</div>
        ${line1.length ? `<div class="wb-load-grid">${line1.map(stCell).join('')}${fuelUp ? fuelCell : ''}</div>` : ''}
        ${(rest.length || (!fuelUp && fuelCell)) ? `<div class="wb-load-grid">${rest.map(stCell).join('')}${fuelUp ? '' : fuelCell}</div>` : ''}
        ${burnHidden}
        ${durationGroup}${devisNav}
        <div class="wb-chart-host"></div>
        <div class="wb-results">
            <div class="wb-res"><span class="wb-dot wb-dot-to"></span><span class="wb-res-val" id="wb-res-to"></span></div>
            ${isNav ? `<div class="wb-res"><span class="wb-dot wb-dot-ar"></span><span class="wb-res-val" id="wb-res-ar"></span></div>` : ''}
            <div class="wb-res"><span class="wb-dot wb-dot-zf"></span><span class="wb-res-val" id="wb-res-zf"></span></div>
        </div>
        <div class="wb-verdict" id="wb-verdict"></div>
        <div class="wb-note">
            <i data-lucide="info" style="width:11px;height:11px;vertical-align:middle;"></i>
            ${isFr
                ? (isNav
                    ? 'Carburant embarqué pré-rempli du plan de nav (modifiable) ; essence consommée = trajet du plan de vol (non modifiable). Point Arrivée = carburant embarqué − essence consommée. Enveloppe, postes et masse à vide : fenêtre Flotte.'
                    : 'Durée prévue → devis carburant = durée estimée + roulage 10 min + réserve finale légale 20 min (15 min en ULM) + réserve perso + inutilisable du manuel de vol (fenêtre Flotte) ; le champ embarqué passe en rouge s\u2019il est insuffisant. Enveloppe, postes et masse à vide : fenêtre Flotte.')
                : (isNav
                    ? 'Fuel on board pre-filled from the nav plan (editable); fuel burned = flight plan trip (read-only). Landing point = fuel on board − fuel burned. Envelope, stations and empty weight: Fleet window.'
                    : 'Planned duration → required fuel (duration + taxi + reserve + unusable fuel from the POH); the fuel field turns red when short. Envelope, stations and empty weight: Fleet window.')}
        </div>
    `;
    if (window.lucide) window.lucide.createIcons({ root: body });

    body.querySelectorAll('.wb-load-in, #wb-fuel-l').forEach(input => {
        input.addEventListener('input', () => _recalc(body, ac, isFr));
    });
    // Durée estimée du vol local (A4) : mémorisée, et le requis suit.
    const durEl = body.querySelector('#wb-local-min');
    durEl?.addEventListener('input', () => {
        try { localStorage.setItem('wb-local-min', String(durEl.value || '')); } catch {   }
        _recalc(body, ac, isFr);
    });
    // Boutons ±5 min : à viser au doigt en vol plutôt qu'un clavier. Pas de
    // 5 arrondi et clampé 0-600 ; la valeur posée en programme n'émet PAS
    // d'événement input — on le relaie (même motif que les sliders), sinon
    // localStorage, devis et tuile Carburant du dossier ne suivraient pas.
    body.querySelectorAll('.wb-step-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!durEl) return;
            const step = parseInt(btn.dataset.step, 10) || 5;
            const v = Math.min(600, Math.max(0, Math.round(((parseInt(durEl.value, 10) || 0) + step) / 5) * 5));
            durEl.value = String(v);
            durEl.dispatchEvent(new Event('input', { bubbles: true }));
        });
    });
    // « Min » colle au chiffre : le champ reste un number natif (tests QA,
    // tuile Carburant du dossier), donc l'unité est un span positionné d'après
    // la largeur RÉELLE du texte, mesurée par un miroir invisible de même
    // police. Re-placé à chaque input (les boutons relaient l'événement) et
    // quand la police DM Mono finit de charger.
    const unitEl = body.querySelector('.wb-duration-field .wb-unit');
    if (unitEl && durEl) {
        const mirror = document.createElement('span');
        mirror.className = 'wb-unit-mirror';
        unitEl.parentNode.appendChild(mirror);
        const placeUnit = () => {
            mirror.textContent = durEl.value || durEl.placeholder || '';
            unitEl.style.left = `calc(50% + ${mirror.offsetWidth / 2 + 7}px)`;
        };
        durEl.addEventListener('input', placeUnit);
        placeUnit();
        if (document.fonts?.ready) document.fonts.ready.then(placeUnit).catch(() => { });
        // Widget replié au rendu → champ mesuré 0 px et « Min » figé au centre,
        // superposé au chiffre à l'expansion (retour pilote 20/09). Le
        // ResizeObserver repositionne dès que la taille du champ change
        // (dépliage, bascule responsive) — 0 → 622 px compris.
        if (window.ResizeObserver) new ResizeObserver(placeUnit).observe(durEl);
    }
    // Sliders : pilotent le champ numérique associé (même data-key). La
    // valeur posée par programme n'émet PAS d'événement input — on le
    // relaie, sinon la tuile Carburant du dossier ne suit pas le curseur
    // (retour pilote 18/09).
    body.querySelectorAll('input[type="range"].wb-load-range').forEach(rng => {
        rng.addEventListener('input', () => {
            const num = body.querySelector(`input[type="number"][data-key="${CSS.escape(rng.dataset.key)}"]`);
            if (num) {
                num.value = rng.value;
                num.dispatchEvent(new Event('input', { bubbles: true }));
            }
            _recalc(body, ac, isFr);
        });
    });

    _recalc(body, ac, isFr);

    // Pop-up de sécurité (une seule fois par épisode) : carburant embarqué
    // insuffisant vs total requis du plan de vol. Le champ reste rouge
    // (géré dans _recalc) jusqu'à ce que la quantité soit suffisante.
    const req = _requiredFuel();
    if (req) {
        const fl2 = _num(body.querySelector('#wb-fuel-l')?.value);
        const under = !(isFinite(fl2) && fl2 + 0.05 >= req.totalL);
        if (under && !_fuelWarnActive) {
            _fuelWarnActive = true;
            const plan = state._lastNavPlan?.plan;
            const route = (plan?.from?.icao && plan?.to?.icao) ? ` (${plan.from.icao} → ${plan.to.icao})` : '';
            // Détail du requis : vol estimé (local) / trajet + dégagement
            // éventuel (navigation), puis réserve.
            const partsFr = [req.local ? `vol estimé ${req.tripFuelL} L (${req.tripMin} min)` : `trajet ${req.tripFuelL} L`];
            const partsEn = [req.local ? `estimated flight ${req.tripFuelL} L (${req.tripMin} min)` : `trip ${req.tripFuelL} L`];
            if (req.diversionL) {
                partsFr.push(`dégagement ${req.diversionL} L`);
                partsEn.push(`alternate ${req.diversionL} L`);
            }
            partsFr.push(`réserve ${req.reserveL} L${req.local
                ? (req.reserveExtraMin > 0 ? ` (${req.reserveBaseMin} + ${req.reserveExtraMin} perso)` : ` (${req.reserveBaseMin} min)`)
                : (req.reserveMin ? ` (${req.reserveMin} min)` : '')}`);
            partsEn.push(`reserve ${req.reserveL} L${req.local
                ? (req.reserveExtraMin > 0 ? ` (${req.reserveBaseMin} + ${req.reserveExtraMin} personal)` : ` (${req.reserveBaseMin} min)`)
                : (req.reserveMin ? ` (${req.reserveMin} min)` : '')}`);
            if (req.unusableL > 0) {
                partsFr.push(`inutilisable ${req.unusableL} L`);
                partsEn.push(`unusable ${req.unusableL} L`);
            }
            window.alert(isFr
                ? `⚠ CARBURANT INSUFFISANT${route}\n\nEmbarqué : ${isFinite(fl2) ? fl2 : 0} L\nRequis : ${req.totalL} L (${partsFr.join(' + ')})\n\nLe champ « Carburant embarqué » restera rouge jusqu'à ce que la quantité embarquée atteigne le total requis.`
                : `⚠ INSUFFICIENT FUEL${route}\n\nOn board: ${isFinite(fl2) ? fl2 : 0} L\nRequired: ${req.totalL} L (${partsEn.join(' + ')})\n\nThe "Fuel on board" field stays red until the quantity on board reaches the required total.`);
        }
    }
}

/** Flash ambre d'une saisie carburant rabattue au plafond capacité. */
function _flashClamped(input) {
    input.classList.remove('wb-fuel-clamped');
    void input.offsetWidth;   // relance l'animation si déjà jouée
    input.classList.add('wb-fuel-clamped');
    setTimeout(() => input.classList.remove('wb-fuel-clamped'), 900);
}

/** Relit les saisies, recalcule, rafraîchit graphe + résultats + verdict. */
function _recalc(body, ac, isFr) {
    const wb = ac.wb;
    const u = wb.units;
    // Vol local : pas de point/ligne Arrivée (confondu avec le Décollage).
    const isNav = getFlightMode() === 'nav';

    // Saisies → chargement interne (kg / litres). data-key : "st:Nom" pour
    // les postes, "fuel"/"burn" pour le carburant.
    const loads = { masses: {}, fuelL: 0, burnL: 0 };
    body.querySelectorAll('.wb-load-in').forEach(inp => {
        const name = (inp.dataset.key || '').startsWith('st:') ? inp.dataset.key.slice(3) : null;
        if (!name) return;
        const v = _num(inp.value);
        if (isFinite(v) && v > 0) loads.masses[name] = massToKg(v, u.mass);
        // Pastille ambre si le max du poste est dépassé.
        const max = _num(inp.dataset.max);
        const over = max > 0 && isFinite(v) && v > massFromKg(max, u.mass) + 1e-9;
        inp.classList.toggle('wb-over', over);
    });
    const fuelIn = body.querySelector('#wb-fuel-l');
    const bl = _num(body.querySelector('#wb-burn-l')?.value);
    // Blocage à la capacité de la fiche avion (retour pilote 03/10) :
    // impossible d'embarquer plus que le plafond utilisable des réservoirs.
    // Toute valeur au-delà — frappe, curseur, prédéfini du plan de vol,
    // état sauvegardé d'une fiche précédente — est rabattue au max et le
    // champ clignote ambre une fois pour montrer le rabattement.
    let fl = _num(fuelIn?.value);
    if (fuelIn) {
        const maxL = _num(fuelIn.dataset.max);
        if (maxL > 0 && isFinite(fl) && fl > maxL + 1e-9) {
            fl = maxL;
            fuelIn.value = String(maxL);
            _flashClamped(fuelIn);
        }
    }
    loads.fuelL = (isFinite(fl) && fl > 0) ? fl : 0;
    loads.burnL = (isFinite(bl) && bl > 0) ? bl : 0;
    // Carburant : pastille ambre si la capacité (max du poste, en litres) est dépassée.
    if (fuelIn) {
        const maxL = _num(fuelIn.dataset.max);
        fuelIn.classList.toggle('wb-over', maxL > 0 && isFinite(fl) && fl > maxL + 1e-9);
        // Sécurité (navigation) : rouge tant que l'embarqué est inférieur au
        // total requis du plan de vol (trajet + réserve).
        const req = _requiredFuel();
        const under = !!req && loads.fuelL + 0.05 < req.totalL;
        fuelIn.classList.toggle('wb-under', under);
        if (!under) _fuelWarnActive = false;
        // Vol local (18/09) : DEVIS détaillé sous la durée — durée + roulage
        // 10 min + réserve finale légale 20 min / 15 ULM (+perso) +
        // inutilisable du manuel de vol (19/09), comme les olives du devis
        // de navigation.
        const devisEl = body.querySelector('#wb-local-devis');
        if (devisEl) {
            const cell = (lab, val, strong) =>
                `<div class="wb-fuel-cell${strong ? ' wb-fuel-total' : ''}"><span>${lab}</span><b>${val}</b></div>`;
            // « Inutilisable » raccourci en « Inut. » (retour pilote 03/10 :
            // gagner de la place) — le mot complet reste en infobulle.
            const inutTitle = isFr
                ? 'Carburant inutilisable du manuel de vol — jamais consommable, mais embarqué dans le réservoir.'
                : 'Unusable fuel from the POH — never burnable, but on board in the tank.';
            const inutLab = isFr ? 'Inut.' : 'Unusable';
            if (req && req.local) {
                devisEl.classList.toggle('wb-fuel-grid-5', req.unusableL > 0);
                devisEl.classList.remove('wb-fuel-grid-6');
                devisEl.innerHTML =
                    cell(`${isFr ? 'Durée' : 'Duration'} ${req.tripMin} min`, `${req.tripFuelL}L`)
                    + cell(`${isFr ? 'Roulage' : 'Taxi'} ${req.groundMin} min`, `${req.groundL}L`)
                    + cell(`${isFr ? 'Réserve' : 'Reserve'} ${req.reserveMin} min`, `${req.reserveL}L`)
                    + (req.unusableL > 0 ? cell(inutLab, `${req.unusableL}L`) : '')
                    + cell(isFr ? 'Total min. requis' : 'Total min. req.', `${req.totalL}L`, true);
            } else if (req) {
                // Navigation (retour pilote 03/10) : le devis du plan de vol,
                // même mise en forme une-ligne que le devis local — libellés
                // repris tels quels de la ligne « Carburant » du planificateur.
                // Six cellules (dégagement présent) : libellés RACCOURCIS pour
                // tenir sur la ligne (le détail complet reste en infobulle).
                const n = (req.diversion?.fuelL ? 1 : 0) + (req.unusableL > 0 ? 1 : 0) + 4;
                const court = n >= 6;
                const cellT = (lab, val, title, strong) =>
                    `<div class="wb-fuel-cell${strong ? ' wb-fuel-total' : ''}"${title ? ` title="${title}"` : ''}><span>${lab}</span><b>${val}</b></div>`;
                let html = cell(isFr ? 'Trajet' : 'Trip', `${req.tripFuelL}L`);
                if (req.diversion?.fuelL) {
                    const dt = isFr
                        ? `Terrain de dégagement ${req.diversion.icao} — rejoint depuis l'arrivée (${req.diversion.distNm ?? '?'} NM)`
                        : `Alternate ${req.diversion.icao} — reached from destination (${req.diversion.distNm ?? '?'} NM)`;
                    html += court
                        ? cellT(`${isFr ? 'Dégag.' : 'Alt.'} ${escapeHtml(req.diversion.icao || '')}`, `${req.diversion.fuelL}L`, dt)
                        : cellT(`${isFr ? 'Dégagement' : 'Alternate'} ${escapeHtml(req.diversion.icao || '')}`, `${req.diversion.fuelL}L`, dt);
                }
                const rt = isFr
                    ? 'Roulage départ + intégration + roulage arrivée (forfaits mini)'
                    : 'Taxi-out + integration + taxi-in (minimum allowances)';
                html += (court
                    ? cellT(`${isFr ? 'Roulage' : 'Taxi'} ${req.groundMin ?? 0}'`, `${req.groundL ?? 0}L`, rt)
                    : cellT(`${isFr ? 'Roulage + intégr.' : 'Taxi + integ.'} (${req.groundMin ?? 0}min)`, `${req.groundL ?? 0}L`, rt))
                    + (court
                        ? cellT(`${isFr ? 'Réserve' : 'Reserve'} ${req.reserveMin ?? 0}'`, `${req.reserveL}L`)
                        : cellT(`${isFr ? 'Réserve' : 'Reserve'} (${req.reserveMin ?? 0}min)`, `${req.reserveL}L`));
                if (req.unusableL > 0) html += cellT(inutLab, `${req.unusableL}L`, inutTitle);
                html += cell(isFr ? 'Total requis' : 'Total req.', `${req.totalL}L`, true);
                devisEl.classList.toggle('wb-fuel-grid-5', n === 5);
                devisEl.classList.toggle('wb-fuel-grid-6', n === 6);
                devisEl.innerHTML = html;
            } else {
                devisEl.classList.remove('wb-fuel-grid-5', 'wb-fuel-grid-6');
                devisEl.innerHTML = '';
            }
        }
    }
    writeWbLoads(ac.id, loads);

    const calc = computeWb(wb, loads);

    // Graphe (remonté à chaque saisie : léger) — en vol local le point
    // Arrivée n'est pas tracé (superposé au Décollage).
    if (_chartDispose) { _chartDispose(); _chartDispose = null; }
    const host = body.querySelector('.wb-chart-host');
    if (host) _chartDispose = mountWbChart(host, wb, calc, isFr, isNav ? {} : { hideArrival: true });

    // Résultats : Décollage (vert) / Arrivée (orange) / ZFW (rouge) — masse
    // et CG seuls (le bandeau verdict ci-dessous porte marges et alertes).
    const burnL = Math.round(calc.burnKg / (wb.fuelDensity || 0.72));
    const mkLine = (label, p) => {
        const cgTxt = p.cgMm == null ? '—' : `${_a(p.cgMm, u.arm)} ${u.arm}`;
        return `<b>${label}</b> ${_m(p.massKg, u.mass)} ${u.mass} · CG ${cgTxt}`;
    };
    const set = (sel, html) => { const el = body.querySelector(sel); if (el) el.innerHTML = html; };
    set('#wb-res-to', mkLine(isFr ? 'Décollage :' : 'Takeoff:', calc.takeoff));
    set('#wb-res-ar', mkLine(burnL > 0
        ? (isFr ? `Arrivée (−${burnL} L) :` : `Landing (−${burnL} L):`)
        : (isFr ? 'Arrivée :' : 'Landing:'), calc.arrival));
    set('#wb-res-zf', mkLine(isFr ? 'ZFW (zéro carburant) :' : 'ZFW (zero fuel):', calc.zfw));

    // Bandeau verdict.
    const vEl = body.querySelector('#wb-verdict');
    if (!vEl) return;
    if (calc.level === 'ok') {
        const p = calc.points.takeoff;
        const U = u.arm.toUpperCase();
        vEl.className = 'wb-verdict ok';
        vEl.innerHTML = isFr
            ? `CG DÉCOLLAGE ${_a(calc.takeoff.cgMm, u.arm)} ${U} · DANS L'ENVELOPPE · MARGE AVANT ${_a(p.fwdMm, u.arm)} ${U} / ARRIÈRE ${_a(p.aftMm, u.arm)} ${U}`
            : `TAKEOFF CG ${_a(calc.takeoff.cgMm, u.arm)} ${U} · IN ENVELOPE · FWD ${_a(p.fwdMm, u.arm)} ${U} / AFT ${_a(p.aftMm, u.arm)} ${U}`;
    } else {
        const reasons = [];
        if (!calc.mtowOk) reasons.push(isFr
            ? `masse décollage > MTOW (${_m(calc.takeoff.massKg, u.mass)} > ${_m(wb.mtowKg, u.mass)} ${u.mass})`
            : `takeoff weight > MTOW (${_m(calc.takeoff.massKg, u.mass)} > ${_m(wb.mtowKg, u.mass)} ${u.mass})`);
        for (const [k, lbl] of [['takeoff', isFr ? 'décollage' : 'takeoff'],
                                 ...(isNav ? [['arrival', isFr ? 'arrivée' : 'landing']] : []),
                                 ['zfw', 'ZFW']]) {
            if (!calc.points[k].inside) reasons.push(`${lbl} ${isFr ? 'hors enveloppe' : 'out of envelope'}`);
        }
        vEl.className = 'wb-verdict danger';
        vEl.innerHTML = `${isFr ? 'HORS LIMITES' : 'OUT OF LIMITS'} — ${reasons.join(' · ')}`;
    }

    // Resynchronise les sliders sur les valeurs saisies.
    body.querySelectorAll('input[type="range"].wb-load-range').forEach(rng => {
        const num = body.querySelector(`input[type="number"][data-key="${CSS.escape(rng.dataset.key)}"]`);
        if (!num) return;
        const v = _num(num.value);
        rng.value = (isFinite(v) && v > 0) ? Math.min(v, Number(rng.max)) : 0;
    });
}
