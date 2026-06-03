// Low-poly "dancing rat" model — slim, GTA3-era faceted polygons with a
// low-resolution mottled fur texture. Tuned toward the meme rat: long pointed
// snout, big thin ears, lean hunched body, long dragging tail.
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

  // Mottled speckle noise = low-res fur. Cool + warm flecks for a grizzled look.
  const count = size * size * (opts.density || 0.8);
  for (let i = 0; i < count; i++) {
    const x = (Math.random() * size) | 0;
    const y = (Math.random() * size) | 0;
    const d = (Math.random() - 0.5) * 2 * speckle;
    const warm = Math.random() < 0.35 ? 8 : 0;
    ctx.fillStyle = `rgba(${clampByte(r + d + warm)},${clampByte(g + d)},${clampByte(b + d - warm)},0.5)`;
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
  fur: makeTex(48, 0x5f574d, 52, { density: 1.0 }),
  furPlain: makeTex(40, 0x554e45, 50, { density: 0.9 }),
  belly: makeTex(40, 0x837a6d, 34, { density: 0.8 }),
  pink: makeTex(24, 0xc89a8d, 22, { density: 0.5 }),
  pinkDark: makeTex(24, 0xa9756a, 24, { density: 0.5 }),
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

  // ---- Torso: a lean faceted body via LatheGeometry -----------------------
  // Pear/teardrop: rounded rump low, tapering up to a narrow neck.
  const profile = [
    [0.02, 0.42], [0.20, 0.46], [0.34, 0.6], [0.39, 0.8],
    [0.38, 1.0], [0.33, 1.2], [0.25, 1.38], [0.17, 1.54], [0.02, 1.62],
  ].map((p) => new THREE.Vector2(p[0], p[1]));
  const torsoGeo = new THREE.LatheGeometry(profile, 9);
  const torso = new THREE.Mesh(torsoGeo, M.fur());
  torso.scale.z = 0.92;
  bodyGroup.add(torso);

  // Lighter belly patch on the front.
  const belly = loSphere(0.36, M.belly(), 8);
  belly.scale.set(0.95, 1.15, 0.7);
  belly.position.set(0, 0.86, 0.22);
  bodyGroup.add(belly);

  // ---- Hind legs / feet --------------------------------------------------
  function leg(side) {
    const g = new THREE.Group();
    const thigh = loCyl(0.12, 0.16, 0.32, M.fur(), 6);
    thigh.position.y = -0.15;
    thigh.rotation.x = 0.4;
    g.add(thigh);
    const shin = loCyl(0.08, 0.11, 0.28, M.fur(), 6);
    shin.position.set(0, -0.34, 0.13);
    g.add(shin);
    const foot = loSphere(0.12, M.pink(), 7);
    foot.scale.set(0.75, 0.4, 1.9);
    foot.position.set(0, -0.46, 0.34);
    g.add(foot);
    g.position.set(side * 0.22, 0.48, 0.0);
    return g;
  }
  const legL = leg(-1);
  const legR = leg(1);
  bodyGroup.add(legL, legR);

  // ---- Tail (long, segmented, drags low) ---------------------------------
  const tail = new THREE.Group();
  tail.position.set(0, 0.48, -0.36);
  const tailSegs = [];
  let parent = tail;
  let segR = 0.11;
  for (let i = 0; i < 11; i++) {
    const seg = new THREE.Group();
    const m = loCyl(segR * 0.84, segR, 0.24, M.pink(), 6);
    m.rotation.x = Math.PI / 2;
    m.position.z = -0.12;
    seg.add(m);
    seg.position.z = i === 0 ? -0.06 : -0.22;
    // Droop the tail down toward the floor as it extends.
    seg.rotation.x = i === 0 ? 0.15 : 0.12;
    parent.add(seg);
    parent = seg;
    tailSegs.push(seg);
    segR *= 0.88;
  }
  bodyGroup.add(tail);

  // ---- Arms (shoulder -> elbow -> paw), thin, correct elbow --------------
  function arm(side) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.27, 1.46, 0.08);
    shoulder.rotation.set(-0.3, 0, side * 0.1);

    const upper = loCyl(0.075, 0.092, 0.44, M.fur(), 6);
    upper.position.y = -0.22;
    shoulder.add(upper);

    const elbow = new THREE.Group();
    elbow.position.y = -0.44;
    elbow.rotation.set(0.55, 0, 0);
    shoulder.add(elbow);

    const fore = loCyl(0.06, 0.075, 0.34, M.fur(), 6);
    fore.position.y = -0.17;
    elbow.add(fore);

    const paw = loSphere(0.092, M.pink(), 7);
    paw.scale.set(1, 0.8, 1.3);
    paw.position.y = -0.36;
    elbow.add(paw);

    return { shoulder, elbow, paw };
  }
  const armL = arm(-1);
  const armR = arm(1);
  bodyGroup.add(armL.shoulder, armR.shoulder);

  // ---- Neck + head (big wedge head, long pointed snout) ------------------
  const neck = new THREE.Group();
  neck.position.set(0, 1.54, 0.02);
  bodyGroup.add(neck);

  const head = new THREE.Group();
  head.position.y = 0.14;
  head.rotation.x = 0.16; // nose tipped down/forward
  neck.add(head);

  // Skull: elongated front-to-back so the face reads as a long rat muzzle.
  const skull = loSphere(0.3, M.fur(), 9);
  skull.scale.set(0.92, 0.82, 1.18);
  skull.position.z = 0.02;
  head.add(skull);

  // Snout: a long faceted cone tapering forward to the nose.
  const snout = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.62, 8), M.fur());
  snout.rotation.x = Math.PI / 2;
  snout.position.set(0, -0.05, 0.42);
  snout.scale.set(1, 0.74, 1);
  head.add(snout);

  const nose = loSphere(0.055, M.pinkDark(), 6);
  nose.position.set(0, -0.07, 0.72);
  head.add(nose);

  // Lower jaw (opens for eating / squeaking).
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.14, 0.2);
  head.add(jaw);
  const jawMesh = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.46, 7), M.furPlain());
  jawMesh.rotation.x = Math.PI / 2;
  jawMesh.position.set(0, -0.01, 0.22);
  jawMesh.scale.set(1, 0.46, 1);
  jaw.add(jawMesh);
  const teeth = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.08, 0.03), plainMat(0xf1e8d6, 0.5));
  teeth.position.set(0, 0.02, 0.42);
  jaw.add(teeth);

  // Eyes: small beads on the upper sides of the muzzle, highlight on-surface.
  function eye(side) {
    const group = new THREE.Group();
    group.position.set(side * 0.15, 0.08, 0.3);
    const ball = loSphere(0.062, plainMat(0x120f08, 0.35), 8);
    ball.scale.z = 0.75;
    group.add(ball);
    const glint = loSphere(0.018, plainMat(0xffffff, 0.1), 5);
    glint.position.set(side * 0.018, 0.025, 0.045);
    ball.add(glint);
    const lid = new THREE.Mesh(
      new THREE.SphereGeometry(0.075, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      M.fur()
    );
    lid.rotation.x = -0.25;
    group.add(lid);
    return { group, lid, ball };
  }
  const eyeL = eye(-1);
  const eyeR = eye(1);
  head.add(eyeL.group, eyeR.group);

  // Ears: large, thin, rounded; set wide and slightly back, angled outward.
  function ear(side) {
    const g = new THREE.Group();
    g.position.set(side * 0.26, 0.14, -0.05);
    const outer = loSphere(0.19, M.fur(), 9);
    outer.scale.set(1.15, 1.2, 0.2);
    g.add(outer);
    const inner = loSphere(0.12, M.pink(), 8);
    inner.scale.set(1.0, 1.15, 0.18);
    inner.position.z = 0.04;
    g.add(inner);
    g.rotation.set(0.04, side * 0.75, side * 0.42);
    return g;
  }
  const earL = ear(-1);
  const earR = ear(1);
  head.add(earL, earR);

  // Whiskers.
  const wMat = new THREE.LineBasicMaterial({ color: 0xd9cdbf, transparent: true, opacity: 0.45 });
  function whiskers(side) {
    const g = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(side * 0.46, 0.06 - i * 0.08, 0.04),
      ]);
      g.add(new THREE.Line(geo, wMat));
    }
    g.position.set(side * 0.07, -0.06, 0.56);
    return g;
  }
  head.add(whiskers(-1), whiskers(1));

  // Resting posture: a slight chic lean-back.
  root.rotation.x = -0.02;

  return {
    root, bodyGroup, torso, belly, neck, head, jaw,
    eyeL, eyeR, earL, earR, armL, armR, legL, legR, tail, tailSegs,
  };
}
