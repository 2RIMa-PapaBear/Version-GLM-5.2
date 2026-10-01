#!/usr/bin/env node
// ============================================================================
// RUN-TESTS — `npm test` en DOUBLE FUSEAU (S16, audit 27/09).
//
//   node scripts/run-tests.mjs
//
// La suite tourne DANS LE FUSEAU LOCAL puis en TZ=UTC, dans deux processus
// séparés (process.env.TZ ne se change pas à chaud de façon fiable). Les
// tests de fuseau (azba, temsi, TAF…) mordent ainsi dans les DEUX hémisphères
// de lecture — les régressions du type « vert à Paris, rouge en UTC » ne
// pouvaient plus être vues (les tests azba ne mordaient qu'en runner
// non-UTC, piège noté audit 27/09).
// La LISTE des fichiers reste dans package.json (script "test-files") —
// ce lanceur la relit, une seule source de vérité.
// ============================================================================
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const files = String(pkg.scripts['test-files']).replace(/^.*?node --test /, '').split(/\s+/).filter(Boolean);

let fails = 0;
for (const tz of [process.env.TZ || 'Europe/Paris', 'UTC']) {
    console.log(`\n=== npm test — TZ=${tz} (${files.length} fichiers) ===`);
    const r = spawnSync(process.execPath, ['--test', ...files], {
        cwd: ROOT, stdio: 'inherit', env: { ...process.env, TZ: tz },
    });
    if (r.status !== 0) { fails++; console.error(`✗ ÉCHEC en TZ=${tz}`); }
}
process.exit(fails ? 1 : 0);
