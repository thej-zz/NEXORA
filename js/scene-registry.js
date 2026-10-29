/* ============================================================
   SceneRegistry v2 — ONE shared WebGL renderer for every 3D chapter.

   WHAT CHANGED IN PHASE 2 (public API is backward compatible)
   - add(def), mount(id, canvas, options), makePinnedProgress(el) and
     makeRevealProgress(el) keep their signatures. A def may still be
     { id, keys, build(ctx), update(p, dt, ctx) }. New optional members:
     resize(w, h, ctx), afterRender(p, ctx), dispose(ctx), fov, cameraMode: 'spline',
     parallax: { x, y }, defaultLights: false, usesOpacityProxy: false.
   - mount() no longer creates a renderer per scene. All scenes render with
     ONE WebGLRenderer on ONE detached <canvas> (one GL context). Each scene
     is drawn into its own region of that canvas and copied (drawImage) into
     the visible <canvas> that lives in its section, so the picture always
     scrolls with the page's own compositor — no scroll-linked overlay lag.
   - ONE requestAnimationFrame loop, scheduled on demand: scroll, resize,
     pointer and visibility events wake it; it goes idle by itself once every
     visible scene has settled. Nothing runs for off-screen scenes or in a
     hidden tab.
   - Scene state is a pure function of a normalised progress value 0..1.
     Displayed progress is a critically-damped follower of the scroll target,
     so the same scroll position always converges to the same picture and
     reversing the scroll reverses the motion.
   - Real teardown: geometries, materials, textures, observers, listeners,
     the environment map and finally the renderer / GL context are released.
   - Context loss is handled (static fallback is restored via 'lost' state).

   Extra helpers: makeSectionProgress(el), onState(fn), supported(),
   stats(), disposeAll().
   ============================================================ */

(function () {
  'use strict';

  const U = window.CineUtils;
  if (!U) { console.warn('[SceneRegistry] js/cine-utils.js must load first.'); return; }
  const { lerp, clamp } = U;
  const Q = U.Q;

  const SMOOTH_TAU = 0.09;            // seconds the shown progress takes to follow the scroll target

  const registry = {};
  const views = new Map();
  const list = [];                    // views as an array: the frame loop iterates without allocating
  const subs = [];
  const live = [];                    // every listener this module adds — proves teardown removes them
  let shared = null;
  let globals = null;
  let rafId = 0, last = 0, frames = 0, renders = 0, paused = false, anyParallax = false, hasDynamic = false;
  const pointer = { x: 0, y: 0 };
  const gov = { n: 0, ema: 0 };

  /* ---------- small infrastructure ---------- */

  function listen(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    const rec = { target, type, fn, opts };
    live.push(rec);
    return rec;
  }
  function unlisten(rec) {
    rec.target.removeEventListener(rec.type, rec.fn, rec.opts);
    const i = live.indexOf(rec);
    if (i > -1) live.splice(i, 1);
  }

  function emit(id, state) {
    subs.slice().forEach((fn) => {
      try { fn(id, state); } catch (e) { console.warn('[SceneRegistry] state subscriber failed:', e); }
    });
  }
  function onState(fn) { if (typeof fn === 'function') subs.push(fn); }

  function supported() { return !!(window.THREE && window.WebGLRenderingContext); }

  function add(def) {
    if (!def || !def.id) { console.warn('[SceneRegistry] add() needs a def with an id'); return; }
    registry[def.id] = def;
  }

  /* ---------- frame scheduling (on demand, never an idle loop) ---------- */

  function cancelFrame() { if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } }
  function schedule() {
    if (rafId || paused || document.hidden || !shared || shared.lost || !list.length) return;
    rafId = requestAnimationFrame(frame);
  }
  function invalidate() { schedule(); }

  /* ---------- progress sources ---------- */

  /* document-space top of an element; offsetTop ignores CSS transforms, so a
     .reveal element that is still translated 18px measures correctly */
  function docTop(el) { let y = 0; while (el) { y += el.offsetTop; el = el.offsetParent; } return y; }

  /* Progress through a tall wrapper whose first child is pinned (position: sticky):
     0 when the wrapper reaches the top of the viewport, 1 when its pinned range ends.
     If the child is NOT sticky (phones / short screens, see css section 19) the story
     instead plays over the first 70% of the section's own height as it scrolls away.
     Geometry is cached and refreshed on resize / layout change (including the one
     getComputedStyle), so the per-frame call is arithmetic only — no layout reads. */
  function makePinnedProgress(container) {
    let top = 0, height = 0, vh = 0, pinned = false;
    const fn = function () {
      const y = window.scrollY - top;
      if (pinned) {
        const total = height - vh;
        return total > 1 ? clamp(y / total, 0, 1) : 0;
      }
      return height > 0 ? clamp(y / (height * 0.7), 0, 1) : 0;
    };
    fn.refresh = function () {
      top = docTop(container); height = container.offsetHeight; vh = window.innerHeight;
      const inner = container.firstElementChild;
      pinned = !!inner && window.getComputedStyle(inner).position === 'sticky';
    };
    fn.refresh();
    return fn;
  }

  /* Progress of an element through the viewport.
       default        0 when its top edge enters the bottom of the viewport, 1 when its bottom
                      edge leaves the top: the element's whole visible lifetime.
       { center:true } 0 when its CENTRE is on the bottom edge, 0.5 when the centre is at the middle
                      of the screen (where a visitor reads), 1 when the centre reaches the top edge.
                      Use this when the choreography must happen where the element is comfortably visible. */
  function makeSectionProgress(el, opts) {
    const center = !!(opts && opts.center);
    let top = 0, height = 0, vh = 0;
    const fn = function () {
      const y = top - window.scrollY;
      return center ? clamp((vh - (y + height / 2)) / vh, 0, 1) : clamp((vh - y) / (vh + height), 0, 1);
    };
    fn.refresh = function () { top = docTop(el); height = el.offsetHeight; vh = window.innerHeight; };
    fn.refresh();
    return fn;
  }

  /* Legacy helper (unchanged contract): eases toward 1 while `el` is on screen
     and back toward 0 when it is not. */
  function makeRevealProgress(el, opts) {
    opts = opts || {};
    let target = Q.reducedMotion ? 1 : 0;
    let current = target;
    let io = null;
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver((entries) => {
        entries.forEach((e) => { target = e.isIntersecting ? 1 : 0; });
        invalidate();
      }, { threshold: opts.threshold || 0.2 });
      io.observe(el);
    } else { target = current = 1; }
    const fn = function (dt) {
      const damp = 1 - Math.pow(0.001, dt);
      current = lerp(current, target, clamp(damp, 0, 1));
      return current;
    };
    fn.isSettled = () => Math.abs(current - target) < 0.001;
    fn.dispose = () => { if (io) io.disconnect(); io = null; };
    return fn;
  }

  /* ---------- camera keys ---------- */

  const camOut = { px: 0, py: 0, pz: 0, lx: 0, ly: 0, lz: 0, fov: 0 };
  const catmull = (a, b, c, d, t) => {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  };

  /* keys: [{ t, pos:[x,y,z], look:[x,y,z], fov? }]. Default easing is the
     original smoothstep between key pairs; spline = Catmull-Rom through the
     keys (continuous velocity, used by the hero). Writes into `out` — no allocation. */
  function interpolateCamera(keys, p, spline, out) {
    const n = keys.length;
    let i = 0;
    while (i < n - 2 && p > keys[i + 1].t) i++;
    const k0 = keys[i], k1 = keys[Math.min(i + 1, n - 1)];
    const u0 = clamp((p - k0.t) / ((k1.t - k0.t) || 1), 0, 1);
    if (!spline) {
      const u = u0 * u0 * (3 - 2 * u0);
      out.px = lerp(k0.pos[0], k1.pos[0], u); out.py = lerp(k0.pos[1], k1.pos[1], u); out.pz = lerp(k0.pos[2], k1.pos[2], u);
      out.lx = lerp(k0.look[0], k1.look[0], u); out.ly = lerp(k0.look[1], k1.look[1], u); out.lz = lerp(k0.look[2], k1.look[2], u);
    } else {
      const kA = keys[Math.max(i - 1, 0)], kB = keys[Math.min(i + 2, n - 1)];
      out.px = catmull(kA.pos[0], k0.pos[0], k1.pos[0], kB.pos[0], u0);
      out.py = catmull(kA.pos[1], k0.pos[1], k1.pos[1], kB.pos[1], u0);
      out.pz = catmull(kA.pos[2], k0.pos[2], k1.pos[2], kB.pos[2], u0);
      out.lx = catmull(kA.look[0], k0.look[0], k1.look[0], kB.look[0], u0);
      out.ly = catmull(kA.look[1], k0.look[1], k1.look[1], kB.look[1], u0);
      out.lz = catmull(kA.look[2], k0.look[2], k1.look[2], kB.look[2], u0);
    }
    out.fov = (k0.fov != null && k1.fov != null) ? lerp(k0.fov, k1.fov, u0 * u0 * (3 - 2 * u0)) : 0;
    return out;
  }

  /* Legacy opacity proxy: scenes call setOp(mat, v) -> mat.userData.baseOpacity.
     Only walked for defs that have not opted out (usesOpacityProxy: false). */
  function fadeVisitor(obj) {
    const mat = obj.material;
    if (!mat) return;
    if (Array.isArray(mat)) {
      mat.forEach((m) => { if (m.userData && m.userData.baseOpacity !== undefined) m.opacity = m.userData.baseOpacity; });
    } else if (mat.userData && mat.userData.baseOpacity !== undefined) {
      mat.opacity = mat.userData.baseOpacity;
    }
  }

  /* ---------- disposal ---------- */

  function disposeMaterial(m) {
    for (const k in m) { const t = m[k]; if (t && t.isTexture) t.dispose(); }
    m.dispose();
  }
  function disposeTree(root) {
    root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.isInstancedMesh && o.dispose) o.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(disposeMaterial);
    });
  }

  /* ---------- shared renderer ---------- */

  /* A small procedural "photo studio": a dark room with a few emissive softboxes,
     pre-filtered once with PMREM. Metals need something to reflect; this is what
     makes machined aluminium read as aluminium instead of flat grey. */
  function buildEnvironment(renderer) {
    const T = THREE;
    const env = new T.Scene();
    env.add(new T.Mesh(new T.BoxGeometry(30, 20, 30), new T.MeshBasicMaterial({ color: 0x07090c, side: T.BackSide })));
    const panel = (w, h, x, y, z, r, g, b) => {
      const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ side: T.DoubleSide, toneMapped: false }));
      m.material.color.setRGB(r, g, b);
      m.position.set(x, y, z);
      m.lookAt(0, 0, 0);
      env.add(m);
    };
    panel(12, 7, -3, 9, 2, 4.2, 4.1, 4.0);      // overhead key softbox
    panel(4, 9, -10, 3, 5, 3.0, 3.0, 3.1);       // left strip
    panel(1.4, 11, 9, 4, -7, 3.0, 4.2, 6.8);     // right-rear strip, cool (rim)
    panel(6, 1.6, 6, 7, 8, 2.2, 2.4, 2.8);       // front-right top accent
    panel(16, 16, 0, -5, 0, 0.30, 0.32, 0.36);   // floor bounce
    const pm = new T.PMREMGenerator(renderer);
    const rt = pm.fromScene(env, 0.03);
    pm.dispose();
    env.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    return rt;
  }

  function ensureShared() {
    if (shared) return shared;
    if (!window.THREE) throw new Error('THREE is not loaded');
    const canvas = document.createElement('canvas');            // detached: never in the DOM
    /* failIfMajorPerformanceCaveat: the browser returns null instead of a software (CPU) context, so a machine
       without GPU acceleration shows the static illustrations instead of freezing on shader compilation.
       Q.allowSoftware (window.NEXORA_3D.allowSoftware) lifts it — the browser tests do, to run without a GPU. */
    const attrs = { alpha: true, antialias: true, premultipliedAlpha: true, powerPreference: 'high-performance', stencil: false,
                    failIfMajorPerformanceCaveat: !Q.allowSoftware };
    /* create the context ourselves (no probe context, no console noise when WebGL is missing) */
    const gl = canvas.getContext('webgl2', attrs) || canvas.getContext('webgl', attrs);
    if (!gl) throw new Error('WebGL is unavailable' + (Q.allowSoftware ? '' : ' or software-only (set NEXORA_3D.allowSoftware to force it)'));
    const renderer = new THREE.WebGLRenderer({ canvas, context: gl, alpha: true, antialias: true });
    renderer.setPixelRatio(1);                                   // sizes below are DEVICE pixels
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.autoClear = false;
    renderer.setClearColor(0x000000, 0);
    renderer.setScissorTest(true);

    const s = { canvas, renderer, env: null, lost: false, recs: [], dprCap: Q.dpr, dpr: 1 };
    s.dpr = Math.min(window.devicePixelRatio || 1, s.dprCap);
    try { s.env = buildEnvironment(renderer); } catch (err) { renderer.dispose(); throw err; }

    s.recs.push(listen(canvas, 'webglcontextlost', onContextLost, false));
    s.recs.push(listen(canvas, 'webglcontextrestored', onContextRestored, false));
    shared = s;
    return s;
  }

  function onContextLost(e) {
    e.preventDefault();                                          // allows restoration
    shared.lost = true;
    cancelFrame();
    list.forEach((v) => emit(v.id, 'lost'));
  }
  function onContextRestored() {
    if (!shared) return;
    try {                                                        // the pre-filtered env died with the context
      /* the old render target is NOT disposed: its GPU objects belonged to the lost context, so
         deleting them now only produces INVALID_OPERATION warnings. Dropping the reference is enough. */
      shared.env = buildEnvironment(shared.renderer);
      list.forEach((v) => { v.scene.environment = shared.env.texture; v.ctx.env = shared.env.texture; });
    } catch (err) { console.warn('[SceneRegistry] could not rebuild the environment after context restore:', err); }
    shared.lost = false;
    list.forEach((v) => { v.rendered = false; v.needsRender = true; v.sizeDirty = true; });
    schedule();
  }

  function teardownShared() {
    cancelFrame();
    if (globals) { globals.recs.forEach(unlisten); if (globals.ro) globals.ro.disconnect(); globals = null; }
    if (!shared) return;
    shared.recs.forEach(unlisten);
    try { if (shared.env) shared.env.dispose(); } catch (e) { /* already gone */ }
    try { shared.renderer.dispose(); shared.renderer.forceContextLoss(); } catch (e) { /* already gone */ }
    shared = null;
  }

  /* ---------- sizing ---------- */

  function syncGL() {
    if (!shared) return;
    let W = 1, H = 1;
    list.forEach((v) => { W = Math.max(W, v.pw || 1); H = Math.max(H, v.ph || 1); });
    if (shared.canvas.width !== W || shared.canvas.height !== H) shared.renderer.setSize(W, H, false);
  }

  function applySize(v) {
    const maxDim = shared.renderer.capabilities.maxTextureSize || 4096;
    const cw = Math.max(1, v.cssW), ch = Math.max(1, v.cssH);
    const dpr = Math.min(shared.dpr, maxDim / Math.max(cw, ch));
    const pw = Math.max(1, Math.floor(cw * dpr)), ph = Math.max(1, Math.floor(ch * dpr));
    if (v.canvas.width !== pw) v.canvas.width = pw;
    if (v.canvas.height !== ph) v.canvas.height = ph;
    v.pw = pw; v.ph = ph; v.sizeDirty = false; v.needsRender = true;
    const sz = v.ctx.size;
    sz.w = pw; sz.h = ph; sz.cssW = cw; sz.cssH = ch;
    v.camera.aspect = pw / ph;
    v.camera.updateProjectionMatrix();
    if (v.def.resize) v.def.resize(pw, ph, v.ctx);
    syncGL();
  }

  /* ---------- the frame ---------- */

  function renderView(v, dt) {
    const r = shared.renderer, cam = v.camera, def = v.def;
    def.update(v.p, dt, v.ctx);
    if (def.usesOpacityProxy !== false && def.group) def.group.traverse(fadeVisitor);
    if (def.keys && def.keys.length) {
      const c = interpolateCamera(def.keys, v.p, def.cameraMode === 'spline', camOut);
      cam.position.set(c.px, c.py, c.pz);
      if (v.parallax) { cam.position.x += v.par.x * v.parallax.x; cam.position.y -= v.par.y * v.parallax.y; }
      if (c.fov && Math.abs(c.fov - cam.fov) > 1e-4) { cam.fov = c.fov; cam.updateProjectionMatrix(); }
      cam.lookAt(c.lx, c.ly, c.lz);
    }
    r.setViewport(0, 0, v.pw, v.ph);
    r.setScissor(0, 0, v.pw, v.ph);
    r.clear(true, true, false);
    r.render(v.scene, cam);
    /* WebGL's origin is bottom-left; drawImage's source origin is top-left */
    v.ctx2d.clearRect(0, 0, v.pw, v.ph);
    v.ctx2d.drawImage(shared.canvas, 0, shared.canvas.height - v.ph, v.pw, v.ph, 0, 0, v.pw, v.ph);
    renders++;
    if (def.afterRender) def.afterRender(v.p, v.ctx);
    if (!v.rendered) { v.rendered = true; emit(v.id, 'ready'); }
  }

  /* Steps the pixel-ratio cap down if the machine cannot hold ~30 fps while a
     scene is actively animating. It never steps back up (no oscillation). */
  function governor(dt) {
    gov.ema = gov.n ? gov.ema * 0.9 + dt * 0.1 : dt;
    gov.n++;
    if (gov.n < 45 || gov.ema < 0.034 || shared.dprCap <= 1) return;
    shared.dprCap = Math.max(1, shared.dprCap - 0.25);
    shared.dpr = Math.min(window.devicePixelRatio || 1, shared.dprCap);
    gov.n = 0; gov.ema = 0;
    list.forEach((v) => { v.sizeDirty = true; });
  }

  function frame(now) {
    rafId = 0;
    if (!shared || shared.lost || paused || document.hidden) return;
    frames++;
    const consecutive = last && now - last < 60;
    const dt = clamp(last ? (now - last) / 1000 : 0.016, 0.001, 0.1);
    last = now;
    const reduced = Q.reducedMotion;
    let moving = false, drew = false;

    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      if (v.sizeDirty) applySize(v);
      if (!v.static && !v.visible) continue;
      let want = v.needsRender || !v.rendered;

      if (!v.static) {
        const target = clamp(v.getProgress(dt), 0, 1);
        v.target = target;
        let p = v.p;
        if (!v.rendered || reduced) p = target;
        else {
          p += (target - p) * (1 - Math.exp(-dt / SMOOTH_TAU));
          if (Math.abs(target - p) < 0.0004) p = target;
        }
        if (p !== v.p) { v.p = p; want = true; }
        if (v.p !== v.target) moving = true;
        if (v.getProgress.isSettled && !v.getProgress.isSettled()) moving = true;

        if (v.parallax) {
          const k = 1 - Math.exp(-dt / 0.22);
          const nx = v.par.x + (pointer.x - v.par.x) * k;
          const ny = v.par.y + (pointer.y - v.par.y) * k;
          if (Math.abs(nx - v.par.x) > 0.0004 || Math.abs(ny - v.par.y) > 0.0004) want = true;
          v.par.x = nx; v.par.y = ny;
          if (Math.abs(pointer.x - nx) > 0.002 || Math.abs(pointer.y - ny) > 0.002) moving = true;
        }
      }
      if (want) { renderView(v, dt); drew = true; v.needsRender = false; }
    }

    if (drew && moving && consecutive && Q.adaptive) governor(dt);
    if (moving) schedule();            // keep going only until every scene has settled
  }

  /* ---------- global listeners (installed once, removed at teardown) ---------- */

  function refreshMetrics() {
    list.forEach((v) => { if (v.getProgress && v.getProgress.refresh) v.getProgress.refresh(); });
    invalidate();
  }
  function onResize() {
    if (shared) shared.dpr = Math.min(window.devicePixelRatio || 1, shared.dprCap);
    list.forEach((v) => { v.sizeDirty = true; });
    refreshMetrics();
  }
  function onVisibility() {
    if (document.hidden) cancelFrame();
    else { last = 0; invalidate(); }
  }
  function onPageHide(e) {
    if (e.persisted) { paused = true; cancelFrame(); }      // going into the back/forward cache
    else disposeAll();                                       // genuine unload: release everything
  }
  function onPageShow(e) {
    if (e.persisted) { paused = false; last = 0; invalidate(); }
  }
  function onScroll() { if (hasDynamic) invalidate(); }
  function onPointer(e) {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    pointer.x = (e.clientX / (window.innerWidth || 1) - 0.5) * 2;
    pointer.y = (e.clientY / (window.innerHeight || 1) - 0.5) * 2;
    if (anyParallax) invalidate();
  }

  function installGlobals() {
    if (globals) return;
    globals = { recs: [], ro: null };
    const g = globals.recs;
    g.push(listen(window, 'scroll', onScroll, { passive: true }));
    g.push(listen(window, 'resize', onResize));
    g.push(listen(window, 'load', refreshMetrics));
    g.push(listen(document, 'visibilitychange', onVisibility));
    g.push(listen(window, 'pagehide', onPageHide));
    g.push(listen(window, 'pageshow', onPageShow));
    g.push(listen(window, 'pointermove', onPointer, { passive: true }));
    if ('ResizeObserver' in window) { globals.ro = new ResizeObserver(refreshMetrics); globals.ro.observe(document.body); }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(refreshMetrics);
  }

  /* ---------- mount / unmount ---------- */

  function mount(id, canvas, options) {
    options = options || {};
    const def = registry[id];
    if (!def) { console.warn('[SceneRegistry] unknown scene id:', id); return null; }
    if (views.has(id)) {
      console.warn('[SceneRegistry] "' + id + '" is already mounted — duplicate mount ignored.');
      return views.get(id).handle;
    }
    if (!canvas) { console.warn('[SceneRegistry] mount("' + id + '") needs a canvas'); return null; }
    if (!supported()) return null;

    let sh;
    try { sh = ensureShared(); } catch (err) { console.info('[SceneRegistry] 3D unavailable:', err.message); return null; }   // expected degradation, not a fault
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) { console.warn('[SceneRegistry] no 2D context for', id); if (!views.size) teardownShared(); return null; }

    if (!def.keys || !def.keys.length) {
      def.keys = [{ t: 0, pos: [0, 0, 8], look: [0, 0, 0] }, { t: 1, pos: [0, 0, 8], look: [0, 0, 0] }];
    }

    const scene = new THREE.Scene();
    scene.environment = sh.env.texture;
    const camera = new THREE.PerspectiveCamera(def.fov || 35, 1, 0.1, 120);
    def.group = new THREE.Group();
    scene.add(def.group);
    if (def.defaultLights !== false && options.defaultLights !== false) {      // legacy defs only
      scene.add(new THREE.AmbientLight(0xffffff, 0.35));
      const key = new THREE.DirectionalLight(0xffffff, 0.6);
      key.position.set(4, 6, 8);
      scene.add(key);
    }

    const ctx = {
      THREE, id, scene, camera, canvas, renderer: sh.renderer, env: sh.env.texture, quality: Q,
      size: { w: 1, h: 1, cssW: 1, cssH: 1 },
      time: () => performance.now() / 1000
    };
    try { def.build(ctx); } catch (err) {
      console.warn('[SceneRegistry] build() failed for "' + id + '":', err);
      try { if (def.dispose) def.dispose(ctx); } catch (e) { /* ignore */ }
      disposeTree(scene);
      if (!views.size) teardownShared();
      return null;
    }

    const isStatic = typeof options.staticProgress === 'number';
    const v = {
      id, def, canvas, ctx2d, scene, camera, ctx,
      static: isStatic,
      getProgress: isStatic ? () => options.staticProgress
        : (options.getProgress || (options.pinnedContainer ? makePinnedProgress(options.pinnedContainer) : () => 1)),
      p: isStatic ? clamp(options.staticProgress, 0, 1) : 0,
      target: 0,
      visible: true, rendered: false, needsRender: true, sizeDirty: true,
      cssW: canvas.clientWidth || (canvas.parentElement && canvas.parentElement.clientWidth) || 300,
      cssH: canvas.clientHeight || (canvas.parentElement && canvas.parentElement.clientHeight) || 300,
      pw: 1, ph: 1, io: null, ro: null,
      parallax: (!isStatic && options.parallax !== false && def.parallax && !Q.low && !Q.reducedMotion) ? def.parallax : null,
      par: { x: 0, y: 0 }
    };
    v.target = v.p;

    if ('ResizeObserver' in window) {
      v.ro = new ResizeObserver((entries) => {
        const r = entries[entries.length - 1].contentRect;
        if (r.width < 1 || r.height < 1) return;
        v.cssW = r.width; v.cssH = r.height; v.sizeDirty = true; invalidate();
      });
      v.ro.observe(canvas);
    }
    if (!isStatic && 'IntersectionObserver' in window) {
      v.io = new IntersectionObserver((entries) => {
        v.visible = entries[entries.length - 1].isIntersecting;
        if (v.visible) { v.needsRender = true; invalidate(); }
      }, { rootMargin: '15% 0px 15% 0px' });
      v.io.observe(canvas);
    }

    v.handle = { id, stop() { unmount(id); }, dispose() { unmount(id); }, get progress() { return v.p; } };
    views.set(id, v);
    list.push(v);
    anyParallax = list.some((x) => x.parallax);
    hasDynamic = list.some((x) => !x.static);
    installGlobals();
    invalidate();
    return v.handle;
  }

  function unmount(id) {
    const v = views.get(id);
    if (!v) return;
    views.delete(id);
    const i = list.indexOf(v);
    if (i > -1) list.splice(i, 1);
    anyParallax = list.some((x) => x.parallax);
    hasDynamic = list.some((x) => !x.static);
    if (v.io) v.io.disconnect();
    if (v.ro) v.ro.disconnect();
    if (v.getProgress && v.getProgress.dispose) v.getProgress.dispose();
    try { if (v.def.dispose) v.def.dispose(v.ctx); } catch (e) { console.warn('[SceneRegistry] dispose() failed for "' + id + '":', e); }
    disposeTree(v.scene);
    v.scene.environment = null;
    v.def.group = null;
    emit(id, 'disposed');
    if (!list.length) teardownShared();      // last scene gone: a deliberate, permanent teardown
    else syncGL();
  }

  function disposeAll() {
    Array.from(views.keys()).forEach(unmount);
    teardownShared();
  }

  /* ---------- diagnostics (used by tests/browser-checks.py) ---------- */

  function stats() {
    return {
      version: 2,
      contexts: shared ? 1 : 0,
      views: list.map((v) => ({
        id: v.id, visible: v.visible, rendered: v.rendered, static: v.static,
        progress: +v.p.toFixed(4), target: +v.target.toFixed(4), w: v.pw, h: v.ph
      })),
      frames, renders, rafPending: !!rafId, paused, hidden: document.hidden,
      lost: !!(shared && shared.lost),
      dpr: shared ? +shared.dpr.toFixed(2) : 0,
      glSize: shared ? [shared.canvas.width, shared.canvas.height] : null,
      listeners: live.length
    };
  }

  window.SceneRegistry = {
    add, mount, makeRevealProgress, makePinnedProgress, makeSectionProgress,
    supported, onState, stats, disposeAll
  };
})();
