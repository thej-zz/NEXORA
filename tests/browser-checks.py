#!/usr/bin/env python3
"""NEXORA browser regression checks — Playwright for Python, Chromium.

    pip install playwright && playwright install chromium
    python tests/browser-checks.py                         # all groups
    python tests/browser-checks.py --only smoke,scenes     # groups: smoke layout scenes motion failures nav shots
    python tests/browser-checks.py --base http://localhost:3000   # use a server that is already running
    python tests/browser-checks.py --gpu                   # do NOT force software WebGL (use on a real-GPU machine)

By default the script starts `node server.js` itself and forces SwiftShader (software WebGL) so that it also
runs on machines without a GPU. Software WebGL is NOT a GPU benchmark: timings it prints are labelled INFO and
must not be read as real-device performance.

Every check ends as PASS, FAIL, NOT TESTED or INCONCLUSIVE. Results: test-output/results.json
"""
import argparse, hashlib, json, os, socket, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
VIEWPORTS = [(320, 700), (360, 800), (390, 844), (414, 896), (768, 1024), (1024, 768), (1280, 800), (1440, 900), (1920, 1080)]
PAGES = ["index.html", "members.html", "contacts.html"]
SWIFT = ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
EXTERNAL = ("fonts.googleapis.com", "fonts.gstatic.com")          # unreachable inside offline sandboxes

INIT_COMMON = r"""
window.NEXORA_3D = Object.assign({ adaptive: false, allowSoftware: true }, window.NEXORA_3D || {});   // full quality, deterministic frames; software WebGL allowed so the suite runs without a GPU
(() => {
  const T = window.__nx = { contexts: 0, rafCalls: 0, marks: {}, longTasks: [] };
  const seen = new WeakSet(), gc = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...a) {
    const r = gc.call(this, type, ...a);
    if (r && /webgl/i.test(type) && !seen.has(this)) { seen.add(this); T.contexts++; T.gl = r; }
    return r;
  };
  const raf = window.requestAnimationFrame.bind(window);
  T.rafCallers = {};
  window.requestAnimationFrame = (cb) => { T.rafCalls++; const k = ((new Error().stack || '').split('\n')[2] || '').trim().replace(/^at /, '').slice(0, 90); T.rafCallers[k] = (T.rafCallers[k] || 0) + 1; return raf(cb); };
  new MutationObserver(() => {
    const c = document.documentElement.classList;
    if (!T.marks.hero3d && c.contains('nx-hero-3d')) T.marks.hero3d = performance.now();
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] });
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => T.longTasks.push(Math.round(e.duration)))).observe({ entryTypes: ['longtask'] }); } catch (e) {}
})();
"""
INIT_NO_WEBGL = """
const __gc = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (type, ...a) { if (/webgl/i.test(type)) return null; return __gc.call(this, type, ...a); };
"""
SETTLE_JS = """() => { const s = SceneRegistry.stats();
  return !s.rafPending && s.views.every(v => !v.visible || Math.abs(v.progress - v.target) < 0.0006); }"""
READY_JS = "() => document.documentElement.classList.contains('nx-hero-3d') && document.documentElement.classList.contains('nx-about-3d')"


class Results:
    def __init__(self): self.rows = []
    def add(self, cid, name, status, detail=""):
        self.rows.append(dict(id=cid, name=name, status=status, detail=detail))
        tail = f"\n              -> {detail}" if detail and status in ("FAIL", "INCONCLUSIVE") else ""
        print(f"{status:<13}{cid:<10}{name}{tail}", flush=True)
    def check(self, cid, name, ok, detail=""): self.add(cid, name, "PASS" if ok else "FAIL", detail)


class Collector:
    def __init__(self, page):
        self.errors, self.warnings, self.pageerrors, self.failed, self.bad, self.stalls, self.ext, self.texts = [], [], [], [], [], 0, 0, []
        def on_console(m):
            t = m.text
            self.texts.append(t)
            if m.type == "error":
                if "ERR_NAME_NOT_RESOLVED" in t or "ERR_INTERNET_DISCONNECTED" in t or "ERR_CONNECTION" in t: self.ext += 1
                else: self.errors.append(t[:200])
            elif m.type == "warning":
                if "GPU stall due to ReadPixels" in t: self.stalls += 1
                else: self.warnings.append(t[:200])
        page.on("console", on_console)
        page.on("pageerror", lambda e: self.pageerrors.append(str(e)[:200]))
        def on_fail(r):
            if any(h in r.url for h in EXTERNAL): self.ext += 1
            elif "net::ERR_ABORTED" not in (r.failure or "") or "/vendor/" not in r.url: self.failed.append(r.url[-90:])
        page.on("requestfailed", on_fail)
        page.on("response", lambda r: self.bad.append(f"{r.status} {r.url[-80:]}") if r.status >= 400 and not any(h in r.url for h in EXTERNAL) else None)
    def clean(self, allow_failed=False):
        return not (self.errors or self.pageerrors or self.bad or (self.failed and not allow_failed))
    def summary(self):
        return json.dumps(dict(errors=self.errors[:3], pageerrors=self.pageerrors[:3], failed=self.failed[:3], bad=self.bad[:3]))


class Runner:
    def __init__(self, browser, base, res, outdir):
        self.b, self.base, self.res, self.out = browser, base, res, outdir
        self.gpu = False
    def open(self, page_name, w, h, *, init=(), reduced=False, abort=(), ready=None, mobile=None, hash_=""):
        mobile = (w < 800) if mobile is None else mobile
        ctx = self.b.new_context(viewport={"width": w, "height": h}, device_scale_factor=1,
                                 reduced_motion="reduce" if reduced else "no-preference", is_mobile=mobile, has_touch=mobile)
        for pat in abort: ctx.route(pat, lambda r: r.abort())
        pg = ctx.new_page()
        col = Collector(pg)
        for s in (INIT_COMMON, *init): pg.add_init_script(s)
        pg.goto(f"{self.base}/{page_name}{hash_}", wait_until="load")
        if ready == "3d": pg.wait_for_function(READY_JS, timeout=90000)
        return ctx, pg, col
    def scroll(self, pg, y):
        pg.evaluate("y => window.scrollTo({ top: y, behavior: 'instant' })", int(y))
        pg.evaluate("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")
        pg.wait_for_function(SETTLE_JS, timeout=120000)
    def hash(self, pg, sel):
        return hashlib.md5(pg.evaluate("s => document.querySelector(s).toDataURL()", sel).encode()).hexdigest()[:10]
    def stats(self, pg): return pg.evaluate("SceneRegistry.stats()")
    def view(self, pg, vid):
        return next(v for v in self.stats(pg)["views"] if v["id"] == vid)


# ------------------------------------------------------------------ smoke: every page x every viewport
def group_smoke(R):
    res, rows = R.res, []
    for page in PAGES:
        for (w, h) in VIEWPORTS:
            ctx, pg, col = R.open(page, w, h, ready="3d" if page == "index.html" else None)
            time.sleep(1.2)
            d = pg.evaluate("""() => ({ ox: document.documentElement.scrollWidth - document.documentElement.clientWidth,
                ctxs: window.__nx.contexts, cls: document.documentElement.className })""")
            rows.append((page, w, h, d, col))
            ctx.close()
    bad = [f"{p}@{w}x{h}: {c.summary()}" for p, w, h, d, c in rows if not c.clean()]
    res.check("T01", f"All 3 pages load at all {len(VIEWPORTS)} viewports with no uncaught errors, console errors or failed local requests ({len(rows)} loads)", not bad, "; ".join(bad[:4]))
    ox = [f"{p}@{w}x{h}: +{d['ox']}px" for p, w, h, d, c in rows if d["ox"] > 0]
    res.check("T02", "No horizontal overflow on any page at any viewport", not ox, "; ".join(ox[:6]))
    ctxs = {p: sorted({d["ctxs"] for pp, w, h, d, c in rows if pp == p}) for p in PAGES}
    res.check("T03", "WebGL contexts created: index = exactly 1, members = 0, contacts = 0",
              ctxs["index.html"] == [1] and ctxs["members.html"] == [0] and ctxs["contacts.html"] == [0], json.dumps(ctxs))
    warn = [f"{p}@{w}x{h}: {c.warnings[:2]}" for p, w, h, d, c in rows if c.warnings]
    res.check("T04", "No console warnings from the site's own code (software-GL driver notices are counted separately)", not warn, "; ".join(warn[:3]))
    stalls = sum(c.stalls for *_, c in rows)
    res.add("T04b", "Software-GL driver notices 'GPU stall due to ReadPixels' (caused by drawImage from a software WebGL canvas; expected only without a GPU)", "INFO", f"{stalls} notices across {len(rows)} loads")


# ------------------------------------------------------------------ layout & content
def group_layout(R):
    res = R.res
    for (w, h) in [(1280, 800), (1440, 900), (1920, 1080), (1024, 768)]:
        ctx, pg, col = R.open("index.html", w, h, ready="3d")
        d = pg.evaluate("""() => { const i = document.querySelector('.hero-pin-inner'), c = document.querySelector('#hero-primary-cta'), r = c.getBoundingClientRect();
            const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return { sticky: getComputedStyle(i).position, wrap: document.querySelector('.hero-pin-wrapper').offsetHeight, vh: innerHeight,
                     innerBottom: i.getBoundingClientRect().bottom, ctaHit: !!top && (top === c || c.contains(top)),
                     h1: document.querySelector('#hero-heading').innerText.replace(/\\s+/g, ' ').trim() } }""")
        ok = d["sticky"] == "sticky" and abs(d["wrap"] - 2.8 * d["vh"]) < 4 and d["innerBottom"] <= d["vh"] + 1 and d["ctaHit"] and d["h1"] == "Building intelligence, together."
        res.check(f"L01-{w}", f"{w}x{h}: hero is pinned (280% scroll length), fits the viewport, headline intact, CTA not covered by the canvas", ok, json.dumps(d))
        ctx.close()
    for (w, h) in [(320, 700), (390, 844), (768, 1024)]:
        ctx, pg, col = R.open("index.html", w, h, ready="3d")
        d = pg.evaluate("""() => { const wr = document.querySelector('.hero-pin-wrapper'), a = document.querySelector('#about');
            return { sticky: getComputedStyle(wr.firstElementChild).position, heroBottom: wr.offsetTop + wr.offsetHeight, aboutTop: a.offsetTop, pin: document.documentElement.classList.contains('nx-pin') } }""")
        res.check(f"L02-{w}", f"{w}x{h}: hero is NOT pinned, grows with its content and never overlaps the About section", d["sticky"] != "sticky" and d["aboutTop"] >= d["heroBottom"] - 1, json.dumps(d))
        ctx.close()
    # content integrity in a real browser
    ctx, pg, col = R.open("index.html", 1440, 900, ready="3d")
    d = pg.evaluate("""() => ({ pillars: document.querySelectorAll('.pillar-card').length, acts: document.querySelectorAll('.activity-card').length,
        preview: document.querySelectorAll('#member-preview-grid .member-card').length, about: document.querySelectorAll('#about-body p').length,
        sections: ['hero-heading','about-heading','pillars-heading','activities-heading','preview-heading','about','pillars','activities'].filter(i => !document.getElementById(i)),
        cta: document.querySelector('#preview-cta').getAttribute('href') })""")
    res.check("C01", "Home: 6 pillars, 6 activities, 4 leadership cards, 2 About paragraphs, all section ids present, members link intact",
              d["pillars"] == 6 and d["acts"] == 6 and d["preview"] == 4 and d["about"] >= 2 and not d["sections"] and d["cta"] == "members.html", json.dumps(d))
    ctx.close()
    ctx, pg, col = R.open("members.html", 1440, 900)
    pg.wait_for_selector(".mp-card")
    for yy in range(0, 3600, 450): pg.evaluate("y => window.scrollTo({ top: y, behavior: 'instant' })", yy); time.sleep(0.25)   # photos are loading="lazy"
    time.sleep(1.0)
    d = pg.evaluate("""() => ({ cards: document.querySelectorAll('.mp-card').length, imgs: [...document.querySelectorAll('.mp-card img')].filter(i => i.complete && i.naturalWidth > 0).length,
        names: [...document.querySelectorAll('.mp-card')].map(c => (c.querySelector('h3,h2,.mp-name') || c).innerText.split('\\n')[0].trim()) })""")
    res.check("C02", "Members: exactly 7 member cards render, each with a loaded photo", d["cards"] == 7 and d["imgs"] == 7, json.dumps(d))
    ctx.close()
    ctx, pg, col = R.open("contacts.html", 1440, 900)
    pg.fill("#contact-name", "Test"); pg.fill("#contact-email", "t@example.com"); pg.fill("#contact-subject", "Hi"); pg.fill("#contact-message", "Hello")
    pg.click(".contact-submit")
    msg = pg.inner_text("#contact-status")
    res.check("C03", "Contact: submitting still reports honestly that nothing was sent (no fake success)", "has not been sent" in msg and "thank" not in msg.lower(), msg[:120])
    res.check("C04", "Contact: 4 required fields + submit present and the page has no console errors", pg.evaluate("document.querySelectorAll('#contact-form [required]').length") == 4 and col.clean(), col.summary())
    ctx.close()


# ------------------------------------------------------------------ the two 3D chapters
def group_scenes(R):
    res = R.res
    ctx, pg, col = R.open("index.html", 1440, 900, ready="3d")
    time.sleep(1.0)
    st = R.stats(pg)
    res.check("S-01", "One WebGL context for both chapters (hero robot + About processor); both scenes rendered", st["contexts"] == 1 and len(st["views"]) == 2 and all(v["rendered"] for v in st["views"]), json.dumps(st["views"]))
    pg.wait_for_function("() => ['#hero-eyebrow', '#hero-body', '.hero-actions'].every(s => !document.querySelector(s).getAttribute('style'))", timeout=30000)
    time.sleep(1.0)                                                      # the hero entrance (Anime.js) has finished
    f0 = R.stats(pg)["frames"]; r0 = pg.evaluate("window.__nx.rafCalls"); c0 = pg.evaluate("JSON.stringify(window.__nx.rafCallers)"); time.sleep(1.5)
    st2 = R.stats(pg); r1 = pg.evaluate("window.__nx.rafCalls"); c1 = json.loads(pg.evaluate("JSON.stringify(window.__nx.rafCallers)")); c0 = json.loads(c0)
    who = {k: c1[k] - c0.get(k, 0) for k in c1 if c1[k] - c0.get(k, 0) > 0}
    res.check("S-02", "Idle = zero work: once the entrance has played, no requestAnimationFrame callbacks and no engine frames while nothing changes (no permanent loop)", st2["frames"] == f0 and r1 == r0 and not st2["rafPending"], f"frames {f0}->{st2['frames']}, rAF calls {r0}->{r1}, callers: {who}")

    # deterministic, reversible mapping (hero, pinned)
    geo = pg.evaluate("() => { const w = document.querySelector('.hero-pin-wrapper'); return { top: w.offsetTop, total: w.offsetHeight - innerHeight } }")
    fr = [0.2, 0.55, 0.9]; down = {}; bad_map = []
    for f in fr:
        R.scroll(pg, geo["top"] + geo["total"] * f); v = R.view(pg, "intelligenceField")
        down[f] = R.hash(pg, "#hero-canvas")
        if abs(v["progress"] - f) > 0.01: bad_map.append((f, v["progress"]))
    R.scroll(pg, geo["top"] + geo["total"] * 1.0)
    up = {}
    for f in reversed(fr):
        R.scroll(pg, geo["top"] + geo["total"] * f); up[f] = R.hash(pg, "#hero-canvas")
    res.check("S-03", "Hero progress equals scroll position through the pinned range (0.2 / 0.55 / 0.9 within 0.01)", not bad_map, str(bad_map))
    res.check("S-04", "Hero is deterministic and reversible: the same scroll position gives the identical frame after scrolling down, to the end and back up", down == up and len(set(down.values())) == 3, f"down={down} up={up}")

    # fast scroll: jump around, final state must still equal the scroll target
    for y in [0, geo["top"] + geo["total"], 200, geo["top"] + geo["total"] * 0.9, 50, geo["top"] + geo["total"] * 0.2]:
        pg.evaluate("y => window.scrollTo({ top: y, behavior: 'instant' })", int(y)); time.sleep(0.05)
    R.scroll(pg, geo["top"] + geo["total"] * 0.55); fast = R.hash(pg, "#hero-canvas")
    res.check("S-05", "Fast, jumpy scrolling (6 jumps in <0.5s) converges to exactly the same frame as slow scrolling to the same position", fast == down[0.55], f"fast={fast} slow={down[0.55]}")

    # About chapter
    # offsetTop chain, like the engine: unaffected by the 18px translate a not-yet-revealed .reveal block still carries
    ab = pg.evaluate("() => { const e = document.querySelector('#about-visual'); let y = 0, n = e; while (n) { y += n.offsetTop; n = n.offsetParent; } return { top: y, h: e.offsetHeight } }")
    def about_at(p):                       # scroll so that the visual's section progress == p
        y = ab["top"] + ab["h"] / 2 - 900 * (1 - p); R.scroll(pg, y); return R.view(pg, "dataCore")["progress"]   # p = where the panel CENTRE is on screen
    got = {p: about_at(p) for p in (0.05, 0.3, 0.5, 0.95)}
    tags = {}
    for p in (0.05, 0.5, 0.95):
        about_at(p); tags[p] = pg.evaluate("[...document.querySelectorAll('.stack-tag')].map(t => +getComputedStyle(t).opacity)")
    hs = {p: (about_at(p), R.hash(pg, "#about-canvas"))[1] for p in (0.05, 0.5, 0.95)}
    res.check("S-06", "About: chapter progress follows scroll (centre of the panel at 5% / 30% / 50% / 95% of the viewport height, within 0.02)", all(abs(g - p) < 0.02 for p, g in got.items()), json.dumps(got))
    res.check("S-07", "About: assembled when entering (p0.05), exploded while it is read (p0.5, panel centred), assembled again as it leaves (p0.95) — the exploded frame differs from both",
              hs[0.05] != hs[0.5] and hs[0.95] != hs[0.5], json.dumps(hs))
    res.check("S-08", "About: the four layer tags are hidden when assembled, fully visible when exploded", all(o < 0.05 for o in tags[0.05]) and all(o > 0.9 for o in tags[0.5]) and all(o < 0.05 for o in tags[0.95]), json.dumps(tags))
    texts = pg.evaluate("[...document.querySelectorAll('.stack-tag')].map(t => t.innerText.replace(/\\s+/g, ' ').trim())")
    svg = pg.evaluate("[...document.querySelectorAll('.stack-labels text')].map(t => t.textContent.replace(/\\s+/g, ' ').trim())")
    res.check("S-09", "About: the DOM tags carry the same four layer names as the SVG fallback (04 LID / 03 DIE / 02 INTERPOSER / 01 SUBSTRATE)", texts == svg and len(texts) == 4, f"{texts} vs {svg}")

    # off-screen: nothing renders while neither chapter is visible
    far = pg.evaluate("document.querySelector('#activities').offsetTop")
    R.scroll(pg, far); time.sleep(0.5)
    s1 = R.stats(pg)
    for dy in (40, 90, 140): pg.evaluate("y => window.scrollTo({ top: y, behavior: 'instant' })", int(far + dy)); time.sleep(0.25)
    s2 = R.stats(pg)
    res.check("S-10", "Off-screen pause: both chapters are marked not visible and scrolling elsewhere renders zero frames", all(not v["visible"] for v in s1["views"]) and s2["renders"] == s1["renders"], f"renders {s1['renders']}->{s2['renders']} visible={[v['visible'] for v in s1['views']]}")

    # hidden tab
    R.scroll(pg, 0)
    pg.evaluate("""() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); }""")
    h0 = R.stats(pg)["renders"]
    pg.evaluate("window.scrollTo({ top: 600, behavior: 'instant' })"); time.sleep(0.8)
    h1 = R.stats(pg)["renders"]
    pg.evaluate("""() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); }""")
    pg.evaluate("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))"); pg.wait_for_function(SETTLE_JS, timeout=120000)
    h2 = R.stats(pg); v = R.view(pg, "intelligenceField")
    res.check("S-11", "Hidden-tab pause: no rendering while hidden, clean resume and correct state when visible again", h1 == h0 and h2["renders"] > h1 and abs(v["progress"] - v["target"]) < 0.001 and v["target"] > 0, f"renders hidden {h0}->{h1}, after {h2['renders']}, hero p={v['progress']}")

    # resize while active
    R.scroll(pg, geo["top"] + geo["total"] * 0.4)
    sizes = []
    for (w, h) in [(1000, 700), (390, 844), (1440, 900)]:
        pg.set_viewport_size({"width": w, "height": h}); time.sleep(0.8)
        pg.wait_for_function(SETTLE_JS, timeout=120000)
        v = R.view(pg, "intelligenceField"); sizes.append((w, v["w"], v["h"]))
    res.check("S-12", "Resize while active: the scene canvas follows the viewport (1000 -> 390 -> 1440 wide) and keeps rendering", [s[1] for s in sizes] == [1000, 390, 1440], str(sizes))

    # duplicate mount, teardown
    n0 = len([t for t in col.texts if "already mounted" in t])
    dup = pg.evaluate("() => { const h = SceneRegistry.mount('dataCore', document.querySelector('#about-canvas')); return { same: !!h && h.id === 'dataCore', ctxs: SceneRegistry.stats().contexts, views: SceneRegistry.stats().views.length } }")
    n1 = len([t for t in col.texts if "already mounted" in t])
    res.check("S-13", "Mounting a scene twice is ignored (same handle, still 1 context, 2 views) and logged", dup["same"] and dup["ctxs"] == 1 and dup["views"] == 2 and n1 == n0 + 1, json.dumps(dup))
    pre = pg.evaluate("SceneRegistry.stats().listeners")
    pg.evaluate("SceneRegistry.disposeAll()"); time.sleep(0.4)
    d = pg.evaluate("""() => ({ s: SceneRegistry.stats(), tags: document.querySelectorAll('.stack-tags').length,
        cls: ['nx-hero-3d', 'nx-about-3d'].filter(c => document.documentElement.classList.contains(c)),
        dial: getComputedStyle(document.querySelector('.hero-visual')).visibility })""")
    pg.evaluate("window.scrollTo({ top: 800, behavior: 'instant' })"); time.sleep(0.3)
    res.check("S-14", "Teardown releases everything: 0 contexts, 0 views, 0 listeners (was %d), DOM tags removed, fallbacks restored, scrolling afterwards is harmless" % pre,
              d["s"]["contexts"] == 0 and not d["s"]["views"] and d["s"]["listeners"] == 0 and d["tags"] == 0 and not d["cls"] and col.pageerrors == [], json.dumps(d)[:300])
    res.check("S-15", "No uncaught exceptions or console errors during the whole scene session", col.clean(), col.summary())
    ctx.close()

    # context loss / restore
    ctx, pg, col = R.open("index.html", 1440, 900, ready="3d")
    pg.evaluate("() => { window.__nx.ext = window.__nx.gl.getExtension('WEBGL_lose_context'); window.__nx.ext.loseContext(); }"); time.sleep(0.6)
    lost = pg.evaluate("({ lost: SceneRegistry.stats().lost, hero: document.documentElement.classList.contains('nx-hero-3d'), about: document.documentElement.classList.contains('nx-about-3d') })")
    pg.evaluate("window.__nx.ext.restoreContext()")
    def came_back(cls):
        try: pg.wait_for_function("c => document.documentElement.classList.contains(c)", arg=cls, timeout=60000); return True
        except Exception: return False
    hero_back = came_back("nx-hero-3d")                      # visible scene: redrawn straight away
    pg.evaluate("document.querySelector('#about-visual').scrollIntoView({ block: 'center', behavior: 'instant' })")
    about_back = came_back("nx-about-3d")                    # off-screen scenes are drawn when they scroll into view
    stale = [t for t in col.warnings if "INVALID_OPERATION" in t]
    res.check("S-16", "WebGL context loss: static illustrations return at once; after restore the hero redraws immediately and the About scene redraws when scrolled into view; no stale-handle GL warnings",
              lost["lost"] and not lost["hero"] and not lost["about"] and hero_back and about_back and col.pageerrors == [] and not stale,
              json.dumps(lost) + f" hero_back={hero_back} about_back={about_back} stale_gl_warnings={len(stale)}")
    ctx.close()

    # informational timings (software WebGL!)
    ctx, pg, col = R.open("index.html", 1440, 900, ready="3d")
    t = pg.evaluate("""() => { const n = performance.getEntriesByType('navigation')[0]; return { dcl: Math.round(n.domContentLoadedEventEnd), ready: Math.round(window.__nx.marks.hero3d), long: window.__nx.longTasks } }""")
    res.add("P-01", "Scene start-up in this environment (DOMContentLoaded -> hero scene drawn) — SOFTWARE WebGL, not a GPU measurement", "INFO", f"DCL {t['dcl']} ms, hero drawn at {t['ready']} ms, long tasks during load (ms): {t['long']}")
    ctx.close()


# ------------------------------------------------------------------ interface motion (Anime.js)
def group_motion(R):
    res = R.res
    ctx, pg, col = R.open("index.html", 1440, 900, ready="3d")
    time.sleep(3.0)
    d = pg.evaluate("""() => ({ anime: document.documentElement.classList.contains('nx-anime'),
        hero: ['#hero-eyebrow', '#hero-heading > span:first-child', '#hero-body', '.hero-actions'].map(s => +getComputedStyle(document.querySelector(s)).opacity),
        inline: ['#hero-eyebrow', '#hero-body', '.hero-actions'].map(s => document.querySelector(s).getAttribute('style') || '') })""")
    res.check("M-01", "Hero entrance (Anime.js timeline) completes: all pieces fully visible and no inline opacity/transform left behind", d["anime"] and all(o == 1 for o in d["hero"]) and all(not s for s in d["inline"]), json.dumps(d))
    h = R.view(pg, "intelligenceField")["progress"]
    res.check("M-02", "Anime.js never touches the 3D state: hero progress is still exactly the scroll position (0 at the top)", h == 0, str(h))
    y = pg.evaluate("document.querySelector('#pillars').offsetTop")
    pg.evaluate("y => window.scrollTo({ top: y, behavior: 'instant' })", y)
    pg.wait_for_function("[...document.querySelectorAll('.pillar-card')].every(c => c.classList.contains('is-visible'))", timeout=30000)
    time.sleep(1.4)
    d = pg.evaluate("""() => ({ op: [...document.querySelectorAll('.pillar-card')].map(c => +getComputedStyle(c).opacity),
        tr: [...document.querySelectorAll('.pillar-card')].map(c => c.style.transition + c.style.opacity + c.style.transform) })""")
    res.check("M-03", "Pillar cards reveal in a stagger and settle fully visible with their inline motion styles cleared (hover transitions intact)", all(o == 1 for o in d["op"]) and all(t == "" for t in d["tr"]), json.dumps(d))
    ctx.close()

    ctx, pg, col = R.open("members.html", 1440, 900); pg.wait_for_selector(".mp-card"); time.sleep(0.5)
    for yy in range(0, 3000, 500): pg.evaluate("y => window.scrollTo({ top: y, behavior: 'instant' })", yy); time.sleep(0.6)
    time.sleep(1.2)
    d = pg.evaluate("({ anime: document.documentElement.classList.contains('nx-anime'), vis: [...document.querySelectorAll('.mp-card')].filter(c => c.classList.contains('is-visible') && +getComputedStyle(c).opacity === 1).length, total: document.querySelectorAll('.mp-card').length })")
    res.check("M-04", "Members: all 7 cards reveal through the shared Anime.js layer and end fully visible", d["anime"] and d["vis"] == 7 and d["total"] == 7 and col.clean(), json.dumps(d) + col.summary())
    ctx.close()
    ctx, pg, col = R.open("contacts.html", 1440, 900); time.sleep(3.0)
    probe = "() => [...document.querySelectorAll('.reveal')].map(e => ({ op: +getComputedStyle(e).opacity, top: e.getBoundingClientRect().top + scrollY }))"
    first = pg.evaluate(probe)
    for yy in range(0, 2400, 300): pg.evaluate("y => window.scrollTo({ top: y, behavior: 'instant' })", yy); time.sleep(0.5)
    time.sleep(1.2); after = pg.evaluate(probe)
    above = [x for x in first if x["top"] < 780]
    res.check("M-05", "Contact: reveals run through Anime.js — everything above the fold is visible on load, the rest reveals on scroll, and all %d blocks end fully visible" % len(after),
              pg.evaluate("document.documentElement.classList.contains('nx-anime')") and above and all(x["op"] == 1 for x in above) and any(x["op"] < 1 for x in first) and all(x["op"] == 1 for x in after) and col.pageerrors == [],
              json.dumps(dict(on_load=[round(x["op"], 2) for x in first], after_scroll=[round(x["op"], 2) for x in after])))
    ctx.close()

    # Anime.js unavailable -> the CSS reveals take over, the 3D still works
    ctx, pg, col = R.open("index.html", 1440, 900, abort=("**/vendor/anime*.js",), ready="3d")
    time.sleep(1.2)
    pg.evaluate("window.scrollTo({ top: document.querySelector('#pillars').offsetTop, behavior: 'instant' })")
    pg.wait_for_function("[...document.querySelectorAll('.pillar-card')].every(c => c.classList.contains('is-visible'))", timeout=30000); time.sleep(1.2)
    d = pg.evaluate("""() => ({ anime: document.documentElement.classList.contains('nx-anime'), hero: +getComputedStyle(document.querySelector('#hero-heading')).opacity,
        cards: [...document.querySelectorAll('.pillar-card')].map(c => +getComputedStyle(c).opacity) })""")
    res.check("M-06", "Anime.js blocked: no nx-anime class, hero copy visible, CSS reveals still work, 3D scenes still run", not d["anime"] and d["hero"] == 1 and all(o == 1 for o in d["cards"]) and col.pageerrors == [], json.dumps(d))
    ctx.close()


# ------------------------------------------------------------------ failure modes & reduced motion
def group_failures(R):
    res = R.res
    def fallback_ok(pg, col, label):
        time.sleep(1.5)
        d = pg.evaluate("""() => { const wr = document.querySelector('.hero-pin-wrapper');
            return { pin: document.documentElement.classList.contains('nx-pin'), hero3d: document.documentElement.classList.contains('nx-hero-3d'),
              wrap: wr.offsetHeight, vh: innerHeight, dial: getComputedStyle(document.querySelector('.hero-visual')).opacity,
              h1: document.querySelector('#hero-heading') ? document.querySelector('#hero-heading').innerText.replace(/\\s+/g, ' ').trim() : '',
              loader: getComputedStyle(document.querySelector('.loader')).visibility, ctxs: window.__nx ? window.__nx.contexts : -1 } }""")
        return d
    ctx, pg, col = R.open("index.html", 1440, 900, init=(INIT_NO_WEBGL,)); d = fallback_ok(pg, col, "nowebgl")
    res.check("F-01", "WebGL unavailable: hero un-pinned, static illustration visible, headline readable, loader gone, no exceptions", not d["pin"] and not d["hero3d"] and d["wrap"] <= d["vh"] + 2 and d["dial"] == "1" and d["h1"] == "Building intelligence, together." and d["loader"] == "hidden" and col.pageerrors == [] and d["ctxs"] == 0, json.dumps(d))
    ctx.close()
    ctx, pg, col = R.open("index.html", 1440, 900, abort=("**/vendor/three*.js",)); d = fallback_ok(pg, col, "nothree")
    res.check("F-02", "Three.js fails to load: same graceful fallback, page fully usable, no uncaught exceptions", not d["pin"] and not d["hero3d"] and d["dial"] == "1" and d["h1"] == "Building intelligence, together." and col.pageerrors == [], json.dumps(d) + col.summary())
    ctx.close()
    ctx, pg, col = R.open("index.html", 1440, 900, abort=("**/js/main.js",)); time.sleep(6.8)
    d = pg.evaluate("""() => ({ js: document.documentElement.classList.contains('js'), pin: document.documentElement.classList.contains('nx-pin'),
        loader: (s => s.opacity + '/' + s.pointerEvents)(getComputedStyle(document.querySelector('.loader'))), footer: document.querySelector('footer').offsetHeight > 0 })""")
    res.check("F-03", "main.js fails to run: after the head/CSS failsafes the page drops html.js/nx-pin and the loader is transparent and click-through (never permanently blank or blocked)", not d["js"] and not d["pin"] and float(d["loader"].split("/")[0]) < 0.001 and d["loader"].endswith("/none") and d["footer"], json.dumps(d))
    ctx.close()

    # default policy: software-only WebGL is refused (needs SwiftShader, so only meaningful without --gpu)
    ctx, pg, col = R.open("index.html", 1440, 900, init=("window.NEXORA_3D = { adaptive: false, allowSoftware: false };",)); d = fallback_ok(pg, col, "software")
    if R.gpu:
        res.add("F-06", "Software-only WebGL is refused by default (static illustrations instead of a multi-second freeze)", "NOT TESTED", "run without --gpu: this check needs a software-only renderer")
    else:
        res.check("F-06", "Software-only WebGL (no GPU) is refused by default: hero un-pinned, static illustration kept, headline readable, no WebGL context created, no errors",
                  not d["pin"] and not d["hero3d"] and d["dial"] == "1" and d["h1"] == "Building intelligence, together." and col.pageerrors == [] and col.errors == [] and d["ctxs"] == 0, json.dumps(d) + col.summary())
    ctx.close()

    ctx, pg, col = R.open("index.html", 1440, 900, reduced=True, ready="3d"); time.sleep(1.0)
    d = pg.evaluate("""() => ({ cls: document.documentElement.className, wrap: document.querySelector('.hero-pin-wrapper').offsetHeight, vh: innerHeight,
        sticky: getComputedStyle(document.querySelector('.hero-pin-inner')).position, stats: SceneRegistry.stats(), dial: getComputedStyle(document.querySelector('.hero-visual')).visibility })""")
    f0 = d["stats"]["frames"]; r0 = d["stats"]["renders"]; pg.evaluate("window.scrollTo({ top: 700, behavior: 'instant' })"); time.sleep(0.8); f1 = pg.evaluate("SceneRegistry.stats()")
    static = all(v["static"] for v in d["stats"]["views"]) and f1["frames"] == f0 and f1["renders"] == r0
    res.check("F-04", "Reduced motion: hero not pinned, no Anime class, both scenes rendered ONCE in a static state (no scroll link, no loop), SVG fallbacks hidden behind them",
              "nx-pin" not in d["cls"] and "nx-anime" not in d["cls"] and d["sticky"] != "sticky" and d["wrap"] <= d["vh"] + 2 and static and d["stats"]["contexts"] == 1, json.dumps(d)[:420])
    h = pg.evaluate("[...document.querySelectorAll('.reveal')].filter(e => +getComputedStyle(e).opacity < 1).length")
    res.check("F-05", "Reduced motion: every .reveal block is visible without animation", h == 0, str(h))
    ctx.close()


# ------------------------------------------------------------------ navigation, keyboard, resilience of position
def group_nav(R):
    res = R.res
    ctx, pg, col = R.open("index.html", 390, 844, ready="3d"); time.sleep(0.8)
    t = pg.locator(".nav-toggle"); t.click(); time.sleep(0.4)
    o = pg.evaluate("({ exp: document.querySelector('.nav-toggle').getAttribute('aria-expanded'), menu: document.querySelector('.mobile-menu').classList.contains('is-open'), ov: document.body.style.overflow })")
    pg.keyboard.press("Escape"); time.sleep(0.4)
    c = pg.evaluate("({ exp: document.querySelector('.nav-toggle').getAttribute('aria-expanded'), ov: document.body.style.overflow, focus: document.activeElement.className })")
    res.check("N-01", "Mobile menu (390 wide) opens, locks scroll, closes on Escape and returns focus while the 3D scene is running", o["exp"] == "true" and o["menu"] and o["ov"] == "hidden" and c["exp"] == "false" and c["ov"] == "" and "nav-toggle" in c["focus"], json.dumps([o, c]))
    ctx.close()
    ctx, pg, col = R.open("index.html", 1440, 900, ready="3d"); time.sleep(2.5)
    pg.keyboard.press("Tab"); first = pg.evaluate("document.activeElement.className")
    n, found = 0, False
    while n < 14 and not found:
        pg.keyboard.press("Tab"); n += 1
        found = pg.evaluate("document.activeElement.id === 'hero-primary-cta'")
    ring = pg.evaluate("(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle + ' ' + s.outlineWidth + ' | ' + s.boxShadow.slice(0, 40) })()") if found else "n/a"
    res.check("N-02", "Keyboard: the skip link is first, the hero CTA is reachable by Tab while the canvas is present, and it shows a visible focus indicator", "skip" in first and found and "none 0px" not in ring.split("|")[0], f"first={first} tabs={n} ring={ring}")
    pg.keyboard.press("Enter"); time.sleep(1.5)
    res.check("N-03", "Hero CTA activates from the keyboard and navigates to #about (canvas does not swallow input)", pg.evaluate("location.hash") == "#about", pg.evaluate("location.hash"))
    ctx.close()

    ctx, pg, col = R.open("index.html", 1440, 900, ready="3d")
    y = 1300; R.scroll(pg, y); pg.reload(wait_until="load"); pg.wait_for_function(READY_JS, timeout=90000); time.sleep(0.6)
    v = R.view(pg, "intelligenceField"); geo = pg.evaluate("() => { const w = document.querySelector('.hero-pin-wrapper'); return { top: w.offsetTop, total: w.offsetHeight - innerHeight, y: scrollY } }")
    exp = (geo["y"] - geo["top"]) / geo["total"]
    res.check("N-04", "Reload at a non-zero scroll position: the scene opens directly in the right state (no catch-up from zero), no errors", abs(v["progress"] - exp) < 0.01 and v["progress"] > 0.2 and col.pageerrors == [], f"scrollY={geo['y']} expected={exp:.3f} got={v['progress']}")
    ctx.close()
    ctx, pg, col = R.open("index.html", 1440, 900, ready="3d", hash_="#about"); time.sleep(3.0)
    d = pg.evaluate("() => { const r = document.querySelector('#about-visual').getBoundingClientRect(); return { vis: r.top < innerHeight && r.bottom > 0, y: scrollY, stats: SceneRegistry.stats().views.map(v => [v.id, v.visible, v.rendered]) } }")
    res.check("N-05", "Opening directly at #about: the About chapter is on screen and rendering, the hero is not", d["vis"] and d["y"] > 1000 and any(x[0] == "dataCore" and x[1] and x[2] for x in d["stats"]) and col.pageerrors == [], json.dumps(d))
    ctx.close()
    ctx, pg, col = R.open("index.html", 1440, 900, ready="3d"); time.sleep(0.8)
    pg.click("a[href='members.html'].nav-cta, .nav-links a[href='members.html']", timeout=10000); pg.wait_for_url("**/members.html", timeout=20000); pg.wait_for_selector(".mp-card")
    pg.go_back(wait_until="load"); time.sleep(1.5)
    d = pg.evaluate("() => ({ url: location.pathname, overlay: document.querySelector('.page-transition').classList.contains('is-active'), ctxs: SceneRegistry ? SceneRegistry.stats().contexts : -1, views: SceneRegistry.stats().views.length })")
    res.check("N-06", "Back/Forward: returning to the home page leaves no stuck transition overlay and the shared engine is alive (1 context, 2 views)", d["url"].endswith("index.html") or d["url"] == "/" and not d["overlay"] and d["ctxs"] == 1 and d["views"] == 2, json.dumps(d))
    ctx.close()


# ------------------------------------------------------------------ screenshots used as delivery evidence
def group_shots(R):
    res, out = R.res, Path(R.out) / "screenshots"; out.mkdir(parents=True, exist_ok=True)
    ctx, pg, col = R.open("index.html", 1440, 900, ready="3d"); time.sleep(3.2)
    geo = pg.evaluate("() => { const w = document.querySelector('.hero-pin-wrapper'); return { top: w.offsetTop, total: w.offsetHeight - innerHeight } }")
    pg.screenshot(path=str(out / "01-hero-initial-1440x900.png"))
    R.scroll(pg, geo["total"] * 0.52); pg.screenshot(path=str(out / "02-hero-mid-scroll-grip-1440x900.png"))
    R.scroll(pg, geo["total"] * 1.0); pg.screenshot(path=str(out / "03-hero-end-presenting-1440x900.png"))
    ab = pg.evaluate("() => { const e = document.querySelector('#about-visual'); let y = 0, n = e; while (n) { y += n.offsetTop; n = n.offsetParent; } return { top: y, h: e.offsetHeight } }")
    for name, p in (("04-about-assembled-entering", 0.12), ("05-about-exploded-reading", 0.50), ("06-about-reassembled-leaving", 0.90)):
        R.scroll(pg, ab["top"] + ab["h"] / 2 - 900 * (1 - p)); time.sleep(0.4); pg.screenshot(path=str(out / f"{name}-1440x900.png"))
    ctx.close()
    ctx, pg, col = R.open("members.html", 1440, 900); pg.wait_for_selector(".mp-card"); time.sleep(0.6)
    for yy in range(0, 3200, 400): pg.evaluate("y => window.scrollTo({ top: y, behavior: 'instant' })", yy); time.sleep(0.35)
    pg.evaluate("window.scrollTo({ top: 0, behavior: 'instant' })"); time.sleep(0.8); pg.screenshot(path=str(out / "07-members-1440x900.png"))
    ctx.close()
    ctx, pg, col = R.open("contacts.html", 1440, 900); time.sleep(2.5); pg.screenshot(path=str(out / "08-contact-1440x900.png")); ctx.close()
    ctx, pg, col = R.open("index.html", 390, 844, ready="3d"); time.sleep(3.0); pg.screenshot(path=str(out / "09-mobile-hero-390x844.png"))
    ab = pg.evaluate("() => { const e = document.querySelector('#about-visual'); return e.getBoundingClientRect().top + scrollY - (innerHeight - e.offsetHeight) / 2 }")
    R.scroll(pg, ab); time.sleep(0.5); pg.screenshot(path=str(out / "10-mobile-about-390x844.png")); ctx.close()
    res.add("E-01", f"Screenshots written to {out}", "INFO", "10 images (hero initial/mid/end, About assembled/exploded/reassembled, Members, Contact, mobile hero + About)")


GROUPS = dict(smoke=group_smoke, layout=group_layout, scenes=group_scenes, motion=group_motion, failures=group_failures, nav=group_nav, shots=group_shots)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default=",".join(GROUPS)); ap.add_argument("--base", default=""); ap.add_argument("--gpu", action="store_true")
    ap.add_argument("--out", default=str(ROOT / "test-output")); a = ap.parse_args()
    proc = None; base = a.base
    if not base:
        s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
        proc = subprocess.Popen(["node", "server.js"], cwd=ROOT, env=dict(os.environ, PORT=str(port)), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        base = f"http://127.0.0.1:{port}"; time.sleep(1.2)
    res = Results(); Path(a.out).mkdir(parents=True, exist_ok=True)
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(args=[] if a.gpu else SWIFT)
            R = Runner(b, base, res, a.out); R.gpu = a.gpu
            for g in a.only.split(","):
                print(f"\n=== {g} ===", flush=True)
                try: GROUPS[g](R)
                except Exception as e: res.add(f"{g}-ERR", f"group '{g}' aborted by an exception", "INCONCLUSIVE", repr(e)[:400])
            b.close()
    finally:
        if proc: proc.terminate()
    tally = {}
    for r in res.rows: tally[r["status"]] = tally.get(r["status"], 0) + 1
    print("\nSUMMARY", json.dumps(tally))
    path = Path(a.out) / f"results-{'-'.join(a.only.split(','))[:40]}.json"
    path.write_text(json.dumps(dict(summary=tally, results=res.rows, software_webgl=not a.gpu), indent=1))
    sys.exit(1 if tally.get("FAIL") or tally.get("INCONCLUSIVE") else 0)


if __name__ == "__main__":
    main()
