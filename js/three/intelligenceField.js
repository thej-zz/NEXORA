/* ============================================================
   INTELLIGENCE FIELD — the hero's scroll-driven 3D scene.

   Registers itself with window.SceneRegistry as 'intelligenceField'.
   main.js mounts it onto #hero-canvas with a pinned scroll
   container, so `p` in update(p, dt, ctx) is how far the visitor
   has scrolled through the hero, 0..1. The camera then flies
   through the field along `keys` below.

   Fading is handled by the engine (scene-registry.js): scenes
   never touch mat.opacity directly, only setOp(mat, v), which the
   engine copies onto mat.opacity every frame.

   Load order: cine-utils.js -> scene-registry.js -> data/brand.js
   -> this file -> main.js.
   ============================================================ */

(function () {
  'use strict';

  const U = window.CineUtils;
  const { lerp, clamp, smoothstep, range, easeInOut } = U;
  const Q = U.Q;
  const R = window.SceneRegistry;

  const setOp = (mat, v) => { mat.userData.baseOpacity = v; };
  const TAU = Math.PI * 2;

  /* ---------- brand config — reads from js/data/brand.js ---------- */
  const BRAND = window.BrandColors || {};
  const CORE_COLOR_RGBA = BRAND.coreRGBA || 'rgba(111,216,255,0.95)';
  const ACCENT_COLOR_RGBA = BRAND.accentRGBA || 'rgba(150,130,255,0.9)';

  function parseRGBA(str) {
    const m = str.match(/rgba?\(([^)]+)\)/);
    const parts = m[1].split(',').map(s => parseFloat(s));
    return { r: parts[0] / 255, g: parts[1] / 255, b: parts[2] / 255 };
  }
  function mixRGB(c1, c2, t) {
    return { r: lerp(c1.r, c2.r, t), g: lerp(c1.g, c2.g, t), b: lerp(c1.b, c2.b, t) };
  }
  function vec3FromRGB(c) { return new THREE.Vector3(c.r, c.g, c.b); }
  function threeColorFromRGB(c) { return new THREE.Color(c.r, c.g, c.b); }

  const CORE_RGB = parseRGBA(CORE_COLOR_RGBA);
  const ACCENT_RGB = parseRGBA(ACCENT_COLOR_RGBA);
  const NEAR_RGB = mixRGB(CORE_RGB, { r: 1, g: 1, b: 1 }, 0.55);   // nodes closer to camera, brightened
  const FAR_RGB = mixRGB(CORE_RGB, { r: 0, g: 0, b: 0 }, 0.35);    // nodes further out, dimmed
  const CORE_COLOR = threeColorFromRGB(CORE_RGB);                  // THREE.Color, used on solid mesh materials

  /* ---------- quality (scaled down automatically on Q.low) ---------- */
  const NODE_COUNT   = Q.neuralNodes || (Q.low ? 90 : 220);
  const EDGE_K        = Q.low ? 2 : 3;
  const EDGE_MAX_DIST = 3.1;
  const EDGE_MAX      = Q.low ? 160 : 420;
  const PACKET_MAX    = Q.low ? 14 : 32;
  const GLYPH_COUNT   = Q.low ? 16 : 40;

  /* ==========================================================
     builders
     ========================================================== */

  function buildCore(g) {
    const core = new THREE.Group();

    const icoGeo = new THREE.IcosahedronGeometry(2.15, 1);

    const wire = new THREE.LineSegments(
      new THREE.EdgesGeometry(icoGeo),
      new THREE.LineBasicMaterial({
        color: CORE_COLOR, transparent: true, opacity: 0.5,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    core.add(wire);

    const solid = new THREE.Mesh(
      icoGeo,
      new THREE.MeshStandardMaterial({
        color: 0x0a0e14, emissive: CORE_COLOR, emissiveIntensity: 0.35,
        roughness: 0.4, metalness: 0.2, transparent: true, opacity: 0.12
      })
    );
    core.add(solid);

    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: U.radialTexture(CORE_COLOR_RGBA, CORE_COLOR_RGBA.replace(/[\d.]+\)$/, '0.05)'), 256),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.5
    }));
    glow.scale.set(9, 9, 1);
    core.add(glow);

    g.add(core);
    return { group: core, wire, solid, glow };
  }

  function buildNodeField(g) {
    const n = NODE_COUNT;
    const positions = new Float32Array(n * 3);
    const seeds = new Float32Array(n);
    const layer = new Float32Array(n);
    const basePos = [];

    for (let i = 0; i < n; i++) {
      /* three loose radius bands so the field reads with depth,
         not like a single perfect sphere */
      const band = Math.floor(Math.random() * 3);
      const rMin = [2.8, 4.0, 5.4][band];
      const rMax = [3.6, 5.0, 6.8][band];
      const r = rMin + Math.random() * (rMax - rMin);
      const theta = Math.random() * TAU;
      const phi = Math.acos(2 * Math.random() - 1);

      const v = new THREE.Vector3(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta) * 0.72,
        r * Math.cos(phi)
      );
      basePos.push(v);
      positions[i * 3] = v.x; positions[i * 3 + 1] = v.y; positions[i * 3 + 2] = v.z;
      seeds[i] = Math.random();
      layer[i] = band / 2;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geo.setAttribute('aLayer', new THREE.BufferAttribute(layer, 1));

    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: {
        uFade: { value: 1 },
        uPR: { value: Math.min(window.devicePixelRatio || 1, Q.dpr) },
        uNear: { value: vec3FromRGB(NEAR_RGB) },
        uFar: { value: vec3FromRGB(FAR_RGB) }
      },
      vertexShader: `
        attribute float aSeed, aLayer;
        uniform float uPR;
        varying float vSeed, vLayer;
        void main(){
          vSeed = aSeed; vLayer = aLayer;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = (2.4 + aLayer * 2.6 + aSeed * 2.0) * uPR * (46.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying float vSeed, vLayer;
        uniform float uFade;
        uniform vec3 uNear, uFar;
        void main(){
          float d = length(gl_PointCoord - 0.5);
          float a = pow(smoothstep(0.5, 0.0, d), 1.9);
          vec3 col = mix(uFar, uNear, vLayer);
          gl_FragColor = vec4(col, a * (0.5 + vSeed * 0.5) * uFade);
        }`
    });

    const points = new THREE.Points(geo, mat);
    g.add(points);
    return { points, mat, basePos, seeds, count: n };
  }

  function buildEdges(g, basePos, count) {
    /* a light neighbor graph, computed once — far cheaper than
       checking proximity between every pair every frame */
    const pairSet = new Set();
    const edgeList = [];

    for (let i = 0; i < count; i++) {
      const dists = [];
      for (let j = 0; j < count; j++) {
        if (i === j) continue;
        const d = basePos[i].distanceTo(basePos[j]);
        if (d < EDGE_MAX_DIST) dists.push([d, j]);
      }
      dists.sort((a, b) => a[0] - b[0]);
      for (let k = 0; k < Math.min(EDGE_K, dists.length); k++) {
        const j = dists[k][1];
        const key = i < j ? i + '_' + j : j + '_' + i;
        if (!pairSet.has(key)) { pairSet.add(key); edgeList.push([i, j]); }
      }
    }
    if (edgeList.length > EDGE_MAX) edgeList.length = EDGE_MAX;

    const m = edgeList.length;
    const positions = new Float32Array(m * 2 * 3);
    const seeds = new Float32Array(m * 2);
    for (let e = 0; e < m; e++) {
      const s = Math.random();
      seeds[e * 2] = s; seeds[e * 2 + 1] = s;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: {
        uFade: { value: 1 }, uTime: { value: 0 }, uActivity: { value: 0 },
        uColorA: { value: vec3FromRGB(CORE_RGB) }, uColorB: { value: vec3FromRGB(ACCENT_RGB) }
      },
      vertexShader: `
        attribute float aSeed;
        varying float vSeed;
        void main(){
          vSeed = aSeed;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying float vSeed;
        uniform float uFade, uTime, uActivity;
        uniform vec3 uColorA, uColorB;
        void main(){
          /* connections quietly flicker in and out, never all at once */
          float flicker = 0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * (0.6 + vSeed * 1.4) + vSeed * 40.0));
          vec3 col = mix(uColorA, uColorB, vSeed);
          gl_FragColor = vec4(col, flicker * uActivity * uFade * 0.55);
        }`
    });

    const lines = new THREE.LineSegments(geo, mat);
    g.add(lines);
    return { lines, mat, edgeList, count: m };
  }

  function buildPackets(g, edgeList) {
    const activeCount = Math.min(edgeList.length, PACKET_MAX);
    const step = Math.max(1, Math.floor(edgeList.length / activeCount));
    const chosen = [];
    for (let i = 0; i < edgeList.length && chosen.length < activeCount; i += step) {
      chosen.push(edgeList[i]);
    }

    const n = chosen.length;
    const positions = new Float32Array(n * 3);
    const seeds = new Float32Array(n);
    const t0 = new Float32Array(n);
    for (let i = 0; i < n; i++) { seeds[i] = Math.random(); t0[i] = Math.random(); }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: {
        uFade: { value: 1 }, uPR: { value: Math.min(window.devicePixelRatio || 1, Q.dpr) },
        uColorA: { value: vec3FromRGB(NEAR_RGB) }, uColorB: { value: vec3FromRGB(ACCENT_RGB) }
      },
      vertexShader: `
        attribute float aSeed; uniform float uPR; varying float vSeed;
        void main(){
          vSeed = aSeed;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = (3.4 + aSeed * 3.0) * uPR * (46.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying float vSeed; uniform float uFade;
        uniform vec3 uColorA, uColorB;
        void main(){
          float d = length(gl_PointCoord - 0.5);
          float a = pow(smoothstep(0.5, 0.0, d), 2.0);
          vec3 col = mix(uColorA, uColorB, vSeed);
          gl_FragColor = vec4(col, a * uFade);
        }`
    });

    const points = new THREE.Points(geo, mat);
    g.add(points);
    return { points, mat, edges: chosen, t: t0, count: n };
  }

  function buildGlyphs(g) {
    const chars = ['0', '1', '\u03A3', '\u222B', '\u03C0', '\u03BB', '\u03C3', '\u03BC', '\u0394', '\u221E', '{', '}', '<', '>', '01', 'AI'];
    const atlas = U.glyphAtlas(chars, '#ffffff');
    atlas.flipY = false; atlas.needsUpdate = true;

    const n = GLYPH_COUNT;
    const positions = new Float32Array(n * 3);
    const glyphIdx = new Float32Array(n);
    const seeds = new Float32Array(n);
    const basePos = [];

    for (let i = 0; i < n; i++) {
      const r = 6.5 + Math.random() * 4.5;
      const theta = Math.random() * TAU;
      const phi = Math.acos(2 * Math.random() - 1);
      const v = new THREE.Vector3(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta) * 0.6,
        r * Math.cos(phi)
      );
      basePos.push(v);
      positions[i * 3] = v.x; positions[i * 3 + 1] = v.y; positions[i * 3 + 2] = v.z;
      glyphIdx[i] = Math.floor(Math.random() * chars.length);
      seeds[i] = Math.random();
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aGlyph', new THREE.BufferAttribute(glyphIdx, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: {
        uAtlas: { value: atlas }, uTime: { value: 0 }, uFade: { value: 1 },
        uPR: { value: Math.min(window.devicePixelRatio || 1, Q.dpr) }
      },
      vertexShader: `
        attribute float aGlyph, aSeed;
        uniform float uPR, uTime;
        varying float vGlyph;
        void main(){
          vGlyph = aGlyph;
          vec3 p = position;
          p.y += sin(uTime * 0.4 + aSeed * 40.0) * 0.25;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = 22.0 * uPR * (16.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D uAtlas; uniform float uFade;
        varying float vGlyph;
        void main(){
          vec2 cell = vec2(mod(vGlyph, 8.0), floor(vGlyph / 8.0));
          vec2 uv = (cell + gl_PointCoord) / 8.0;
          float a = texture2D(uAtlas, uv).a;
          gl_FragColor = vec4(1.0, 1.0, 1.0, a * uFade * 0.4);
        }`
    });

    const points = new THREE.Points(geo, mat);
    g.add(points);
    return { points, mat, basePos, count: n };
  }

  /* ==========================================================
     INTELLIGENCE FIELD
     A neural field of nodes and quietly firing connections,
     with a slow-turning data core at its center and mathematical
     glyphs drifting through the outer volume. The camera glides
     through it as the section scrolls, rather than sitting still.
     ========================================================== */
  R.add({
    id: 'intelligenceField',
    label: 'Intelligence Field',
    caption: 'A thousand small signals, learning to move as one.',
    warm: 0.15,

    keys: [
      { t: 0.00, pos: [0, 1.2, 15.5], look: [0, 0.3, 0] },   // wide establishing view of the whole field
      { t: 0.35, pos: [-4.5, 2.0, 10.0], look: [0.5, 0.4, 0] }, // drifting past the outer nodes
      { t: 0.65, pos: [3.0, -0.8, 7.2], look: [-0.3, 0.6, 0] }, // pushed close, looking up through the core
      { t: 1.00, pos: [0, 2.6, 12.5], look: [0, 0.2, 0] }        // pulling back, settling for the next section
    ],

    build(ctx) {
      const g = this.group;
      this.core = buildCore(g);
      this.field = buildNodeField(g);
      this.edges = buildEdges(g, this.field.basePos, this.field.count);
      this.packets = buildPackets(g, this.edges.edgeList);
      this.glyphs = buildGlyphs(g);
    },

    update(p, dt, ctx) {
      const t = ctx.time();
      const awaken = smoothstep(0.0, 0.22, p);            // the field wakes up as the hero begins
      const settle = 1 - smoothstep(0.82, 1.0, p) * 0.35;  // gentle ease-down into the next section
      const drive = awaken * settle;

      /* -- core: slow permanent spin, a little faster as you scroll -- */
      const coreSpin = 0.06 + p * 0.10;
      this.core.group.rotation.y += dt * coreSpin;
      this.core.group.rotation.x = Math.sin(t * 0.05) * 0.08;
      setOp(this.core.wire.material, 0.35 + drive * 0.35);
      setOp(this.core.solid.material, 0.06 + drive * 0.10);
      const glowPulse = 0.85 + 0.15 * Math.sin(t * 0.6);
      setOp(this.core.glow.material, drive * 0.45 * glowPulse);

      /* -- node field: each node drifts on its own slow orbit -- */
      const npos = this.field.points.geometry.attributes.position.array;
      for (let i = 0; i < this.field.count; i++) {
        const b = this.field.basePos[i];
        const s = this.field.seeds[i];
        const wob = 0.18 + s * 0.14;
        const speed = 0.15 + s * 0.25;
        npos[i * 3]     = b.x + Math.sin(t * speed + s * 30.0) * wob;
        npos[i * 3 + 1] = b.y + Math.cos(t * speed * 0.8 + s * 22.0) * wob * 0.8;
        npos[i * 3 + 2] = b.z + Math.sin(t * speed * 0.6 + s * 17.0) * wob;
      }
      this.field.points.geometry.attributes.position.needsUpdate = true;
      setOp(this.field.mat, 0.55 + drive * 0.35);

      /* -- edges follow the live node positions -- */
      const epos = this.edges.lines.geometry.attributes.position.array;
      for (let e = 0; e < this.edges.count; e++) {
        const pair = this.edges.edgeList[e];
        const i = pair[0], j = pair[1];
        epos[e * 6]     = npos[i * 3];     epos[e * 6 + 1] = npos[i * 3 + 1]; epos[e * 6 + 2] = npos[i * 3 + 2];
        epos[e * 6 + 3] = npos[j * 3];     epos[e * 6 + 4] = npos[j * 3 + 1]; epos[e * 6 + 5] = npos[j * 3 + 2];
      }
      this.edges.lines.geometry.attributes.position.needsUpdate = true;
      this.edges.mat.uniforms.uTime.value = t;
      this.edges.mat.uniforms.uActivity.value = drive;

      /* -- data packets ride a subset of the edges, speeding up slightly on scroll -- */
      const pspeed = 0.18 + p * 0.22;
      const ppos = this.packets.points.geometry.attributes.position.array;
      for (let k = 0; k < this.packets.count; k++) {
        this.packets.t[k] = (this.packets.t[k] + dt * pspeed) % 1;
        const pair = this.packets.edges[k];
        const i = pair[0], j = pair[1];
        const u = this.packets.t[k];
        ppos[k * 3]     = lerp(npos[i * 3],     npos[j * 3],     u);
        ppos[k * 3 + 1] = lerp(npos[i * 3 + 1], npos[j * 3 + 1], u);
        ppos[k * 3 + 2] = lerp(npos[i * 3 + 2], npos[j * 3 + 2], u);
      }
      this.packets.points.geometry.attributes.position.needsUpdate = true;
      setOp(this.packets.mat, drive * 0.75);

      /* -- floating glyphs drift, fading in as the deeper field reveals itself -- */
      this.glyphs.mat.uniforms.uTime.value = t;
      setOp(this.glyphs.mat, smoothstep(0.35, 0.9, p) * 0.5);
    }
  });
})();
