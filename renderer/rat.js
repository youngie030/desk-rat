// Low-poly rat model tuned toward the "dancing rat" meme. Built so it reads as
// ONE creature: capsule limbs embedded into the torso with blend masses at every
// joint (shoulder/hip/neck/tail-base) hiding the seams. GTA3-era faceting via
// flatShading + a low-res mottled fur texture.
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
  fur: makeTex(48, 0x5f574d, 50, { density: 1.0 }),
  furDark: makeTex(40, 0x554e45, 48, { density: 0.9 }),
  belly: makeTex(40, 0x837a6d, 32, { density: 0.8 }),
  pink: makeTex(24, 0xc89a8d, 22, { density: 0.5 }),
  pinkDark: makeTex(24, 0xa9756a, 24, { density: 0.5 }),
};

// One shared fur material instance keeps every body part visually identical so
// the creature reads as a single skin rather than assorted props.
const MAT = {
  fur: new THREE.MeshStandardMaterial({ map: TEX.fur, roughness: 1, metalness: 0, flatShading: true }),
  furDark: new THREE.MeshStandardMaterial({ map: TEX.furDark, roughness: 1, metalness: 0, flatShading: true }),
  belly: new THREE.MeshStandardMaterial({ map: TEX.belly, roughness: 1, metalness: 0, flatShading: true }),
  pink: new THREE.MeshStandardMaterial({ map: TEX.pink, roughness: 1, metalness: 0, flatShading: true }),
  pinkDark: new THREE.MeshStandardMaterial({ map: TEX.pinkDark, roughness: 1, metalness: 0, flatShading: true }),
};
function plainMat(color, rough = 1) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, flatShading: true });
}

// Low-poly primitives.
function sph(r, mat, seg = 8) {
  return new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(4, seg - 2)), mat);
}
function caps(r, len, mat, seg = 6) {
  return new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 2, seg), mat);
}

// ---------------------------------------------------------------------------
export function buildRat() {
  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  // ---- Torso: lean faceted body via LatheGeometry --------------------------
  const profile = [
    [0.02, 0.40], [0.22, 0.45], [0.36, 0.6], [0.41, 0.8], [0.40, 1.0],
    [0.35, 1.18], [0.29, 1.34], [0.22, 1.46], [0.13, 1.54], [0.02, 1.58],
  ].map((p) => new THREE.Vector2(p[0], p[1]));
  const torsoGeo = new THREE.LatheGeometry(profile, 10);
  // Vertex-colour shading: darker along the back/top, lighter on the belly/front,
  // so the body has dorsal/ventral tone instead of a flat colour.
  {
    const pos = torsoGeo.attributes.position;
    const cols = [];
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i), z = pos.getZ(i);
      let t = 0.94 + z * 0.5 - Math.max(0, y - 0.9) * 0.12;
      t = Math.max(0.7, Math.min(1.14, t));
      cols.push(t, t, t);
    }
    torsoGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  }
  const torsoMat = MAT.fur.clone();
  torsoMat.vertexColors = true;
  const torso = new THREE.Mesh(torsoGeo, torsoMat);
  torso.scale.z = 0.94;
  bodyGroup.add(torso);

  // Lighter belly underside (bulges only when full).
  const belly = sph(0.36, MAT.belly, 9);
  belly.scale.set(0.95, 1.15, 0.7);
  belly.position.set(0, 0.84, 0.2);
  bodyGroup.add(belly);

  // Helper: a static blend mass that fills a joint seam (child of bodyGroup).
  function blob(x, y, z, r, sx, sy, sz, mat) {
    const m = sph(r, mat || MAT.fur, 8);
    m.position.set(x, y, z);
    m.scale.set(sx || 1, sy || 1, sz || 1);
    bodyGroup.add(m);
    return m;
  }

  // Shoulder, hip, neck and tail-base masses so the limbs emerge from the body.
  blob(-0.3, 1.36, 0.05, 0.2, 1, 1.1, 1);   // L shoulder
  blob(0.3, 1.36, 0.05, 0.2, 1, 1.1, 1);    // R shoulder
  blob(-0.26, 0.62, 0.02, 0.24, 1, 1.15, 1); // L hip
  blob(0.26, 0.62, 0.02, 0.24, 1, 1.15, 1);  // R hip
  blob(0, 1.5, 0.03, 0.2, 1.05, 0.9, 1.05);  // neck
  blob(0, 0.5, -0.28, 0.2, 1, 1, 1);         // tail base

  // ---- Hind legs (thigh -> shin -> foot), embedded into the hip blob ------
  function leg(side) {
    const g = new THREE.Group();
    g.position.set(side * 0.26, 0.66, 0.0);
    const thigh = caps(0.15, 0.26, MAT.fur);
    thigh.position.y = -0.14;
    thigh.rotation.x = 0.35;
    g.add(thigh);
    const knee = new THREE.Group();
    knee.position.set(0, -0.32, 0.1);
    g.add(knee);
    const shin = caps(0.11, 0.22, MAT.fur);
    shin.position.y = -0.12;
    shin.rotation.x = -0.2;
    knee.add(shin);
    const foot = sph(0.12, MAT.pink, 7);
    foot.scale.set(0.8, 0.45, 1.8);
    foot.position.set(0, -0.26, 0.16);
    knee.add(foot);
    for (let k = -1; k <= 1; k++) {
      const toe = sph(0.045, MAT.pink, 5);
      toe.scale.set(1, 0.7, 1.4);
      toe.position.set(k * 0.06, -0.27, 0.34);
      knee.add(toe);
    }
    return Object.assign(g, { knee });
  }
  const legL = leg(-1);
  const legR = leg(1);
  bodyGroup.add(legL, legR);

  // ---- Tail (long, segmented, drags low) ---------------------------------
  const tail = new THREE.Group();
  tail.position.set(0, 0.5, -0.32);
  const tailSegs = [];
  let parent = tail;
  let segR = 0.12;
  for (let i = 0; i < 11; i++) {
    const seg = new THREE.Group();
    const m = caps(segR, 0.18, MAT.pink, 6);
    m.rotation.x = Math.PI / 2;
    m.position.z = -0.12;
    seg.add(m);
    seg.position.z = i === 0 ? -0.04 : -0.22;
    seg.rotation.x = i === 0 ? 0.18 : 0.12;
    parent.add(seg);
    parent = seg;
    tailSegs.push(seg);
    segR *= 0.9;
  }
  bodyGroup.add(tail);

  // ---- Arms (shoulder -> elbow -> paw): capsules, elbow bends FORWARD ------
  function arm(side) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.3, 1.42, 0.05);
    shoulder.rotation.set(-0.35, 0, side * 0.08);

    const upper = caps(0.11, 0.3, MAT.fur);
    upper.position.y = -0.18; // top embedded in the shoulder blob
    shoulder.add(upper);

    const elbow = new THREE.Group();
    elbow.position.y = -0.4;
    elbow.rotation.set(-0.5, 0, 0); // negative = forearm folds forward/up
    shoulder.add(elbow);

    const elbowBlob = sph(0.11, MAT.fur, 7);
    elbow.add(elbowBlob);

    const fore = caps(0.092, 0.26, MAT.fur);
    fore.position.y = -0.15;
    elbow.add(fore);

    const paw = sph(0.1, MAT.pink, 7);
    paw.scale.set(1, 0.85, 1.2);
    paw.position.y = -0.32;
    elbow.add(paw);
    for (let k = -1; k <= 1; k++) {
      const fin = sph(0.032, MAT.pink, 5);
      fin.position.set(k * 0.045, -0.41, 0.05);
      elbow.add(fin);
    }

    return { shoulder, elbow, paw };
  }
  const armL = arm(-1);
  const armR = arm(1);
  bodyGroup.add(armL.shoulder, armR.shoulder);

  // ---- Neck + head (big wedge head, long pointed snout) ------------------
  const neck = new THREE.Group();
  neck.position.set(0, 1.5, 0.04);
  bodyGroup.add(neck);

  const head = new THREE.Group();
  head.position.y = 0.12;
  head.rotation.x = 0.14; // nose tipped down/forward
  neck.add(head);

  // Skull blends into the neck (overlaps downward) so the head doesn't float.
  const skull = sph(0.3, MAT.fur, 9);
  skull.scale.set(0.94, 0.86, 1.16);
  skull.position.set(0, -0.02, 0.02);
  head.add(skull);

  const snout = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.6, 8), MAT.fur);
  snout.rotation.x = Math.PI / 2;
  snout.position.set(0, -0.06, 0.42);
  snout.scale.set(1, 0.76, 1);
  head.add(snout);

  const nose = sph(0.055, MAT.pinkDark, 6);
  nose.position.set(0, -0.08, 0.72);
  head.add(nose);

  // Lower jaw.
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.13, 0.2);
  head.add(jaw);
  const jawMesh = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.44, 7), MAT.furDark);
  jawMesh.rotation.x = Math.PI / 2;
  jawMesh.position.set(0, -0.01, 0.22);
  jawMesh.scale.set(1, 0.46, 1);
  jaw.add(jawMesh);
  const teeth = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.08, 0.03), plainMat(0xf1e8d6, 0.5));
  teeth.position.set(0, 0.02, 0.42);
  jaw.add(teeth);

  // Eyes: small beads, highlight parented to the eyeball (no float).
  function eye(side) {
    const group = new THREE.Group();
    group.position.set(side * 0.16, 0.07, 0.28);
    const ball = sph(0.062, plainMat(0x120f08, 0.35), 8);
    ball.scale.z = 0.75;
    group.add(ball);
    const glint = sph(0.018, plainMat(0xffffff, 0.1), 5);
    glint.position.set(side * 0.018, 0.025, 0.045);
    ball.add(glint);
    const lid = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), MAT.fur);
    lid.rotation.x = -0.25;
    group.add(lid);
    return { group, lid, ball };
  }
  const eyeL = eye(-1);
  const eyeR = eye(1);
  head.add(eyeL.group, eyeR.group);

  // Ears: large, thin, rounded; set wide, angled out.
  function ear(side) {
    const g = new THREE.Group();
    g.position.set(side * 0.25, 0.16, -0.04);
    const outer = sph(0.19, MAT.fur, 9);
    outer.scale.set(1.15, 1.2, 0.22);
    g.add(outer);
    const inner = sph(0.12, MAT.pink, 8);
    inner.scale.set(1.0, 1.15, 0.2);
    inner.position.z = 0.04;
    g.add(inner);
    g.rotation.set(0.04, side * 0.72, side * 0.4);
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
    g.position.set(side * 0.07, -0.07, 0.56);
    return g;
  }
  head.add(whiskers(-1), whiskers(1));

  root.rotation.x = -0.02;

  return {
    root, bodyGroup, torso, belly, neck, head, jaw,
    eyeL, eyeR, earL, earR, armL, armR, legL, legR, tail, tailSegs,
  };
}
