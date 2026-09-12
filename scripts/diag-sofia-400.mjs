// Diagnostic direct SOFIA : rejoue le protocole du worker (session GET → POST
// narrow-route) et affiche le CORPS des réponses non-200 (le worker le jette).
// Usage : node scripts/diag-sofia-400.mjs "LFRV,LFTA,LFBH"
const SOFIA = 'https://sofia-briefing.aviation-civile.gouv.fr';
const route = (process.argv[2] || 'LFRV,LFTA,LFBH').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

const page = await fetch(`${SOFIA}/sofia/pages/notamform.html`, { headers: { 'User-Agent': 'papabear56-meteo-relais/1.0' } });
const cookie = (page.headers.get('Set-Cookie') || '').split(';')[0];
console.log('session:', page.status, cookie ? 'cookie ok' : 'PAS DE COOKIE');

const body = new URLSearchParams({
    ':operation': 'postNarrowRoutePibRequest',
    'valid_from': new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    'duration': '1200',
    'traffic': 'V',
    'fl_lower': '0',
    'fl_upper': '999',
    'width': '15',
    'radiusAD': '30',
    'uuid': crypto.randomUUID(),
    'isFromSofia': 'true',
});
route.forEach(c => body.append('route[]', c));

const res = await fetch(`${SOFIA}/sofia`, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(cookie ? { Cookie: cookie } : {}),
        Referer: `${SOFIA}/sofia/pages/notamform.html`,
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'User-Agent': 'papabear56-meteo-relais/1.0',
    },
    body: body.toString(),
});
const txt = await res.text();
console.log('POST status:', res.status);
console.log('corps (800 premiers caractères) :');
console.log(txt.slice(0, 800));
