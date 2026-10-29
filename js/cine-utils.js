/* ============================================================
   CineUtils — small shared helpers for the scene engine
   (scene-registry.js) and every module in /js/three/.

   Load order: vendor/three.r128.min.js -> cine-utils.js ->
   scene-registry.js -> js/three/*.js -> main.js

   PHASE 2 CHANGES
   - Kept: lerp, clamp, smoothstep, range, easeInOut, radialTexture.
   - Added: easeOutCubic, canvasTexture and the geometry helpers
     (rrect, roundedBox, roundedSlab, hullShape, extrudeShape,
     lathe) used by the robotic arm and the processor.
   - Quality tier (Q) now has a configurable pixel-ratio CAP, an
     `adaptive` switch and a live `reducedMotion` getter.
   - Removed (only the retired network/constellation scenes used
     them; a repo-wide search found no other reference):
     ringTexture, roundRectTexture, glyphAtlas, Q.neuralNodes.

   Optional runtime overrides, set BEFORE this file loads:
     window.NEXORA_3D = { dpr: 1.25, adaptive: false, tier: 'low', allowSoftware: true }
   ============================================================ */

(function () {
  'use strict';

  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  /* maps p from the window [a, b] onto [0, 1], clamped outside it */
  const range = (p, a, b) => clamp((p - a) / (b - a), 0, 1);
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

  /* ---------- device-aware quality tier ----------
     `dpr` is a CAP on devicePixelRatio, not the resolved value: the engine
     uses Math.min(devicePixelRatio, Q.dpr). 1.5 is deliberately conservative
     (it was only validated on software WebGL, not on real GPUs); raise it
     through window.NEXORA_3D.dpr once you have measured a target device. */
  const mm = (q) => !!(window.matchMedia && window.matchMedia(q).matches);
  const cfg = window.NEXORA_3D || {};
  const memory = navigator.deviceMemory || 8;
  const cores = navigator.hardwareConcurrency || 8;
  const low = cfg.tier
    ? cfg.tier === 'low'
    : (mm('(pointer: coarse)') || window.innerWidth < 760 || memory <= 2 || cores <= 2);

  const Q = {
    low: low,
    tier: low ? 'low' : 'high',
    dpr: typeof cfg.dpr === 'number' ? cfg.dpr : 1.5,
    adaptive: cfg.adaptive !== false,
    /* false (default): refuse software-only WebGL (failIfMajorPerformanceCaveat) and show the static
       illustrations instead; on a CPU rasterizer the first frame alone measured ~8 s. */
    allowSoftware: cfg.allowSoftware === true,
    get reducedMotion() { return mm('(prefers-reduced-motion: reduce)'); }
  };

  /* ---------- textures ---------- */

  /* Draws into a fresh 2D canvas and wraps it as a texture. */
  function canvasTexture(w, h, draw, srgb) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const tex = new THREE.CanvasTexture(c);
    if (srgb) tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = 4;
    return tex;
  }

  /* Soft radial gradient — used for blob shadows and floor light pools
     (cheaper than a shadow map, and the machine never moves its base). */
  function radialTexture(colorInner, colorOuter, size) {
    return canvasTexture(size || 128, size || 128, (ctx, w) => {
      const r = w / 2;
      const g = ctx.createRadialGradient(r, r, 0, r, r, r);
      g.addColorStop(0, colorInner);
      g.addColorStop(1, colorOuter);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, w);
    }, false);
  }

  /* ---------- geometry helpers (all procedural, no assets) ---------- */

  /* rounded rectangle outline, w x h, centred on the origin (XY plane) */
  function rrect(w, h, r) {
    const x = w / 2, y = h / 2;
    r = Math.max(0.0001, Math.min(r, x, y));
    const s = new THREE.Shape();
    s.moveTo(-x + r, -y);
    s.lineTo(x - r, -y);
    s.absarc(x - r, -y + r, r, -Math.PI / 2, 0, false);
    s.lineTo(x, y - r);
    s.absarc(x - r, y - r, r, 0, Math.PI / 2, false);
    s.lineTo(-x + r, y);
    s.absarc(-x + r, y - r, r, Math.PI / 2, Math.PI, false);
    s.lineTo(-x, -y + r);
    s.absarc(-x + r, -y + r, r, Math.PI, Math.PI * 1.5, false);
    return s;
  }

  /* Extrudes a shape to `depth` along Z with a small machined bevel.
     bevelOffset = -bevel keeps the final outline equal to the shape. */
  function extrudeShape(shape, depth, bevel, curveSegments) {
    bevel = Math.min(bevel, depth / 2 - 0.0005);
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: Math.max(depth - 2 * bevel, 0.001),
      bevelEnabled: bevel > 0,
      bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 2,
      curveSegments: curveSegments || 8
    });
    g.translate(0, 0, -(depth - 2 * bevel) / 2);
    return g;
  }

  /* box w (X) x h (Y) x d (Z) with rounded corners (r) and bevelled faces */
  function roundedBox(w, h, d, r, bevel, curveSegments) {
    return extrudeShape(rrect(w, h, r), d, bevel == null ? Math.min(r, 0.04) : bevel, curveSegments);
  }

  /* flat plate w (X) x d (Z), thickness h along Y */
  function roundedSlab(w, d, h, r, bevel, curveSegments) {
    const g = extrudeShape(rrect(w, d, r), h, bevel == null ? Math.min(h * 0.3, 0.02) : bevel, curveSegments);
    g.rotateX(-Math.PI / 2);
    return g;
  }

  /* outline of two circles joined by their outer tangents: circle 0 at the
     origin (radius r0), circle 1 at (0, len) (radius r1) — a link silhouette */
  function hullShape(r0, r1, len) {
    const a = Math.asin((r0 - r1) / len), c = Math.cos(a), s = Math.sin(a);
    const sh = new THREE.Shape();
    sh.moveTo(r0 * c, r0 * s);
    sh.lineTo(r1 * c, len + r1 * s);
    sh.absarc(0, len, r1, a, Math.PI - a, false);
    sh.lineTo(-r0 * c, r0 * s);
    sh.absarc(0, 0, r0, Math.PI - a, Math.PI * 2 + a, false);
    return sh;
  }

  /* Revolves a [radius, y, radius, y, ...] profile around Y — the quickest way
     to get believable machined parts (chamfers, steps, grooves). */
  function lathe(profile, segments) {
    const pts = [];
    for (let i = 0; i < profile.length; i += 2) pts.push(new THREE.Vector2(profile[i], profile[i + 1]));
    return new THREE.LatheGeometry(pts, segments || 48);
  }

  window.CineUtils = {
    lerp, clamp, smoothstep, range, easeInOut, easeOutCubic,
    Q, canvasTexture, radialTexture,
    rrect, extrudeShape, roundedBox, roundedSlab, hullShape, lathe
  };
})();
