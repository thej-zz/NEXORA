/* ============================================================
   SceneRegistry — mounts a registered Three.js scene onto a
   <canvas>, drives its camera along `keys` using a 0..1
   progress value, and runs def.update(p, dt, ctx) every frame.

   Two progress sources are supported:
     - pinnedContainer: a tall wrapper the canvas sticks inside;
       p tracks how far the user has scrolled through it (used
       by the hero's "Intelligence Field").
     - getProgress: any function returning 0..1, e.g. the
       IntersectionObserver-based reveal helper below (used by
       the About "Data Core" and the Members "Constellation").

   Note on architecture: the original chat app ran many story
   chapters through ONE shared canvas as the user scrolled past
   each. This site instead gives each section its own small
   canvas mounted independently \u2014 simpler, and it means a
   section's 3D cost only exists while that section is visible.
   ============================================================ */

(function () {
  'use strict';

  const U = window.CineUtils;
  const { lerp, clamp } = U;

  const registry = {};

  function add(def) { registry[def.id] = def; }

  /* Scenes never touch mat.opacity directly — they call
     setOp(mat, v) which stashes v on mat.userData.baseOpacity.
     This copies it across every frame, which is also the hook
     a future cross-scene fade weight would multiply into. */
  function applyFade(group) {
    group.traverse((obj) => {
      const mat = obj.material;
      if (!mat) return;
      if (Array.isArray(mat)) {
        mat.forEach((m) => { if (m.userData && m.userData.baseOpacity !== undefined) m.opacity = m.userData.baseOpacity; });
      } else if (mat.userData && mat.userData.baseOpacity !== undefined) {
        mat.opacity = mat.userData.baseOpacity;
      }
    });
  }

  function interpolateCamera(keys, p) {
    let k0 = keys[0], k1 = keys[keys.length - 1];
    for (let i = 0; i < keys.length - 1; i++) {
      if (p >= keys[i].t && p <= keys[i + 1].t) { k0 = keys[i]; k1 = keys[i + 1]; break; }
    }
    const span = (k1.t - k0.t) || 1;
    let u = clamp((p - k0.t) / span, 0, 1);
    u = u * u * (3 - 2 * u); // ease between keyframes, not just linear

    return {
      pos: [
        lerp(k0.pos[0], k1.pos[0], u),
        lerp(k0.pos[1], k1.pos[1], u),
        lerp(k0.pos[2], k1.pos[2], u)
      ],
      look: [
        lerp(k0.look[0], k1.look[0], u),
        lerp(k0.look[1], k1.look[1], u),
        lerp(k0.look[2], k1.look[2], u)
      ]
    };
  }

  /* Progress that eases toward 1 while `el` is on screen and
     back toward 0 when it isn't \u2014 for ambient section scenes
     that "activate" on scroll-into-view rather than scrub with it. */
  function makeRevealProgress(el, opts) {
    opts = opts || {};
    let target = U.Q.reducedMotion ? 1 : 0;
    let current = target;

    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((e) => { target = e.isIntersecting ? 1 : 0; });
      }, { threshold: opts.threshold || 0.2 });
      io.observe(el);
    } else {
      target = 1;
    }

    return function (dt) {
      const damp = 1 - Math.pow(0.001, dt);
      current = lerp(current, target, clamp(damp, 0, 1));
      return current;
    };
  }

  /* Progress that tracks scroll position through a tall wrapper
     while its inner canvas stays visually pinned (CSS handles the
     sticky/fixed positioning \u2014 this just supplies the number). */
  function makePinnedProgress(container) {
    return function () {
      const rect = container.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      if (total <= 0) return 0;
      return clamp(-rect.top / total, 0, 1);
    };
  }

  function mount(id, canvas, options) {
    options = options || {};
    const def = registry[id];
    if (!def) { console.warn('[SceneRegistry] unknown scene id:', id); return null; }
    if (!def.keys || !def.keys.length) {
      def.keys = [{ t: 0, pos: [0, 0, 8], look: [0, 0, 0] }, { t: 1, pos: [0, 0, 8], look: [0, 0, 0] }];
    }

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);

    scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    const keyLight = new THREE.DirectionalLight(0xffffff, 0.6);
    keyLight.position.set(4, 6, 8);
    scene.add(keyLight);

    def.group = new THREE.Group();
    scene.add(def.group);

    const clock = new THREE.Clock();
    const ctx = { time: () => clock.getElapsedTime(), scene, camera, renderer };
    def.build(ctx);

    const getProgress = options.getProgress
      || (options.pinnedContainer ? makePinnedProgress(options.pinnedContainer) : () => 1);

    /* subtle desktop-only mouse parallax layered on top of the keyed path */
    let mouseX = 0, mouseY = 0, targetX = 0, targetY = 0;
    const parallaxEnabled = options.parallax !== false && !U.Q.low && !U.Q.reducedMotion;
    let onMouseMove;
    if (parallaxEnabled) {
      onMouseMove = (e) => {
        targetX = (e.clientX / window.innerWidth - 0.5) * 2;
        targetY = (e.clientY / window.innerHeight - 0.5) * 2;
      };
      window.addEventListener('mousemove', onMouseMove, { passive: true });
    }

    function resize() {
      const w = canvas.clientWidth || (canvas.parentElement && canvas.parentElement.clientWidth) || window.innerWidth;
      const h = canvas.clientHeight || (canvas.parentElement && canvas.parentElement.clientHeight) || window.innerHeight;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, U.Q.dpr));
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
    }
    resize();
    window.addEventListener('resize', resize);

    let lastT = clock.getElapsedTime();
    let raf = null;
    function tick() {
      raf = requestAnimationFrame(tick);
      if (document.hidden) return; // pause work on a hidden tab

      const t = clock.getElapsedTime();
      const dt = Math.min(t - lastT, 0.1);
      lastT = t;

      mouseX = lerp(mouseX, targetX, Math.min(1, dt * 4));
      mouseY = lerp(mouseY, targetY, Math.min(1, dt * 4));

      const p = clamp(getProgress(dt), 0, 1);
      def.update(p, dt, ctx);
      applyFade(def.group);

      const cam = interpolateCamera(def.keys, p);
      camera.position.set(cam.pos[0], cam.pos[1], cam.pos[2]);
      if (parallaxEnabled) {
        camera.position.x += mouseX * 0.6;
        camera.position.y += -mouseY * 0.4;
      }
      camera.lookAt(cam.look[0], cam.look[1], cam.look[2]);

      renderer.render(scene, camera);
    }
    tick();

    return {
      stop() {
        if (raf) cancelAnimationFrame(raf);
        window.removeEventListener('resize', resize);
        if (onMouseMove) window.removeEventListener('mousemove', onMouseMove);
      }
    };
  }

  window.SceneRegistry = { add, mount, makeRevealProgress, makePinnedProgress };
})();
