// Tests du relai Apps Script (apps-script/relais-aviationweather.gs) sous
// Node, avec stubs des services Google (CacheService, UrlFetchApp…).
// Le .gs est du JS pur : on l'évalue dans un contexte stubbé et on appelle
// doGet({ parameter: {...} }) comme le ferait Google. Tourne via `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SRC = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'apps-script', 'relais-aviationweather.gs'), 'utf8');

function makeEnv({ status = 200, body = 'METAR LFPB 190830Z', throwErr = null } = {}) {
    const calls = { fetchUrls: [], puts: [] };
    const store = new Map();
    const cacheStub = {
        get: (k) => (store.has(k) ? store.get(k) : null),
        put: (k, v, t) => { calls.puts.push([k, t]); store.set(k, v); },
    };
    const env = {
        calls,
        Utilities: {
            // Vrai SHA-256 (comme Utilities.computeDigest côté Google) : la clé
            // de cache tronquée à 40 caractères ne doit pas collisionner.
            base64EncodeWebSafe: (b) => Buffer.from(b).toString('base64url'),
            computeDigest: (_a, s) => Array.from(crypto.createHash('sha256').update(s).digest()),
            DigestAlgorithm: { SHA_256: 'SHA_256' },
        },
        CacheService: { getScriptCache: () => cacheStub },
        UrlFetchApp: {
            fetch: (u) => {
                calls.fetchUrls.push(u);
                if (throwErr) throw throwErr;
                return { getResponseCode: () => status, getContentText: () => body };
            },
        },
        ContentService: { createTextOutput: (t) => ({ text: t }) },
    };
    const doGet = new Function('Utilities', 'CacheService', 'UrlFetchApp', 'ContentService',
        SRC + '\nreturn doGet;')(env.Utilities, env.CacheService, env.UrlFetchApp, env.ContentService);
    return { doGet, calls };
}

test('allowlist : URL absente, invalide ou hôte non autorisé → PROXY_ERROR', () => {
    const { doGet } = makeEnv();
    for (const p of [{}, { url: '' }, { url: 'ftp://x' }, { url: 'https://evil.example.com/a' }]) {
        assert.match(doGet({ parameter: p }).text, /^PROXY_ERROR:/);
    }
});

test('200 : corps renvoyé puis servi depuis le cache (un seul fetch amont)', () => {
    const { doGet, calls } = makeEnv();
    const p = { parameter: { url: 'https://aviationweather.gov/api/data/metar?ids=LFPB&format=raw' } };
    assert.equal(doGet(p).text, 'METAR LFPB 190830Z');
    assert.equal(doGet(p).text, 'METAR LFPB 190830Z');
    assert.equal(calls.fetchUrls.length, 1);
    assert.equal(calls.puts.length, 1);
    assert.equal(calls.puts[0][1], 180);   // TTL par défaut
});

test('&ttl= : borné entre 30 s et 3600 s', () => {
    const { doGet, calls } = makeEnv();
    doGet({ parameter: { url: 'https://aviationweather.gov/a?x=1', ttl: '3600' } });
    doGet({ parameter: { url: 'https://aviationweather.gov/a?x=2', ttl: '99999' } });
    doGet({ parameter: { url: 'https://aviationweather.gov/a?x=3', ttl: '5' } });
    assert.deepEqual(calls.puts.map(p => p[1]), [3600, 3600, 30]);
});

test('page HTML (erreur AviationWeather) renvoyée mais JAMAIS cachée', () => {
    const { doGet, calls } = makeEnv({ body: '<html><body>503 Service</body></html>' });
    const p = { parameter: { url: 'https://aviationweather.gov/api/data/metar?ids=LFPB' } };
    assert.match(doGet(p).text, /^<html>/);
    assert.match(doGet(p).text, /^<html>/);   // 2e appel : pas de cache non plus
    assert.equal(calls.puts.length, 0);
    assert.equal(calls.fetchUrls.length, 2);   // chaque appel repart à l'amont
});

test('HTTP non-200 amont → PROXY_ERROR, pas de cache', () => {
    const { doGet, calls } = makeEnv({ status: 503, body: 'overloaded' });
    assert.match(doGet({ parameter: { url: 'https://aviationweather.gov/x' } }).text, /^PROXY_ERROR: HTTP 503/);
    assert.equal(calls.puts.length, 0);
});

test('corps > 90 Ko : renvoyé mais pas caché (limite CacheService 100 Ko)', () => {
    const { doGet, calls } = makeEnv({ body: 'x'.repeat(90001) });
    const p = { parameter: { url: 'https://aviationweather.gov/api/data/sigmet?format=json' } };
    assert.equal(doGet(p).text.length, 90001);
    assert.equal(doGet(p).text.length, 90001);
    assert.equal(calls.puts.length, 0);
    assert.equal(calls.fetchUrls.length, 2);
});

test('UrlFetchApp qui lève → PROXY_ERROR', () => {
    const { doGet } = makeEnv({ throwErr: new Error('timeout amont') });
    assert.match(doGet({ parameter: { url: 'https://aviationweather.gov/x' } }).text, /^PROXY_ERROR: /);
});

test('HTTP 204 amont (zone sans PIREP) : corps vide renvoyé, pas PROXY_ERROR', () => {
    const { doGet } = makeEnv({ status: 204, body: '' });
    const r = doGet({ parameter: { url: 'https://aviationweather.gov/api/data/pirep?bbox=45,0,50,5&format=json' } });
    assert.equal(r.text, '');
});
