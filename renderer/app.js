import * as THREE from './vendor/three.module.js';
import { buildRat } from './rat.js';

// ---------------------------------------------------------------------------
// Scene / renderer / camera
// ---------------------------------------------------------------------------
const canvas = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
camera.position.set(0, 1.55, 6.4);
camera.lookAt(0, 1.35, 0);

scene.add(new THREE.HemisphereLight(0xfff3e0, 0x40382f, 1.05));
const key = new THREE.DirectionalLight(0xffffff, 1.15);
key.position.set(2.5, 5, 4);
scene.add(key);
const rim = new THREE.DirectionalLight(0xffd9a8, 0.5);
rim.position.set(-3, 2, -3);
scene.add(rim);

const rat = buildRat();
scene.add(rat.root);

// Capture base rotations we animate as offsets.
const base = {
  earL: rat.earL.rotation.clone(),
  earR: rat.earR.rotation.clone(),
  shoulderL: rat.armL.shoulder.rotation.clone(),
  shoulderR: rat.armR.shoulder.rotation.clone(),
  elbowL: rat.armL.elbow.rotation.clone(),
  elbowR: rat.armR.elbow.rotation.clone(),
};

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------------------
// Pose controller: target values are eased into `cur` each frame, then
// procedural motion (breathing, sway, wag, blink) is layered on top.
// ---------------------------------------------------------------------------
const def = {
  rootRotX: -0.04, rootRotY: 0, rootRotZ: 0, rootY: 0,
  bodyLean: 0, squash: 0,
  neckX: 0, neckY: 0, neckZ: 0,
  jaw: 0,
  eyeOpen: 0.52, // chic = half-lidded
  earBack: 0, earPerk: 0,
  armRaise: 0, armIn: 0, armSpread: 0,
  belly: 0,
  tailAmp: 0.13, tailSpeed: 1.4,
  lookGain: 0, // how strongly the neck follows the cursor
};
const target = { ...def };
const cur = { ...def };

function lerp(a, b, t) { return a + (b - a) * t; }

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------
let state = 'idle';
let stateT = 0;
const data = {}; // per-state scratch
let annoy = 0;
let fullness = 0; // 0..1 persistent belly fill

function setState(s) {
  state = s;
  stateT = 0;
  for (const k in data) delete data[k];
}

const bubbleEl = document.getElementById('bubble');
let bubbleTimer = 0;
function say(text, dur = 1.6) {
  bubbleEl.textContent = text;
  bubbleEl.classList.add('show');
  bubbleTimer = dur;
}

// ---------------------------------------------------------------------------
// Cursor (global, via main process) + drag tracking (DOM)
// ---------------------------------------------------------------------------
const cursor = { x: -999, y: -999, inside: false, w: 480, h: 520 };
window.deskrat.onCursor((d) => { Object.assign(cursor, d); });

let dragActive = false;
let lastDragT = 0;
const dragPt = { x: 0, y: 0 };

function onDragOver(e) {
  e.preventDefault();
  dragActive = true;
  lastDragT = stateClock;
  dragPt.x = e.clientX;
  dragPt.y = e.clientY;
}
window.addEventListener('dragenter', onDragOver);
window.addEventListener('dragover', onDragOver);
window.addEventListener('dragleave', (e) => { e.preventDefault(); });

window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragActive = false;
  const files = [...(e.dataTransfer?.files || [])];
  if (!files.length) return;
  const paths = files.map((f) => window.deskrat.pathForFile(f)).filter(Boolean);
  if (!paths.length) return;
  startEat(paths);
});

// Debug overlay (visible only in demo/test runs).
if (window.deskrat?.dev) {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:4px;bottom:4px;color:#0f0;font:11px monospace;background:rgba(0,0,0,.6);padding:2px 4px;z-index:99;pointer-events:none;';
  document.body.appendChild(d);
  window.__DBG = d;
}

// Dev-only auto-feed (DESKRAT_TEST=1).
window.deskrat.onDevEat?.((p) => { startEat([p]); });
// Dev-only pose tour (DESKRAT_DEMO=1).
window.deskrat.onDevPose?.((p) => { setState('demo'); if (p === 'TOUR') data.tour = true; else data.pose = p; });

// Clicks: left = poke, right = pet.
window.addEventListener('mousedown', (e) => {
  if (!overRat(e.clientX, e.clientY)) return;
  if (e.button === 0) poke();
  else if (e.button === 2) pet();
});
window.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------------------------------------------------------------------------
// Projection helpers
// ---------------------------------------------------------------------------
const _v = new THREE.Vector3();
function worldToScreen(obj, ox = 0, oy = 0, oz = 0) {
  obj.getWorldPosition(_v);
  _v.x += ox; _v.y += oy; _v.z += oz;
  _v.project(camera);
  return {
    x: (_v.x * 0.5 + 0.5) * window.innerWidth,
    y: (-_v.y * 0.5 + 0.5) * window.innerHeight,
  };
}
function headScreen() { return worldToScreen(rat.head); }
function mouthScreen() { return worldToScreen(rat.head, 0, -0.1, 0.7); }
function bodyScreen() { return worldToScreen(rat.bodyGroup, 0, 1.05, 0); }

function overRat(px, py) {
  const b = bodyScreen();
  const dx = px - b.x, dy = py - (b.y - 20);
  return dx * dx + dy * dy < 150 * 150;
}
function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }

// ---------------------------------------------------------------------------
// Behaviours
// ---------------------------------------------------------------------------
function poke() {
  annoy = Math.min(annoy + 1, 4);
  setState('poke');
  say(annoy >= 3 ? '아 진짜 그만!' : '야!', 1.2);
}
function pet() {
  setState('pet');
  data.warm = 0;
  say('...뭐, 나쁘진 않네', 1.6);
}
function startEat(paths) {
  setState('eat');
  data.paths = paths;
  data.phase = 'grab';
  data.chew = 0;
  data.size = 0;
  // Trash each file; total size decides how full the rat gets.
  Promise.all(paths.map((p) => window.deskrat.trash(p))).then((res) => {
    console.log('[deskrat] trash result', JSON.stringify(res));
    let total = 0;
    for (const r of res) if (r && r.ok) total += r.size || 0;
    data.size = total;
  });
}

// ---------------------------------------------------------------------------
// Random idle fidgets
// ---------------------------------------------------------------------------
let blink = 1;
let nextBlink = 2 + Math.random() * 3;
let nextFidget = 3 + Math.random() * 4;
let earTwitch = 0;
let idleLook = 0;
let idleLookTarget = -0.18; // chic: tends to glance away

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();
let stateClock = 0;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  stateClock += dt;
  stateT += dt;

  if (dragActive && stateClock - lastDragT > 0.2) dragActive = false;

  // Geometry-derived cursor relationships.
  const hs = headScreen();
  const bs = bodyScreen();
  const curDist = cursor.inside || cursor.x > -900
    ? dist(cursor.x, cursor.y, bs.x, bs.y - 10)
    : 9999;

  updateState(dt, hs, bs, curDist);

  // ---- ease cur -> target ----
  const k = 1 - Math.pow(0.001, dt); // ~smoothing
  for (const key in target) cur[key] = lerp(cur[key], target[key], k);

  applyPose(t, dt, hs, bs, curDist);

  // bubble fade
  if (bubbleTimer > 0) {
    bubbleTimer -= dt;
    if (bubbleTimer <= 0) bubbleEl.classList.remove('show');
  }

  if (window.__DBG) {
    window.__DBG.textContent =
      `state=${state} pose=${data.pose || '-'} belly=${cur.belly.toFixed(2)} ` +
      `squash=${cur.squash.toFixed(2)} bsx=${rat.bodyGroup.scale.x.toFixed(2)} ` +
      `bellyScaleX=${rat.belly.scale.x.toFixed(2)} lean=${cur.bodyLean.toFixed(2)}`;
  }

  // Report silhouette to main for cursor hit-testing.
  window.deskrat.reportRegion({ cx: bs.x, cy: bs.y - 20, r: 150 });

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

function updateState(dt, hs, bs, curDist) {
  // Look gain: rat watches the cursor when it's reasonably near.
  const near = curDist < 300;

  switch (state) {
    case 'idle': {
      Object.assign(target, {
        eyeOpen: 0.5, earBack: 0, earPerk: 0,
        armRaise: 0, armIn: 0, jaw: 0, bodyLean: 0,
        tailAmp: 0.13, tailSpeed: 1.3, lookGain: near ? 0.5 : 0.12,
        belly: fullness,
      });
      if (annoy > 0) annoy = Math.max(0, annoy - dt * 0.3);
      if (near) setState('curious');
      break;
    }
    case 'curious': {
      Object.assign(target, {
        eyeOpen: 1, earPerk: 1, earBack: 0,
        bodyLean: 0.12, tailAmp: 0.22, tailSpeed: 2.2,
        armRaise: 0, armIn: 0, jaw: 0, lookGain: 1, belly: fullness,
      });
      if (dragActive) { setState('reach'); break; }
      if (curDist > 360) setState('idle');
      break;
    }
    case 'reach': {
      const ms = mouthScreen();
      const md = dist(cursor.x, cursor.y, ms.x, ms.y);
      data.reached = data.reached || md < 95;
      Object.assign(target, {
        eyeOpen: 1, earPerk: 1, bodyLean: 0.32,
        armRaise: 1, armIn: 0, jaw: 0.5, lookGain: 1.1,
        tailAmp: 0.3, tailSpeed: 3.2, belly: fullness,
      });
      if (!dragActive) { setState('curious'); break; }
      // Teased: had it close, now pulled away.
      if (data.reached && md > 175) setState('beg');
      break;
    }
    case 'beg': {
      const ms = mouthScreen();
      const md = dist(cursor.x, cursor.y, ms.x, ms.y);
      const hop = Math.abs(Math.sin(stateT * 11)) * 0.12;
      Object.assign(target, {
        eyeOpen: 1.15, earPerk: 1, bodyLean: 0.42,
        armRaise: 1.25, armIn: 0, jaw: 0.35 + Math.sin(stateT * 14) * 0.2,
        lookGain: 1.2, tailAmp: 0.34, tailSpeed: 4, rootY: hop, belly: fullness,
      });
      if (!data.said) { say('줘... 줘!!', 1.4); data.said = true; }
      if (!dragActive) { say('치...', 1.0); setState('idle'); break; }
      if (md < 110) setState('reach');
      break;
    }
    case 'eat': {
      runEat(dt);
      break;
    }
    case 'full': {
      Object.assign(target, {
        eyeOpen: 0.28, earBack: 0.15, bodyLean: -0.16,
        armRaise: 0, armIn: 0, jaw: 0, lookGain: 0.15,
        tailAmp: 0.07, tailSpeed: 0.8, belly: fullness,
      });
      fullness = Math.max(0, fullness - dt * 0.02);
      if (fullness < 0.45 && stateT > 2) setState('idle');
      break;
    }
    case 'poke': {
      const p = Math.min(stateT / 0.5, 1);
      Object.assign(target, {
        eyeOpen: 0.05, earBack: 1, squash: stateT < 0.18 ? 0.5 : 0,
        jaw: stateT < 0.25 ? 0.6 : 0, bodyLean: -0.3,
        rootRotZ: Math.sin(stateT * 30) * 0.12 * (1 - p),
        armRaise: 0.2, lookGain: 0, tailAmp: 0.05, belly: fullness,
      });
      if (stateT > 0.9) setState('huff');
      break;
    }
    case 'huff': {
      // Chic annoyance: turns away.
      Object.assign(target, {
        eyeOpen: 0.32, earBack: 0.4, neckY: 0.5, bodyLean: -0.05,
        rootRotY: 0.35, lookGain: 0, tailAmp: 0.1, tailSpeed: 1,
        belly: fullness,
      });
      if (stateT > 1.4) { target.rootRotY = 0; target.neckY = 0; setState('idle'); }
      break;
    }
    case 'demo': {
      if (data.tour) {
        const seq = ['reach', 'beg', 'eatgrab', 'poke', 'pet', 'full'];
        data.pose = seq[Math.floor(stateClock / 2.6) % seq.length];
      }
      const p = data.pose;
      const base = { lookGain: 0, belly: fullness, tailAmp: 0.15, tailSpeed: 2 };
      if (p === 'reach') Object.assign(target, base, { eyeOpen: 1, earPerk: 1, bodyLean: 0.32, armRaise: 1, jaw: 0.5 });
      else if (p === 'beg') Object.assign(target, base, { eyeOpen: 1.15, bodyLean: 0.42, armRaise: 1.25, jaw: 0.4, earPerk: 1 });
      else if (p === 'eatgrab') Object.assign(target, base, { eyeOpen: 0.7, armRaise: 0.9, armIn: 1, jaw: 0.6, bodyLean: 0.18 });
      else if (p === 'poke') Object.assign(target, base, { eyeOpen: 0.05, earBack: 1, jaw: 0.5, bodyLean: -0.3, armRaise: 0.2 });
      else if (p === 'pet') Object.assign(target, base, { eyeOpen: 0.12, earPerk: 0.3, bodyLean: 0.1, tailSpeed: 4.5, tailAmp: 0.3 });
      else if (p === 'full') Object.assign(target, base, { eyeOpen: 0.28, earBack: 0.15, bodyLean: -0.16, belly: 1 });
      break;
    }
    case 'pet': {
      data.warm = (data.warm || 0) + dt;
      const melt = Math.min(data.warm / 0.6, 1);
      Object.assign(target, {
        eyeOpen: lerp(1, 0.12, melt), earBack: 0, earPerk: 0.3,
        bodyLean: 0.1 * melt, rootRotZ: Math.sin(stateT * 3) * 0.05 * melt,
        armRaise: 0, jaw: 0, lookGain: 0.3,
        tailAmp: 0.3, tailSpeed: 4.5, belly: fullness,
      });
      if (melt > 0.9 && !data.purr) { spawnHearts(); data.purr = true; }
      if (stateT > 1.6) setState('idle');
      break;
    }
  }
}

function runEat(dt) {
  const d = data;
  Object.assign(target, { eyeOpen: 0.7, earPerk: 0.4, lookGain: 0.2 });
  if (d.phase === 'grab') {
    target.armRaise = 0.92; target.armIn = 1; target.jaw = 0.6;
    target.bodyLean = 0.18;
    if (stateT > 0.35) { d.phase = 'chew'; stateT = 0; }
  } else if (d.phase === 'chew') {
    target.armRaise = 0.82; target.armIn = 1;
    target.jaw = Math.abs(Math.sin(stateT * 16)) * 0.55;
    target.squash = Math.sin(stateT * 16) * 0.08;
    target.neckX = Math.sin(stateT * 16) * 0.08;
    if (!d.munch) { say('냠...', 1.2); d.munch = true; }
    if (stateT > 1.1) { d.phase = 'gulp'; stateT = 0; }
  } else if (d.phase === 'gulp') {
    target.armRaise = 0.2; target.armIn = 0.2; target.jaw = 0.1;
    target.neckX = Math.sin(Math.min(stateT * 8, Math.PI)) * 0.25;
    const big = d.size > 60 * 1024 * 1024; // >60MB = a big meal
    if (stateT > 0.5) {
      fullness = Math.min(1, fullness + (big ? 0.55 : 0.18));
      if (big) say('우웁... 배불러', 1.8);
      if (fullness > 0.6) setState('full');
      else setState('curious');
    }
  }
}

// ---------------------------------------------------------------------------
// Apply pose to the actual joints + procedural motion
// ---------------------------------------------------------------------------
function applyPose(t, dt, hs, bs, curDist) {
  // Breathing.
  const breath = Math.sin(t * 1.6) * 0.025 * (1 - cur.belly * 0.4);
  rat.bodyGroup.scale.set(
    1 + cur.squash * 0.4 - breath * 0.5,
    1 - cur.squash * 0.5 + breath,
    1 + cur.squash * 0.4 - breath * 0.5
  );

  // Belly fullness — a noticeable pot belly, never bigger than the body itself.
  const bScale = 1 + cur.belly * 0.42;
  rat.belly.scale.set(0.95 * bScale, 1.05 * bScale, 0.8 * (1 + cur.belly * 0.45));
  rat.belly.position.set(0, 0.95 - cur.belly * 0.12, 0.28 + cur.belly * 0.14);

  // Root posture + idle sway.
  const sway = Math.sin(t * 0.9) * 0.02;
  rat.root.rotation.x = cur.rootRotX;
  rat.root.rotation.y = cur.rootRotY + sway;
  rat.root.rotation.z = cur.rootRotZ + Math.sin(t * 0.7) * 0.01;
  rat.root.position.y = cur.rootY;
  // Keep the lean gentle so the rat's silhouette stays readable (no folding flat).
  rat.bodyGroup.rotation.x = cur.bodyLean * 0.5;

  // ---- Look at cursor ----
  let wantY = cur.neckY, wantX = cur.neckX;
  if (cur.lookGain > 0.01 && cursor.x > -900) {
    const dx = cursor.x - hs.x;
    const dy = cursor.y - hs.y;
    wantY += THREE.MathUtils.clamp(dx / 320, -0.8, 0.8) * cur.lookGain;
    wantX += THREE.MathUtils.clamp(dy / 360, -0.45, 0.6) * cur.lookGain;
  } else {
    // Idle glancing.
    idleLook = lerp(idleLook, idleLookTarget, 0.02);
    wantY += idleLook;
  }
  rat.neck.rotation.y = lerp(rat.neck.rotation.y, wantY, 0.18);
  rat.neck.rotation.x = lerp(rat.neck.rotation.x, wantX, 0.18) + Math.sin(t * 1.6) * 0.01;
  rat.neck.rotation.z = cur.neckZ;

  // Jaw.
  rat.jaw.rotation.x = cur.jaw * 0.7;

  // ---- Eyes: blink + openness ----
  blink = lerp(blink, 1, 0.25);
  nextBlink -= dt;
  if (nextBlink <= 0) { blink = 0; nextBlink = 2.5 + Math.random() * 3.5; }
  const open = THREE.MathUtils.clamp(cur.eyeOpen, 0, 1.2) * blink;
  for (const e of [rat.eyeL, rat.eyeR]) {
    e.lid.rotation.x = lerp(0.85, -0.55, Math.min(open, 1));
    e.group.scale.y = lerp(0.1, 1, Math.min(open, 1)) * (open > 1 ? 1.08 : 1);
  }

  // ---- Ears: perk / fold back / twitch ----
  earTwitch = lerp(earTwitch, 0, 0.2);
  nextFidget -= dt;
  if (nextFidget <= 0) {
    earTwitch = (Math.random() - 0.5) * 0.5;
    idleLookTarget = (Math.random() - 0.5) * 0.5 - 0.1;
    nextFidget = 3 + Math.random() * 5;
  }
  const earX = cur.earBack * 1.1 - cur.earPerk * 0.4;
  const earSpread = cur.earPerk * 0.25 - cur.earBack * 0.3;
  rat.earL.rotation.set(base.earL.x + earX + earTwitch, base.earL.y - earSpread, base.earL.z - cur.earBack * 0.2);
  rat.earR.rotation.set(base.earR.x + earX - earTwitch, base.earR.y + earSpread, base.earR.z + cur.earBack * 0.2);

  // ---- Arms ----
  const raise = cur.armRaise, gin = cur.armIn;
  const shX = base.shoulderL.x - raise * 1.5 - gin * 0.5;
  const shZin = gin * 0.5;
  rat.armL.shoulder.rotation.set(shX, 0, base.shoulderL.z + shZin + cur.armSpread);
  rat.armR.shoulder.rotation.set(shX, 0, base.shoulderR.z - shZin - cur.armSpread);
  const elX = base.elbowL.x + raise * 0.3 - gin * 1.2;
  rat.armL.elbow.rotation.x = elX;
  rat.armR.elbow.rotation.x = elX;
  // Begging wobble in the paws.
  if (state === 'beg') {
    const w = Math.sin(t * 16) * 0.2;
    rat.armL.elbow.rotation.x += w;
    rat.armR.elbow.rotation.x -= w;
  }

  // ---- Tail wag ----
  rat.tailSegs.forEach((seg, i) => {
    const phase = t * cur.tailSpeed - i * 0.5;
    seg.rotation.y = Math.sin(phase) * cur.tailAmp;
    seg.rotation.x = 0.12 + Math.cos(phase * 0.5) * 0.05;
  });
}

// ---------------------------------------------------------------------------
// Heart particles (pet reward)
// ---------------------------------------------------------------------------
function spawnHearts() {
  for (let i = 0; i < 5; i++) {
    const h = document.createElement('div');
    h.textContent = '❤';
    h.style.cssText =
      'position:fixed;color:#ff7a9c;font-size:20px;pointer-events:none;' +
      'left:' + (innerWidth / 2 - 20 + Math.random() * 40) + 'px;top:' + (innerHeight * 0.4) + 'px;' +
      'transition:transform 1.1s ease-out,opacity 1.1s ease-out;opacity:1;';
    document.body.appendChild(h);
    requestAnimationFrame(() => {
      h.style.transform = 'translate(' + (Math.random() * 60 - 30) + 'px,-90px) scale(1.4)';
      h.style.opacity = '0';
    });
    setTimeout(() => h.remove(), 1200);
  }
}

frame();
