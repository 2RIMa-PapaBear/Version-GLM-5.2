// Génère les SVG inline des icônes lucide utilisées par les pages vitrine
// (accueil.html + guides) et réécrit ces pages pour supprimer la dépendance
// à vendor/lucide.min.js (401 Ko). Usage : node test/gen-icons-inline.mjs
// Les pages de l'application (index.html) continuent d'utiliser lucide.
import fs from 'node:fs';
import vm from 'node:vm';

const ICONS = ['plane', 'arrow-right-circle', 'list', 'cloud-sun', 'map', 'cloud-lightning',
               'navigation', 'folder-check', 'plane-takeoff', 'clock', 'sun', 'radio', 'book-open'];
const PAGES = ['accueil.html', 'guide-metar.html', 'guide-taf.html', 'guide-fenetre-vfr.html'];

const pascal = (n) => n.split('-').map(s => s[0].toUpperCase() + s.slice(1)).join('');

const src = fs.readFileSync('vendor/lucide.min.js', 'utf8');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(src, ctx);
const lucide = ctx.lucide;

const nodeToSvg = (node) => {
    const [tag, attrs, children] = node;
    const a = Object.entries(attrs || {}).map(([k, v]) => `${k}="${v}"`).join(' ');
    const inner = (children || []).map(c => Array.isArray(c) ? nodeToSvg(c) : '').join('');
    return `<${tag}${a ? ' ' + a : ''}${inner ? '>' + inner + '</' + tag + '>' : '/>'}`;
};
const iconSvg = (name) => {
    const pascalName = pascal(name);
    const node = lucide[pascalName];
    if (!node) throw new Error(`icône inconnue : ${pascalName}`);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${node.map(n => nodeToSvg(n)).join('')}</svg>`;
};

let total = 0;
for (const page of PAGES) {
    let html = fs.readFileSync(page, 'utf8');
    const counts = {};
    html = html.replace(/<i data-lucide="([a-z-]+)"([^>]*)><\/i>/g, (m, name, rest) => {
        counts[name] = (counts[name] || 0) + 1;
        total++;
        // L'attribut style du <i> (largeur/hauteur) est reporté tel quel sur le <svg>
        return iconSvg(name).replace('<svg ', `<svg${rest} `);
    });
    html = html.replace(/<script src="vendor\/lucide\.min\.js[^"]*"[^>]*><\/script>\n?/g, '');
    html = html.split('\n').filter(l => !l.includes('createIcons')).join('\n');
    html = html.replace(/<script>\s*<\/script>\n?/g, '');
    fs.writeFileSync(page, html);
    console.log(`${page} : ${Object.entries(counts).map(([k, v]) => `${k}×${v}`).join(', ')}`);
}
console.log(`Total : ${total} icônes inlinées — lucide retiré des 4 pages.`);
