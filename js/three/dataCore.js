/* ============================================================
   DATA CORE — the About chapter's exploded processor.

   Registers itself with SceneRegistry as 'dataCore' (same id as the retired
   network scene, so main.js keeps its mount call).

   FOUR LAYERS, bottom to top (the same order the static SVG fallback shows):
     01 SUBSTRATE   dark organic board with a printed pad field and capacitors
     02 INTERPOSER  slate silicon slab carrying a grid of micro-bumps
     03 DIE         glossy near-black silicon, a 4x4 tile floorplan, one blue core
     04 LID         brushed-aluminium heat spreader with the NEXORA marking

   HOW IT MOVES (deterministic)
   p is where the panel's CENTRE is in the viewport (0 = on the bottom edge,
   0.5 = middle of the screen where the copy is read, 1 = on the top edge).
   The explosion amount e(p) rises over p 0.12-0.40 (panel rising into view),
   holds over 0.40-0.62 (while the visitor reads) and returns to a clean
   assembly over 0.62-0.92 as the panel leaves — all inside the range where the
   panel is actually on screen, so both the opening AND the closing are seen. Four DOM tags (aria-hidden)
   name the layers; they are positioned from the final camera pose each frame.

   COST (measured in the running engine): 17 meshes, 3 of them instanced
   (368 instances) = 19 draw calls, ~11.6k triangles, 11 materials, 4 lights
   (2 directional, 1 hemisphere, 1 point), 3 small canvas textures, no shadow maps.
   ============================================================ */

(function () {
  'use strict';

  const R = window.SceneRegistry, U = window.CineUtils;
  if (!window.THREE || !R || !U) return;
  const T = window.THREE;
  const { lerp, smoothstep, range, easeInOut } = U;
  const Q = U.Q;
  const B = window.BrandColors || {};
  const BLUE = new T.Color(B.blue || '#4C91F0');
  const D2R = Math.PI / 180;

  /* assembled y of each layer's origin, and how far it travels when exploded */
  const SUB_Y = 0.07, ITP_Y = 0.175, DIE_Y = 0.24, LID_Y = 0.28;
  const SUB_DY = -0.80, ITP_DY = -0.15, DIE_DY = 0.55, LID_DY = 1.45;

  const TAGS = [
    { text: '04  LID', anchor: [1.20, 0.22, 0] },
    { text: '03  DIE', anchor: [0.75, 0.03, 0] },
    { text: '02  INTERPOSER', anchor: [1.15, 0.035, 0] },
    { text: '01  SUBSTRATE', anchor: [1.50, 0.07, 0] }
  ];

  /* camera: an orbit around the stack, written as keys (spline) */
  const orbit = (az, el, d, ty) => [
    Math.sin(az * D2R) * Math.cos(el * D2R) * d,
    ty + Math.sin(el * D2R) * d,
    Math.cos(az * D2R) * Math.cos(el * D2R) * d
  ];

  /* ---------- scene state (created in build, released in dispose) ---------- */
  let asm, sub, itp, die, lid, guides, accent, core, shadow, tagsEl, tagEls;
  let curE = 0, lastShow = -1;
  const tmp = new T.Vector3();

  function pcbTexture() {
    return U.canvasTexture(512, 512, (c, w, h) => {
      c.fillStyle = '#10151b'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#161c25'; c.fillRect(24, 24, w - 48, h - 48);
      c.lineWidth = 1;
      c.strokeStyle = 'rgba(205,214,228,0.05)';
      for (let i = 24; i <= w - 24; i += 16) {
        c.beginPath(); c.moveTo(i, 24); c.lineTo(i, h - 24); c.stroke();
        c.beginPath(); c.moveTo(24, i); c.lineTo(w - 24, i); c.stroke();
      }
      c.strokeStyle = 'rgba(205,214,228,0.10)';
      for (let i = 24; i <= w - 24; i += 64) {
        c.beginPath(); c.moveTo(i, 24); c.lineTo(i, h - 24); c.stroke();
        c.beginPath(); c.moveTo(24, i); c.lineTo(w - 24, i); c.stroke();
      }
      c.fillStyle = 'rgba(205,214,228,0.24)';
      for (let i = 48; i < w - 48; i += 20) {
        c.fillRect(i, 34, 8, 8); c.fillRect(i, h - 42, 8, 8);
        c.fillRect(34, i, 8, 8); c.fillRect(w - 42, i, 8, 8);
      }
      c.strokeStyle = 'rgba(141,184,246,0.38)'; c.lineWidth = 2;
      c.strokeRect(64, 64, w - 128, h - 128);                      // keep-out outline for the interposer
    }, true);
  }

  function lidMark() {
    return U.canvasTexture(1024, 256, (c, w, h) => {
      c.clearRect(0, 0, w, h);
      c.fillStyle = 'rgba(38,46,58,0.62)';
      c.font = '600 132px "Inter Tight", "Inter", system-ui, sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      if ('letterSpacing' in c) c.letterSpacing = '26px';
      c.fillText('NEXORA', w / 2 + 13, h / 2 + 4);
    }, true);
  }

  function materials() {
    const std = (o) => new T.MeshStandardMaterial(o);
    const top = pcbTexture();
    top.wrapS = top.wrapT = T.RepeatWrapping;
    top.repeat.set(1 / 3, 1 / 3);
    top.offset.set(0.5, 0.5);                       // cap UVs are in world units: [-1.5, 1.5] -> [0, 1]
    return {
      subTop: std({ color: 0xffffff, map: top, metalness: 0.25, roughness: 0.62, envMapIntensity: 0.7 }),
      subSide: std({ color: 0x0f1318, metalness: 0.3, roughness: 0.55, envMapIntensity: 0.6 }),
      itp: std({ color: 0x2b3440, metalness: 0.7, roughness: 0.38, envMapIntensity: 0.9 }),
      bump: std({ color: 0xb4bdcb, metalness: 1.0, roughness: 0.3, envMapIntensity: 1.0 }),
      die: std({ color: 0x0a0e14, metalness: 0.92, roughness: 0.2, envMapIntensity: 1.1 }),
      tile: std({ color: 0xffffff, metalness: 0.85, roughness: 0.28, envMapIntensity: 0.9 }),
      alu: std({ color: 0xd2dae5, metalness: 1.0, roughness: 0.30, envMapIntensity: 1.25 }),
      aluDark: std({ color: 0x8b95a5, metalness: 1.0, roughness: 0.42, envMapIntensity: 1.0 }),
      core: new T.MeshBasicMaterial({ color: BLUE.clone().multiplyScalar(0.8), toneMapped: false }),
      mark: new T.MeshBasicMaterial({ map: lidMark(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
      pin: new T.MeshBasicMaterial({ color: 0x262e3a, transparent: true, opacity: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })
    };
  }

  const dummy = new T.Object3D();
  function place(mesh, i, x, y, z, s) {
    dummy.position.set(x, y, z);
    dummy.scale.set(s || 1, s || 1, s || 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }

  function build(ctx) {
    const g = def.group;
    const M = materials();
    const seg = Q.low ? 6 : 10;

    asm = new T.Group(); g.add(asm);
    sub = new T.Group(); itp = new T.Group(); die = new T.Group(); lid = new T.Group();
    asm.add(sub, itp, die, lid);
    sub.position.y = SUB_Y; itp.position.y = ITP_Y; die.position.y = DIE_Y; lid.position.y = LID_Y;

    /* 01 substrate: slab with a printed top, 28 capacitors around the lid, 4 fiducials */
    const subGeo = U.roundedSlab(3.0, 3.0, 0.14, 0.10, 0.02, 5);
    sub.add(new T.Mesh(subGeo, [M.subTop, M.subSide]));
    const caps = new T.InstancedMesh(new T.BoxGeometry(0.10, 0.055, 0.06), M.aluDark, 28);
    let n = 0;
    for (let i = 0; i < 7; i++) {
      const t = (i - 3) * 0.36;
      place(caps, n++, t, 0.07 + 0.0275, 1.43);
      place(caps, n++, t, 0.07 + 0.0275, -1.43);
      place(caps, n++, 1.43, 0.07 + 0.0275, t);
      place(caps, n++, -1.43, 0.07 + 0.0275, t);
    }
    caps.instanceMatrix.needsUpdate = true;
    sub.add(caps);
    const fid = new T.CylinderGeometry(0.05, 0.05, 0.006, 20);
    [[1.3, 1.3], [-1.3, 1.3], [1.3, -1.3], [-1.3, -1.3]].forEach((c) => {
      const m = new T.Mesh(fid, M.alu); m.position.set(c[0], 0.073, c[1]); sub.add(m);
    });

    /* 02 interposer: slate slab + 18x18 micro-bumps */
    itp.add(new T.Mesh(U.roundedSlab(2.3, 2.3, 0.07, 0.06, 0.01, 4), M.itp));
    const bumps = new T.InstancedMesh(new T.CylinderGeometry(0.017, 0.017, 0.02, seg), M.bump, 18 * 18);
    n = 0;
    for (let ix = 0; ix < 18; ix++) for (let iz = 0; iz < 18; iz++) place(bumps, n++, (ix - 8.5) * 0.105, 0.045, (iz - 8.5) * 0.105);
    bumps.instanceMatrix.needsUpdate = true;
    itp.add(bumps);

    /* 03 die: glossy slab + 4x4 floorplan tiles + one emissive core */
    die.add(new T.Mesh(U.roundedSlab(1.5, 1.5, 0.06, 0.03, 0.008, 4), M.die));
    const tiles = new T.InstancedMesh(new T.BoxGeometry(0.28, 0.012, 0.28), M.tile, 16);
    const col = new T.Color();
    n = 0;
    for (let ix = 0; ix < 4; ix++) for (let iz = 0; iz < 4; iz++) {
      place(tiles, n, (ix - 1.5) * 0.35, 0.036, (iz - 1.5) * 0.35);
      const inner = (ix === 1 || ix === 2) && (iz === 1 || iz === 2);
      col.setHex(inner ? 0x24344f : ((ix + iz) % 2 ? 0x1a212b : 0x141a23));
      tiles.setColorAt(n, col);
      n++;
    }
    tiles.instanceMatrix.needsUpdate = true;
    tiles.instanceColor.needsUpdate = true;
    die.add(tiles);
    core = new T.Mesh(new T.BoxGeometry(0.26, 0.012, 0.26), M.core);
    core.position.y = 0.048;
    die.add(core);

    /* 04 lid: stepped heat spreader, etched mark, pin-1 triangle */
    const flange = new T.Mesh(U.roundedSlab(2.7, 2.7, 0.05, 0.12, 0.012, 5), M.aluDark); flange.position.y = 0.025;
    const step = new T.Mesh(U.roundedSlab(2.52, 2.52, 0.04, 0.11, 0.01, 5), M.alu); step.position.y = 0.07;
    const body = new T.Mesh(U.roundedSlab(2.36, 2.36, 0.13, 0.10, 0.03, 5), M.alu); body.position.y = 0.155;
    lid.add(flange, step, body);
    const mark = new T.Mesh(new T.PlaneGeometry(1.7, 0.425).rotateX(-Math.PI / 2), M.mark);
    mark.position.set(0, 0.2205, 0.0);
    lid.add(mark);
    const tri = new T.Shape(); tri.moveTo(0, 0); tri.lineTo(0.16, 0); tri.lineTo(0, 0.16);
    const pin = new T.Mesh(new T.ShapeGeometry(tri).rotateX(-Math.PI / 2), M.pin);
    pin.position.set(-1.05, 0.2205, 1.05 - 0.16 + 0.0);
    pin.rotation.y = 0;
    lid.add(pin);

    /* a dashed axis through the stack + a soft contact shadow below it */
    const gp = [];
    gp.push(0, -0.95, 0, 0, 2.05, 0);
    const gg = new T.BufferGeometry();
    gg.setAttribute('position', new T.Float32BufferAttribute(gp, 3));
    guides = new T.LineSegments(gg, new T.LineDashedMaterial({
      color: new T.Color(B.silver300 || '#CDD6E4'), dashSize: 0.05, gapSize: 0.07, transparent: true, opacity: 0, depthWrite: false
    }));
    guides.computeLineDistances();
    asm.add(guides);
    shadow = new T.Mesh(
      new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new T.MeshBasicMaterial({ map: U.radialTexture('rgba(0,0,0,0.85)', 'rgba(0,0,0,0)', 128), transparent: true, depthWrite: false, opacity: 0.6 })
    );
    shadow.position.y = -1.35;
    g.add(shadow);

    /* lights: warm key, cool rim, soft sky + a blue light that wakes up as the stack opens */
    const key = new T.DirectionalLight(0xfff3e6, 1.1); key.position.set(-4, 9, 6); g.add(key);
    const rim = new T.DirectionalLight(new T.Color(B.blueHi || '#8DB8F6'), 0.9); rim.position.set(7, 4, -6); g.add(rim);
    g.add(new T.HemisphereLight(0xcdd6e4, 0x0a0c0f, 0.3));
    accent = new T.PointLight(new T.Color(B.blue || '#4C91F0'), 0, 2.4, 2);
    asm.add(accent);

    /* DOM tags (decorative; the SVG fallback carries the same four labels) */
    tagsEl = document.createElement('div');
    tagsEl.className = 'stack-tags';
    tagsEl.setAttribute('aria-hidden', 'true');
    tagEls = TAGS.map((t) => {
      const el = document.createElement('div');
      el.className = 'stack-tag';
      el.innerHTML = '<i></i><span></span>';
      el.lastChild.textContent = t.text;
      tagsEl.appendChild(el);
      return el;
    });
    if (ctx.canvas.parentElement) ctx.canvas.parentElement.appendChild(tagsEl);

    update(0);
  }

  function update(p) {
    const e = easeInOut(range(p, 0.12, 0.40)) * (1 - easeInOut(range(p, 0.62, 0.92)));
    curE = e;
    sub.position.y = SUB_Y + SUB_DY * e;
    itp.position.y = ITP_Y + ITP_DY * e;
    die.position.y = DIE_Y + DIE_DY * e;
    lid.position.y = LID_Y + LID_DY * e;
    asm.rotation.y = lerp(-0.62, 0.30, smoothstep(0, 1, p));
    guides.material.opacity = 0.38 * smoothstep(0.05, 0.5, e);
    accent.position.y = die.position.y + 0.32;
    accent.intensity = 0.55 * e;
    core.material.color.copy(BLUE).multiplyScalar(lerp(0.75, 1.2, e));
    shadow.scale.set(lerp(3.4, 4.6, e), 1, lerp(3.4, 4.6, e));
    shadow.material.opacity = lerp(0.6, 0.4, e);
  }

  /* runs after the camera has its final pose for this frame, so tags never lag */
  function afterRender(p, ctx) {
    if (!tagEls) return;
    const show = smoothstep(0.5, 0.85, curE);
    if (show === 0 && lastShow === 0) return;
    lastShow = show;
    const cw = ctx.size.cssW, ch = ctx.size.cssH;
    const colX = cw * (cw < 420 ? 0.67 : 0.70);
    for (let i = 0; i < TAGS.length; i++) {
      const layer = i === 0 ? lid : i === 1 ? die : i === 2 ? itp : sub;
      const a = TAGS[i].anchor;
      tmp.set(a[0], a[1], a[2]);
      layer.localToWorld(tmp);
      tmp.project(ctx.camera);
      const x = (tmp.x * 0.5 + 0.5) * cw;
      const y = (-tmp.y * 0.5 + 0.5) * ch;
      const el = tagEls[i];
      el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
      el.style.setProperty('--w', Math.max(14, colX - x).toFixed(1) + 'px');
      el.style.opacity = show.toFixed(3);
    }
  }

  /* the stack sits left of centre; the tag column takes the right third */
  function resize(w, h, ctx) {
    ctx.camera.setViewOffset(w, h, (ctx.size.cssW < 420 ? 0.10 : 0.12) * w, 0, w, h);
  }

  function dispose() {
    if (tagsEl && tagsEl.parentNode) tagsEl.parentNode.removeChild(tagsEl);
    tagsEl = tagEls = null;
    asm = sub = itp = die = lid = guides = accent = core = shadow = null;
    lastShow = -1;
  }

  const def = {
    id: 'dataCore',
    fov: 28,
    cameraMode: 'spline',
    defaultLights: false,
    usesOpacityProxy: false,
    keys: [
      { t: 0.00, pos: orbit(40, 22, 10.4, 0.25), look: [0, 0.25, 0] },
      { t: 0.28, pos: orbit(36, 27, 12.2, 0.60), look: [0, 0.60, 0] },
      { t: 0.50, pos: orbit(30, 29, 12.6, 0.70), look: [0, 0.70, 0] },
      { t: 0.74, pos: orbit(36, 25, 12.0, 0.50), look: [0, 0.50, 0] },
      { t: 1.00, pos: orbit(40, 21, 10.4, 0.25), look: [0, 0.25, 0] }
    ],
    build, update, afterRender, resize, dispose
  };
  R.add(def);
})();
