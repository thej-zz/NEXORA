/* ============================================================
   MEMBERS PAGE — ambient background scene
   ------------------------------------------------------------
   "A synchronized intelligence network": a field of slow-drifting
   nodes with thin connecting edges, rendered into the existing
   #constellation-canvas element. This replaces the page's old
   constellation.js include (see members.html) — constellation.js
   itself hasn't been touched, in case anything else references it.

   Written defensively since js/scene-registry.js and
   js/cine-utils.js weren't available for this task: it hooks into
   window.SceneRegistry only if that API turns out to exist, and
   otherwise manages its own resize / visibility / reduced-motion
   listeners so it works standalone either way.
   ============================================================ */
(function () {
  'use strict';

  var canvas = document.getElementById('constellation-canvas');
  if (!canvas || typeof THREE === 'undefined') return;

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var isSmall = window.innerWidth < 720;

  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
  } catch (e) {
    return; // no WebGL — leave the canvas empty rather than error out
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 0, 14);

  var accentColor = new THREE.Color(0x6fd8ff);   // --accent
  var accent2Color = new THREE.Color(0x9682ff);  // --accent-2

  var NODE_COUNT = isSmall ? 42 : 110;
  var RADIUS = isSmall ? 8 : 12;

  var basePositions = new Float32Array(NODE_COUNT * 3);
  var speeds = new Float32Array(NODE_COUNT);

  for (var i = 0; i < NODE_COUNT; i++) {
    var theta = Math.random() * Math.PI * 2;
    var phi = Math.acos((Math.random() * 2) - 1);
    var r = RADIUS * (0.35 + Math.random() * 0.65);
    var x = r * Math.sin(phi) * Math.cos(theta);
    var y = r * Math.sin(phi) * Math.sin(theta) * 0.6;
    var z = r * Math.cos(phi) * 0.6 - 4;
    basePositions[i * 3] = x;
    basePositions[i * 3 + 1] = y;
    basePositions[i * 3 + 2] = z;
    speeds[i] = 0.15 + Math.random() * 0.25;
  }

  var nodeGeo = new THREE.BufferGeometry();
  nodeGeo.setAttribute('position', new THREE.BufferAttribute(basePositions.slice(), 3));
  var nodeMat = new THREE.PointsMaterial({
    size: isSmall ? 0.05 : 0.06,
    color: accentColor,
    transparent: true,
    opacity: 0.75,
    depthWrite: false
  });
  var points = new THREE.Points(nodeGeo, nodeMat);
  scene.add(points);

  // connections — computed once from the resting layout, not per-frame
  var linePositions = [];
  var MAX_LINKS_PER_NODE = 3;
  var LINK_DIST = RADIUS * 0.55;
  for (var a = 0; a < NODE_COUNT; a++) {
    var links = 0;
    for (var b = a + 1; b < NODE_COUNT && links < MAX_LINKS_PER_NODE; b++) {
      var dx = basePositions[a * 3] - basePositions[b * 3];
      var dy = basePositions[a * 3 + 1] - basePositions[b * 3 + 1];
      var dz = basePositions[a * 3 + 2] - basePositions[b * 3 + 2];
      var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < LINK_DIST) {
        linePositions.push(
          basePositions[a * 3], basePositions[a * 3 + 1], basePositions[a * 3 + 2],
          basePositions[b * 3], basePositions[b * 3 + 1], basePositions[b * 3 + 2]
        );
        links++;
      }
    }
  }
  var lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(linePositions), 3));
  var lineMat = new THREE.LineBasicMaterial({ color: accent2Color, transparent: true, opacity: 0.14 });
  var lineSegments = new THREE.LineSegments(lineGeo, lineMat);
  scene.add(lineSegments);

  var clock = new THREE.Clock();
  var mouseX = 0, mouseY = 0;
  window.addEventListener('pointermove', function (e) {
    mouseX = (e.clientX / window.innerWidth) - 0.5;
    mouseY = (e.clientY / window.innerHeight) - 0.5;
  }, { passive: true });

  var running = true;
  function setRunning(v) { running = v; }
  document.addEventListener('visibilitychange', function () {
    setRunning(!document.hidden);
  });

  function resize() {
    var w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }
  window.addEventListener('resize', resize);

  // optional: play nicely with an existing scene registry, if one exists
  if (window.SceneRegistry && typeof window.SceneRegistry.register === 'function') {
    try {
      window.SceneRegistry.register({
        name: 'members-scene',
        pause: function () { setRunning(false); },
        resume: function () { setRunning(true); },
        resize: resize,
        dispose: function () {
          setRunning(false);
          nodeGeo.dispose();
          lineGeo.dispose();
          nodeMat.dispose();
          lineMat.dispose();
          renderer.dispose();
        }
      });
    } catch (e) { /* registry shape didn't match — standalone listeners above still cover it */ }
  }

  var speedScale = reduceMotion ? 0.12 : 1;
  var rafId = null;

  function animate() {
    rafId = requestAnimationFrame(animate);
    if (!running) return;

    var t = clock.getElapsedTime() * speedScale;
    var posAttr = nodeGeo.getAttribute('position');
    for (var i = 0; i < NODE_COUNT; i++) {
      var idx = i * 3;
      posAttr.array[idx] = basePositions[idx] + Math.sin(t * speeds[i] + i) * 0.25;
      posAttr.array[idx + 1] = basePositions[idx + 1] + Math.cos(t * speeds[i] * 0.8 + i) * 0.25;
    }
    posAttr.needsUpdate = true;

    scene.rotation.y = t * 0.02 + mouseX * 0.15;
    scene.rotation.x = mouseY * 0.08;

    renderer.render(scene, camera);
  }
  animate();
})();