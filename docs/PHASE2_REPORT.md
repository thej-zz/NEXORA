# NEXORA — Phase 2 implementation & verification report

Shared cinematic 3D engine, original robotic-intelligence Hero, exploded-processor About,
Anime.js interface motion. Source of truth: the uploaded Phase 1 ZIP (the Phase 1 report was
**not** attached, so every Phase 1 baseline below is my own measurement of that ZIP).

## 1. Result in one paragraph

Both 3D chapters are real, procedural Three.js scenes drawn by **one** WebGL renderer in **one**
context with **one** on-demand animation loop. The Hero plays a six-axis arm unfolding, gripping a data
module, lifting and presenting it; the About opens a four-layer processor while it is read and closes it as
the panel leaves. State is a pure function of scroll progress (identical frames when scrolling down, to the
end and back up). Members and Contact create no WebGL context. Everything that was required to stay intact
is byte-identical or proven unchanged. **Verification: 18/18 static checks and 49/49 browser checks pass
(0 fail, 0 inconclusive), plus 3 INFO measurements — all on software WebGL in Chromium only; nothing was
tested on a real GPU, real phone, Safari or Firefox** (§8).

## 2. What the audit found (before touching anything)

- The ZIP contained a Git repo (`main`, HEAD `cd2d640 phase 1 updation`). `git status` listed 4 modified
  files; `git diff --ignore-space-at-eol` is empty, so they are **line-ending differences only**. I recorded
  that state as a checkpoint commit on branch `phase-2-cinematic-engine` (in my working copy) and kept the
  untouched ZIP as the rollback point.
- Phase 1 had already disabled the legacy scenes (their script tags were commented out), left `#hero-canvas`
  / `#about-canvas` and static SVG fallbacks in place, and a 100svh `.hero-pin-wrapper` as the attachment point.
- The main site had **no Anime.js**; only `logo/launch.html` has it (v3.2.2 via CDN, with Three.js r162 as an
  ES module). The old main-site scenes used Three.js r128 (UMD) from unpkg.
- `js/data/brand.js` still held a cyan/violet pair that matched neither the logo nor the CSS tokens.
- `constellation.js`, `members-scene.js`, `contact-scene.js` were referenced only from HTML comments, README
  text and comments (repo-wide search) → deleted. Members/Contact only had two **empty** `<canvas>` slots.
- The hero wrapper had a fixed height, which makes the hero overlap the next section whenever its copy is
  taller than the viewport (reproduced at 320×700: 798 px of content in a 700 px box).

## 3. Decisions

| Topic | Decision | Why |
|---|---|---|
| Three.js | **r128 UMD, vendored** in `vendor/` (MIT licence file included) | Already the project's version; newer releases are not a CDN-URL swap (module builds) and there is no bundler. Provides PBR, PMREM, instancing, `setViewOffset`. |
| Anime.js | **3.2.2 UMD, vendored** | One version on the main site; same as the launch page (which keeps its own copy, untouched). v3/v4 never mixed. |
| Loading | `defer` scripts in dependency order | Off the critical path; run before `DOMContentLoaded` where `main.js` starts. |
| Renderer | One detached GL canvas, each scene drawn into a region and copied (`drawImage`) into the visible canvas in its section | One context, and the visible canvases scroll with the page compositor (a fixed full-screen canvas would lag the DOM on fast scrolls). |
| Loop | Scheduled on demand; stops when all visible scenes settle | "No permanent idle loop". Verified: 0 rAF callbacks when idle (S-02). |
| Hero progress | Sticky pin, 280% scroll length (≥900×620); otherwise first 70% of the hero's own height | Pinning on phones would trap the CTAs below the fold. |
| About progress | Panel **centre** position in the viewport | See §6 item 1 — the first mapping hid the re-assembly. |
| Reduced motion | Each scene rendered **once** in a static state; no pin, no Anime | Brief: "set scenes to useful static states". |
| Software-only WebGL | **Refused by default** (`failIfMajorPerformanceCaveat`) → static illustrations | First frame measured 7.6 s (hero) + 1.5 s (About) on a CPU rasterizer. Override `NEXORA_3D.allowSoftware`. |
| Logo | New `logo.min.svg` (−41.5 %) referenced; original untouched | §7. |
| Members/Contact | No WebGL, Anime reveals only; two empty canvas slots and their CSS removed | Brief. |

## 4. Files

**Added** — `vendor/three.r128.min.js` (+ licence), `vendor/anime.3.2.2.min.js` (+ licence),
`assets/images/logo.min.svg`, `tests/static-checks.js`, `tests/browser-checks.py`, `.gitignore`,
`docs/**` (this report, 10 screenshots, test results).

**Rewritten** — `js/scene-registry.js` (shared engine, public API kept), `js/cine-utils.js` (quality tier,
geometry helpers; dropped `ringTexture`, `roundRectTexture`, `glyphAtlas`, `neuralNodes` — only the retired
scenes used them), `js/three/intelligenceField.js` (robot), `js/three/dataCore.js` (processor), `README.md`.

**Modified** — `js/main.js` (+184: Anime motion layer, scene start-up/fallbacks, loader hook),
`js/members-render.js` (+9, outside the suggested scope: reveals go through the shared motion layer, CSS
fallback intact), `js/data/brand.js` (palette aligned with the logo/CSS, data contract kept),
`css/style.css` (+74: hero pin, canvas ↔ fallback swap, layer tags, press feedback; hero wrapper now
`min-height`), `index.html` (head pin decision script, deferred libraries), `members.html` and
`contacts.html` (empty canvas slot and legacy comment removed, Anime script, logo file name).

**Deleted** (no remaining references — `static-checks.js` S05) — `js/three/constellation.js`,
`js/three/members-scene.js`, `js/three/contact-scene.js`.

**Untouched, proven byte-identical to Phase 1 (28 files, S11)** — `server.js`, `package.json`,
`render.yaml`, `js/data/content.js`, `js/data/members.js`, all of `logo/**` (launch page),
`assets/images/logo.svg`, `favicon.svg`, every member photo. The Contact `<form>` block is identical (S13);
`index/members/contacts.html` markup is identical apart from scripts, comments, the two removed empty canvases
and the logo file name (S14–S16). No element id was removed except those two canvases (S12).

## 5. Verification (Chromium 141, headless, **software WebGL**)

| Group | Checks | Result |
|---|---|---|
| Static (`tests/static-checks.js`, with `--baseline`) | 18 | **18 PASS** |
| `smoke` — 3 pages × 9 viewports (320×700 … 1920×1080) = 27 loads: no uncaught errors / console errors / failed local requests, no horizontal overflow, WebGL contexts exactly 1 / 0 / 0, no warnings from site code | 4 (+1 INFO) | **4 PASS** |
| `layout` — hero pinned at 1024/1280/1440/1920, not pinned and never overlapping About at 320/390/768, CTA not covered by the canvas, content integrity (6 pillars, 6 activities, 4 preview cards, 7 member cards with photos), Contact still honest | 11 | **11 PASS** |
| `scenes` — one context; idle = zero rAF; progress = scroll; **deterministic & reversible**; fast jumpy scroll converges to the identical frame; About assembled → exploded → assembled with tags; off-screen and hidden-tab pause; resize while active; duplicate mount; teardown (0 contexts / views / listeners); no errors; context loss & restore | 16 (+1 INFO) | **16 PASS** |
| `motion` — hero entrance completes, Anime never touches 3D state, staggered reveals settle, Members 7 cards, Contact, Anime blocked | 6 | **6 PASS** |
| `failures` — no WebGL, Three.js missing, `main.js` missing, reduced motion (2), software-only refused | 6 | **6 PASS** |
| `nav` — mobile menu, keyboard order + focus ring + activation, reload at non-zero scroll, open at `#about`, back/forward | 6 | **6 PASS** |

`npm start` was run and every page, vendored file and asset returned 200 with the right MIME type; the
deleted scene returns 404.

**Phase 1 vs Phase 2** (same script, 27 loads each, cold cache, uncompressed bytes, member photos excluded)

| | Phase 1 | Phase 2 |
|---|---|---|
| index.html total | 1,650 KB / 7 req | 1,675 KB / 13 req (+672 KB JS incl. Three.js, −651 KB logo) |
| members.html | 1,651 KB / 8 req | 1,027 KB / 9 req (−38 %) |
| contacts.html | 1,646 KB / 7 req | 1,021 KB / 8 req (−38 %) |
| WebGL contexts (index / members / contacts) | 0 / 0 / 0 | 1 / 0 / 0 |
| Pages with horizontal overflow, console/page errors | 0, 0 | 0, 0 |

**Scene cost** (counted in the running engine): Hero 56 meshes = 56 draw calls, ~13.6k triangles, 10
materials, 4 lights; About 17 meshes (3 instanced, 368 instances) = 19 draw calls, ~11.6k triangles, 11
materials, 4 lights. No shadow maps, no post-processing.

**Start-up, software WebGL only (not a GPU measurement):** DOMContentLoaded 281 ms; context + environment map
+ geometry build 123 ms; **first frame 7.6 s (hero) and 1.5 s (About)** = shader compilation and draw on a CPU
rasterizer; one 7.8 s long task. This is why software-only WebGL is refused by default. Real-device numbers
do not exist.

## 6. Problems found during verification, and what was done

1. **About timing flaw (design).** Keyed to the panel's whole visible lifetime, the explosion began while the
   panel was below the fold and the re-assembly happened after it had left the top. Re-keyed to the panel
   centre (0.5 = where the copy is read): explode 0.12–0.40, hold to 0.62, close by 0.92.
2. **Context restore.** Disposing the old environment target after a restore produced
   `INVALID_OPERATION: delete` warnings → now dropped, not disposed. Also confirmed (and tested) that an
   off-screen scene redraws when scrolled into view rather than immediately.
3. **Static pages woke the loop on scroll** (reduced motion) → scroll listener now only wakes it for
   scroll-driven scenes.
4. **Software-only first-frame stall** → refused by default (§3).
5. **Unpinned hero progress** would have completed within a few dozen pixels on phones → sticky detection,
   70 %-of-height mapping.
6. **Hero composition** touched the headline's right edge → arm shifted right, lens widened.
7. **Logo optimiser bug (caught in review):** my first pattern also matched the tail of `id="Layer_1"` and
   `enable-background`; fixed with an anchored pattern and checked (same 2,244 paths/fills, attributes intact).
8. **My own test bugs** (not product bugs; each triaged before changing anything): lazy-loaded photos, a
   wrong comparison fraction in the fast-scroll test, `getExtension()` returning `null` after loss, loader
   failsafe checked as `visibility` instead of opacity/pointer-events, a below-the-fold contact check,
   measuring a still-translated `.reveal` with `getBoundingClientRect`, and counting Anime's entrance as a
   permanent loop (it is transient; zero rAF once it ends).

## 7. Logo optimisation

`assets/images/logo.svg` is an auto-traced vector (2,244 paths, six-decimal coordinates, 1,606,439 bytes).
`logo.min.svg` (939,944 bytes, −41.5 %): coordinates rounded to two decimals, default attributes removed.
Rendered in Chromium at 34 / 72 / 144 / 512 / 1254 px, versus the original: mean difference ≤ 0.03/255; at
the site's display sizes ≤ 0.04 % of pixels differ (anti-aliased edge pixels, max 27/255); at 1254 px 0.003 %
of pixels differ by more than 32. Visually identical, **not bit-identical**. The original stays in place;
to roll back, point the `<img>` tags back to `logo.svg`.

## 8. Not tested / unverified

- **Real GPU, real phones, Safari, Firefox, Lighthouse, FPS** — none. All timings are software WebGL.
- The `failIfMajorPerformanceCaveat` policy was verified only in the software direction (refused); GPU-backed
  behaviour is expected, not tested. The pixel-ratio cap (1.5) and adaptive governor were never exercised
  on real hardware (the suite disables the governor for deterministic frames).
- High-DPI (`deviceScaleFactor` 2) rendering; touch scrolling on a physical device; screen-reader audit.
- Render deployment itself (only `npm start` locally); whether Render's edge compresses the 600 KB Three.js
  file (`server.js` does not).
- "Scroll slowly through every section" is covered by stepped programmatic scrolling of Hero, About,
  Members and Contact, not by a recorded continuous manual scroll.
- Visual quality was reviewed by me from the screenshots in `docs/screenshots/`; please judge it yourself.

## 9. Acceptance criteria

| ID | Status | Evidence |
|---|---|---|
| P2-01 hero scene | Met | S-01, screenshots 01–03 |
| P2-02 About scene, 4 recognisable layers | Met | S-07–S-09, screenshots 04–06, 10 |
| P2-03 deterministic, reversible | Met | S-03, S-04, S-05, S-06, S-07 |
| P2-04 no duplicate loops/renderers | Met | T03, S-01, S-02, S-13 |
| P2-05 off-screen / hidden-tab pause | Met | S-10, S-11 |
| P2-06 teardown | Met | S-14 (9 listeners → 0, 0 contexts) |
| P2-07 single Anime version, no conflict | Met | S06b, M-02, M-06 |
| P2-08 reduced-motion / no-WebGL fallbacks | Met | F-01–F-06 |
| P2-09 data & content intact | Met | S07–S16, C01–C04 |
| P2-10 Members/Contact no loops | Met | T03, S04 |
| P2-11 Phase 1 a11y/mobile preserved | Met (Chromium) | N-01–N-03, F-04, F-05 |
| P2-12 no new overflow, 9 viewports | Met | T02, L02 |
| P2-13 no new errors / broken links | Met | T01, S01 (87 refs) |
| P2-14 `npm start` / Render path | Met locally; **not deployed to Render** | `npm start` check |
| P2-15 honest report | This document | §5, §8 |
| P2-16 delivered | Met | ZIP + individual files |

## 10. Run, test, roll back

```
npm start
node tests/static-checks.js --baseline <phase-1-folder>
pip install playwright && playwright install chromium && python tests/browser-checks.py
```
Before pasting files into your repository: `git switch -c phase-2-cinematic-engine`; roll back with
`git switch main` (or restore the Phase 1 ZIP). My working copy also has the checkpoint (`255ed41`) and the
Phase 2 commit (`0c49a02`), but that branch exists only in my sandbox copy.
