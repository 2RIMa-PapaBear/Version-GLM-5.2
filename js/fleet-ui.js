/* ================================================================
 * FLEET UI — Gestion de la flotte d'avions (modal)
 * ================================================================
 *
 * Panneau modal permettant au pilote de gérer sa flotte :
 *   - Lister les avions enregistrés
 *   - Ajouter / éditer / supprimer un avion
 *   - Chaque avion : nom, immatriculation, type, distances de référence
 *     (roulement + franchissement 50ft au niveau mer/ISA), marge de
 *     sécurité personnalisée.
 *
 * Les distances de référence proviennent du manuel de vol (POH) de
 * l'avion, rubrique "performances de décollage" au niveau de la mer en
 * atmosphère standard (ISA).
 * ================================================================ */

import { state } from './core.js';
import {
    getFleet, getActiveAircraftId, setActiveAircraft,
    addAircraft, updateAircraft, deleteAircraft,
} from './aircraft-fleet.js';
import { searchAircraft } from './aircraft-database.js';

let _onCloseCallback = null;

/**
 * Ouvre le modal de gestion de la flotte.
 * @param {Function} [onClose] Callback appelé à la fermeture (pour rafraîchir le widget).
 */
export function openFleetManager(onClose) {
    _onCloseCallback = onClose || null;
    _ensureModal();
    _render();
    document.getElementById('fleet-overlay').style.display = 'flex';
}

/**
 * Ferme le modal.
 */
export function closeFleetManager() {
    const overlay = document.getElementById('fleet-overlay');
    if (overlay) overlay.style.display = 'none';
    _hideSuggest();
    document.removeEventListener('click', _onDocClick);
    clearTimeout(_suggestDebounce);
    if (_onCloseCallback) {
        _onCloseCallback();
        _onCloseCallback = null;
    }
}

/**
 * Crée le squelette du modal s'il n'existe pas encore.
 */
function _ensureModal() {
    if (document.getElementById('fleet-overlay')) return;

    const isFr = state.lang === 'fr';
    const overlay = document.createElement('div');
    overlay.id = 'fleet-overlay';
    overlay.className = 'fleet-overlay';
    overlay.innerHTML = `
        <div class="fleet-modal" role="dialog" aria-modal="true" aria-labelledby="fleet-title">
            <div class="fleet-modal-header">
                <h2 id="fleet-title"><i data-lucide="plane" class="icon-sm"></i>
                    <span>${isFr ? 'Ma flotte' : 'My fleet'}</span>
                </h2>
                <button id="fleet-close" class="fleet-close" aria-label="${isFr ? 'Fermer' : 'Close'}">
                    <i data-lucide="x"></i>
                </button>
            </div>
            <div id="fleet-content" class="fleet-content"></div>
        </div>
    `;
    document.body.appendChild(overlay);

    // Fermeture au clic sur l'overlay (hors du modal).
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeFleetManager();
    });
    overlay.querySelector('#fleet-close').addEventListener('click', closeFleetManager);
    if (window.lucide) window.lucide.createIcons({ root: overlay });
}

/**
 * Rend le contenu du modal (liste + formulaire).
 */
function _render() {
    const content = document.getElementById('fleet-content');
    if (!content) return;

    const isFr = state.lang === 'fr';
    const fleet = getFleet();
    const activeId = getActiveAircraftId();

    // --- Liste des avions ---
    let html = `<div class="fleet-list-section">
        <div class="fleet-section-title">${isFr ? 'Avions enregistrés' : 'Registered aircraft'} (${fleet.length})</div>`;

    fleet.forEach(ac => {
        const isActive = ac.id === activeId;
        html += `
            <div class="fleet-item ${isActive ? 'fleet-item-active' : ''}" data-id="${ac.id}">
                <div class="fleet-item-info">
                    <div class="fleet-item-name">${_esc(ac.name)} ${ac.registration ? `<span class="fleet-item-reg">(${_esc(ac.registration)})</span>` : ''}</div>
                    <div class="fleet-item-stats">
                        <span title="${isFr ? 'Roulement au niveau mer/ISA' : 'Ground roll at SL/ISA'}">${ac.groundRoll} ft</span>
                        <span>·</span>
                        <span title="${isFr ? 'Franchissement 50ft' : '50ft obstacle'}">${ac.fiftyFt} ft</span>
                        <span>·</span>
                        <span title="${isFr ? 'Marge de sécurité' : 'Safety margin'}">${ac.safetyMargin}%</span>
                    </div>
                </div>
                <div class="fleet-item-actions">
                    <button class="fleet-mini-btn fleet-activate ${isActive ? 'active' : ''}" data-action="activate" data-id="${ac.id}" title="${isFr ? 'Définir actif' : 'Set active'}">
                        <i data-lucide="${isActive ? 'check-circle-2' : 'circle'}"></i>
                    </button>
                    <button class="fleet-mini-btn" data-action="edit" data-id="${ac.id}" title="${isFr ? 'Éditer' : 'Edit'}">
                        <i data-lucide="pencil"></i>
                    </button>
                    <button class="fleet-mini-btn fleet-delete" data-action="delete" data-id="${ac.id}" title="${isFr ? 'Supprimer' : 'Delete'}" ${fleet.length <= 1 ? 'disabled' : ''}>
                        <i data-lucide="trash-2"></i>
                    </button>
                </div>
            </div>
        `;
    });
    html += `</div>`;

    // --- Formulaire d'ajout/édition ---
    html += `<div class="fleet-form-section">
        <div class="fleet-section-title" id="fleet-form-title">${isFr ? 'Ajouter un avion' : 'Add an aircraft'}</div>
        <div class="fleet-form" id="fleet-form">
            <input type="hidden" id="fleet-edit-id" value="">
            <div class="fleet-form-row">
                <label>${isFr ? 'Nom / modèle' : 'Name / model'}<div class="fleet-name-field">
                    <input type="text" id="fleet-name" placeholder="${isFr ? 'ex: Cessna 172 SP' : 'e.g. Cessna 172 SP'}" maxlength="40" autocomplete="off">
                    <div class="fleet-suggest" id="fleet-suggest" role="listbox" hidden></div>
                </div></label>
                <label>${isFr ? 'Immatriculation' : 'Registration'}<input type="text" id="fleet-reg" placeholder="F-GABC" maxlength="12" style="text-transform:uppercase;"></label>
            </div>
            <div class="fleet-form-row">
                <label>${isFr ? 'Type' : 'Type'}<input type="text" id="fleet-type" placeholder="${isFr ? 'ex: C172, DR400, ULM' : 'e.g. C172, DR400'}" maxlength="20"></label>
                <label>${isFr ? 'Marge sécurité (%)' : 'Safety margin (%)'}<input type="number" id="fleet-margin" value="20" min="0" max="50" step="5"></label>
            </div>
            <div class="fleet-form-row">
                <label>${isFr ? 'Roulement SL/ISA (ft)' : 'Ground roll SL/ISA (ft)'}<input type="number" id="fleet-roll" placeholder="830" min="0" step="10"></label>
                <label>${isFr ? 'Franch. 50ft SL/ISA (ft)' : '50ft obstacle SL/ISA (ft)'}<input type="number" id="fleet-50ft" placeholder="1400" min="0" step="10"></label>
            </div>
            <div class="fleet-form-hint">
                <i data-lucide="info"></i>
                <span>${isFr
                    ? 'Distances issues du manuel de vol (POH) au niveau de la mer en atmosphère standard. Reportez-vous à la section « Performances de décollage ».'
                    : 'Distances from the POH at sea level / standard atmosphere. See "Takeoff performance" section.'}</span>
            </div>
            <div class="fleet-form-actions">
                <button id="fleet-save" class="btn-primary"><i data-lucide="save"></i> ${isFr ? 'Enregistrer' : 'Save'}</button>
                <button id="fleet-cancel-form" class="btn-secondary" style="display:none;">${isFr ? 'Annuler' : 'Cancel'}</button>
            </div>
        </div>
    </div>`;

    content.innerHTML = html;
    if (window.lucide) window.lucide.createIcons({ root: content });

    // --- Branchement des actions ---
    content.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.action;
            const id = btn.dataset.id;
            if (action === 'activate') { setActiveAircraft(id); _render(); }
            else if (action === 'edit') { _fillForm(id); }
            else if (action === 'delete') { _doDelete(id); }
        });
    });

    content.querySelector('#fleet-save').addEventListener('click', _doSave);
    content.querySelector('#fleet-cancel-form').addEventListener('click', _resetForm);

    _setupNameAutocomplete();
}

/* ----------------------------------------------------------------
 * Autocomplétion du champ nom : propose les avions de la base
 * (aircraft-database.js) et pré-remplit type / roulement / 50ft.
 * ---------------------------------------------------------------- */
let _suggestDebounce = null;

function _setupNameAutocomplete() {
    const input = document.getElementById('fleet-name');
    const box = document.getElementById('fleet-suggest');
    if (!input || !box) return;

    input.addEventListener('input', () => {
        clearTimeout(_suggestDebounce);
        const q = input.value.trim();
        if (q.length < 2) { _hideSuggest(); return; }
        _suggestDebounce = setTimeout(() => _renderSuggest(q), 180);
    });

    input.addEventListener('focus', () => {
        const q = input.value.trim();
        if (q.length >= 2) _renderSuggest(q);
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { _hideSuggest(); input.blur(); }
        if (e.key === 'Enter' && !box.hidden) {
            const first = box.querySelector('.fleet-suggest-item');
            if (first) { e.preventDefault(); first.click(); }
        }
    });

    // Ferme la liste si l'on clique en dehors. Enregistré une seule fois
    // (le même _render peut être appelé plusieurs fois sans fermer le modal).
    document.removeEventListener('click', _onDocClick);
    document.addEventListener('click', _onDocClick);
}

function _onDocClick(e) {
    const field = document.querySelector('.fleet-name-field');
    if (field && !field.contains(e.target)) _hideSuggest();
}

function _renderSuggest(query) {
    const box = document.getElementById('fleet-suggest');
    if (!box) return;
    const results = searchAircraft(query, 6);
    if (results.length === 0) { _hideSuggest(); return; }
    const isFr = state.lang === 'fr';
    box.innerHTML = results.map((ac, i) => `
        <div class="fleet-suggest-item" role="option" data-idx="${i}">
            <span class="fleet-suggest-name">${_esc(ac.name)}</span>
            <span class="fleet-suggest-dist">${ac.groundRoll}/${ac.fiftyFt} ft</span>
        </div>
    `).join('');
    box.hidden = false;

    box.querySelectorAll('.fleet-suggest-item').forEach(el => {
        el.addEventListener('click', () => {
            _applySuggestion(results[parseInt(el.dataset.idx, 10)]);
        });
    });
}

function _applySuggestion(ac) {
    const nameEl = document.getElementById('fleet-name');
    if (!ac) return;
    // On ne remplit que les champs vides : ne pas écraser ce que le pilote
    // a déjà saisi (ex: s'il a déjà mis son immatriculation ou ajusté la marge).
    if (nameEl && !nameEl.value.trim()) nameEl.value = ac.name;
    const typeEl = document.getElementById('fleet-type');
    if (typeEl && !typeEl.value.trim()) typeEl.value = ac.type;
    const rollEl = document.getElementById('fleet-roll');
    if (rollEl && !rollEl.value.trim()) rollEl.value = ac.groundRoll;
    const ftEl = document.getElementById('fleet-50ft');
    if (ftEl && !ftEl.value.trim()) ftEl.value = ac.fiftyFt;
    _hideSuggest();
    nameEl?.focus();
}

function _hideSuggest() {
    const box = document.getElementById('fleet-suggest');
    if (box) { box.hidden = true; box.innerHTML = ''; }
}

/**
 * Remplit le formulaire avec les données d'un avion (mode édition).
 */
function _fillForm(id) {
    const ac = getFleet().find(a => a.id === id);
    if (!ac) return;
    const isFr = state.lang === 'fr';

    document.getElementById('fleet-edit-id').value = ac.id;
    document.getElementById('fleet-name').value = ac.name || '';
    document.getElementById('fleet-reg').value = ac.registration || '';
    document.getElementById('fleet-type').value = ac.type || '';
    document.getElementById('fleet-margin').value = ac.safetyMargin ?? 20;
    document.getElementById('fleet-roll').value = ac.groundRoll || '';
    document.getElementById('fleet-50ft').value = ac.fiftyFt || '';

    document.getElementById('fleet-form-title').textContent = isFr ? 'Modifier l\'avion' : 'Edit aircraft';
    document.getElementById('fleet-cancel-form').style.display = 'inline-block';
}

/**
 * Réinitialise le formulaire (mode ajout).
 */
function _resetForm() {
    const isFr = state.lang === 'fr';
    document.getElementById('fleet-edit-id').value = '';
    document.getElementById('fleet-name').value = '';
    document.getElementById('fleet-reg').value = '';
    document.getElementById('fleet-type').value = '';
    document.getElementById('fleet-margin').value = 20;
    document.getElementById('fleet-roll').value = '';
    document.getElementById('fleet-50ft').value = '';
    document.getElementById('fleet-form-title').textContent = isFr ? 'Ajouter un avion' : 'Add an aircraft';
    document.getElementById('fleet-cancel-form').style.display = 'none';
    _hideSuggest();
}

/**
 * Enregistre (ajout ou édition) l'avion du formulaire.
 */
function _doSave() {
    const isFr = state.lang === 'fr';
    const name = document.getElementById('fleet-name').value.trim();
    const roll = document.getElementById('fleet-roll').value.trim();
    const ft50 = document.getElementById('fleet-50ft').value.trim();

    if (!name) {
        alert(isFr ? 'Veuillez saisir un nom.' : 'Please enter a name.');
        return;
    }
    if (!roll || !ft50) {
        alert(isFr ? 'Veuillez saisir les distances de référence (roulement et 50ft).' : 'Please enter reference distances (roll and 50ft).');
        return;
    }

    const data = {
        name,
        registration: document.getElementById('fleet-reg').value.trim(),
        type: document.getElementById('fleet-type').value.trim(),
        safetyMargin: document.getElementById('fleet-margin').value,
        groundRoll: roll,
        fiftyFt: ft50,
    };

    const editId = document.getElementById('fleet-edit-id').value;
    if (editId) {
        updateAircraft(editId, data);
    } else {
        const created = addAircraft(data);
        setActiveAircraft(created.id);
    }

    _resetForm();
    _render();
}

/**
 * Supprime un avion (avec confirmation).
 */
function _doDelete(id) {
    const isFr = state.lang === 'fr';
    const ac = getFleet().find(a => a.id === id);
    if (!ac) return;
    if (!confirm(isFr
        ? `Supprimer « ${ac.name} » de la flotte ?`
        : `Delete "${ac.name}" from the fleet?`)) return;
    deleteAircraft(id);
    _render();
}

function _esc(text) {
    const el = document.createElement('div');
    el.textContent = String(text || '');
    return el.innerHTML;
}
