/* ============================================================
   DATA CORE — the About section's 3D scene.

   Registers itself as 'dataCore'. Unlike the hero, this scene
   isn't scroll-scrubbed by a pinned container — main.js mounts
   it with SceneRegistry.makeRevealProgress(), so `p` in
   update(p, dt, ctx) is an activation value that eases toward 1
   while the section is on screen and back toward 0 when it
   isn't. Camera stays effectively still; the core itself is
   what moves — it assembles from scattered points into a formed
   shell as the section comes into view.

   Load order: cine-utils.js -> scene-registry.js -> data/brand.js
   -> this file -> main.js.
   ============================================================ */

(function () {
  'use strict';

  const U = window.CineUtils;
  const { lerp, clamp, smoothstep, easeInOut } = U;
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
  function threeColor(c) { return new THREE.Color(c.r, c.g, c.b); }

  const CORE_RGB = parseRGBA(CORE_COLOR_RGBA);
  const ACCENT_RGB = parseRGBA(ACCENT_COLOR_RGBA);
  const CORE_THREE = threeColor(CORE_RGB);

  const SHELL_COUNT = Q.low ? 60 : 130;
  const LINE_COUNT = Q.low ? 8 : 18;

  function fibonacciSphere(n, radius) {
    const pts = [];
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const y = 1 - (i / Math.max(n - 1, 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = golden * i;
      pts.push(new THREE.Vector3(Math.cos(theta) * r * radius, y * radius, Math.sin(theta) * r * radius));
    }
    return pts;
  }

  function buildCore(g) {
    const core = new THREE.Group();
    const geo = new THREE.IcosahedronGeometry(1.15, 1);

    const wire = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: CORE_THREE, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    core.add(wire);

    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: U.radialTexture(CORE_COLOR_RGBA, CORE_COLOR_RGBA.replace(/[\d.]+\)$/, '0.04)'), 256),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.5
    }));
    glow.scale.set(6.5, 6.5, 1);
    core.add(glow);

    g.add(core);
    return { group: core, wire, glow };
  }

  function buildShell(g) {
    const n = SHELL_COUNT;
    const target = fibonacciSphere(n, 2.3);
    const start = target.map(() => {
      const r = 4.5 + Math.random() * 3.5;
      const theta = Math.random() * TAU;
      const phi = Math.acos(2 * Math.random() - 1);
      return new THREE.Vector3(r * Math.sin(phi) * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta), r * Math.cos(phi));
    });

    const positions = new Float32Array(n * 3);
    const seeds = new Float32Array(n);
    for (let i = 0; i < n; i++) seeds[i] = Math.random();

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
          gl_PointSize = (2.6 + aSeed * 2.4) * uPR * (40.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying float vSeed; uniform float uFade; uniform vec3 uColor;
        void main(){
          float d = length(gl_PointCoord - 0.5);
          float a = pow(smoothstep(0.5, 0.0, d), 1.8);
          gl_FragColor = vec4(uColor * (0.85 + vSeed * 0.3), a * uFade);
        }`
    });

    const points = new THREE.Points(geo, mat);
    g.add(points);
    return { points, mat, start, target, seeds, count: n };
  }

  function buildLines(g, target, count) {
    const pairs = [];
    for (let e = 0; e < LINE_COUNT; e++) {
      const i = Math.floor(Math.random() * count);
      let j = Math.floor(Math.random() * count);
      if (j === i) j = (j + 1) % count;
      pairs.push([i, j]);
    }
    const positions = new Float32Array(pairs.length * 2 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.LineBasicMaterial({
      color: new THREE.Color(ACCENT_RGB.r, ACCENT_RGB.g, ACCENT_RGB.b),
      transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false
    });
    const lines = new THREE.LineSegments(geo, mat);
    g.add(lines);
    return { lines, mat, pairs };
  }

  function buildRings(g) {
    const mkRing = (radius, tilt, color) => {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(radius, radius + 0.02, 64),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      ring.rotation.x = tilt;
      g.add(ring);
      return ring;
    };
    return [
      mkRing(3.1, Math.PI * 0.42, new THREE.Color(ACCENT_RGB.r, ACCENT_RGB.g, ACCENT_RGB.b)),
      mkRing(3.7, Math.PI * 0.58, CORE_THREE)
    ];
  }

  R.add({
    id: 'dataCore',
    label: 'Data Core',
    caption: 'What the association is: a shape assembling itself, one node at a time.',
    warm: 0.1,
    keys: [
      { t: 0, pos: [0, 0.3, 7.4], look: [0, 0.1, 0] },
      { t: 1, pos: [0, 0.3, 7.4], look: [0, 0.1, 0] }
    ],

    build(ctx) {
      const g = this.group;
      this.core = buildCore(g);
      this.shell = buildShell(g);
      this.lines = buildLines(g, this.shell.target, this.shell.count);
      this.rings = buildRings(g);
    },

    update(p, dt, ctx) {
      const t = ctx.time();
      const form = easeInOut(p);

      this.core.group.rotation.y += dt * (0.08 + p * 0.12);
      setOp(this.core.wire.material, 0.15 + form * 0.35);
      setOp(this.core.glow.material, 0.15 + form * 0.4 * (0.85 + 0.15 * Math.sin(t * 0.7)));

      const pos = this.shell.points.geometry.attributes.position.array;
      for (let i = 0; i < this.shell.count; i++) {
        const s = this.shell.seeds[i];
        const stagger = s * 0.4;
        const f = clamp((form - stagger) / (1 - 0.4), 0, 1);
        const e = f * f * (3 - 2 * f);
        const a = this.shell.start[i], b = this.shell.target[i];
        const wob = (1 - e) * 0.6;
        pos[i * 3]     = lerp(a.x, b.x, e) + Math.sin(t * 0.6 + s * 20.0) * 0.05 + Math.sin(t + i) * wob * 0.2;
        pos[i * 3 + 1] = lerp(a.y, b.y, e) + Math.cos(t * 0.5 + s * 15.0) * 0.05;
        pos[i * 3 + 2] = lerp(a.z, b.z, e) + Math.sin(t * 0.4 + s * 12.0) * 0.05;
      }
      this.shell.points.geometry.attributes.position.needsUpdate = true;
      setOp(this.shell.mat, 0.2 + form * 0.6);

      const lpos = this.lines.lines.geometry.attributes.position.array;
      this.lines.pairs.forEach((pair, e) => {
        const i = pair[0], j = pair[1];
        lpos[e * 6] = pos[i * 3]; lpos[e * 6 + 1] = pos[i * 3 + 1]; lpos[e * 6 + 2] = pos[i * 3 + 2];
        lpos[e * 6 + 3] = pos[j * 3]; lpos[e * 6 + 4] = pos[j * 3 + 1]; lpos[e * 6 + 5] = pos[j * 3 + 2];
      });
      this.lines.lines.geometry.attributes.position.needsUpdate = true;
      setOp(this.lines.mat, form * 0.35);

      this.rings.forEach((ring, i) => {
        ring.rotation.z += dt * (0.06 + i * 0.03) * (i % 2 === 0 ? 1 : -1);
        setOp(ring.material, form * 0.22);
      });
    }
  });
})();
