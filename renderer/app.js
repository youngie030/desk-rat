import * as THREE from './vendor/three.module.js';
import { buildRat } from './rat.js';
import { createLife } from './life.js';
import { createPersonality } from './personality.js';

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
  rootRotX: -0.04, rootRotY: 0, rootRotZ: 0, rootY: 0, bodyYaw: 0,
  bodyLean: 0, squash: 0, legSwing: 0, armSwingGait: 0, groom: 0,
  neckX: 0, neckY: 0, neckZ: 0,
  jaw: 0,
  eyeOpen: 0.52, // chic = half-lidded
  earBack: 0, earPerk: 0,
  armRaise: 0, armIn: 0, armSpread: 0, armSwingL: 0, armSwingR: 0,
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

// Autonomous "life" brain (wandering, lying, napping, grooming, zoomies).
const life = createLife();
let curPosture = 'sit';   // posture hint currently driving the body
let curActivity = 'lounge';
let walkAmt = 0;          // 0..1 eased "how much walking" (drives leg/arm gait)
let gaitPhase = 0;        // 0..1 gait phase from the life brain

// The rat's "soul": personality, mood, bond, and a little inner-life director.
const soul = createPersonality();
try { soul.load(JSON.parse(localStorage.getItem('deskrat.soul'))); } catch {}
let soulClock = 0;        // host-provided monotonic ms for the soul
let dir = {               // latest soul directives (mood, expr biases, etc.)
  mood: 'content', valence: 0, arousal: 0.3,
  expr: { eyeOpen: 0, earPerk: 0, earBack: 0, tailAmp: 0, tailSpeed: 0, browTilt: 0 },
  prefer: null, say: null, emote: null, special: null,
};

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
// Tamagotchi stats (persisted) — hunger, affection, energy, weight
// ---------------------------------------------------------------------------
const STAT_DEFAULT = { hunger: 35, affection: 55, energy: 85, weight: 0, fed: 0 };
let stats = loadStats();
function loadStats() {
  try {
    const s = JSON.parse(localStorage.getItem('deskrat.stats'));
    if (s && typeof s.hunger === 'number') return Object.assign({ ...STAT_DEFAULT }, s);
  } catch {}
  return { ...STAT_DEFAULT };
}
let saveTimer = 0;
function saveStats() {
  try {
    localStorage.setItem('deskrat.stats', JSON.stringify(stats));
    localStorage.setItem('deskrat.soul', JSON.stringify(soul.serialize()));
  } catch {}
}
const clamp01100 = (v) => Math.max(0, Math.min(100, v));

// Natural drift of stats over time.
function tickStats(dt) {
  // Stats evolve over TENS OF MINUTES (constants designed by the soul system).
  stats.hunger = clamp01100(stats.hunger + dt * 0.040);        // 0->100 in ~42 min
  let eRate = 0.030;                                            // idle drain ~55 min
  if (state === 'dance') eRate = 0.20;
  else if (curPosture === 'sleep') eRate = -0.55;             // nap refills in ~3 min
  else if (curPosture === 'walk') eRate = curActivity === 'zoomies' ? 0.12 : 0.040;
  stats.energy = clamp01100(stats.energy - dt * eRate);
  stats.affection = clamp01100(stats.affection + (55 - stats.affection) * dt * 0.0015); // gentle drift
  stats.weight = clamp01100(stats.weight - dt * 0.010);        // very slowly slims
  // Belly baseline follows weight when not actively full from a meal.
  fullness = Math.max(fullness, stats.weight / 100);
  saveTimer += dt;
  if (saveTimer > 3) { saveTimer = 0; saveStats(); }
}

// Overall mood 0..1 from the stats (high = happy & lively).
function mood() {
  const hungerPenalty = stats.hunger > 60 ? (stats.hunger - 60) / 40 : 0;
  const energyOk = stats.energy / 100;
  return clamp01100((stats.affection - hungerPenalty * 45) * energyOk) / 100;
}

// ---- Stat panel (shown while the cursor is over the rat) ----
const panel = document.createElement('div');
panel.id = 'stats';
panel.style.cssText =
  'position:fixed;left:50%;bottom:8px;transform:translateX(-50%);' +
  'display:flex;gap:8px;padding:6px 10px;border-radius:12px;' +
  'background:rgba(28,24,20,0.82);font:600 10px/1 "Segoe UI",sans-serif;color:#f0e6d8;' +
  'opacity:0;transition:opacity .2s;pointer-events:none;white-space:nowrap;z-index:50;';
function bar(label, color) {
  const w = document.createElement('div');
  w.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:3px;';
  const t = document.createElement('div'); t.textContent = label;
  const track = document.createElement('div');
  track.style.cssText = 'width:46px;height:6px;border-radius:3px;background:rgba(255,255,255,0.16);overflow:hidden;';
  const fill = document.createElement('div');
  fill.style.cssText = `height:100%;width:50%;background:${color};border-radius:3px;transition:width .25s;`;
  track.appendChild(fill); w.appendChild(t); w.appendChild(track);
  return { w, fill };
}
const barHunger = bar('배고픔', '#e8a23c');
const barLove = bar('애정', '#e85c7a');
const barEnergy = bar('기력', '#5cc8e8');
panel.append(barHunger.w, barLove.w, barEnergy.w);
document.body.appendChild(panel);
function updatePanel(show) {
  panel.style.opacity = show ? '1' : '0';
  if (!show) return;
  barHunger.fill.style.width = (100 - stats.hunger) + '%'; // shown as "fullness"
  barLove.fill.style.width = stats.affection + '%';
  barEnergy.fill.style.width = stats.energy + '%';
}

// ---------------------------------------------------------------------------
// Cursor (global, via main process) + drag tracking (DOM)
// ---------------------------------------------------------------------------
const cursor = { x: -999, y: -999, inside: false, w: 480, h: 520 };
window.deskrat.onCursor((d) => { Object.assign(cursor, d); });

let dragActive = false;
let lastDragT = 0;
const dragPt = { x: 0, y: 0 };

let lastDragEvent = -10;
function onDragOver(e) {
  e.preventDefault();
  dragActive = true;
  lastDragT = stateClock;
  dragPt.x = e.clientX;
  dragPt.y = e.clientY;
  if (stateClock - lastDragEvent > 1.2) { lastDragEvent = stateClock; soul.event('drag'); }
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

// Tray commands.
window.deskrat.onCmd?.((c) => {
  if (c === 'dance') {
    if (stats.energy > 20) { soul.event('dance'); say('♪', 1.0); setState('dance'); }
    else say('지금은... 좀 피곤해.', 1.4);
  }
});

// Dev-only auto-feed (DESKRAT_TEST=1).
window.deskrat.onDevEat?.((p) => { startEat([p]); });
// Dev-only pose tour (DESKRAT_DEMO=1).
window.deskrat.onDevPose?.((p) => { setState('demo'); if (p === 'TOUR') { data.tour = true; console.log('[deskrat] TOURSTART'); } else data.pose = p; });

// Clicks: left = poke (single), double-left = dance, right = pet.
let pokeTimer = null;
window.addEventListener('mousedown', (e) => {
  if (!overRat(e.clientX, e.clientY)) return;
  if (e.button === 0) {
    // Defer the poke so a double-click can cancel it into a dance.
    if (pokeTimer) clearTimeout(pokeTimer);
    pokeTimer = setTimeout(() => { pokeTimer = null; poke(); }, 240);
  } else if (e.button === 2) {
    pet();
  }
});
window.addEventListener('contextmenu', (e) => e.preventDefault());

// Double-click: ask the rat to dance (if it has the energy).
window.addEventListener('dblclick', (e) => {
  if (!overRat(e.clientX, e.clientY)) return;
  if (pokeTimer) { clearTimeout(pokeTimer); pokeTimer = null; }
  if (stats.energy > 25) { soul.event('dance'); say('♪', 1.0); setState('dance'); }
  else { setState('idle'); say('지금은... 좀 피곤해.', 1.4); }
});

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
  stats.affection = clamp01100(stats.affection - 7);
  stats.energy = clamp01100(stats.energy - 2);
  soul.event('poke');
  setState('poke');
  const lines = ['야!', '하지 마.', '아 진짜 그만!', '한 번만 더 해봐.'];
  say(lines[Math.min(annoy - 1, 3)], 1.2);
}
function pet() {
  stats.affection = clamp01100(stats.affection + 6);
  annoy = Math.max(0, annoy - 1);
  soul.event('pet');
  setState('pet');
  data.warm = 0;
  const lines = stats.affection > 80
    ? ['...좋아.', '그래, 거기.', '흥, 봐줄게.']
    : ['...뭐, 나쁘진 않네', '계속해도 돼.', '흠...'];
  say(lines[(Math.random() * lines.length) | 0], 1.6);
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

  tickStats(dt);

  // Geometry-derived cursor relationships.
  const hs = headScreen();
  const bs = bodyScreen();
  const curDist = cursor.inside || cursor.x > -900
    ? dist(cursor.x, cursor.y, bs.x, bs.y - 10)
    : 9999;

  updateState(dt, hs, bs, curDist);

  // ---- soul: mood, personality, inner-life director ----
  soulClock += dt * 1000;
  dir = soul.update(dt, {
    stats,
    cursorNear: curDist < 300,
    dragActive,
    busy: state !== 'idle',
    activity: curActivity,
    clockMs: soulClock,
  }) || dir;
  if (dir.say && bubbleTimer <= 0) say(dir.say, 1.8); // don't stomp interaction lines
  if (dir.emote) {
    const map = { spark: ['note', '✨'], heart: ['note', '❤'], note: ['note', '♪'],
      sweat: ['z', '💦'], anger: ['z', '💢'], zzz: ['z', '💤'], dots: ['z', '…'] };
    const e = map[dir.emote];
    if (e) spawnFloat(e[0], e[1]);
  }
  if (dir.special && state === 'idle') {
    if (dir.special === 'sulk_turn') setState('huff');
    else if (dir.special === 'happy_wiggle' && stats.energy > 30) setState('dance');
  }

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

  // Show the stat panel while the cursor is over the rat.
  updatePanel(cursor.inside);

  // Report silhouette to main for cursor hit-testing.
  window.deskrat.reportRegion({ cx: bs.x, cy: bs.y - 20, r: 150 });

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

function updateState(dt, hs, bs, curDist) {
  // Look gain: rat watches the cursor when it's reasonably near.
  const near = curDist < 300;

  // Transient channels default to 0 each frame; states that want them override.
  target.armSpread = 0; target.armSwingL = 0; target.armSwingR = 0;
  target.rootRotZ = 0; target.rootY = 0; target.groom = 0; target.bodyYaw = 0;
  if (state !== 'idle') curPosture = 'sit'; // interactions drain energy normally

  switch (state) {
    case 'idle': {
      if (annoy > 0) annoy = Math.max(0, annoy - dt * 0.3);
      if (near || dragActive) { setState('curious'); break; }
      runLife(dt); // autonomous wandering / lying / napping / grooming
      break;
    }
    case 'dance': {
      const m = mood();
      const beat = stateT * 7.5;
      const swing = Math.sin(beat);
      Object.assign(target, {
        eyeOpen: 0.9, earPerk: 1, earBack: 0, jaw: 0.18 + Math.abs(swing) * 0.18,
        bodyLean: 0.05, lookGain: 0,
        armSpread: 0.9, armRaise: 0.55,
        armSwingL: swing * 0.8, armSwingR: -swing * 0.8,
        rootRotZ: swing * 0.14, rootY: Math.abs(Math.sin(beat * 2)) * 0.12,
        tailAmp: 0.35, tailSpeed: 6, belly: fullness,
      });
      if (!data.note) { say('♪', 1.0); data.note = true; }
      data.noteT = (data.noteT || 0) + dt;
      if (data.noteT > 0.5) { data.noteT = 0; spawnFloat('note', ['♪', '♫'][(Math.random() * 2) | 0]); }
      if (near && stateT > 0.6) { setState('curious'); break; } // stop to greet cursor
      if (stateT > 5 || stats.energy < 20) { setState('idle'); }
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
        if (data.tourStart == null) data.tourStart = stateClock;
        const seq = ['reach', 'beg', 'eatgrab', 'poke', 'pet', 'full', 'walk', 'lie', 'sleep', 'groom'];
        data.pose = seq[Math.floor((stateClock - data.tourStart) / 2.6) % seq.length];
        if (data.lastLogged !== data.pose) { data.lastLogged = data.pose; console.log('POSE:' + data.pose); }
      }
      const p = data.pose;
      if (p === 'walk' || p === 'lie' || p === 'sleep' || p === 'groom') {
        // Reuse the autonomous posture poses for deterministic screenshotting.
        curPosture = p;
        walkAmt = p === 'walk' ? 1 : 0;
        if (p === 'walk') { gaitPhase = (stateClock * 1.6) % 1; target.bodyYaw = -1.15; }
        const m = 0.6;
        const PP = target; PP.lookGain = 0; PP.belly = fullness;
        if (p === 'walk') Object.assign(PP, { eyeOpen: 0.7, earPerk: 0.5, bodyLean: 0.16, armRaise: 0, armIn: 0, jaw: 0, tailAmp: 0.16, tailSpeed: 2.4 });
        else if (p === 'lie') Object.assign(PP, { eyeOpen: 0.32, earBack: 0.1, bodyLean: 0.05, rootY: -0.52, tailAmp: 0.05, tailSpeed: 0.7 });
        else if (p === 'sleep') Object.assign(PP, { eyeOpen: 0, earBack: 0.25, bodyLean: 0.08, rootY: -0.56, neckX: 0.24, tailAmp: 0.03 });
        else if (p === 'groom') Object.assign(PP, { eyeOpen: 0.45, earPerk: 0.2, bodyLean: 0.08, armRaise: 0.5, armIn: 1.05, jaw: 0.08, groom: 1 });
        break;
      }
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
    const mb = d.size / (1024 * 1024);
    const big = mb > 60; // >60MB = a big meal
    if (stateT > 0.5) {
      const portion = Math.min(0.6, 0.12 + mb / 120);
      fullness = Math.min(1, fullness + portion);
      stats.hunger = clamp01100(stats.hunger - (25 + mb * 0.4));
      stats.weight = clamp01100(stats.weight + portion * 40);
      stats.affection = clamp01100(stats.affection + 3);
      stats.fed = (stats.fed || 0) + 1;
      soul.event('feed', mb);
      saveStats();
      if (big) say('우웁... 배불러', 1.8);
      else say(['잘 먹었어.', '냠.', '괜찮은 맛이네.'][(Math.random() * 3) | 0], 1.2);
      if (fullness > 0.6) setState('full');
      else setState('curious');
    }
  }
}

// ---------------------------------------------------------------------------
// Autonomous life: ask the brain what to do, then drive window + posture.
// ---------------------------------------------------------------------------
function runLife(dt) {
  const m = mood();
  const ctx = {
    stats,
    cursorNear: false, // idle already handed off to 'curious' when near
    dragActive,
    busy: false,
    win: { x: cursor.wx || 0, y: cursor.wy || 0, w: cursor.w || 480, h: cursor.h || 520 },
    screen: { x: cursor.sx || 0, y: cursor.sy || 0, w: cursor.sw || 1920, h: cursor.sh || 1080 },
  };
  const act = life.update(dt, ctx);
  curActivity = act.name;
  const wasSleeping = curPosture === 'sleep';
  curPosture = act.posture;
  if (wasSleeping && curPosture !== 'sleep') soul.event('wake');

  // ---- window movement (the rat walking across the desktop) ----
  if (act.moveWindowTo && act.speedPx > 0) {
    const wx = ctx.win.x, wy = ctx.win.y;
    const dx = act.moveWindowTo.x - wx, dy = act.moveWindowTo.y - wy;
    const d = Math.hypot(dx, dy) || 1;
    const step = act.speedPx * dt;
    let nx, ny;
    if (d <= step) { nx = act.moveWindowTo.x; ny = act.moveWindowTo.y; }
    else { nx = wx + (dx / d) * step; ny = wy + (dy / d) * step; }
    window.deskrat.moveWindow(nx, ny);
  }

  // ---- facing + gait blend ----
  const walking = act.posture === 'walk';
  walkAmt = lerp(walkAmt, walking ? 1 : 0, 1 - Math.pow(0.004, dt));
  if (walking) gaitPhase = act.stepPhase;
  // Turn toward a 3/4 walking profile while moving; face the viewer otherwise.
  target.bodyYaw = walking ? act.facing * 1.15 : 0;

  // ---- one-shot lines + floating emotes ----
  if (act.say) say(act.say, 1.6);
  if (act.emote) {
    const map = { sleep: ['z', '💤'], note: ['note', '♪'], sparkle: ['note', '✨'], dust: ['z', '💨'] };
    const e = map[act.emote];
    if (e) spawnFloat(e[0], e[1]);
  }

  // ---- posture -> pose targets ----
  const P = target;
  P.lookGain = 0.12; P.belly = fullness;
  switch (act.posture) {
    case 'walk':
      Object.assign(P, { eyeOpen: 0.7, earPerk: 0.5, earBack: 0, bodyLean: 0.16,
        armRaise: 0, armIn: 0, jaw: 0, tailAmp: 0.16, tailSpeed: 2.4, lookGain: 0 });
      break;
    case 'lie':
      Object.assign(P, { eyeOpen: 0.32, earPerk: 0, earBack: 0.1, bodyLean: 0.05,
        armRaise: 0, armIn: 0, jaw: 0, rootY: -0.52, tailAmp: 0.05, tailSpeed: 0.7 });
      break;
    case 'sleep':
      Object.assign(P, { eyeOpen: 0, earPerk: 0, earBack: 0.25, bodyLean: 0.08,
        armRaise: 0, armIn: 0, jaw: 0, rootY: -0.56, neckX: 0.24,
        tailAmp: 0.03, tailSpeed: 0.4, lookGain: 0 });
      break;
    case 'groom':
      Object.assign(P, { eyeOpen: 0.45, earPerk: 0.2, earBack: 0, bodyLean: 0.08,
        armRaise: 0.5, armIn: 1.05, jaw: 0.08, groom: 1, tailAmp: 0.1, tailSpeed: 1.5 });
      break;
    default: // 'sit' / 'stand'
      Object.assign(P, { eyeOpen: lerp(0.5, 0.66, m), earPerk: m > 0.7 ? 0.25 : 0, earBack: 0,
        armRaise: 0, armIn: 0, jaw: 0, bodyLean: 0,
        tailAmp: lerp(0.08, 0.18, m), tailSpeed: lerp(0.9, 1.8, m) });
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

  // Belly: a subtle lighter underside at rest; bulges into a pot belly when full.
  const bScale = 1 + cur.belly * 0.6;
  rat.belly.scale.set(0.82 * bScale, 0.95 * bScale, 0.5 * (1 + cur.belly * 0.7));
  rat.belly.position.set(0, 0.84 - cur.belly * 0.06, 0.18 + cur.belly * 0.16);

  // Root posture + idle sway.
  const sway = Math.sin(t * 0.9) * 0.02;
  rat.root.rotation.x = cur.rootRotX;
  rat.root.rotation.y = cur.rootRotY + cur.bodyYaw + sway;
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
  const ex = dir.expr || {};
  const open = THREE.MathUtils.clamp(cur.eyeOpen + (ex.eyeOpen || 0), 0, 1.2) * blink;
  const brow = ex.browTilt || 0; // mood slant: <0 furrowed/grumpy, >0 raised/curious
  [rat.eyeL, rat.eyeR].forEach((e, i) => {
    const side = i === 0 ? -1 : 1;
    e.lid.rotation.x = lerp(0.5, -0.85, Math.min(open, 1));
    // Slant the upper lid so the inner corner drops (angry) or lifts (surprised).
    e.lid.rotation.z = side * brow * 0.6;
    e.group.scale.y = lerp(0.18, 1, Math.min(open, 1)) * (open > 1 ? 1.1 : 1);
  });

  // ---- Ears: perk / fold back / twitch ----
  earTwitch = lerp(earTwitch, 0, 0.2);
  nextFidget -= dt;
  if (nextFidget <= 0) {
    earTwitch = (Math.random() - 0.5) * 0.5;
    idleLookTarget = (Math.random() - 0.5) * 0.5 - 0.1;
    nextFidget = 3 + Math.random() * 5;
  }
  const earBackB = cur.earBack + (ex.earBack || 0);
  const earPerkB = cur.earPerk + (ex.earPerk || 0);
  const earX = earBackB * 1.1 - earPerkB * 0.4;
  const earSpread = earPerkB * 0.25 - earBackB * 0.3;
  rat.earL.rotation.set(base.earL.x + earX + earTwitch, base.earL.y - earSpread, base.earL.z - cur.earBack * 0.2);
  rat.earR.rotation.set(base.earR.x + earX - earTwitch, base.earR.y + earSpread, base.earR.z + cur.earBack * 0.2);

  // ---- Arms (raise = swing forward/up, in = bend up toward mouth) ----
  const raise = cur.armRaise, gin = cur.armIn;
  const shX = base.shoulderL.x - raise * 1.4 - gin * 0.4;
  const shZin = gin * 0.4;
  rat.armL.shoulder.rotation.set(shX + cur.armSwingL, 0, base.shoulderL.z + shZin - cur.armSpread);
  rat.armR.shoulder.rotation.set(shX + cur.armSwingR, 0, base.shoulderR.z - shZin + cur.armSpread);
  // Negative elbow = forearm folds forward/up. Reach straightens; grab folds to mouth.
  const elX = base.elbowL.x + raise * 0.45 - gin * 0.9;
  rat.armL.elbow.rotation.x = elX;
  rat.armR.elbow.rotation.x = elX;
  // Begging wobble in the paws.
  if (state === 'beg') {
    const w = Math.sin(t * 16) * 0.2;
    rat.armL.elbow.rotation.x += w;
    rat.armR.elbow.rotation.x -= w;
  }

  // Walking gait: legs swing fore/aft, arms counter-swing.
  if (walkAmt > 0.01) {
    const gp = gaitPhase * Math.PI * 2;
    const la = 0.5 * walkAmt;
    rat.legL.rotation.x = Math.sin(gp) * la;
    rat.legR.rotation.x = Math.sin(gp + Math.PI) * la;
    rat.armL.shoulder.rotation.x += Math.sin(gp + Math.PI) * 0.45 * walkAmt;
    rat.armR.shoulder.rotation.x += Math.sin(gp) * 0.45 * walkAmt;
  } else if (curPosture === 'lie' || curPosture === 'sleep') {
    // Splayed-out limbs so the low posture reads as lying down, not crouching.
    rat.legL.rotation.set(-0.55, 0, 0.6);
    rat.legR.rotation.set(-0.55, 0, -0.6);
  } else {
    rat.legL.rotation.x *= 0.8;
    rat.legR.rotation.x *= 0.8;
    rat.legL.rotation.z *= 0.8;
    rat.legR.rotation.z *= 0.8;
  }

  // Grooming: quick paw-to-face scrubbing + little head bob.
  if (cur.groom > 0.01) {
    const gr = Math.sin(t * 15) * cur.groom;
    rat.armL.elbow.rotation.x += gr * 0.3;
    rat.armR.elbow.rotation.x -= gr * 0.3;
    rat.neck.rotation.x += Math.sin(t * 7.5) * cur.groom * 0.06;
  }

  // ---- Tail wag ----
  const tAmp = cur.tailAmp + (ex.tailAmp || 0);
  const tSpd = cur.tailSpeed + (ex.tailSpeed || 0);
  rat.tailSegs.forEach((seg, i) => {
    const phase = t * tSpd - i * 0.5;
    seg.rotation.y = Math.sin(phase) * tAmp;
    seg.rotation.x = 0.12 + Math.cos(phase * 0.5) * 0.05;
  });
}

// ---------------------------------------------------------------------------
// Heart particles (pet reward)
// ---------------------------------------------------------------------------
// Floating emoji (💤 while sleeping, ♪ while dancing).
function spawnFloat(kind, glyph) {
  const el = document.createElement('div');
  el.textContent = glyph;
  const x = innerWidth / 2 + (kind === 'note' ? (Math.random() * 80 - 40) : 30);
  const y = innerHeight * (kind === 'note' ? 0.42 : 0.3);
  el.style.cssText =
    'position:fixed;font-size:' + (kind === 'note' ? 20 : 22) + 'px;pointer-events:none;z-index:60;' +
    'color:' + (kind === 'note' ? '#ffd66e' : '#bcd3ff') + ';left:' + x + 'px;top:' + y + 'px;' +
    'transition:transform 1.4s ease-out,opacity 1.4s ease-out;opacity:0.95;';
  document.body.appendChild(el);
  requestAnimationFrame(() => {
    el.style.transform = 'translate(' + (Math.random() * 40 - 20) + 'px,-70px) rotate(' + (Math.random() * 30 - 15) + 'deg)';
    el.style.opacity = '0';
  });
  setTimeout(() => el.remove(), 1400);
}

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
