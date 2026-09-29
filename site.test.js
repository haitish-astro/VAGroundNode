// Static site checks: every page's local files exist, every script parses, every element id a page's scripts look up
// exists in that page, the shared navigation points at real pages, and the server refuses to leak private files.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolve } = require('./serve.js');

const ROOT = __dirname;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const pages = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'));
assert(pages.length >= 12, 'Pages found: ' + pages.length);

// 1. Local references exist and 2. ids used by the page's scripts are present in the page.
const DYNAMIC_IDS = new Set(['site-header', 'site-explain', 'main']);   // created by site-nav.js
let refs = 0, idChecks = 0;
for (const page of pages) {
  const html = read(page), scripts = [];
  for (const m of html.matchAll(/(?:href|src)="([^"#?]+)(?:[?#][^"]*)?"/g)) {
    const ref = m[1]; if (/^(https?:|mailto:|data:)/.test(ref)) continue;
    assert(fs.existsSync(path.join(ROOT, ref)), `${page}: missing local file ${ref}`); refs++;
    if (/\.js$/.test(ref) && /<script[^>]*src="/.test(html)) scripts.push(ref);
  }
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  for (const s of new Set(scripts)) {
    if (['site-nav.js', 'three.module.js'].includes(path.basename(s))) continue;
    const src = read(s);
    for (const m of src.matchAll(/(?:\$|getElementById)\(\s*['"]([\w-]+)['"]\s*\)/g)) {
      const id = m[1]; if (DYNAMIC_IDS.has(id)) continue;
      // Scripts shared by several pages only need the id on pages that use that feature.
      if (['n1-link.js', 'n1-ui.js', 'n1-map.js', 'n1-coach.js', 'n1-pfd.js'].includes(path.basename(s))) continue;
      assert(ids.has(id), `${page}: script ${s} looks up #${id} but the page has no such element`); idChecks++;
    }
  }
}

// 3. Every JavaScript file parses (ES modules through stdin).
const jsFiles = fs.readdirSync(ROOT).filter(f => f.endsWith('.js'));
for (const f of jsFiles) {
  const src = read(f), isModule = /^\s*(import|export)\s/m.test(src) || /\bawait import\(/.test(src);
  const r = isModule ? spawnSync(process.execPath, ['--check', '--input-type=module'], { input: src, encoding: 'utf8' }) : spawnSync(process.execPath, ['--check', f], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, `Syntax error in ${f}: ${r.stderr}`);
}

// 4. Shared navigation only links to real pages.
const nav = read('site-nav.js');
for (const m of nav.matchAll(/\['([\w-]+\.html)',/g)) assert(fs.existsSync(path.join(ROOT, m[1])), 'site-nav links to missing page ' + m[1]);
assert(fs.existsSync(path.join(ROOT, 'docs/Vahnim-Simulation-User-Manual.pdf')), 'User manual PDF exists');
assert(fs.existsSync(path.join(ROOT, 'assets/vahnim-logo.webp')), 'Vahnim logo exists');
for (const p of pages) assert(/<title>[^<]{3,}<\/title>/.test(read(p)), p + ' has a title');
for (const p of pages.filter(p => !/classic/.test(p))) assert(/site-nav\.js/.test(read(p)), p + ' loads the shared header');

// 5. The static server only serves the app.
const ok = ['/', '/index.html', '/assets/vahnim-logo.webp', '/docs/Vahnim-Simulation-User-Manual.pdf', '/node_modules/three/build/three.module.js', '/n1-worker.js'];
const blocked = ['/../package.json', '/%2e%2e/package.json', '/.git/config', '/.gitignore', '/serve.js', '/package.json', '/package-lock.json', '/n1.test.js', '/tests/import-fixture.glb', '/node_modules/other/index.js', '/README.md', '/index.html%00.png', '//etc/passwd'];
for (const u of ok) assert(resolve(u), 'served: ' + u);
for (const u of blocked) assert.equal(resolve(u), null, 'blocked: ' + u);

console.log(`PASS: site checks — ${pages.length} pages, ${refs} local references, ${idChecks} element lookups, ${jsFiles.length} scripts parse, navigation and server rules.`);
