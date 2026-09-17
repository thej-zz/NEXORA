# AI & Data Science Association — Website

A premium, dark, cinematic website with three custom Three.js scenes:
a scroll-driven "Intelligence Field" in the hero, a self-assembling
"Data Core" in the About section, and an ambient "Intelligence
Constellation" behind the Members page.

No build step, no framework, no npm dependencies. Plain HTML/CSS/JS,
plus Three.js loaded from a CDN.

## Run it locally

Two options — pick whichever's easier:

**Node (no install needed beyond Node itself):**
```
node server.js
```
Then open `http://localhost:3000`. This is a zero-dependency static
file server (`server.js`) — no `npm install` required to run it locally.

**Any other static server**, e.g.:
```
python3 -m http.server 8000
```
or
```
npx serve .
```

(Opening `index.html` directly via `file://` will mostly work too, but
some browsers block canvas/texture loading over `file://` — a local
server avoids that entirely.)

## Deploy to Render

This repo includes `server.js`, `package.json`, and `render.yaml` so
it runs as a Render **Web Service** with no extra setup:

1. Push this folder to a GitHub/GitLab repo.
2. In Render: **New → Blueprint**, point it at the repo. Render reads
   `render.yaml` and configures everything automatically (free plan,
   `npm install` as the build command, `npm start` as the start command).
   Alternatively, **New → Web Service** and set those two commands by hand.
3. Render assigns a port via the `PORT` environment variable at runtime —
   `server.js` already reads it (`process.env.PORT`), so no config needed there.
4. Deploy. You'll get a `https://ai-ds-association.onrender.com`-style URL.

Note: this project has no build step and no real backend logic, so a
**Static Site** on Render (or Netlify/GitHub Pages) works just as well
and is simpler to run — `server.js` exists specifically so you have a
real Node server to point at when a plain static host isn't an option.

## Project structure

```
index.html                 Homepage
members.html                Members / leadership page

server.js                    Zero-dependency Node static file server (local + Render)
package.json                  npm start -> server.js; also lets Render auto-detect Node
render.yaml                   Render Blueprint (Web Service config)

css/style.css                Design tokens + every component's styles

js/
  cine-utils.js               Shared math + texture helpers for the 3D scenes
  scene-registry.js           The engine: mounts a scene onto a <canvas>,
                               drives its camera, handles resize/parallax
  main.js                      Renders content + members into the page,
                               nav, mobile menu, cursor, reveals, loader

  data/
    content.js                 <-- EDIT: all homepage/members page copy
    members.js                 <-- EDIT: names, roles, photo paths
    brand.js                   <-- EDIT: the two accent colors

  three/
    intelligenceField.js        Hero scene (scroll-scrubbed camera flythrough)
    dataCore.js                  About section scene (assembles on scroll-into-view)
    constellation.js             Members page background (ambient)

assets/images/
  logo.svg                      Placeholder logo — replace with the real one
  favicon.svg
  members/                      Put member photos here
```

## What to edit, and where

**Text on the homepage and members page** — `js/data/content.js`.
Every heading, paragraph, button label and eyebrow is a field in
that one file. Nothing else needs to change.

**Member names, roles, and photos** — `js/data/members.js`. Both the
homepage's leadership preview and the full members.html hierarchy
render from this file, so update names/roles/photos in exactly one
place. If a member's `image` is `null`, their card automatically
shows a clean initials placeholder instead of a broken image —
add photos to `assets/images/members/` and point `image` at the
file whenever they're ready; nothing else needs to change.

**Association logo** — replace `assets/images/logo.svg` with the
real logo file (keep the filename, or update the three `<img>` tags
that reference it in `index.html` / `members.html`).

**Brand colors** — `js/data/brand.js` holds the two accent colors
used across all three 3D scenes. Update `--accent` / `--accent-2` in
`css/style.css` to match, so the UI and the 3D work read as one
identity (pull both from the logo once you have it).

## How the 3D scenes work

Each scene is a self-registering module (`SceneRegistry.add({...})`)
with:
- `keys` — a camera path: waypoints of `{ t, pos, look }` from `t=0`
  to `t=1`.
- `build(ctx)` — runs once, builds the Three.js objects into `this.group`.
- `update(p, dt, ctx)` — runs every frame. `p` is a 0..1 progress
  value; what drives it differs per scene:
  - **Hero** (`intelligenceField.js`): `p` tracks how far you've
    scrolled through the pinned hero wrapper — scrolling flies the
    camera through the field.
  - **About** (`dataCore.js`): `p` eases toward 1 while the section
    is on screen (via `SceneRegistry.makeRevealProgress`) and back
    toward 0 when it scrolls away — the core assembles/disassembles.
  - **Members** (`constellation.js`): ambient, always active, just
    ticks with time.

Scenes never set `material.opacity` directly — they call
`setOp(material, value)`, which the engine copies onto the real
`opacity` every frame. That indirection is what would let a future
scene fade against another if scenes ever needed to cross-fade.

## Performance notes

- Particle/edge counts scale down automatically on phones and
  coarse pointers via `CineUtils.Q.low` (see `js/cine-utils.js`).
- `devicePixelRatio` is capped (`Q.dpr`, 1.5 on low-end / 2 otherwise).
- All 3D rendering pauses when the browser tab is hidden
  (`document.hidden` check in the render loop).
- `prefers-reduced-motion: reduce` disables scroll reveals' motion
  and skips mouse parallax on the 3D cameras.
- Each canvas only runs while its section is relevant: the About and
  Members scenes are comparatively light, and the hero — the most
  expensive scene — is the only one active on first load.

## Known placeholders to replace

- `assets/images/logo.svg` — a generic node-mark, not the real logo.
- Member photos — all `image` fields in `js/data/members.js` are
  `null`, so every card currently shows initials.
- `js/data/content.js` → `activities.items` — generic category
  placeholders (Workshops, Hackathons, etc.) with no real dates.
- `js/data/content.js` → `footer.social` — no social links supplied yet.
