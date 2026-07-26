const LS_FLEET = 'ac-fleet';
const LS_ACTIVE = 'ac-active-id';

const DEFAULT_C172 = {
    name: 'Cessna 172 SP',
    registration: '',
    type: 'C172',
    groundRoll: 830,
    fiftyFt: 1400,
    safetyMargin: 20,
};

function _uid() {
    return 'ac_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

export function getFleet() {
    let fleet = _readLs(LS_FLEET, []);

    if (fleet.length === 0) {
        const oldRef = _readLs('ac-takeoff-ref', null);
        if (oldRef && typeof oldRef.groundRoll === 'number') {
            const migrated = {
                id: _uid(),
                ...DEFAULT_C172,
                name: 'Mon avion',
                groundRoll: oldRef.groundRoll,
                fiftyFt: oldRef.fiftyFt,
                safetyMargin: 20,
            };
            fleet = [migrated];
            _writeLs(LS_FLEET, fleet);
            _writeLs(LS_ACTIVE, migrated.id);
        }
    }

    if (fleet.length === 0) {
        const def = { id: _uid(), ...DEFAULT_C172 };
        fleet = [def];
        _writeLs(LS_FLEET, fleet);
        _writeLs(LS_ACTIVE, def.id);
    }

    return fleet;
}

export function getActiveAircraft() {
    const fleet = getFleet();
    const activeId = _readLs(LS_ACTIVE, null);
    let active = activeId ? fleet.find(a => a.id === activeId) : null;
    if (!active) {
        active = fleet[0];
        _writeLs(LS_ACTIVE, active.id);
    }
    return active;
}

export function getActiveAircraftId() {
    return _readLs(LS_ACTIVE, null) || getFleet()[0]?.id || null;
}

export function setActiveAircraft(id) {
    const fleet = getFleet();
    if (fleet.some(a => a.id === id)) {
        _writeLs(LS_ACTIVE, id);
    }
}

export function addAircraft(data) {
    const fleet = getFleet();
    const aircraft = { id: _uid(), ..._sanitize(data) };
    fleet.push(aircraft);
    _writeLs(LS_FLEET, fleet);
    return aircraft;
}

export function updateAircraft(id, data) {
    const fleet = getFleet();
    const idx = fleet.findIndex(a => a.id === id);
    if (idx === -1) return null;
    fleet[idx] = { ...fleet[idx], ..._sanitize(data), id };
    _writeLs(LS_FLEET, fleet);
    return fleet[idx];
}

export function deleteAircraft(id) {
    const fleet = getFleet();
    if (fleet.length <= 1) return false;
    const idx = fleet.findIndex(a => a.id === id);
    if (idx === -1) return false;
    fleet.splice(idx, 1);
    _writeLs(LS_FLEET, fleet);

    if (getActiveAircraftId() === id) {
        _writeLs(LS_ACTIVE, fleet[0].id);
    }
    return true;
}

function _sanitize(data) {
    const gr = parseInt(data.groundRoll, 10);
    const ft = parseInt(data.fiftyFt, 10);
    const sm = parseInt(data.safetyMargin, 10);
    return {
        name: String(data.name || 'Avion').slice(0, 40),
        registration: String(data.registration || '').slice(0, 12).toUpperCase(),
        type: String(data.type || '').slice(0, 20),
        groundRoll: isNaN(gr) || gr <= 0 ? DEFAULT_C172.groundRoll : gr,
        fiftyFt: isNaN(ft) || ft <= 0 ? DEFAULT_C172.fiftyFt : ft,
        safetyMargin: isNaN(sm) ? 20 : Math.max(0, Math.min(50, sm)),
    };
}

function _readLs(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        if (raw == null) return fallback;
        return JSON.parse(raw);
    } catch {
        return fallback;
    }
}

function _writeLs(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {

    }
}
