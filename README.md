# NEXORA — AI & Data Science Association website

A dark, cinematic, student-run association site with two original,
scroll-driven 3D chapters on the homepage:

- **Hero** — an articulated six-axis robotic manipulator that unfolds,
  descends on a glowing data module, grips it, lifts it and presents it as
  you scroll.
- **About** — an exploded processor (substrate / interposer / die / lid) that
  opens while you read and closes as the panel leaves.

Plain HTML, CSS and vanilla JavaScript. **No framework, no build step, no npm
dependencies.** Three.js and Anime.js are vendored in `vendor/` (no CDN at
runtime; only Google Fonts is fetched remotely).

## Run it locally

```
npm start          # = node server.js  →  http://localhost:3000
```

`server.js` is a zero-dependency static server (it honours `PORT`). Any other
static server works too (`npx serve .`, `python3 -m http.server 8000`), but
serve over HTTP — `file://` blocks some canvas features.

## Deploy to Render

Unchanged from Phase 1: `server.js`, `package.json` and `render.yaml` run the
site as a Render **Web Service** (`npm install` / `npm start`, `PORT` is read
from the environment). The new files are plain static assets in `vendor/`,
`js/`, `css/` and `assets/`, so nothing about the deployment changes.

## Project structure

```
index.html  members.html  contacts.html     the three pages
server.js  package.json  render.yaml        Node static server + Render blueprint (unchanged)
css/style.css                                design tokens + components (section 19 = Phase 2 3D layer)

vendor/                                      pinned, vendored libraries (see "Libraries")
  three.r128.min.js        Three.js r128, UMD build        (MIT, see three.LICENSE.txt)
  anime.3.2.2.min.js       Anime.js 3.2.2                  (MIT, see anime.LICENSE.md)

js/
  main.js                  content render, nav, cursor, loader, Anime.js motion layer, 3D start-up
  cine-utils.js            math, quality tier (pixel-ratio cap), procedural geometry helpers
  scene-registry.js        the shared 3D engine (one renderer, one on-demand loop, lifecycle)
  members-render.js        members page render + reveal (uses the shared motion layer)
  three/
    intelligenceField.js   hero scene: robotic manipulator + inverse kinematics
    dataCore.js            About scene: exploded processor + layer tags
  data/
    content.js  members.js  brand.js           EDIT these for copy, people, 3D palette

assets/images/             logo.svg (original, untouched), logo.min.svg (optimised, in use), favicon, members/
logo/                      standalone launch experience (untouched, own libraries)
tests/                     static-checks.js (no deps) + browser-checks.py (Playwright)
docs/                      PHASE2_REPORT.md, screenshots/, test-results/
```

## What to edit

- **Copy** — `js/data/content.js` (every heading, paragraph, label).
- **People** — `js/data/members.js` (name, role, photo path). Home preview and
  members page both render from it.
- **3D palette** — `js/data/brand.js` (`blue`, `blueHi`, `silver…`); keep it in
  sync with the `--nx-*` tokens in `css/style.css`.
- **Logo** — pages use `assets/images/logo.min.svg`; the untouched original is
  `assets/images/logo.svg`.

## Libraries and how they load

| Library | Version | Format | Why |
|---|---|---|---|
| Three.js | r128 | UMD global (`window.THREE`), vendored | The project was already on r128 as a UMD global. Newer releases are not a CDN-URL swap (module-only builds) and the project has no bundler, so r128 stays; it provides everything used (PBR materials, PMREM, instancing, `setViewOffset`). |
| Anime.js | 3.2.2 | UMD global (`window.anime`), vendored | One version on the main site. Matches the version the launch page already uses (that page loads its own copy and was not touched). v3 and v4 APIs are never mixed. |

`index.html` loads the six Phase 2 scripts with `defer`, in dependency order:
they run after parsing and before `DOMContentLoaded`, off the critical
rendering path. `members.html` and `contacts.html` load only Anime.js — they
create **no** WebGL context.

## How the 3D engine works (`js/scene-registry.js`)

**One renderer for the homepage.** A single `WebGLRenderer` draws on a single
detached `<canvas>` (one GL context). Each scene is rendered into its own
region of that canvas and copied (`drawImage`) into the visible
`#hero-canvas` / `#about-canvas` that live in their sections. Because the
visible canvases are ordinary page elements, they scroll with the browser's
own compositor — there is no scroll-linked overlay to lag behind the page.

**Deterministic progress.** Every scene is a pure function of a progress value
`p` in 0..1:

| Scene | `p` comes from | Source |
|---|---|---|
| Hero | scroll through the pinned hero (280% of the viewport on screens ≥ 900×620, sticky) — or, where pinning is off (phones, short screens), the first 70% of the hero's own height | `makePinnedProgress` |
| About | where the panel's **centre** is in the viewport: 0 at the bottom edge, 0.5 at mid-screen (where the copy is read), 1 at the top edge | `makeSectionProgress(el, { center: true })` |

The shown value follows the scroll target with a short critically-damped
smoothing, so the same position always converges to the same picture and
reversing the scroll reverses the motion. Geometry is measured once per
resize/layout change (never per frame).

**On-demand loop.** Scroll, resize, pointer and visibility events wake **one**
`requestAnimationFrame` loop; it stops by itself when every visible scene has
settled. Off-screen scenes are skipped (IntersectionObserver), a hidden tab
renders nothing, and static (reduced-motion) pages never wake it on scroll.

**Lifecycle.** `add → mount → (resize / update / afterRender) → unmount →
disposeAll`. Mounting twice is ignored. Unmounting disposes geometries,
materials, textures, instanced buffers and observers; the last unmount (or
`SceneRegistry.disposeAll()`, or a real page unload) also drops the
environment map, the renderer and the GL context. `SceneRegistry.stats()`
reports contexts, views, frames, listeners — the tests use it.

**Public API kept from Phase 1:** `add`, `mount`, `makePinnedProgress`,
`makeRevealProgress` (a legacy `{ id, keys, build, update }` scene still works).
New: `makeSectionProgress`, `onState`, `supported`, `stats`, `disposeAll`, and
optional scene members `resize`, `afterRender`, `dispose`, `cameraMode:'spline'`.

**Quality.** Pixel ratio is capped (`CineUtils.Q.dpr`, default **1.5**) and an
adaptive governor steps it down (never up) if the machine cannot hold ~30 fps
while animating. Override before `cine-utils.js` loads:
`window.NEXORA_3D = { dpr: 1.25, adaptive: false, tier: 'low', allowSoftware: true }`.
The 1.5 default is conservative because it has only been exercised on software
WebGL; raise it after measuring on a real target device.

## The two scenes

- **Hero (`intelligenceField.js`)** — 56 procedural meshes / 56 draw calls /
  ~13.6k triangles (turned housings, bevelled links, conduit, hex bolts,
  gripper) lit by a procedural photo-studio environment map and 4 lights, no
  shadow maps. `p` → path of the gripper pad →
  analytic inverse kinematics → joint angles. The data module is "held" purely
  as a function of `p`. Camera: Catmull-Rom spline keys; the composition is
  shifted with `camera.setViewOffset` (arm on the right on wide screens, lower
  half on portrait).
- **About (`dataCore.js`)** — four layers with distinct silhouettes and
  materials (printed substrate + 28 capacitors, interposer with 324
  micro-bumps, tiled die with one blue core, brushed lid with the NEXORA
  marking): 17 meshes (3 instanced, 368 instances) = 19 draw calls, ~11.6k
  triangles. Explode over `p` 0.12–0.40, hold to 0.62,
  re-assemble by 0.92. Four DOM tags (`aria-hidden`) name the layers and are
  positioned from the final camera pose each frame.

To retune: camera `keys` and (hero) `PATH` waypoints live at the top of each
scene file; the About timeline is the `e` line in `update()`.

## Interface motion (Anime.js, in `main.js`)

One easing (`--ease` as `cubicBezier(0.16, 0.84, 0.44, 1)`) and one distance
language: hero entrance timeline (eyebrow → heading lines → copy → actions) as
the loader lifts; staggered `.reveal` blocks (batched per intersection);
Members cards through `window.NexoraMotion.reveal`. Anime only animates DOM;
the 3D state has exactly one authority (scroll progress). Holds are
failsafed: the hero can never stay invisible (4.5 s guard), inline styles are
always cleared afterwards, and CSS `:active` gives button press feedback.

## Fallbacks (all tested)

| Situation | What happens |
|---|---|
| `prefers-reduced-motion` | no pin, no Anime; each scene is rendered **once** in a useful static state (hero p=0.14, About p=0.56); no loop, no scroll link |
| WebGL unavailable / context creation fails | hero un-pinned, static SVG illustrations stay, no exceptions |
| **No GPU acceleration** (software-only WebGL) | refused by default (`failIfMajorPerformanceCaveat`) → static illustrations, no context created. On a CPU rasterizer the hero's first frame measured ~7.6 s (shader compile + draw) and the About's ~1.5 s, so the visitor would stare at the loader. Override: `window.NEXORA_3D = { allowSoftware: true }` |
| Three.js fails to load | same as above |
| Anime.js fails to load | CSS `.reveal` transitions (Phase 1 behaviour); 3D still runs |
| `main.js` fails | `<head>` + CSS failsafes drop `html.js` / `nx-pin` and fade out the loader after 5–6 s |
| WebGL context lost | SVG fallbacks return at once; hero redraws on restore, About redraws when scrolled into view |

## Testing

```
node tests/static-checks.js --baseline <path-to-phase-1-project>   # 18 checks, no dependencies
pip install playwright && playwright install chromium
python tests/browser-checks.py                                      # all groups
python tests/browser-checks.py --only smoke,scenes                  # smoke layout scenes motion failures nav shots
python tests/browser-checks.py --gpu                                # use the real GPU instead of SwiftShader (F-06 is then NOT TESTED)
```

Every check ends as PASS, FAIL, NOT TESTED or INCONCLUSIVE. By default the
browser checks force **software WebGL (SwiftShader)** and set
`allowSoftware: true` so the real scenes run on any machine; that exercises
correctness, not GPU performance — timings they print are labelled INFO.
Check F-06 runs once *without* `allowSoftware` to prove the default policy. Under software WebGL Chrome logs a few "GPU stall due to
ReadPixels" driver notices (the canvas copy needs a CPU read-back without GPU
acceleration); the site's own code produces no warnings or errors.

## Known limitations

- **No real-device GPU or mobile measurements exist.** All 3D testing ran on
  software WebGL in headless Chromium; there are no FPS figures, Lighthouse
  scores or Safari/Firefox results. First-frame shader compilation is the
  known cost (7.6 s hero / 1.5 s About on a CPU rasterizer; mount itself,
  including the environment map, took 123 ms) — measure it on a real
  mid-range phone before launch. The `failIfMajorPerformanceCaveat` policy
  was only verified in the software direction (refused); its behaviour on
  GPU-backed browsers is expected, not tested.
- The `drawImage` canvas copy is GPU-to-GPU when 2D canvas acceleration is on;
  on a browser with it disabled it needs a read-back each rendered frame.
- `server.js` does not compress responses (unchanged). `three.r128.min.js` is
  ~600 KB raw; serve through a compressing proxy/CDN (Render's edge normally
  does — not verified here).
- On phones the hero machine sits behind the copy at 50% opacity (the copy
  fills the screen); on short/narrow screens the hero is not pinned.
- Contact form has no backend (it says so honestly) and still shows the
  Phase 1 placeholder address `nexora@example.com`.
- Pre-existing, untouched: `activities` copy has no dates, `footer.social`
  has no links.

## Logo optimisation

`assets/images/logo.svg` (1.6 MB) is an auto-traced vector of 2,244 paths with
six-decimal coordinates. `assets/images/logo.min.svg` (940 KB, −41.5%) has
coordinates rounded to two decimals and default attributes removed — same
paths, same fills. Rendered in Chromium at 34 / 72 / 144 / 512 / 1254 px the
two differ on at most 0.07% of pixels (anti-aliased edge pixels) and not at
all in layout. The pages reference the `.min.svg`; to roll back, change the
`<img src>` back to `logo.svg` (the original is untouched).

## Rolling back Phase 2

Before pasting the Phase 2 files into your repository, create a branch
(`git switch -c phase-2-cinematic-engine`). To roll back: `git switch main`
(or restore the Phase 1 ZIP). Files Phase 2 deliberately did **not** touch (and
`node tests/static-checks.js --baseline` proves byte-identical): `server.js`,
`package.json`, `render.yaml`, `js/data/content.js`, `js/data/members.js`,
`logo/**`, `assets/images/logo.svg`, `assets/images/favicon.svg` and every member photo.
