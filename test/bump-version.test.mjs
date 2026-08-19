// Tests du bump de versions PWA (scripts/bump-version.mjs) : incrémente les
// ?v= d'index.html et le CACHE de sw.js, formats attendus respectés.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bumpVersions } from '../scripts/bump-version.mjs';

function makeTmpProject(idx, sw) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bump-'));
    fs.writeFileSync(path.join(dir, 'index.html'), idx);
    fs.writeFileSync(path.join(dir, 'sw.js'), sw);
    return dir;
}

test('bump 1.79/mt-shell-v61 → 1.80/mt-shell-v62, toutes les occurrences ?v=', () => {
    const dir = makeTmpProject(
        '<script src="js/app.js?v=1.79"></script><link href="css/style.css?v=1.79">',
        "const CACHE = 'mt-shell-v61';",
    );
    const r = bumpVersions(dir);
    assert.equal(r.vHtml, '1.80');
    assert.equal(r.vShell, 'mt-shell-v62');
    r.write();
    const idx = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    assert.equal((idx.match(/\?v=1\.80/g) || []).length, 2);
    assert.ok(!idx.includes('1.79'));
    assert.ok(fs.readFileSync(path.join(dir, 'sw.js'), 'utf8').includes("CACHE = 'mt-shell-v62'"));
});

test('le calcul sans write() ne modifie pas les fichiers', () => {
    const dir = makeTmpProject('<a href="x?v=1.45">', "const CACHE = 'mt-shell-v30';");
    bumpVersions(dir);
    assert.ok(fs.readFileSync(path.join(dir, 'index.html'), 'utf8').includes('1.45'));
});

test('erreur claire si les marqueurs sont absents', () => {
    const dir = makeTmpProject('<html></html>', 'const X = 1;');
    assert.throws(() => bumpVersions(dir), /index\.html/);
    const dir2 = makeTmpProject('<a href="x?v=1.45">', 'const X = 1;');
    assert.throws(() => bumpVersions(dir2), /sw\.js/);
});

test('passage de version à deux chiffres (1.99 → 1.100)', () => {
    const dir = makeTmpProject('<a href="x?v=1.99">', "const CACHE = 'mt-shell-v99';");
    const r = bumpVersions(dir);
    assert.equal(r.vHtml, '1.100');
    assert.equal(r.vShell, 'mt-shell-v100');
});
