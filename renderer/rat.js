// Low-poly "dancing rat" model — slim, GTA3-era faceted polygons with a
// low-resolution mottled fur texture. Fully rigged so the animation layer can
// drive breathing, looking, reaching, eating, poking, petting and dancing.
import * as THREE from './vendor/three.module.js';

// ---------------------------------------------------------------------------
// Low-res procedural textures (pixelated, nearest-filtered = retro look)
// ---------------------------------------------------------------------------
function clampByte(v) { return Math.max(0, Math.min(255, v | 0)); }
function hexRGB(hex) { return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]; }

function makeTex(size, base, speckle, opts = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const [r, g, b] = hexRGB(base);
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.fillRect(0, 0, size, size);

  // Optional lighter belly band toward the bottom of the texture.
  if (opts.belly) {
    const [lr, lg, lb] = hexRGB(opts.belly);
    for (let y = 0; y < size; y++) {
      const t = Math.max(0, (y - size * 0.35) / (size * 0.65));
      if (t <= 0) continue;
      for (let x = 0; x < size; x++) {
        ctx.fillStyle = `rgba(${lr},${lg},${lb},${t * 0.9})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  // Mottled speckle noise = low-res fur.
  const count = size * size * (opts.density || 0.7);
  for (let i = 0; i < count; i++) {
    const x = (Math.random() * size) | 0;
    const y = (Math.random() * size) | 0;
    const d = (Math.random() - 0.5) * 2 * speckle;
    ctx.fillStyle = `rgba(${clampByte(r + d)},${clampByte(g + d)},${clampByte(b + d)},0.55)`;
    ctx.fillRect(x, y, 1, 1);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

const TEX = {
  fur: makeTex(48, 0x5d5142, 58, { density: 1.0 }),
  furPlain: makeTex(40, 0x564a3c, 55, { density: 0.9 }),
  belly: makeTex(40, 0x9c8f7b, 34, { density: 0.7 }),
  pink: makeTex(24, 0xcc9a8c, 24, { density: 0.5 }),
  pinkDark: makeTex(24, 0xab7569, 26, { density: 0.5 }),
};

function furMat(tex) {
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0, flatShading: true });
}
function plainMat(color, rough = 1) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, flatShading: true });
}

const M = {
  fur: () => furMat(TEX.fur),
  furPlain: () => furMat(TEX.furPlain),
  belly: () => furMat(TEX.belly),
  pink: () => furMat(TEX.pink),
  pinkDark: () => furMat(TEX.pinkDark),
};

// Low-poly primitives.
function loSphere(r, mat, seg = 8) {
  return new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(4, seg - 2)), mat);
}
function loCyl(rt, rb, len, mat, seg = 7) {
  return new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, len, seg), mat);
}

// ---------------------------------------------------------------------------
export function buildRat() {
  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  // ---- Torso: a slim faceted pear via LatheGeometry ----------------------
  const profile = [
    [0.02, 0.45], [0.26, 0.5], [0.42, 0.66], [0.46, 0.86],
    [0.43, 1.06], [0.36, 1.28], [0.27, 1.5], [0.18, 1.66], [0.02, 1.74],
  ].map((p) => new THREE.Vector2(p[0], p[1]));
  const torsoGeo = new THREE.LatheGeometry(profile, 9);
  const torso = new THREE.Mesh(torsoGeo, M.fur());
  torso.scale.z = 0.88; // a touch flatter front-to-back
  bodyGroup.add(torso);

  // Lighter belly patch on the front.
  const belly = loSphere(0.4, M.belly(), 8);
  belly.scale.set(0.95, 1.05, 0.7);
  belly.position.set(0, 0.92, 0.24);
  bodyGroup.add(belly);

  // ---- Hind legs / feet --------------------------------------------------
  function leg(side) {
    const g = new THREE.Group();
    const thigh = loCyl(0.13, 0.17, 0.34, M.fur(), 6);
    thigh.position.y = -0.16;
    thigh.rotation.x = 0.35;
    g.add(thigh);
    const shin = loCyl(0.09, 0.12, 0.26, M.fur(), 6);
    shin.position.set(0, -0.36, 0.12);
    g.add(shin);
    const foot = loSphere(0.13, M.pink(), 7);
    foot.scale.set(0.8, 0.45, 1.7);
    foot.position.set(0, -0.46, 0.3);
    g.add(foot);
    g.position.set(side * 0.24, 0.5, 0.0);
    return g;
  }
  const legL = leg(-1);
  const legR = leg(1);
  bodyGroup.add(legL, legR);

  // ---- Tail (segmented) --------------------------------------------------
  const tail = new THREE.Group();
  tail.position.set(0, 0.6, -0.42);
  const tailSegs = [];
  let parent = tail;
  let segR = 0.12;
  for (let i = 0; i < 8; i++) {
    const seg = new THREE.Group();
    const m = loCyl(segR * 0.82, segR, 0.26, M.pink(), 6);
    m.rotation.x = Math.PI / 2;
    m.position.z = -0.13;
    seg.add(m);
    seg.position.z = i === 0 ? -0.08 : -0.24;
    parent.add(seg);
    parent = seg;
    tailSegs.push(seg);
    segR *= 0.84;
  }
  bodyGroup.add(tail);

  // ---- Arms (shoulder -> elbow -> paw), thin, correct elbow --------------
  function arm(side) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.3, 1.46, 0.06);
    // Rest: hang down, slightly forward and a little out.
    shoulder.rotation.set(-0.25, 0, side * 0.12);

    const upper = loCyl(0.085, 0.1, 0.42, M.fur(), 6);
    upper.position.y = -0.21;
    shoulder.add(upper);

    const elbow = new THREE.Group();
    elbow.position.y = -0.42;
    elbow.rotation.set(0.5, 0, 0); // forearm bent gently forward
    shoulder.add(elbow);

    const fore = loCyl(0.07, 0.085, 0.32, M.fur(), 6);
    fore.position.y = -0.16;
    elbow.add(fore);

    const paw = loSphere(0.1, M.pink(), 7);
    paw.scale.set(1, 0.85, 1.25);
    paw.position.y = -0.34;
    elbow.add(paw);

    return { shoulder, elbow, paw };
  }
  const armL = arm(-1);
  const armR = arm(1);
  bodyGroup.add(armL.shoulder, armR.shoulder);

  // ---- Neck + head (distinct, pointed snout) -----------------------------
  const neck = new THREE.Group();
  neck.position.set(0, 1.66, 0.02);
  bodyGroup.add(neck);

  const head = new THREE.Group();
  head.position.y = 0.12;
  head.rotation.x = 0.12; // nose tipped slightly down
  neck.add(head);

  const skull = loSphere(0.29, M.fur(), 9);
  skull.scale.set(0.95, 0.88, 1.0);
  head.add(skull);

  // Snout: a faceted cone tapering forward to the nose.
  const snout = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 8), M.fur());
  snout.rotation.x = Math.PI / 2;
  snout.position.set(0, -0.04, 0.34);
  snout.scale.set(1, 0.78, 1);
  head.add(snout);

  const nose = loSphere(0.06, M.pinkDark(), 6);
  nose.position.set(0, -0.05, 0.6);
  head.add(nose);

  // Lower jaw (opens for eating / squeaking).
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.12, 0.18);
  head.add(jaw);
  const jawMesh = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.4, 7), M.furPlain());
  jawMesh.rotation.x = Math.PI / 2;
  jawMesh.position.set(0, -0.02, 0.18);
  jawMesh.scale.set(1, 0.5, 1);
  jaw.add(jawMesh);
  const teeth = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.09, 0.03), plainMat(0xf3ead8, 0.5));
  teeth.position.set(0, 0.02, 0.36);
  jaw.add(teeth);

  // Eyes: dark bead with a small highlight that sits ON the surface.
  function eye(side) {
    const group = new THREE.Group();
    group.position.set(side * 0.16, 0.06, 0.24);
    const ball = loSphere(0.075, plainMat(0x141008, 0.35), 8);
    ball.scale.z = 0.7;
    group.add(ball);
    // Highlight: tiny, parented to the ball, placed at its surface (no float).
    const glint = loSphere(0.022, plainMat(0xffffff, 0.1), 5);
    glint.position.set(side * 0.02, 0.03, 0.055);
    ball.add(glint);
    // Upper lid: a fur cap that lowers to close the eye.
    const lid = new THREE.Mesh(
      new THREE.SphereGeometry(0.092, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      M.fur()
    );
    lid.position.z = 0.0;
    lid.rotation.x = -0.25;
    group.add(lid);
    return { group, lid, ball };
  }
  const eyeL = eye(-1);
  const eyeR = eye(1);
  head.add(eyeL.group, eyeR.group);

  // Ears: large rounded, pink inner, angled forward/out.
  function ear(side) {
    const g = new THREE.Group();
    g.position.set(side * 0.2, 0.26, -0.02);
    const outer = loSphere(0.18, M.fur(), 8);
    outer.scale.set(1.05, 1.15, 0.32);
    g.add(outer);
    const inner = loSphere(0.12, M.pink(), 7);
    inner.scale.set(1.0, 1.1, 0.3);
    inner.position.z = 0.05;
    g.add(inner);
    g.rotation.set(-0.1, side * 0.5, side * 0.2);
    return g;
  }
  const earL = ear(-1);
  const earR = ear(1);
  head.add(earL, earR);

  // Whiskers.
  const wMat = new THREE.LineBasicMaterial({ color: 0xd9cdbf, transparent: true, opacity: 0.5 });
  function whiskers(side) {
    const g = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(side * 0.42, 0.06 - i * 0.08, 0.05),
      ]);
      g.add(new THREE.Line(geo, wMat));
    }
    g.position.set(side * 0.08, -0.05, 0.46);
    return g;
  }
  head.add(whiskers(-1), whiskers(1));

  // Resting posture: slight chic lean-back.
  root.rotation.x = -0.03;

  return {
    root, bodyGroup, torso, belly, neck, head, jaw,
    eyeL, eyeR, earL, earR, armL, armR, legL, legR, tail, tailSegs,
  };
}
