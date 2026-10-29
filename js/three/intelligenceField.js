/* ============================================================
   INTELLIGENCE FIELD — the hero's scroll-driven robotic manipulator.

   Registers itself with SceneRegistry as 'intelligenceField' (same id as the
   retired network scene, so main.js keeps its mount call).

   WHAT YOU SEE
   An original six-axis arm on a machined pedestal, built entirely from code:
   lathe-turned housings, bevelled aluminium links, graphite covers, a parallel
   gripper and ONE restrained blue accent (joint rings, the gripper LED, the
   glowing data module it picks up). Scrolling plays a short story: the arm
   unfolds, descends on the module, grips it, lifts it and presents it.

   HOW IT MOVES (deterministic)
   progress p (0..1) -> path of the gripper pad -> analytic inverse kinematics
   (base yaw + two-link shoulder/elbow + a wrist pitch that keeps the tool
   pointing down) -> joint angles. Nothing accumulates between frames: the same
   p always gives the same picture and reversing the scroll reverses the motion.
   The module is "held" purely as a function of p; it is never re-parented.

   COST (measured in the running engine): 56 meshes = 56 draw calls, ~13.6k
   triangles, 10 materials, 4 lights (2 directional, 1 hemisphere, 1 point),
   no shadow maps, only two tiny radial-gradient textures.
   ============================================================ */

(function () {
  'use strict';

  const R = window.SceneRegistry, U = window.CineUtils;
  if (!window.THREE || !R || !U) return;
  const T = window.THREE;
  const { lerp, clamp, smoothstep, easeInOut } = U;
  const Q = U.Q;
  const B = window.BrandColors || {};
  const BLUE = new T.Color(B.blue || '#4C91F0');

  const SEG = Q.low ? 36 : 64;         // radial segments of turned parts
  const CURVE = Q.low ? 5 : 10;        // curve segments of extruded outlines

  /* ---------- dimensions (world units) ---------- */
  const L1 = 2.15;                     // upper arm
  const L2 = 1.9;                      // forearm
  const GRIP = 0.88;                   // wrist centre -> centre of the finger pads
  const SHOULDER_Y = 1.41;             // shoulder pivot height
  const CUBE = 0.38;                   // the data module
  const PLINTH_TOP = 0.212;
  const CX = 1.85, CZ = 1.35, CY = PLINTH_TOP + CUBE / 2;

  /* path of the pad centre: t, x, y, z, open (0..1), psi (world yaw of the finger axis) */
  const PATH = [
    [0.00, -0.55, 2.40, 1.85, 1.0, 0.80],     // ready: hovering high, fingers open
    [0.20,  0.65, 2.20, 1.80, 1.0, 0.40],     // swing toward the module
    [0.40,  CX,   1.55, CZ,   1.0, 0.00],     // above it, fingers aligned
    [0.52,  CX,   CY,   CZ,   1.0, 0.00],     // down on the module
    [0.60,  CX,   CY,   CZ,   0.0, 0.00],     // grip closes
    [0.76,  CX,   2.00, CZ,   0.0, 0.00],     // lift
    [0.91, -0.80, 2.90, 1.55, 0.0, -0.60],    // swing away and present
    [1.00, -0.80, 2.95, 1.55, 0.0, -0.60]     // hold
  ];
  const HOLD_FROM = 0.60;              // the module follows the gripper from here on

  const pose = { x: 0, y: 0, z: 0, open: 1, psi: 0 };
  const ik = { yaw: 0, a2: 0, a3: 0, a4: 0 };

  function samplePath(p) {
    let i = 0;
    while (i < PATH.length - 2 && p > PATH[i + 1][0]) i++;
    const a = PATH[i], b = PATH[i + 1];
    const u = easeInOut(clamp((p - a[0]) / (b[0] - a[0]), 0, 1));
    pose.x = lerp(a[1], b[1], u);
    pose.y = lerp(a[2], b[2], u);
    pose.z = lerp(a[3], b[3], u);
    pose.open = lerp(a[4], b[4], u);
    pose.psi = lerp(a[5], b[5], u);
  }

  /* Elbow-up analytic IK. The arm plane is the turret's YZ plane; an angle is
     measured from +Y toward the horizontal reach direction (+Z), i.e. a rotation
     about the local +X axis. The wrist pitch keeps the tool vertical:
     a2 + a3 + a4 = PI (tool points down). */
  function solve(px, py, pz) {
    const wy = py + GRIP;
    ik.yaw = Math.atan2(px, pz);
    const r = Math.hypot(px, pz), dy = wy - SHOULDER_Y;
    const d = clamp(Math.hypot(r, dy), Math.abs(L1 - L2) + 0.02, L1 + L2 - 0.02);
    const phi = Math.atan2(r, dy);
    const beta = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
    const gamma = Math.acos(clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1));
    ik.a2 = phi - beta;
    ik.a3 = Math.PI - gamma;
    ik.a4 = Math.PI - ik.a2 - ik.a3;
  }

  /* ---------- scene state (created in build, released in dispose) ---------- */
  let j1, j2, j3, j4, j5, fingerL, fingerR, cube, cubeGlow, accent;

  function materials() {
    const std = (o) => new T.MeshStandardMaterial(o);
    const blue = BLUE;
    return {
      alu: std({ color: 0xc4ccd8, metalness: 1.0, roughness: 0.34, envMapIntensity: 0.95 }),
      aluDark: std({ color: 0x8b95a5, metalness: 1.0, roughness: 0.42, envMapIntensity: 1.0 }),
      graphite: std({ color: 0x1a1f26, metalness: 0.65, roughness: 0.46, envMapIntensity: 0.9 }),
      rubber: std({ color: 0x0a0c0f, metalness: 0.0, roughness: 0.92, envMapIntensity: 0.3 }),
      led: new T.MeshBasicMaterial({ color: blue.clone(), toneMapped: false }),
      cube: std({ color: 0x2d333d, metalness: 1.0, roughness: 0.36, envMapIntensity: 1.1 }),
      cubeGlow: new T.MeshBasicMaterial({ color: blue.clone().multiplyScalar(0.85), toneMapped: false })
    };
  }

  const mesh = (geo, mat, parent, x, y, z) => {
    const m = new T.Mesh(geo, mat);
    if (x !== undefined) m.position.set(x, y, z);
    if (parent) parent.add(m);
    return m;
  };

  /* a turned part whose axis runs along X (dir +1 / -1) */
  const axialX = (profile, dir) => U.lathe(profile, SEG).rotateZ(dir > 0 ? -Math.PI / 2 : Math.PI / 2);
  const ringX = (r, tube) => new T.TorusGeometry(r, tube, 8, SEG).rotateY(Math.PI / 2);

  /* joint hub: graphite barrel, aluminium end caps, optional blue ring on +X */
  function hub(parent, M, radius, halfLen, ringR, withRing) {
    mesh(new T.CylinderGeometry(radius, radius, halfLen * 2, SEG).rotateZ(Math.PI / 2), M.graphite, parent, 0, 0, 0);
    const cap = [0, 0, radius * 0.9, 0, radius * 0.9, 0.035, radius * 0.78, 0.06, 0, 0.06];
    mesh(axialX(cap, 1), M.alu, parent, halfLen, 0, 0);
    mesh(axialX(cap, -1), M.alu, parent, -halfLen, 0, 0);
    if (withRing) mesh(ringX(ringR, 0.011), M.led, parent, halfLen + 0.062, 0, 0);
  }

  /* tapered link between two circles, bevelled, with an optional graphite inset */
  function link(parent, M, r0, r1, len, thick, inset) {
    const body = U.extrudeShape(U.hullShape(r0, r1, len), thick, 0.05, CURVE * 2).rotateY(Math.PI / 2);
    mesh(body, M.alu, parent, 0, 0, 0);
    if (inset) {
      const panel = U.extrudeShape(U.hullShape(r0 * 0.5, r1 * 0.5, len * inset.len), thick + 0.02, 0.018, CURVE)
        .rotateY(Math.PI / 2).translate(0, inset.at, 0);
      mesh(panel, M.graphite, parent, 0, 0, 0);
    }
  }

  function finger(parent, M, side) {
    const g = new T.Group();
    mesh(U.roundedBox(0.075, 0.38, 0.2, 0.02, 0.012, 4), M.alu, g, 0.0625, 0.48, 0);
    mesh(U.roundedBox(0.05, 0.1, 0.2, 0.02, 0.01, 3), M.graphite, g, 0.09, 0.62, 0);
    mesh(new T.BoxGeometry(0.025, 0.22, 0.17), M.rubber, g, 0.0125, 0.47, 0);
    g.scale.x = side;
    parent.add(g);
    return g;
  }

  function build(ctx) {
    const g = def.group;
    const M = materials();
    const blueHi = new T.Color(B.blueHi || '#8DB8F6');

    /* floor: a faint pool of light and two contact shadows (no shadow maps) */
    const flat = new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const flatMat = (map, opacity) => new T.MeshBasicMaterial({ map, transparent: true, opacity, depthWrite: false });
    const poolTex = U.radialTexture('rgba(141,184,246,0.10)', 'rgba(141,184,246,0)', 256);
    const shadowTex = U.radialTexture('rgba(0,0,0,0.8)', 'rgba(0,0,0,0)', 128);
    mesh(flat, flatMat(poolTex, 1), g, 0.8, -0.004, 0.7).scale.set(16, 1, 16);
    mesh(flat, flatMat(shadowTex, 0.95), g, 0, 0.002, 0).scale.set(4.4, 1, 4.4);
    mesh(flat, flatMat(shadowTex, 0.8), g, CX, 0.002, CZ).scale.set(2.2, 1, 2.2);

    /* pedestal */
    mesh(U.lathe([0, 0, 1.30, 0, 1.34, 0.04, 1.34, 0.15, 1.30, 0.19, 0, 0.19], SEG), M.graphite, g);
    mesh(U.lathe([0, 0.19, 1.14, 0.19, 1.14, 0.27, 1.10, 0.31, 0, 0.31], SEG), M.alu, g);
    mesh(new T.TorusGeometry(0.95, 0.012, 8, SEG).rotateX(Math.PI / 2), M.led, g, 0, 0.312, 0);
    const bolt = U.lathe([0, 0, 0.05, 0, 0.05, 0.03, 0.036, 0.048, 0, 0.048], 6);       // 6 sides = hex head
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.15;
      mesh(bolt, M.aluDark, g, Math.cos(a) * 1.24, 0.19, Math.sin(a) * 1.24);
    }

    /* J1 turret (yaw) with the shoulder yoke */
    j1 = new T.Group(); j1.position.set(0, 0.31, 0); g.add(j1);
    mesh(U.lathe([0, 0, 0.80, 0, 0.82, 0.03, 0.82, 0.20, 0.78, 0.24, 0.78, 0.52, 0.72, 0.58, 0, 0.58], SEG), M.alu, j1);
    mesh(U.lathe([0.80, 0.21, 0.845, 0.21, 0.845, 0.33, 0.80, 0.33], SEG), M.graphite, j1);
    const cheek = U.roundedBox(0.16, 1.1, 0.95, 0.08, 0.035, 6);
    mesh(cheek, M.alu, j1, 0.52, 1.0, 0);
    mesh(cheek, M.alu, j1, -0.52, 1.0, 0);
    const shoulderHub = new T.Group(); shoulderHub.position.set(0, 1.10, 0); j1.add(shoulderHub);
    hub(shoulderHub, M, 0.36, 0.60, 0.22, true);

    /* J2 shoulder + upper arm */
    j2 = new T.Group(); j2.position.set(0, 1.10, 0); j1.add(j2);
    link(j2, M, 0.40, 0.30, L1, 0.62, { len: 0.62, at: 0.55 });

    /* J3 elbow + forearm (with a cable conduit and two clamps) */
    j3 = new T.Group(); j3.position.set(0, L1, 0); j2.add(j3);
    hub(j3, M, 0.31, 0.43, 0.2, true);
    link(j3, M, 0.30, 0.21, L2, 0.5, { len: 0.6, at: 0.5 });
    const conduit = new T.CatmullRomCurve3([
      new T.Vector3(0.30, 0.20, 0.0), new T.Vector3(0.32, 0.70, 0.04),
      new T.Vector3(0.30, 1.20, -0.03), new T.Vector3(0.27, L2 - 0.15, 0.0)
    ]);
    mesh(new T.TubeGeometry(conduit, 24, 0.032, 8, false), M.rubber, j3);
    const clamp3 = new T.BoxGeometry(0.07, 0.09, 0.06);
    mesh(clamp3, M.aluDark, j3, 0.31, 0.46, 0.02);
    mesh(clamp3, M.aluDark, j3, 0.305, 1.1, -0.02);

    /* J4 wrist pitch, wrist roll housing, J5 tool roll and the gripper */
    j4 = new T.Group(); j4.position.set(0, L2, 0); j3.add(j4);
    hub(j4, M, 0.20, 0.30, 0.13, false);
    mesh(U.lathe([0, 0.10, 0.19, 0.10, 0.19, 0.18, 0.215, 0.20, 0.215, 0.24, 0.19, 0.26, 0.19, 0.40, 0, 0.40], SEG), M.alu, j4);
    j5 = new T.Group(); j5.position.set(0, 0.42, 0); j4.add(j5);
    mesh(U.lathe([0, 0, 0.25, 0, 0.25, 0.045, 0.22, 0.05, 0, 0.05], SEG), M.graphite, j5);
    mesh(U.roundedBox(0.62, 0.24, 0.34, 0.06, 0.03, 4), M.graphite, j5, 0, 0.17, 0);
    mesh(U.roundedBox(0.50, 0.16, 0.012, 0.03, 0.005, 3), M.alu, j5, 0, 0.17, 0.176);
    mesh(new T.BoxGeometry(0.30, 0.024, 0.012), M.led, j5, 0, 0.17, 0.184);
    mesh(new T.CylinderGeometry(0.025, 0.025, 0.72, 16).rotateZ(Math.PI / 2), M.aluDark, j5, 0, 0.31, 0);
    fingerL = finger(j5, M, -1);
    fingerR = finger(j5, M, 1);
    accent = new T.PointLight(new T.Color(B.blue || '#4C91F0'), 0, 3.4, 2);
    accent.position.set(0, 0.25, 0.4);
    j5.add(accent);

    /* plinth and the data module it carries */
    mesh(U.roundedSlab(1.15, 1.15, 0.2, 0.12, 0.03, 6), M.graphite, g, CX, 0.1, CZ);
    mesh(U.lathe([0, 0, 0.52, 0, 0.52, 0.012, 0, 0.012], SEG), M.aluDark, g, CX, 0.2, CZ);
    cube = new T.Group(); g.add(cube);
    mesh(U.roundedBox(CUBE, CUBE, CUBE, 0.06, 0.04, 4), M.cube, cube);
    const inlayTop = new T.BoxGeometry(0.22, 0.005, 0.22);
    const inlaySide = new T.BoxGeometry(0.22, 0.22, 0.005);
    mesh(inlayTop, M.cubeGlow, cube, 0, CUBE / 2 + 0.001, 0);
    mesh(inlaySide, M.cubeGlow, cube, 0, 0, CUBE / 2 + 0.001);
    mesh(inlaySide, M.cubeGlow, cube, 0, 0, -CUBE / 2 - 0.001);
    cubeGlow = M.cubeGlow;

    /* lighting: warm key, cool rim, dim sky fill (+ the gripper's blue accent above) */
    const key = new T.DirectionalLight(0xfff3e6, 1.15); key.position.set(-4.5, 9, 6); g.add(key);
    const rim = new T.DirectionalLight(blueHi, 0.95); rim.position.set(7, 4.5, -6); g.add(rim);
    g.add(new T.HemisphereLight(0xcdd6e4, 0x0a0c0f, 0.3));

    update(0);
  }

  function update(p) {
    samplePath(p);
    solve(pose.x, pose.y, pose.z);
    j1.rotation.y = ik.yaw;
    j2.rotation.x = ik.a2;
    j3.rotation.x = ik.a3;
    j4.rotation.x = ik.a4;
    j5.rotation.y = ik.yaw - pose.psi;                 // keeps the finger axis at world yaw psi
    const gap = lerp(CUBE / 2, 0.345, pose.open);
    fingerR.position.x = gap;
    fingerL.position.x = -gap;

    if (p >= HOLD_FROM) { cube.position.set(pose.x, pose.y, pose.z); cube.rotation.y = pose.psi; }
    else { cube.position.set(CX, CY, CZ); cube.rotation.y = 0; }

    cubeGlow.color.copy(BLUE).multiplyScalar(lerp(0.85, 1.25, smoothstep(0.55, 0.95, p)));
    accent.intensity = lerp(0.2, 1.6, smoothstep(0.35, 0.62, p)) * (1 - 0.4 * smoothstep(0.62, 0.9, p));
  }

  /* Composition: the arm sits on the right on wide screens so the headline keeps
     the left; on portrait screens it drops toward the lower half. A view offset
     shifts the picture without changing the perspective. */
  function resize(w, h, ctx) {
    const aspect = w / h, cam = ctx.camera;
    if (aspect >= 1) {
      cam.fov = 31.5;
      cam.setViewOffset(w, h, -0.265 * w, 0.015 * h, w, h);
    } else {
      cam.fov = 30 + (1 - Math.max(aspect, 0.4)) * 24;
      cam.setViewOffset(w, h, 0, -0.16 * h, w, h);
    }
  }

  function dispose() {
    j1 = j2 = j3 = j4 = j5 = fingerL = fingerR = cube = cubeGlow = accent = null;
  }

  const def = {
    id: 'intelligenceField',
    fov: 30,
    cameraMode: 'spline',
    defaultLights: false,
    usesOpacityProxy: false,
    parallax: { x: 0.45, y: 0.28 },
    keys: [
      { t: 0.00, pos: [8.0, 3.4, 9.2],   look: [0.30, 1.65, 0.6] },
      { t: 0.22, pos: [7.4, 3.2, 8.8],   look: [0.60, 1.65, 0.9] },
      { t: 0.46, pos: [6.9, 2.9, 8.5],   look: [1.00, 1.60, 0.9] },
      { t: 0.70, pos: [5.4, 3.5, 9.0],   look: [0.70, 1.95, 0.9] },
      { t: 0.88, pos: [2.0, 4.2, 10.3],  look: [0.30, 2.10, 0.9] },
      { t: 1.00, pos: [-1.0, 4.5, 10.8], look: [0.20, 2.20, 0.9] }
    ],
    build, update, resize, dispose
  };
  R.add(def);
})();
