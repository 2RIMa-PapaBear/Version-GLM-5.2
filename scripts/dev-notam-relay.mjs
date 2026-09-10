#!/usr/bin/env node
// ============================================================================
// DEV-NOTAM-RELAY — remplaçant LOCAL de `wrangler dev` pour tester le dossier
// NOTAM dans l'app (10/09). wrangler dev s'est mis à bloquer sur les fetch
// sortants sur cette machine (workerd) alors que Node passe très bien : ce
// mini-relais reproduit le CONTRAT EXACT de la route POST /notam du Worker
// (worker/index.js — pibNotam), même port 8787, zéro changement côté app
// (config.local.js pointe déjà sur http://127.0.0.1:8787/notam).
//
//   node scripts/dev-notam-relay.mjs
//
// LOCAL UNIQUEMENT — jamais déployé. Le Worker Cloudflare reste la référence
// pour la production (déployé à part, sur feu vert du pilote).
// ============================================================================
import http from 'node:http';

const SOFIA = 'https://sofia-briefing.aviation-civile.gouv.fr';
const OACI = /^[A-Z][A-Z0-9]{3}$/;

// Session SOFIA (cookie JSESSIONID) — un GET préalable, réutilisé par appel.
let _cookie = '';
async function sofiaSession() {
    const page = await fetch(`${SOFIA}/sofia/pages/notamform.html`);
    _cookie = (page.headers.get('set-cookie') || page.headers.get('Set-Cookie') || '').split(';')[0];
}

async function sofiaPibOnce(body, cookie) {
    const res = await fetch(`${SOFIA}/sofia`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Cookie': cookie,
            'Referer': `${SOFIA}/sofia/pages/notamform.html`,
            'X-Requested-With': 'XMLHttpRequest',
            'Accept': 'application/json, text/javascript, */*; q=0.01',
        },
        body: body.toString(),
    });
    const txt = await res.text();
    if (res.status !== 200 || !txt.trim().startsWith('{')) throw new Error(`SOFIA HTTP ${res.status}`);
    return JSON.parse(JSON.parse(txt)['status.message']);
}

// La session SOFIA (JSESSIONID) EXPIRE : si l'appel échoue (500/HTML), on
// reprend une session FRAÎCHE et on rejoue UNE fois (retour pilote 10/09
// « Erreur : SOFIA HTTP 500 » après un moment d'inactivité).
async function sofiaPib(body) {
    if (!_cookie) await sofiaSession();
    try {
        return await sofiaPibOnce(body, _cookie);
    } catch (e) {
        await sofiaSession();          // cookie neuf
        return await sofiaPibOnce(body, _cookie);
    }
}

function baseBody(p) {
    const b = new URLSearchParams({
        ':operation': p.area ? 'postAreaPibRequest' : 'postNarrowRoutePibRequest',
        'valid_from': p.validFrom || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        'duration': String(p.durationMin || 1200),
        'traffic': 'V',
        'fl_lower': String(p.flLower ?? 0),
        'fl_upper': String(p.flUpper ?? 999),
        'width': String(p.widthNm || 15),
        'radiusAD': String(p.radiusAdNm || 30),
        'uuid': crypto.randomUUID(),
        'isFromSofia': 'true',
    });
    if (p.area) {
        b.set('lat', String(p.area.lat || ''));
        b.set('long', String(p.area.long || ''));
        b.set('radius', String(p.area.radiusNm || 30));
    } else {
        (p.route || []).forEach(c => b.append('route[]', c));
    }
    return b;
}

const server = http.createServer(async (req, res) => {
    const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }); res.end(JSON.stringify(obj)); };
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }); return res.end(); }
    if (req.method !== 'POST' || !req.url.startsWith('/notam')) { res.writeHead(404); return res.end(); }
    try {
        const p = JSON.parse(await new Promise((ok) => { let d = ''; req.on('data', c => d += c); req.on('end', () => ok(d)); }));
        const route = (p.route || []).map(c => String(c).toUpperCase()).filter(c => OACI.test(c));
        if (!route.length) return json(400, { error: 'route vide' });

        const inner = await sofiaPib(baseBody({ ...p, route }));
        if (!inner?.listnotams) return json(502, { error: 'PIB sans listnotams' });

        const legs = Array.isArray(p.legs) ? p.legs : [];
        if (legs.length) {
            const dossiers = await Promise.all(legs.map(async ([a, b]) => {
                if (!OACI.test(a) || !OACI.test(b)) return [a, null];
                try {
                    const lb = baseBody({ ...p, route: [a, b] });
                    const leg = await sofiaPib(lb);
                    const dep = {};
                    for (const [cat, list] of Object.entries(leg.listnotams?.ADDep || {}))
                        if (Array.isArray(list) && list.length) dep[cat] = list;
                    return [a, dep];
                } catch { return [a, null]; }
            }));
            inner.waypointDossiers = Object.fromEntries(dossiers.filter(([a]) => a));
        }
        return json(200, inner);
    } catch (e) {
        return json(502, { error: String(e.message || e).slice(0, 200) });
    }
});
server.listen(8787, '127.0.0.1', () => console.log('DEV-NOTAM-RELAY prêt sur http://127.0.0.1:8787/notam (contrat du Worker, en local)'));
