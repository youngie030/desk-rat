// Procedural rat model built from primitives, fully rigged so the animation
// layer can drive breathing, looking, reaching, eating, poking and petting.
import * as THREE from './vendor/three.module.js';

const COL = {
  fur: 0x6b5d4d,
  furDark: 0x4f4438,
  belly: 0x9a8a76,
  ear: 0x5b4f42,
  earInner: 0xd99a8f,
  paw: 0xdca596,
  nose: 0xd98f86,
  eye: 0x161210,
  tooth: 0xf4ece0,
};

function mat(color, rough = 0.85) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.0 });
}

function sphere(r, c, rough) {
  return new THREE.Mesh(new THREE.SphereGeometry(r, 28, 22), mat(c, rough));
}

function capsule(r, len, c) {
  return new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 10, 18), mat(c));
}

export function buildRat() {
  const root = new THREE.Group();

  // ---- Body --------------------------------------------------------------
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const body = capsule(0.62, 0.95, COL.fur);
  body.scale.set(1.05, 1.0, 0.92);
  body.position.y = 1.15;
  bodyGroup.add(body);

  // Soft lighter belly that bulges when the rat is full.
  const belly = sphere(0.55, COL.belly);
  belly.scale.set(0.95, 1.05, 0.8);
  belly.position.set(0, 0.95, 0.28);
  bodyGroup.add(belly);

  // Haunches near the floor.
  const hipL = sphere(0.42, COL.fur);
  hipL.position.set(-0.34, 0.55, 0.05);
  hipL.scale.set(1, 1.1, 1);
  bodyGroup.add(hipL);
  const hipR = hipL.clone();
  hipR.position.x = 0.34;
  bodyGroup.add(hipR);

  // ---- Legs / feet -------------------------------------------------------
  function leg(side) {
    const g = new THREE.Group();
    const thigh = capsule(0.18, 0.3, COL.fur);
    thigh.position.y = -0.2;
    thigh.rotation.x = 0.5;
    g.add(thigh);
    const foot = sphere(0.2, COL.paw, 0.7);
    foot.scale.set(1, 0.5, 1.5);
    foot.position.set(0, -0.42, 0.28);
    g.add(foot);
    g.position.set(side * 0.32, 0.5, 0.06);
    return g;
  }
  const legL = leg(-1);
  const legR = leg(1);
  bodyGroup.add(legL, legR);

  // ---- Tail (segmented, animatable) -------------------------------------
  const tail = new THREE.Group();
  tail.position.set(0, 0.6, -0.5);
  const tailSegs = [];
  let parent = tail;
  let segR = 0.16;
  for (let i = 0; i < 7; i++) {
    const seg = new THREE.Group();
    const m = capsule(segR, 0.22, COL.paw);
    m.rotation.x = Math.PI / 2;
    m.position.z = -0.18;
    seg.add(m);
    seg.position.z = i === 0 ? -0.1 : -0.34;
    parent.add(seg);
    parent = seg;
    tailSegs.push(seg);
    segR *= 0.86;
  }
  bodyGroup.add(tail);

  // ---- Arms (shoulder -> forearm -> paw) --------------------------------
  function arm(side) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.52, 1.5, 0.26);
    // Resting pose: arms folded forward onto the belly (classic rodent look).
    shoulder.rotation.set(-0.55, 0, side * 0.18);

    const upper = capsule(0.15, 0.32, COL.fur);
    upper.position.y = -0.28;
    shoulder.add(upper);

    const elbow = new THREE.Group();
    elbow.position.y = -0.55;
    elbow.rotation.set(0.7, 0, side * -0.25);
    shoulder.add(elbow);

    const fore = capsule(0.13, 0.3, COL.fur);
    fore.position.y = -0.26;
    elbow.add(fore);

    const paw = sphere(0.18, COL.paw, 0.7);
    paw.position.y = -0.5;
    paw.scale.set(1.1, 0.9, 1.1);
    elbow.add(paw);

    return { shoulder, elbow, paw };
  }
  const armL = arm(-1);
  const armR = arm(1);
  bodyGroup.add(armL.shoulder, armR.shoulder);

  // ---- Head --------------------------------------------------------------
  const neck = new THREE.Group();
  neck.position.set(0, 1.75, 0.05);
  bodyGroup.add(neck);

  const head = new THREE.Group();
  neck.add(head);

  const skull = sphere(0.5, COL.fur);
  skull.scale.set(1, 0.95, 1.05);
  head.add(skull);

  // Snout tapering forward.
  const snout = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.62, 22), mat(COL.fur));
  snout.rotation.x = Math.PI / 2;
  snout.position.set(0, -0.06, 0.5);
  snout.scale.set(1, 0.8, 1);
  head.add(snout);

  const nose = sphere(0.09, COL.nose, 0.5);
  nose.position.set(0, -0.04, 0.82);
  head.add(nose);

  // Lower jaw (opens for eating / squeaking).
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.16, 0.3);
  head.add(jaw);
  const jawMesh = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.5, 20), mat(COL.furDark));
  jawMesh.rotation.x = Math.PI / 2;
  jawMesh.position.set(0, -0.04, 0.22);
  jawMesh.scale.set(1, 0.55, 1);
  jaw.add(jawMesh);
  // Two little incisors.
  const teeth = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.04), mat(COL.tooth, 0.4));
  teeth.position.set(0, 0.02, 0.46);
  jaw.add(teeth);

  // Eyes with eyelids for blink / squint / emotion.
  function eye(side) {
    const g = new THREE.Group();
    g.position.set(side * 0.26, 0.12, 0.4);
    const ball = sphere(0.13, COL.eye, 0.25);
    ball.scale.z = 0.6;
    g.add(ball);
    const glint = sphere(0.04, 0xffffff, 0.1);
    glint.position.set(side * 0.04, 0.05, 0.1);
    g.add(glint);
    // Upper lid (a fur-colored cap that lowers to half-close the eye).
    const lid = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat(COL.fur));
    lid.position.z = 0.02;
    lid.rotation.x = -0.2;
    g.add(lid);
    return { group: g, lid };
  }
  const eyeL = eye(-1);
  const eyeR = eye(1);
  head.add(eyeL.group, eyeR.group);

  // Ears (big, pink-rimmed discs that twitch / fold back).
  function ear(side) {
    const g = new THREE.Group();
    g.position.set(side * 0.34, 0.42, -0.02);
    g.rotation.z = side * -0.25;
    const outer = new THREE.Mesh(new THREE.CircleGeometry(0.3, 26), mat(COL.ear));
    outer.scale.set(0.85, 1, 1);
    g.add(outer);
    const inner = new THREE.Mesh(new THREE.CircleGeometry(0.21, 24), mat(COL.earInner, 0.6));
    inner.position.z = 0.01;
    inner.scale.set(0.85, 1, 1);
    g.add(inner);
    g.rotation.y = side * 0.35;
    return g;
  }
  const earL = ear(-1);
  const earR = ear(1);
  head.add(earL, earR);

  // Whiskers.
  const whiskerMat = new THREE.LineBasicMaterial({ color: 0xd9cdbf, transparent: true, opacity: 0.6 });
  function whiskers(side) {
    const g = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(side * 0.6, 0.1 - i * 0.12, 0.1),
      ]);
      g.add(new THREE.Line(geo, whiskerMat));
    }
    g.position.set(side * 0.18, -0.04, 0.66);
    return g;
  }
  head.add(whiskers(-1), whiskers(1));

  // Whole-rat resting pose: a touch of chic lean-back.
  root.rotation.x = -0.04;

  return {
    root,
    bodyGroup,
    body,
    belly,
    neck,
    head,
    jaw,
    eyeL,
    eyeR,
    earL,
    earR,
    armL,
    armR,
    legL,
    legR,
    tail,
    tailSegs,
  };
}
