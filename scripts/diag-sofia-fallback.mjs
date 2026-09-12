// Preuve réelle du REPLI TRONÇONS contre SOFIA (avant déploiement du worker) :
// rejoue pibNotam hors Worker — appel global (doit 400 sur une route qui
// revient en arrière) puis tronçons + fusion (doit produire un dossier complet).
// Usage : node scripts/diag-sofia-fallback.mjs "LFRV,LFRE,LFFO,LFOO,LFTA,LFBH"
import { mergePibChunks } from '../worker/fusion-pib.mjs';

const SOFIA = 'https://sofia-briefing.aviation-civile.gouv.fr';
const route = (process.argv[2] || 'LFRV,LFRE,LFFO,LFOO,LFTA,LFBH').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

const page = await fetch(`${SOFIA}/sofia/pages/notamform.html`, { headers: { 'User-Agent': 'papabear56-meteo-relais/1.0' } });
const cookie = (page.headers.get('Set-Cookie') || '').split(';')[0];

const base = new URLSearchParams({
    ':operation': 'postNarrowRoutePibRequest',
    'valid_from': new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    'duration': '1200', 'traffic': 'V',
    'fl_lower': '0', 'fl_upper': '999',
    'width': '15', 'radiusAD': '30',
    'uuid': crypto.randomUUID(), 'isFromSofia': 'true',
});

const post = async (codes) => {
    const b = new URLSearchParams(base);
    codes.forEach(c => b.append('route[]', c));
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
        body: b.toString(),
    });
    const txt = await res.text();
    if (res.status !== 200 || !txt.trim().startsWith('{')) return { status: res.status };
    return { status: 200, pib: JSON.parse(JSON.parse(txt)['status.message']) };
};

// 1. Appel global (attendu en échec sur cette géométrie).
const globalTry = await post(route);
console.log(`appel global ${route.join('→')} : HTTP ${globalTry.status}${globalTry.status === 200 ? ' (route acceptée en global — repli inutile)' : ' (repli tronçons requis)'}`);

// 2. Tronçons + fusion (le comportement du worker après correctif).
const chunks = [];
for (let i = 0; i + 1 < route.length; i++) {
    const r = await post([route[i], route[i + 1]]);
    chunks.push(r.pib || null);
    console.log(`  tronçon ${route[i]}→${route[i + 1]} : HTTP ${r.status}${r.pib ? ` · ${r.pib.nbNotams ?? '?'} NOTAM` : ''}`);
}
const valid = chunks.filter(c => c && c.listnotams);
if (!valid.length) { console.log('ÉCHEC : aucun tronçon exploitable'); process.exit(1); }

const merged = mergePibChunks(valid);
const countList = (o) => Object.values(o || {}).filter(Array.isArray).flat().length;
const firCount = Object.values(merged.listnotams.FIR).flat()
    .flatMap(g => g.sortedNotamsByImpactedAerodromes || [])
    .flatMap(ae => [...(ae.notam || []), ...(ae.sortedNotamsByPurpose || []).flatMap(p => p.notam || [])]).length;
console.log('FUSION :', JSON.stringify({
    dep: merged.listnotams.ADDep?.code,
    arr: merged.listnotams.ADDes?.code,
    notamsDep: countList(merged.listnotams.ADDep),
    notamsArr: countList(merged.listnotams.ADDes),
    firNotams: firCount,
    nbNotamsAnnonce: merged.nbNotams,
    validFrom: merged.validFrom,
}));
const ok = merged.listnotams.ADDep?.code === route[0]
    && merged.listnotams.ADDes?.code === route[route.length - 1]
    && (countList(merged.listnotams.ADDep) + countList(merged.listnotams.ADDes) + firCount) > 0;
console.log(ok ? 'REPLI OK — dossier complet couvrant toute la route' : 'ÉCHEC de la fusion');
process.exit(ok ? 0 : 1);
