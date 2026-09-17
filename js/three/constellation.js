/* ============================================================
   INTELLIGENCE CONSTELLATION — the members page's background scene.

   Registers itself as 'constellation'. Mounted as a full-viewport
   fixed background behind the member cards: an ambient star/node
   field with quiet connections, symbolizing students connected
   through knowledge. No names or labels live in this scene by
   design — that information belongs to the HTML cards, not the
   canvas. Camera holds still; everything else drifts slowly.

   Load order: cine-utils.js -> scene-registry.js -> data/brand.js
   -> this file -> main.js.
   ============================================================ */

(function () {
  'use strict';

  const U = window.CineUtils;
  const { lerp, clamp, smoothstep } = U;
  const Q = U.Q;
  const R = window.SceneRegistry;

  const setOp = (mat, v) => { mat.userData.baseOpacity = v; };
  const TAU = Math.PI * 2;

  const BRAND = window.BrandColors || {};
  const CORE_COLOR_RGBA = BRAND.coreRGBA || 'rgba(111,216,255,0.95)';
  const ACCENT_COLOR_RGBA = BRAND.accentRGBA || 'rgba(150,130,255,0.9)';

  function parseRGBA(str) {
    const m = str.match(/rgba?\(([^)]+)\)/);
    const parts = m[1].split(',').map((s) => parseFloat(s));
    return { r: parts[0] / 255, g: parts[1] / 255, b: parts[2] / 255 };
  }
  const CORE_RGB = parseRGBA(CORE_COLOR_RGBA);
  const ACCENT_RGB = parseRGBA(ACCENT_COLOR_RGBA);

  const STAR_COUNT = Q.low ? 90 : 220;
  const NODE_COUNT = Q.low ? 46 : 100;
  const EDGE_K = 2;
  const EDGE_MAX_DIST = 2.6;

  function scatter(n, rMin, rMax, flatten) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const r = rMin + Math.random() * (rMax - rMin);
      const theta = Math.random() * TAU;
      const phi = Math.acos(2 * Math.random() - 1);
      pts.push(new THREE.Vector3(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta) * (flatten || 1),
        r * Math.cos(phi)
      ));
    }
    return pts;
  }

  function buildStars(g) {
    const base = scatter(STAR_COUNT, 5, 13, 0.6);
    const n = base.length;
    const positions = new Float32Array(n * 3);
    const seeds = new Float32Array(n);
    base.forEach((v, i) => { positions[i * 3] = v.x; positions[i * 3 + 1] = v.y; positions[i * 3 + 2] = v.z; seeds[i] = Math.random(); });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uFade: { value: 1 }, uPR: { value: Math.min(window.devicePixelRatio || 1, Q.dpr) } },
      vertexShader: `
        attribute float aSeed; uniform float uPR; varying float vSeed;
        void main(){
          vSeed = aSeed;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = (1.4 + aSeed * 1.6) * uPR * (30.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying float vSeed; uniform float uFade;
        void main(){
          float d = length(gl_PointCoord - 0.5);
          float a = pow(smoothstep(0.5, 0.0, d), 2.0);
          gl_FragColor = vec4(vec3(0.75, 0.8, 0.95), a * (0.3 + vSeed * 0.4) * uFade);
        }`
    });

    const points = new THREE.Points(geo, mat);
    g.add(points);
    return { points, mat, base, seeds, count: n };
  }

  function buildNodes(g) {
    const base = scatter(NODE_COUNT, 2.2, 5.6, 0.75);
    const n = base.length;
    const positions = new Float32Array(n * 3);
    const seeds = new Float32Array(n);
    base.forEach((v, i) => { positions[i * 3] = v.x; positions[i * 3 + 1] = v.y; positions[i * 3 + 2] = v.z; seeds[i] = Math.random(); });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: {
        uFade: { value: 1 }, uPR: { value: Math.min(window.devicePixelRatio || 1, Q.dpr) },
        uColor: { value: new THREE.Vector3(CORE_RGB.r, CORE_RGB.g, CORE_RGB.b) }
      },
      vertexShader: `
        attribute float aSeed; uniform float uPR; varying float vSeed;
        void main(){
          vSeed = aSeed;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = (2.4 + aSeed * 2.2) * uPR * (34.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying float vSeed; uniform float uFade; uniform vec3 uColor;
        void main(){
          float d = length(gl_PointCoord - 0.5);
          float a = pow(smoothstep(0.5, 0.0, d), 1.8);
          gl_FragColor = vec4(uColor, a * (0.4 + vSeed * 0.4) * uFade);
        }`
    });

    const points = new THREE.Points(geo, mat);
    g.add(points);
    return { points, mat, base, seeds, count: n };
  }

  function buildEdges(g, base, count) {
    const pairSet = new Set();
    const edgeList = [];
    for (let i = 0; i < count; i++) {
      const dists = [];
      for (let j = 0; j < count; j++) {
        if (i === j) continue;
        const d = base[i].distanceTo(base[j]);
        if (d < EDGE_MAX_DIST) dists.push([d, j]);
      }
      dists.sort((a, b) => a[0] - b[0]);
      for (let k = 0; k < Math.min(EDGE_K, dists.length); k++) {
        const j = dists[k][1];
        const key = i < j ? i + '_' + j : j + '_' + i;
        if (!pairSet.has(key)) { pairSet.add(key); edgeList.push([i, j]); }
      }
    }

    const m = edgeList.length;
    const positions = new Float32Array(m * 2 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: {
        uFade: { value: 1 }, uTime: { value: 0 },
        uColor: { value: new THREE.Vector3(ACCENT_RGB.r, ACCENT_RGB.g, ACCENT_RGB.b) }
      },
      vertexShader: `void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform float uFade, uTime; uniform vec3 uColor;
        void main(){ gl_FragColor = vec4(uColor, 0.16 * uFade); }`
    });

    const lines = new THREE.LineSegments(geo, mat);
    g.add(lines);
    return { lines, mat, edgeList, count: m };
  }

  R.add({
    id: 'constellation',
    label: 'Intelligence Constellation',
    caption: 'Students, connected through knowledge, forming one community.',
    warm: 0.2,
    keys: [
      { t: 0, pos: [0, 0.4, 9.5], look: [0, 0, 0] },
      { t: 1, pos: [0, 0.4, 9.5], look: [0, 0, 0] }
    ],

    build(ctx) {
      const g = this.group;
      this.stars = buildStars(g);
      this.nodes = buildNodes(g);
      this.edges = buildEdges(g, this.nodes.base, this.nodes.count);
    },

    update(p, dt, ctx) {
      const t = ctx.time();
      const intro = smoothstep(0, 2.2, t);

      this.group.rotation.y += dt * 0.015;

      const spos = this.stars.points.geometry.attributes.position.array;
      for (let i = 0; i < this.stars.count; i++) {
        const b = this.stars.base[i], s = this.stars.seeds[i];
        spos[i * 3]     = b.x + Math.sin(t * 0.05 + s * 20.0) * 0.15;
        spos[i * 3 + 1] = b.y + Math.cos(t * 0.04 + s * 16.0) * 0.15;
        spos[i * 3 + 2] = b.z;
      }
      this.stars.points.geometry.attributes.position.needsUpdate = true;
      setOp(this.stars.mat, intro * 0.8);

      const npos = this.nodes.points.geometry.attributes.position.array;
      for (let i = 0; i < this.nodes.count; i++) {
        const b = this.nodes.base[i], s = this.nodes.seeds[i];
        npos[i * 3]     = b.x + Math.sin(t * (0.1 + s * 0.15) + s * 30.0) * 0.35;
        npos[i * 3 + 1] = b.y + Math.cos(t * (0.08 + s * 0.12) + s * 22.0) * 0.35;
        npos[i * 3 + 2] = b.z + Math.sin(t * (0.07 + s * 0.1) + s * 17.0) * 0.35;
      }
      this.nodes.points.geometry.attributes.position.needsUpdate = true;
      setOp(this.nodes.mat, intro * 0.85);

      const epos = this.edges.lines.geometry.attributes.position.array;
      for (let e = 0; e < this.edges.count; e++) {
        const pair = this.edges.edgeList[e];
        const i = pair[0], j = pair[1];
        epos[e * 6] = npos[i * 3]; epos[e * 6 + 1] = npos[i * 3 + 1]; epos[e * 6 + 2] = npos[i * 3 + 2];
        epos[e * 6 + 3] = npos[j * 3]; epos[e * 6 + 4] = npos[j * 3 + 1]; epos[e * 6 + 5] = npos[j * 3 + 2];
      }
      this.edges.lines.geometry.attributes.position.needsUpdate = true;
      this.edges.mat.uniforms.uTime.value = t;
      setOp(this.edges.mat, intro);
    }
  });
})();
