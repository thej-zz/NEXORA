/* ============================================================
   CineUtils — small shared helpers used by every scene module
   and by the scroll-camera engine (scene-registry.js). Load this
   BEFORE scene-registry.js and any file in /js/three/.
   ============================================================ */

(function () {
  'use strict';

  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function smoothstep(edge0, edge1, x) {
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  /* Maps p from the window [a, b] onto [0, 1], clamped outside it.
     e.g. range(0.4, 0.2, 0.6) === 0.5 */
  function range(p, a, b) {
    return clamp((p - a) / (b - a), 0, 1);
  }

  function easeInOut(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  /* ---------- device-aware quality tier ----------
     `low` scales particle counts down on phones / coarse pointers /
     reduced-motion so the site stays smooth everywhere. `dpr` is a
     CAP on devicePixelRatio, not the resolved value \u2014 scenes do
     Math.min(window.devicePixelRatio || 1, Q.dpr) themselves. */
  const coarsePointer = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const smallViewport = window.innerWidth < 760;
  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const low = coarsePointer || smallViewport;

  const Q = {
    low: low,
    reducedMotion: reducedMotion,
    dpr: low ? 1.5 : 2,
    neuralNodes: low ? 90 : 220
  };

  /* ---------- textures ---------- */

  /* Soft radial glow \u2014 used for halos/bloom sprites without a
     post-processing pass. colorInner/colorOuter are CSS color
     strings (rgba(...) recommended so alpha fades naturally). */
  function radialTexture(colorInner, colorOuter, size) {
    size = size || 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const r = size / 2;
    const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, colorInner);
    grad.addColorStop(1, colorOuter);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }

  /* Thin glowing ring, used for pulse/emitter effects. */
  function ringTexture(color, size) {
    size = size || 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const r = size / 2;
    ctx.strokeStyle = color;
    ctx.lineWidth = size * 0.06;
    ctx.beginPath();
    ctx.arc(r, r, r - ctx.lineWidth, 0, Math.PI * 2);
    ctx.stroke();
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }

  /* Rounded rectangle sprite, used for chat-style bubbles \u2014 kept
     for parity with scenes.js; unused by the association scenes. */
  function roundRectTexture(w, h, radius, color, stroke) {
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = color;
    const r = radius;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.arcTo(w, 0, w, h, r);
    ctx.arcTo(w, h, 0, h, r);
    ctx.arcTo(0, h, 0, 0, r);
    ctx.arcTo(0, 0, w, 0, r);
    ctx.closePath();
    ctx.fill();
    if (stroke) { ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.stroke(); }
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }

  /* Packs up to 64 glyphs into an 8x8 grid atlas, one glyph per
     cell. Point-based scene shaders read a cell via
     vec2(mod(idx,8.0), floor(idx/8.0)) + gl_PointCoord, divided by 8. */
  function glyphAtlas(chars, color) {
    const cell = 64;
    const grid = 8;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = cell * grid;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = color || '#ffffff';
    ctx.font = `600 ${Math.floor(cell * 0.52)}px "Space Grotesk", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const n = Math.min(chars.length, grid * grid);
    for (let i = 0; i < n; i++) {
      const cx = (i % grid) * cell + cell / 2;
      const cy = Math.floor(i / grid) * cell + cell / 2;
      ctx.fillText(String(chars[i]), cx, cy);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }

  window.CineUtils = {
    lerp, clamp, smoothstep, range, easeInOut,
    Q, radialTexture, ringTexture, roundRectTexture, glyphAtlas
  };
})();
