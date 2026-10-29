#!/usr/bin/env node
/* ============================================================
   NEXORA static checks — no dependencies, no browser.
   Usage:  node tests/static-checks.js [--baseline <path-to-phase-1-project>]

   Verifies that every local reference resolves, ids are unique, the Phase 2
   script wiring is correct, content/data invariants hold and (with
   --baseline) that everything that must stay untouched is byte-identical to
   the Phase 1 project.
   Exit code 1 if any check fails.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const bi = process.argv.indexOf('--baseline');
const BASE = bi > -1 ? path.resolve(process.argv[bi + 1]) : null;
const PAGES = ['index.html', 'members.html', 'contacts.html'];

const results = [];
const rec = (id, name, ok, detail) => results.push({ id, name, ok, detail: detail || '' });
const read = (root, f) => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
const exists = (f) => fs.existsSync(path.join(ROOT, f));
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    e.isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
};

/* S01 — local references resolve ------------------------------------------ */
{
  const bad = [];
  let count = 0;
  for (const page of PAGES) {
    const html = read(ROOT, page);
    const re = /(?:src|href)="([^"]+)"/g;
    let m;
    while ((m = re.exec(html))) {
      const u = m[1];
      if (/^(https?:|mailto:|tel:|data:|#|javascript:)/.test(u)) continue;
      const clean = u.split('#')[0].split('?')[0];
      if (!clean) continue;
      count++;
      const file = clean.startsWith('/') ? clean.slice(1) : clean;
      if (!fs.existsSync(path.join(ROOT, file))) bad.push(page + ' -> ' + u);
    }
  }
  rec('S01', 'Every local src/href in the three pages resolves to a file (' + count + ' checked)', !bad.length, bad.join('; '));
}

/* S02 — anchors and unique ids -------------------------------------------- */
{
  const problems = [];
  for (const page of PAGES) {
    const html = read(ROOT, page);
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
    if (dup.length) problems.push(page + ' duplicate ids: ' + [...new Set(dup)].join(','));
    for (const m of html.matchAll(/href="#([^"]+)"/g)) if (!ids.includes(m[1])) problems.push(page + ' dangling #' + m[1]);
    if (!ids.includes('main')) problems.push(page + ' has no #main (skip-link target)');
  }
  rec('S02', 'Ids are unique, in-page anchors resolve, #main exists on every page', !problems.length, problems.join('; '));
}

/* S03 — Phase 2 script wiring --------------------------------------------- */
{
  const html = read(ROOT, 'index.html');
  const order = ['./vendor/three.r128.min.js', './vendor/anime.3.2.2.min.js', './js/cine-utils.js',
    './js/scene-registry.js', './js/three/intelligenceField.js', './js/three/dataCore.js'];
  const tags = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)].map((m) => ({ src: m[1], defer: /\sdefer\b/.test(m[0]) }));
  const idx = order.map((s) => tags.findIndex((t) => t.src === s));
  const inOrder = idx.every((v, i) => v > -1 && (i === 0 || v > idx[i - 1]));
  const allDeferred = order.every((s) => (tags.find((t) => t.src === s) || {}).defer);
  const mainAt = tags.findIndex((t) => t.src === './js/main.js');
  rec('S03', 'index.html loads the 6 Phase 2 scripts in dependency order, all deferred, after main.js',
    inOrder && allDeferred && mainAt > -1 && mainAt < idx[0], JSON.stringify({ inOrder, allDeferred, mainAt, idx }));
  const members = read(ROOT, 'members.html'), contacts = read(ROOT, 'contacts.html');
  const noThree = !/three/i.test(members.replace(/<!--[\s\S]*?-->/g, '')) && !/three/i.test(contacts.replace(/<!--[\s\S]*?-->/g, ''));
  rec('S04', 'Members and Contact load Anime.js only — no Three.js, no WebGL scripts',
    members.includes('./vendor/anime.3.2.2.min.js') && contacts.includes('./vendor/anime.3.2.2.min.js') && noThree);
}

/* S05 — no CDN at runtime, no references to deleted legacy code ------------ */
{
  const hits = [];
  for (const f of walk(ROOT).filter((p) => /\.(html|js|css)$/.test(p) && !/[\\/](vendor|tests|docs)[\\/]/.test(p) && !/[\\/]logo[\\/]/.test(p))) {
    const rel = path.relative(ROOT, f);
    const txt = fs.readFileSync(f, 'utf8');
    const live = rel.endsWith('.html') ? txt.replace(/<!--[\s\S]*?-->/g, '') : txt;
    if (/unpkg\.com|cdn\.jsdelivr|cdnjs/.test(live)) hits.push(rel + ': CDN reference');
    if (/members-scene|contact-scene|three\/constellation|constellation-canvas|contact-canvas/.test(live)) hits.push(rel + ': legacy reference');
  }
  const gone = ['js/three/constellation.js', 'js/three/members-scene.js', 'js/three/contact-scene.js'].every((f) => !exists(f));
  rec('S05', 'No runtime CDN (outside Google Fonts) and no references to the three deleted legacy scenes; files are gone', !hits.length && gone, hits.join('; '));
}

/* S06 — vendored libraries are the pinned versions ------------------------- */
{
  const three = fs.readFileSync(path.join(ROOT, 'vendor/three.r128.min.js'), 'utf8');
  const anime = fs.readFileSync(path.join(ROOT, 'vendor/anime.3.2.2.min.js'), 'utf8');
  rec('S06', 'vendor/three.r128.min.js is Three.js r128 and vendor/anime.3.2.2.min.js is Anime.js 3.2.2',
    /REVISION\s*=\s*['"]128['"]/.test(three) || /="128"/.test(three), 'three: ' + (three.match(/REVISION[^,;]{0,16}/) || ['no REVISION match'])[0] + ' | anime: ' + (anime.slice(0, 60)));
  rec('S06b', 'Anime.js banner says v3.2.2', /anime\.js v3\.2\.2/i.test(anime.slice(0, 200)), anime.slice(0, 80));
}

/* S07 — content / data invariants ----------------------------------------- */
{
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(read(ROOT, 'js/data/content.js'), ctx);
  vm.runInContext(read(ROOT, 'js/data/members.js'), ctx);
  const c = ctx.window.SiteContent, m = ctx.window.SiteMembers;
  rec('S07', 'Content: 6 pillars, 6 activities, 3-line hero heading, leadership preview of 4',
    c.pillars.items.length === 6 && c.activities.items.length === 6 && c.hero.headingLines.length === 3 && m.preview.length === 4,
    JSON.stringify({ p: c.pillars.items.length, a: c.activities.items.length, h: c.hero.headingLines.length, pv: m.preview.length }));
  /* sections[] describes the 7 hierarchy rows; the people live in SiteMembers[row.key] */
  const people = m.sections.flatMap((row) => m[row.key] || []);
  const incomplete = people.filter((x) => !(x.name && x.role && x.image)).map((x) => x.name || '(unnamed)');
  rec('S08', 'Members: 7 hierarchy rows holding 7 people, each with a name, a role and an image path',
    m.sections.length === 7 && people.length === 7 && !incomplete.length,
    'rows=' + m.sections.length + ' people=' + people.length + (incomplete.length ? ' incomplete: ' + incomplete.join(',') : ''));
  const imgs = [];
  const collect = (o) => { if (o && typeof o === 'object') { if (typeof o.image === 'string') imgs.push(o.image); Object.values(o).forEach(collect); } };
  collect(m);
  const missing = [...new Set(imgs)].filter((i) => !fs.existsSync(path.join(ROOT, i.replace(/^\.?\//, ''))));
  rec('S08b', 'Every member image path in js/data/members.js exists on disk (' + new Set(imgs).size + ' distinct)', !missing.length, missing.join(', '));
}

/* S09 — Contact page honesty + form fields -------------------------------- */
{
  const html = read(ROOT, 'contacts.html');
  const fields = ['contact-name', 'contact-email', 'contact-subject', 'contact-message'];
  const ok = fields.every((id) => new RegExp('id="' + id + '"[\\s\\S]{0,200}?required').test(html) && new RegExp('for="' + id + '"').test(html));
  rec('S09', 'Contact form keeps its 4 labelled required fields and the live status region', ok && /id="contact-status"[^>]*role="status"/.test(html));
  rec('S10', 'Contact form still says plainly that nothing is sent (no fake success message)',
    /has not been sent/.test(html) && !/(thank you|message sent|successfully)/i.test(html.split('<script>').pop()));
}

/* S11 — preservation against the Phase 1 project (optional) --------------- */
if (BASE) {
  const mustBeIdentical = ['server.js', 'package.json', 'render.yaml', 'js/data/content.js', 'js/data/members.js',
    'assets/images/logo.svg', 'assets/images/favicon.svg'];
  for (const d of ['logo', 'assets/images/members']) {
    if (fs.existsSync(path.join(BASE, d))) walk(path.join(BASE, d)).forEach((p) => mustBeIdentical.push(path.relative(BASE, p)));
  }
  const diff = mustBeIdentical.filter((f) => {
    const a = path.join(ROOT, f), b = path.join(BASE, f);
    if (!fs.existsSync(a) || !fs.existsSync(b)) return true;
    return !fs.readFileSync(a).equals(fs.readFileSync(b));
  });
  rec('S11', 'Untouched-by-design files are byte-identical to Phase 1 (' + mustBeIdentical.length + ' files: server, package, render.yaml, data, launch page, logo, member photos)', !diff.length, diff.join(', '));

  const idsOf = (root, f) => new Set([...read(root, f).matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const removed = [];
  for (const p of PAGES) { const a = idsOf(BASE, p), b = idsOf(ROOT, p); a.forEach((id) => { if (!b.has(id)) removed.push(p + '#' + id); }); }
  const intended = ['members.html#constellation-canvas', 'contacts.html#contact-canvas'];
  rec('S12', 'No element id was removed except the two empty legacy canvas slots', removed.every((r) => intended.includes(r)), 'removed: ' + removed.join(', '));

  const formOf = (root) => (read(root, 'contacts.html').match(/<form[\s\S]*?<\/form>/) || [''])[0];
  rec('S13', 'The whole <form> block on the Contact page is unchanged from Phase 1', formOf(ROOT) === formOf(BASE));

  const textOf = (root, f) => read(root, f).replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<canvas[^>]*><\/canvas>/g, '').replace(/logo\.min\.svg/g, 'logo.svg').replace(/\s+/g, ' ');
  const homeBase = textOf(BASE, 'index.html'), homeNew = textOf(ROOT, 'index.html');
  rec('S14', 'index.html markup is unchanged apart from scripts, comments and the logo file name', homeBase === homeNew);
  rec('S15', 'members.html markup is unchanged apart from scripts, comments, the removed empty canvas and the logo file name',
    textOf(BASE, 'members.html') === textOf(ROOT, 'members.html'));
  rec('S16', 'contacts.html markup is unchanged apart from scripts, comments, the removed empty canvas and the logo file name',
    textOf(BASE, 'contacts.html') === textOf(ROOT, 'contacts.html'));
}

/* report ------------------------------------------------------------------- */
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log((r.ok ? 'PASS ' : 'FAIL ') + r.id.padEnd(5) + r.name + (r.ok || !r.detail ? '' : '\n        -> ' + r.detail));
}
console.log('\n' + (results.length - failed) + '/' + results.length + ' static checks passed' + (BASE ? '' : ' (no --baseline given: preservation checks S11-S16 skipped)'));
process.exit(failed ? 1 : 0);
