/* ================================================================
 * RELAIS MÉTÉO CORS — Cloudflare Worker
 * ================================================================
 * Remplace le relais Google Apps Script (sujet à des phases de
 * surcharge de 8-34 s). Même contrat d'appel :
 *   ?url=<https cible encodée>&ttl=<secondes optionnel>
 *
 * - Cibles autorisées : aviationweather.gov (METAR/TAF/SIGMET/
 *   stations/PIREP), nominatim.openstreetmap.org (recherche
 *   terrain) et sia.aviation-civile.gouv.fr — pour ce dernier,
 *   UNIQUEMENT les PDF de cartes d'aérodrome de l'eAIP (VAC/ADC),
 *   servis en BINAIRE avec cache périphérique de 7 jours (l'URL
 *   contient le cycle AIRAC : elle change à chaque cycle, jamais
 *   périmée). RIEN d'autre : personne ne peut détourner ce relais
 *   pour consommer le quota gratuit du compte (100 k req/jour).
 * - Cache périphérique : 180 s par défaut, paramètre ttl honoré
 *   (30 s mini, 24 h maxi) — mêmes règles que l'ancien relais.
 * - Échec de la cible (réseau ou HTTP) : HTTP 200 + corps 'PROXY_ERROR: …',
 *   le contrat exact de l'ancien relais Apps Script — l'app échoue proprement
 *   sans retry ni erreur console (l'endpoint /api/data/atis, supprimé côté
 *   AviationWeather en 2025, répond 404 à chaque chargement de terrain).
 * - HEAD sans paramètre : 200 immédiat (sondage du watchdog).
 * ================================================================ */

const HOSTS_AUTORISES = new Set([
    'aviationweather.gov',
    'nominatim.openstreetmap.org',
]);

// Cartes PDF de l'eAIP SIA :
//   /media/dvd/eAIP_06_AUG_2026/FRANCE/AIRAC-2026-08-06/html/eAIP/
//   Cartes/LFRS/AD_2_LFRS_ADC_01.pdf   (ADC = carte d'aérodrome, MIA = insertion)
const SIA_CARTE_PDF = /^\/media\/dvd\/eAIP_[A-Z0-9_]+\/FRANCE\/AIRAC-\d{4}-\d{2}-\d{2}\/html\/eAIP\/Cartes\/[A-Z0-9]{4}\/AD_2_[A-Z0-9]{4}_[A-Z0-9_]+\.pdf$/;

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': '*',
};

// Fusion des dossiers PIB du repli « tronçon par tronçon » (module pur testé).
import { mergePibChunks } from './fusion-pib.mjs';

const TTL_PDF_SEC = 7 * 86400;   // cartes AIRAC : URL par cycle, jamais périmée

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        if (request.method === 'POST' && url.pathname === '/notam') {
            try {
                return await pibNotam(request);
            } catch (e) {
                return reponse(502, JSON.stringify({ error: String(e.message || e).slice(0, 200) }), 'application/json');
            }
        }
        // B3 v2 (16/09) — TEMSI/WinTEM France (AEROWEB, compte du pilote).
        if (request.method === 'GET' && url.pathname === '/temsi') {
            return await temsiFrance(request, env, ctx);
        }
        // ⑤ (17/09) — CARTES DES FRONTS (situation générale du briefing,
        // AEROWEB compte du pilote) : analyse + prévisions toutes les 6 h.
        if (request.method === 'GET' && url.pathname === '/fronts') {
            return await frontsFrance(request, env, ctx);
        }
        // C1 (14/09) : SIGMET/GAMET/AIRMET France via le compte AEROWEB du
        // pilote (secrets AEROWEB_USER/AEROWEB_PASS — jamais dans le repo).
        if (request.method === 'GET' && url.pathname === '/sigmet') {
            try {
                return await sigmetFrance(request, env, ctx);
            } catch (e) {
                return reponse(502, JSON.stringify({ error: String(e.message || e).slice(0, 200) }), 'application/json');
            }
        }
        return handleGet(request, env, ctx);
    },
};

// ----------------------------------------------------------------
// AEROWEB — SIGMET France (C1)
//   1. session : POST /ajax/login_valid.php login + md5(password)
//      → PHPSESSID (cachée en mémoire ~25 min, re-login sur réponse vide) ;
//   2. messages : POST /affichemessages_sigmet.php mode=xml&codes=FIR…
//      → XML « Messages SIGMET, GAMET, AIRMET » par FIR (source officielle
//      Météo-France,Annexe 3 OACI) ;
//   3. réponse : XML tel quel, cache périphérique 4 min (un SIGMET peut
//      être émis à tout moment, mais 4 min de retard est raisonnable).
// ----------------------------------------------------------------
const AEROWEB = 'https://aviation.meteo.fr';
const FIR_FRANCE_DEFAULT = 'LFFF LFEE LFRR LFBB LFMH';   // métropole
let _aeroSession = { cookie: null, ts: 0 };
const AERO_SESSION_TTL_MS = 25 * 60 * 1000;

async function aerowebLogin(env) {
    // Session valide en mémoire ?
    if (_aeroSession.cookie && Date.now() - _aeroSession.ts < AERO_SESSION_TTL_MS) return _aeroSession.cookie;

    const page = await fetch(AEROWEB + '/login.php');
    const baseCookie = (page.headers.get('set-cookie') || '').split(';')[0];
    if (!baseCookie) throw new Error('AEROWEB: pas de cookie de session');

    // MD5 (le site hashe le mot de passe côté client) — les Workers n'ont
    // pas de MD5 natif (WebCrypto l'a retiré), implémentation RFC 1321.
    const r = await fetch(AEROWEB + '/ajax/login_valid.php', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: baseCookie },
        body: 'login=' + encodeURIComponent(env.AEROWEB_USER) + '&password=' + md5(env.AEROWEB_PASS),
    });
    const t = await r.text();
    if (t.trim() !== 'ok') throw new Error('AEROWEB: login refusé (' + t.trim().slice(0, 40) + ')');
    // getSetCookie() renvoie un TABLEAU ; sinon header brut → split.
    const rawSet = typeof r.headers.getSetCookie === 'function'
        ? r.headers.getSetCookie()
        : String(r.headers.get('set-cookie') || '').split(/,(?=[^;]+?=)/);
    const extra = rawSet.map(c => String(c).split(';')[0].trim()).filter(Boolean);
    const cookies = [baseCookie, ...extra].join('; ');
    _aeroSession = { cookie: cookies, ts: Date.now() };
    return cookies;
}

// ---------------------------------------------------------------------------
// B3 v2 — TEMSI / WinTEM France (cartes du temps significatif, AEROWEB).
//   GET /temsi
//     → JSON { generatedAt, domain:'FRANCE',
//              layers:[{ key:'temsi'|'wintem', label, type, echeances:[{utc,label}] }] }
//     liste des échéances du jour (cache périphérique 10 min — 4 émissions/j).
//   GET /temsi?img=<type>&date=<YYYYMMDDHHMMSS>
//     → l'IMAGE de la carte (affiche_image.php?mode=img, ~280 Ko, immuable
//       par date — cache périphérique 30 min).
// Sources (recon 16/09, session authentifiée) :
//   get_domaine_layers_echeances.php?domaine=19 (FRANCE) → couches + échéances
//   affiche_image.php?type=sigwx/fr/france&date=…&mode=img → image TEMSI
//   affiche_image.php?type=wintemp/fr/france/fl020&date=…&mode=img → WinTEM
// ---------------------------------------------------------------------------
const TEMSI_TYPE_OK = /^(sigwx|wintemp)\/fr\/france(\/fl\d{2,3})?$/;

/** Parse la page des couches France → [{key,label,type,echeances}] (pur, testé). */
export function parseTemsiLayers(html) {
    const layers = [];
    const reBlock = /<span>([^<]+)<\/span>([\s\S]*?)(?=<span>|$)/g;
    let m;
    while ((m = reBlock.exec(html))) {
        const label = m[1].replace(/\s+/g, ' ').trim();
        const body = m[2];
        const type = (body.match(/type=([a-z0-9/_]+)&date=/i) || [])[1];
        const utc = [...body.matchAll(/goCartesAnim\(\d+,'(\d{14})',19,/g)].map(e => e[1]);
        const echeances = [...new Set(utc)];
        if (!type || !echeances.length) continue;
        layers.push({
            key: /wintemp/i.test(type) ? 'wintem' : 'temsi',
            label,
            type,
            echeances: echeances.map(u => ({ utc: u, label: u.slice(8, 10) + 'h UTC' })),
        });
    }
    return layers;
}

async function temsiFrance(request, env, ctx) {
    if (!env.AEROWEB_USER || !env.AEROWEB_PASS) {
        return reponse(503, JSON.stringify({ error: 'secrets AEROWEB absents (wrangler secret put AEROWEB_USER / AEROWEB_PASS)' }), 'application/json');
    }
    const params = new URL(request.url).searchParams;
    const cache = caches.default;

    // ---- Image d'une échéance (immuable par date → cache 30 min) ----
    const imgType = params.get('img');
    if (imgType) {
        if (!TEMSI_TYPE_OK.test(imgType)) return reponse(400, JSON.stringify({ error: 'type TEMSI invalide' }), 'application/json');
        const date = (params.get('date') || '').replace(/\D/g, '');
        if (!/^\d{14}$/.test(date)) return reponse(400, JSON.stringify({ error: 'date invalide (YYYYMMDDHHMMSS)' }), 'application/json');
        const urlImg = AEROWEB + '/affiche_image.php?type=' + imgType + '&date=' + date + '&mode=img';
        const cle = new Request(urlImg);
        const hit = await cache.match(cle);
        if (hit) {
            const out = reponse(200, hit.body, hit.headers.get('content-type') || 'image/png');
            out.headers.set('X-Cache', 'HIT');
            return out;
        }
        const cookie = await aerowebLogin(env);
        const r = await fetch(urlImg, { headers: { cookie } });
        if (!r.ok) return reponse(502, JSON.stringify({ error: 'image TEMSI indisponible (HTTP ' + r.status + ')' }), 'application/json');
        const ct = r.headers.get('content-type') || 'image/png';
        const bytes = await r.arrayBuffer();
        ctx.waitUntil(cache.put(cle, new Response(bytes, { headers: { 'content-type': ct, 'cache-control': 'public, max-age=1800' } })));
        const out = reponse(200, bytes, ct);
        out.headers.set('Cache-Control', 'public, max-age=1800');
        return out;
    }

    // ---- Liste des couches/échéances (cache 10 min) ----
    const cleListe = new Request(AEROWEB + '/temsi/liste/france');
    const hitListe = await cache.match(cleListe);
    if (hitListe) {
        const out = reponse(200, hitListe.body, 'application/json');
        out.headers.set('X-Cache', 'HIT');
        return out;
    }
    const urlListe = AEROWEB + '/get_domaine_layers_echeances.php?domaine=19';
    let html = '';
    for (let essai = 1; essai <= 2; essai++) {
        const cookie = await aerowebLogin(env);
        const r = await fetch(urlListe, { headers: { cookie } });
        html = await r.text();
        if (/goCartesAnim/.test(html)) break;
        _aeroSession = { cookie: null, ts: 0 };   // session expirée → re-login
    }
    const layers = parseTemsiLayers(html);
    if (!layers.length) {
        return reponse(502, JSON.stringify({ error: 'réponse AEROWEB inattendue (pas de couches TEMSI)' }), 'application/json');
    }
    const json = JSON.stringify({ generatedAt: new Date().toISOString(), domain: 'FRANCE', layers });
    ctx.waitUntil(cache.put(cleListe, new Response(json, { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=600' } })));
    const out = reponse(200, json, 'application/json');
    out.headers.set('Cache-Control', 'public, max-age=600');
    return out;
}

// ----------------------------------------------------------------
// CARTES DES FRONTS (⑤, 17/09) — situation générale du briefing.
// Page d'animation AEROWEB : anim_carte_front.php?layer=front/europeouest
// (analyse + prévisions toutes les 6 h, jusqu'à J+3). La page embarque
// directement les URLs affiche_image.php?type=front/…&date=…&mode=img —
// chaque échéance y figure DEUX fois (aller puis retour de l'animation).
// ----------------------------------------------------------------
const FRONTS_TYPE_OK = /^front\/[a-z]+$/;

/** Parse la page d'animation des fronts → [{key,label,type,echeances}]
 *  (pur, testé) — dédoublonnage des dates + tri croissant. */
export function parseFrontsLayers(html) {
    const pairs = [...String(html).matchAll(/affiche_image\.php\?[^"']*?type=([a-z0-9/_]+)&date=(\d{14})[^"']*?mode=img/gi)];
    const byType = new Map();
    for (const m of pairs) {
        if (!FRONTS_TYPE_OK.test(m[1])) continue;
        if (!byType.has(m[1])) byType.set(m[1], new Set());
        byType.get(m[1]).add(m[2]);
    }
    const layers = [];
    for (const [type, set] of byType) {
        const echeances = [...set].sort();
        if (!echeances.length) continue;
        layers.push({
            key: 'fronts',
            label: /europe/.test(type) ? 'Europe ouest' : type,
            type,
            echeances: echeances.map(u => ({ utc: u, label: u.slice(8, 10) + 'h UTC' })),
        });
    }
    return layers;
}

async function frontsFrance(request, env, ctx) {
    if (!env.AEROWEB_USER || !env.AEROWEB_PASS) {
        return reponse(503, JSON.stringify({ error: 'secrets AEROWEB absents (wrangler secret put AEROWEB_USER / AEROWEB_PASS)' }), 'application/json');
    }
    const params = new URL(request.url).searchParams;
    const cache = caches.default;

    // ---- Image d'une échéance (immuable par date → cache 30 min) ----
    const imgType = params.get('img');
    if (imgType) {
        if (!FRONTS_TYPE_OK.test(imgType)) return reponse(400, JSON.stringify({ error: 'type fronts invalide' }), 'application/json');
        const date = (params.get('date') || '').replace(/\D/g, '');
        if (!/^\d{14}$/.test(date)) return reponse(400, JSON.stringify({ error: 'date invalide (YYYYMMDDHHMMSS)' }), 'application/json');
        const urlImg = AEROWEB + '/affiche_image.php?type=' + imgType + '&date=' + date + '&mode=img';
        const cle = new Request(urlImg);
        const hit = await cache.match(cle);
        if (hit) {
            const out = reponse(200, hit.body, hit.headers.get('content-type') || 'image/png');
            out.headers.set('X-Cache', 'HIT');
            return out;
        }
        const cookie = await aerowebLogin(env);
        const r = await fetch(urlImg, { headers: { cookie } });
        if (!r.ok) return reponse(502, JSON.stringify({ error: 'image fronts indisponible (HTTP ' + r.status + ')' }), 'application/json');
        const ct = r.headers.get('content-type') || 'image/png';
        const bytes = await r.arrayBuffer();
        ctx.waitUntil(cache.put(cle, new Response(bytes, { headers: { 'content-type': ct, 'cache-control': 'public, max-age=1800' } })));
        const out = reponse(200, bytes, ct);
        out.headers.set('Cache-Control', 'public, max-age=1800');
        return out;
    }

    // ---- Liste des échéances (cache 10 min) ----
    const cleListe = new Request(AEROWEB + '/fronts/liste/europeouest');
    const hitListe = await cache.match(cleListe);
    if (hitListe) {
        const out = reponse(200, hitListe.body, 'application/json');
        out.headers.set('X-Cache', 'HIT');
        return out;
    }
    const urlListe = AEROWEB + '/anim_carte_front.php?tt=xxx&width=600&height=539&layer=front/europeouest&prof_avant=-18';
    let html = '';
    for (let essai = 1; essai <= 2; essai++) {
        const cookie = await aerowebLogin(env);
        const r = await fetch(urlListe, { headers: { cookie } });
        html = await r.text();
        if (/affiche_image\.php/.test(html)) break;
        _aeroSession = { cookie: null, ts: 0 };   // session expirée → re-login
    }
    const layers = parseFrontsLayers(html);
    if (!layers.length) {
        return reponse(502, JSON.stringify({ error: 'réponse AEROWEB inattendue (pas de cartes fronts)' }), 'application/json');
    }
    const json = JSON.stringify({ generatedAt: new Date().toISOString(), domain: 'EUROPE OUEST', layers });
    ctx.waitUntil(cache.put(cleListe, new Response(json, { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=600' } })));
    const out = reponse(200, json, 'application/json');
    out.headers.set('Cache-Control', 'public, max-age=600');
    return out;
}

// MD5 — implémentation EXACTE du site AEROWEB (php.js, md5 + utf8_encode
// extraites de https://aviation.meteo.fr/js/md5.js) : le login du serveur
// hache le mot de passe avec CETTE fonction, zéro divergence possible.
function utf8_encode ( str_data ) {
    // Encodes an ISO-8859-1 string to UTF-8
    // 
    // +    discuss at: http://kevin.vanzonneveld.net/techblog/article/javascript_equivalent_for_phps_utf8_encode/
    // +       version: 804.1015
    // +   original by: Webtoolkit.info (http://www.webtoolkit.info/)
    // *     example 1: utf8_encode('Kevin van Zonneveld');
    // *     returns 1: 'Kevin van Zonneveld'

    str_data = str_data.replace(/\r\n/g,"\n");
    var utftext = "";

    for (var n = 0; n < str_data.length; n++) {
        var c = str_data.charCodeAt(n);
        if (c < 128) {
            utftext += String.fromCharCode(c);
        } else if((c > 127) && (c < 2048)) {
            utftext += String.fromCharCode((c >> 6) | 192);
            utftext += String.fromCharCode((c & 63) | 128);
        } else {
            utftext += String.fromCharCode((c >> 12) | 224);
            utftext += String.fromCharCode(((c >> 6) & 63) | 128);
            utftext += String.fromCharCode((c & 63) | 128);
        }
    }

    return utftext;
}

function md5 ( str ) {
    // Calculate the md5 hash of a string
    // 
    // +    discuss at: http://kevin.vanzonneveld.net/techblog/article/javascript_equivalent_for_phps_md5/
    // +       version: 804.1015
    // +   original by: Webtoolkit.info (http://www.webtoolkit.info/)
    // + namespaced by: Michael White (http://crestidg.com)
    // -    depends on: utf8_encode
    // *     example 1: md5('Kevin van Zonneveld');
    // *     returns 1: '6e658d4bfcb59cc13f96c14450ac40b9'

    var RotateLeft = function(lValue, iShiftBits) {
            return (lValue<<iShiftBits) | (lValue>>>(32-iShiftBits));
        };

    var AddUnsigned = function(lX,lY) {
            var lX4,lY4,lX8,lY8,lResult;
            lX8 = (lX & 0x80000000);
            lY8 = (lY & 0x80000000);
            lX4 = (lX & 0x40000000);
            lY4 = (lY & 0x40000000);
            lResult = (lX & 0x3FFFFFFF)+(lY & 0x3FFFFFFF);
            if (lX4 & lY4) {
                return (lResult ^ 0x80000000 ^ lX8 ^ lY8);
            }
            if (lX4 | lY4) {
                if (lResult & 0x40000000) {
                    return (lResult ^ 0xC0000000 ^ lX8 ^ lY8);
                } else {
                    return (lResult ^ 0x40000000 ^ lX8 ^ lY8);
                }
            } else {
                return (lResult ^ lX8 ^ lY8);
            }
        };

    var F = function(x,y,z) { return (x & y) | ((~x) & z); };
    var G = function(x,y,z) { return (x & z) | (y & (~z)); };
    var H = function(x,y,z) { return (x ^ y ^ z); };
    var I = function(x,y,z) { return (y ^ (x | (~z))); };

    var FF = function(a,b,c,d,x,s,ac) {
            a = AddUnsigned(a, AddUnsigned(AddUnsigned(F(b, c, d), x), ac));
            return AddUnsigned(RotateLeft(a, s), b);
        };

    var GG = function(a,b,c,d,x,s,ac) {
            a = AddUnsigned(a, AddUnsigned(AddUnsigned(G(b, c, d), x), ac));
            return AddUnsigned(RotateLeft(a, s), b);
        };

    var HH = function(a,b,c,d,x,s,ac) {
            a = AddUnsigned(a, AddUnsigned(AddUnsigned(H(b, c, d), x), ac));
            return AddUnsigned(RotateLeft(a, s), b);
        };

    var II = function(a,b,c,d,x,s,ac) {
            a = AddUnsigned(a, AddUnsigned(AddUnsigned(I(b, c, d), x), ac));
            return AddUnsigned(RotateLeft(a, s), b);
        };

    var ConvertToWordArray = function(str) {
            var lWordCount;
            var lMessageLength = str.length;
            var lNumberOfWords_temp1=lMessageLength + 8;
            var lNumberOfWords_temp2=(lNumberOfWords_temp1-(lNumberOfWords_temp1 % 64))/64;
            var lNumberOfWords = (lNumberOfWords_temp2+1)*16;
            var lWordArray=Array(lNumberOfWords-1);
            var lBytePosition = 0;
            var lByteCount = 0;
            while ( lByteCount < lMessageLength ) {
                lWordCount = (lByteCount-(lByteCount % 4))/4;
                lBytePosition = (lByteCount % 4)*8;
                lWordArray[lWordCount] = (lWordArray[lWordCount] | (str.charCodeAt(lByteCount)<<lBytePosition));
                lByteCount++;
            }
            lWordCount = (lByteCount-(lByteCount % 4))/4;
            lBytePosition = (lByteCount % 4)*8;
            lWordArray[lWordCount] = lWordArray[lWordCount] | (0x80<<lBytePosition);
            lWordArray[lNumberOfWords-2] = lMessageLength<<3;
            lWordArray[lNumberOfWords-1] = lMessageLength>>>29;
            return lWordArray;
        };

    var WordToHex = function(lValue) {
            var WordToHexValue="",WordToHexValue_temp="",lByte,lCount;
            for (lCount = 0;lCount<=3;lCount++) {
                lByte = (lValue>>>(lCount*8)) & 255;
                WordToHexValue_temp = "0" + lByte.toString(16);
                WordToHexValue = WordToHexValue + WordToHexValue_temp.substr(WordToHexValue_temp.length-2,2);
            }
            return WordToHexValue;
        };

    var x=Array();
    var k,AA,BB,CC,DD,a,b,c,d;
    var S11=7, S12=12, S13=17, S14=22;
    var S21=5, S22=9 , S23=14, S24=20;
    var S31=4, S32=11, S33=16, S34=23;
    var S41=6, S42=10, S43=15, S44=21;

    str = utf8_encode(str);
    x = ConvertToWordArray(str);
    a = 0x67452301; b = 0xEFCDAB89; c = 0x98BADCFE; d = 0x10325476;

    for (k=0;k<x.length;k+=16) {
        AA=a; BB=b; CC=c; DD=d;
        a=FF(a,b,c,d,x[k+0], S11,0xD76AA478);
        d=FF(d,a,b,c,x[k+1], S12,0xE8C7B756);
        c=FF(c,d,a,b,x[k+2], S13,0x242070DB);
        b=FF(b,c,d,a,x[k+3], S14,0xC1BDCEEE);
        a=FF(a,b,c,d,x[k+4], S11,0xF57C0FAF);
        d=FF(d,a,b,c,x[k+5], S12,0x4787C62A);
        c=FF(c,d,a,b,x[k+6], S13,0xA8304613);
        b=FF(b,c,d,a,x[k+7], S14,0xFD469501);
        a=FF(a,b,c,d,x[k+8], S11,0x698098D8);
        d=FF(d,a,b,c,x[k+9], S12,0x8B44F7AF);
        c=FF(c,d,a,b,x[k+10],S13,0xFFFF5BB1);
        b=FF(b,c,d,a,x[k+11],S14,0x895CD7BE);
        a=FF(a,b,c,d,x[k+12],S11,0x6B901122);
        d=FF(d,a,b,c,x[k+13],S12,0xFD987193);
        c=FF(c,d,a,b,x[k+14],S13,0xA679438E);
        b=FF(b,c,d,a,x[k+15],S14,0x49B40821);
        a=GG(a,b,c,d,x[k+1], S21,0xF61E2562);
        d=GG(d,a,b,c,x[k+6], S22,0xC040B340);
        c=GG(c,d,a,b,x[k+11],S23,0x265E5A51);
        b=GG(b,c,d,a,x[k+0], S24,0xE9B6C7AA);
        a=GG(a,b,c,d,x[k+5], S21,0xD62F105D);
        d=GG(d,a,b,c,x[k+10],S22,0x2441453);
        c=GG(c,d,a,b,x[k+15],S23,0xD8A1E681);
        b=GG(b,c,d,a,x[k+4], S24,0xE7D3FBC8);
        a=GG(a,b,c,d,x[k+9], S21,0x21E1CDE6);
        d=GG(d,a,b,c,x[k+14],S22,0xC33707D6);
        c=GG(c,d,a,b,x[k+3], S23,0xF4D50D87);
        b=GG(b,c,d,a,x[k+8], S24,0x455A14ED);
        a=GG(a,b,c,d,x[k+13],S21,0xA9E3E905);
        d=GG(d,a,b,c,x[k+2], S22,0xFCEFA3F8);
        c=GG(c,d,a,b,x[k+7], S23,0x676F02D9);
        b=GG(b,c,d,a,x[k+12],S24,0x8D2A4C8A);
        a=HH(a,b,c,d,x[k+5], S31,0xFFFA3942);
        d=HH(d,a,b,c,x[k+8], S32,0x8771F681);
        c=HH(c,d,a,b,x[k+11],S33,0x6D9D6122);
        b=HH(b,c,d,a,x[k+14],S34,0xFDE5380C);
        a=HH(a,b,c,d,x[k+1], S31,0xA4BEEA44);
        d=HH(d,a,b,c,x[k+4], S32,0x4BDECFA9);
        c=HH(c,d,a,b,x[k+7], S33,0xF6BB4B60);
        b=HH(b,c,d,a,x[k+10],S34,0xBEBFBC70);
        a=HH(a,b,c,d,x[k+13],S31,0x289B7EC6);
        d=HH(d,a,b,c,x[k+0], S32,0xEAA127FA);
        c=HH(c,d,a,b,x[k+3], S33,0xD4EF3085);
        b=HH(b,c,d,a,x[k+6], S34,0x4881D05);
        a=HH(a,b,c,d,x[k+9], S31,0xD9D4D039);
        d=HH(d,a,b,c,x[k+12],S32,0xE6DB99E5);
        c=HH(c,d,a,b,x[k+15],S33,0x1FA27CF8);
        b=HH(b,c,d,a,x[k+2], S34,0xC4AC5665);
        a=II(a,b,c,d,x[k+0], S41,0xF4292244);
        d=II(d,a,b,c,x[k+7], S42,0x432AFF97);
        c=II(c,d,a,b,x[k+14],S43,0xAB9423A7);
        b=II(b,c,d,a,x[k+5], S44,0xFC93A039);
        a=II(a,b,c,d,x[k+12],S41,0x655B59C3);
        d=II(d,a,b,c,x[k+3], S42,0x8F0CCC92);
        c=II(c,d,a,b,x[k+10],S43,0xFFEFF47D);
        b=II(b,c,d,a,x[k+1], S44,0x85845DD1);
        a=II(a,b,c,d,x[k+8], S41,0x6FA87E4F);
        d=II(d,a,b,c,x[k+15],S42,0xFE2CE6E0);
        c=II(c,d,a,b,x[k+6], S43,0xA3014314);
        b=II(b,c,d,a,x[k+13],S44,0x4E0811A1);
        a=II(a,b,c,d,x[k+4], S41,0xF7537E82);
        d=II(d,a,b,c,x[k+11],S42,0xBD3AF235);
        c=II(c,d,a,b,x[k+2], S43,0x2AD7D2BB);
        b=II(b,c,d,a,x[k+9], S44,0xEB86D391);
        a=AddUnsigned(a,AA);
        b=AddUnsigned(b,BB);
        c=AddUnsigned(c,CC);
        d=AddUnsigned(d,DD);
    }

    var temp = WordToHex(a)+WordToHex(b)+WordToHex(c)+WordToHex(d);

    return temp.toLowerCase();
}


async function sigmetFrance(request, env, ctx) {
    if (!env.AEROWEB_USER || !env.AEROWEB_PASS) {
        return reponse(503, JSON.stringify({ error: 'secrets AEROWEB absents (wrangler secret put AEROWEB_USER / AEROWEB_PASS)' }), 'application/json');
    }
    const params = new URL(request.url).searchParams;
    // FIR valides seulement (A-Z×4, espacées) ; défaut = métropole.
    let codes = (params.get('codes') || FIR_FRANCE_DEFAULT).toUpperCase().replace(/[^A-Z ]/g, '');
    codes = codes.split(/\s+/).filter(c => /^[A-Z]{4}$/.test(c)).slice(0, 8).join(' ') || FIR_FRANCE_DEFAULT;

    // Cache périphérique 4 min : les SIGMET sont urgents mais pas à la seconde.
    const cache = caches.default;
    const cle = new Request(AEROWEB + '/sigmet/' + codes, { method: 'GET' });
    const enCache = await cache.match(cle);
    if (enCache) {
        const sortie = reponse(200, enCache.body, 'text/xml; charset=ISO-8859-1');
        sortie.headers.set('X-Cache', 'HIT');
        return sortie;
    }

    const cookie = await aerowebLogin(env);
    const r = await fetch(AEROWEB + '/affichemessages_sigmet.php', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
        body: 'mode=xml&codes=' + encodeURIComponent(codes),
    });
    let xml = await r.text();
    // Session expirée entre-temps → une seule relance.
    if (!/<\/root>|<fir/.test(xml)) {
        _aeroSession = { cookie: null, ts: 0 };
        const cookie2 = await aerowebLogin(env);
        const r2 = await fetch(AEROWEB + '/affichemessages_sigmet.php', {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookie2 },
            body: 'mode=xml&codes=' + encodeURIComponent(codes),
        });
        xml = await r2.text();
    }
    if (!/<\/root>|<fir/.test(xml)) {
        return reponse(502, JSON.stringify({ error: 'réponse AEROWEB inattendue' }), 'application/json');
    }
    const sortie = reponse(200, xml, 'text/xml; charset=ISO-8859-1');
    try {
        ctx.waitUntil(caches.default.put(cle, new Response(xml, {
            headers: { 'Content-Type': 'text/xml; charset=ISO-8859-1' },
        })));
    } catch {   }
    return sortie;
}

async function handleGet(request, env, ctx) {
        if (request.method === 'OPTIONS') return reponse(204, null);
        if (request.method === 'HEAD') return reponse(200, null);
        if (request.method !== 'GET') return reponse(405, 'Méthode non supportée');
        if (request.method === 'OPTIONS') return reponse(204, null);
        if (request.method === 'HEAD') return reponse(200, null);
        if (request.method !== 'GET') return reponse(405, 'Méthode non supportée');

        const params = new URL(request.url).searchParams;
        const cibleBrute = params.get('url');
        if (!cibleBrute) return reponse(400, '<ERREUR paramètre url manquant/>');

        let cible;
        try { cible = new URL(cibleBrute); } catch { return reponse(400, '<ERREUR url invalide/>'); }

        const estSiaCarte = cible.hostname === 'www.sia.aviation-civile.gouv.fr' && SIA_CARTE_PDF.test(cible.pathname);
        const hoteAutorise = HOSTS_AUTORISES.has(cible.hostname)
            || cible.hostname.endsWith('.aviationweather.gov')
            || estSiaCarte;
        if (cible.protocol !== 'https:' || !hoteAutorise) {
            return reponse(403, '<ERREUR hôte non autorisé/>');
        }

        const ttl = estSiaCarte ? TTL_PDF_SEC
            : Math.min(86400, Math.max(30, parseInt(params.get('ttl') || '180', 10) || 180));

        // 1) Cache périphérique d'abord — c'est lui qui rend les hits ~instantanés.
        const cache = caches.default;
        const cle = new Request(cible.toString(), { method: 'GET' });
        const enCache = await cache.match(cle);
        if (enCache) {
            const sortie = reponse(200, enCache.body, enCache.headers.get('Content-Type'));
            sortie.headers.set('X-Cache', 'HIT');
            return sortie;
        }

        // 2) Miss : aller chercher la donnée à la source.
        //    Contrat de l'ancien relais Apps Script, reproduit à l'identique :
        //    tout échec amont est renvoyé en HTTP 200 avec le préfixe
        //    'PROXY_ERROR:' — l'app le détecte et échoue proprement SANS retry
        //    ni erreur console (cas quotidien : /api/data/atis répond 404 pour
        //    tout terrain depuis la refonte 2025 de l'API AviationWeather).
        let amont;
        try {
            amont = await fetch(cible.toString(), {
                headers: { 'User-Agent': 'papabear56-meteo-relais/1.0' },
                redirect: 'follow',
            });
        } catch (e) {
            return reponse(200, `PROXY_ERROR: ${e.message}`);
        }
        if (amont.status !== 200 && amont.status !== 204) {
            const extrait = (await amont.text()).substring(0, 200);
            return reponse(200, `PROXY_ERROR: HTTP ${amont.status} — ${extrait}`);
        }

        // PDF (binaire) : réponse binaire CORS + cache périphérique long.
        const typeAmont = amont.headers.get('Content-Type') || 'text/plain';
        if (typeAmont.includes('application/pdf')) {
            const buf = await amont.arrayBuffer();
            const sortie = reponse(200, buf, 'application/pdf');
            sortie.headers.set('X-Cache', 'MISS');
            ctx.waitUntil(cache.put(cle, new Response(buf, {
                headers: { 'Content-Type': 'application/pdf', 'Cache-Control': `public, max-age=${TTL_PDF_SEC}` },
            })));
            return sortie;
        }

        const corps = await amont.text();
        const type = typeAmont;
        const sortie = reponse(200, corps, type);
        sortie.headers.set('X-Cache', 'MISS');

        // 3) Stocker en cache — sauf page HTML d'erreur d'AviationWeather
        //    (sinon on servirait une erreur pendant tout le ttl).
        const estPageHtml = corps.trim().startsWith('<') && !corps.toLowerCase().includes('<?xml');
        if (!estPageHtml) {
            const aStocker = new Response(corps, {
                headers: {
                    'Content-Type': type,
                    'Cache-Control': `public, max-age=${ttl}`,
                },
            });
            ctx.waitUntil(cache.put(cle, aStocker));
        }
        return sortie;
}

// ----------------------------------------------------------------
// POST /notam — PIB NOTAM officiel SOFIA-Briefing pour un plan de
// vol (10/09). Entrée JSON : { route:[OACI…], validFrom, durationMin,
// flLower, flUpper, widthNm, radiusAdNm }. Le Worker joue la session
// (cookie JSESSIONID) puis l'opération postNarrowRoutePibRequest, et
// renvoie le PIB JSON INTERNE (double parse fait ici). Cible FIXÉE
// (hôte + opération) : ce relais ne peut pas être détourné en proxy
// générique. Pas de cache : les NOTAM doivent être frais.
// ----------------------------------------------------------------
async function pibNotam(request) {
    const SOFIA = 'https://sofia-briefing.aviation-civile.gouv.fr';
    const params = await request.json();
    // ZZxx = repères libres de l'app : inconnus de SOFIA → HTTP 400. Ils sont
    // déjà filtrés côté client ; ce filtre protège tout client futur.
    const isCode = (c) => { const s = String(c || '').toUpperCase(); return /^[A-Z][A-Z0-9]{3}$/.test(s) && !/^ZZ[A-Z]{2}$/.test(s); };
    const route = (params.route || []).filter(isCode);
    if (route.length < 1) return reponse(400, JSON.stringify({ error: 'route vide' }), 'application/json');

    // 1. Session (cookie) — un GET préalable suffit.
    const page = await fetch(`${SOFIA}/sofia/pages/notamform.html`, { headers: { 'User-Agent': 'papabear56-meteo-relais/1.0' } });
    const cookie = (page.headers.get('Set-Cookie') || '').split(';')[0];

    // 2. Requête PIB (contrat reverse-engineéré — cf mémoire notam-sofia-api).
    const body = new URLSearchParams({
        ':operation': params.area ? 'postAreaPibRequest' : 'postNarrowRoutePibRequest',
        'valid_from': params.validFrom || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        'duration': String(params.durationMin || 1200),
        'traffic': 'V',   // VFR uniquement (retour pilote 10/09 : exclure les NOTAM IFR-only)
        'fl_lower': String(params.flLower ?? 0),
        'fl_upper': String(params.flUpper ?? 999),
        'width': String(params.widthNm || 15),
        'radiusAD': String(params.radiusAdNm || 30),
        'uuid': crypto.randomUUID(),
        'isFromSofia': 'true',
    });
    if (params.area) {
        // Mode VOL LOCAL (retour pilote 10/09) : cylindre autour du terrain.
        body.set('lat', String(params.area.lat || ''));
        body.set('long', String(params.area.long || ''));
        body.set('radius', String(params.area.radiusNm || 30));
    } else {
        route.forEach(c => body.append('route[]', c));
    }

    const appelSofia = async (extra) => {
        const b = new URLSearchParams(body);
        for (const [k, v] of Object.entries(extra || {})) b.set(k, v);
        const res = await fetch(`${SOFIA}/sofia`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                ...(cookie ? { 'Cookie': cookie } : {}),
                'Referer': `${SOFIA}/sofia/pages/notamform.html`,
                'X-Requested-With': 'XMLHttpRequest',
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'User-Agent': 'papabear56-meteo-relais/1.0',
            },
            body: b.toString(),
        });
        const txt = await res.text();
        if (res.status !== 200 || !txt.trim().startsWith('{')) throw new Error(`SOFIA HTTP ${res.status}`);
        return JSON.parse(JSON.parse(txt)['status.message']);
    };

    // Appel PIB sur UN tronçon [a→b] : corps narrow-route PROPRE, sans les
    // paramètres zone (lat/long/radius) — sinon SOFIA répond une zone sans
    // dossier AD (bug « NOTAM AD absents en vol local »). Sert au repli
    // tronçons (route refusée en global) et aux dossiers des points de
    // passage. Retourne le PIB interne complet, ou null si tronçon refusé.
    const legPib = async (a, b) => {
        const lp = new URLSearchParams();
        for (const [k, v] of body.entries()) {
            if (k === 'route[]' || k === 'lat' || k === 'long' || k === 'radius') continue;
            if (k === ':operation') { lp.set(k, 'postNarrowRoutePibRequest'); continue; }
            lp.append(k, v);
        }
        lp.append('route[]', a); lp.append('route[]', b);
        const res = await fetch(`${SOFIA}/sofia`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                ...(cookie ? { 'Cookie': cookie } : {}),
                'Referer': `${SOFIA}/sofia/pages/notamform.html`,
                'X-Requested-With': 'XMLHttpRequest',
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'User-Agent': 'papabear56-meteo-relais/1.0',
            },
            body: lp.toString(),
        });
        const t = await res.text();
        if (res.status !== 200 || !t.trim().startsWith('{')) return null;
        return JSON.parse(JSON.parse(t)['status.message']);
    };

    const inner = await appelSofia({}).catch(async (e) => {
        // REPLI TRONÇONS : SOFIA rejette les couloirs multi-segments qui
        // reviennent en arrière (HTTP 400, message générique « consultez la
        // FAQ ») — vérifié : LFRV→LFTA→LFBH échoue, les mêmes terrains dans
        // l'ordre de progression passent, et chaque tronçon isolé (ligne
        // droite) passe toujours. On interroge la route tronçon par tronçon
        // et on fusionne les dossiers (NOTAM dédupliqués par id).
        if (route.length < 2 || params.area) throw e;
        const chunks = await Promise.all(route.slice(0, -1).map((_, i) =>
            legPib(route[i], route[i + 1]).catch(() => null)));
        const valid = chunks.filter(c => c && c.listnotams);
        if (!valid.length) throw e;
        return mergePibChunks(valid);
    });
    if (!inner || !inner.listnotams) throw new Error('PIB sans listnotams');

    // Dossiers des POINTS DE PASSAGE (retour pilote 10/09) : SOFIA ne remplit
    // ADDep/ADDes que pour le premier/dernier terrain — chaque tronçon partant
    // du point de passage rapporte SON dossier (vérifié : LFRV→1, LFRC→6).
    // Appels parallèles côté Worker, ajoutés comme waypointDossiers.
    const legs = Array.isArray(params.legs) ? params.legs : [];
    if (legs.length) {
        const dossiers = await Promise.all(legs.map(async ([a, b]) => {
            if (!isCode(a) || !isCode(b)) return [a, null];
            try {
                const leg = await legPib(a, b);
                const dep = {};
                let n = 0;
                for (const [cat, list] of Object.entries(leg?.listnotams?.ADDep || {}))
                    if (Array.isArray(list) && list.length) { dep[cat] = list; n += list.length; }
                return [a, n ? dep : {}];
            } catch { return [a, null]; }
        }));
        inner.waypointDossiers = Object.fromEntries(dossiers.filter(([a]) => a));
    }
    return reponse(200, JSON.stringify(inner), 'application/json');
}

function reponse(statut, corps, type = 'text/plain') {
    return new Response(corps, { status: statut, headers: { ...CORS, 'Content-Type': type } });
}
