// personality.js — "Desk Rat"의 속마음 / the rat's inner life (PURE LOGIC).
//
// 이 모듈은 쥐에게 "성격(traits) · 기분(mood) · 유대(bond) · 최근 기억(memory)"을 부여하고,
// 가끔 스스로 작은 사건(special moment)을 일으키는 "감독(director)"을 담는다.
// life.js가 "무엇을 하는가(activity)"를 정한다면, 이 모듈은 "어떤 마음으로 하는가"를 정한다.
//
// This module gives the rat stable personality TRAITS, a smoothly-varying MOOD,
// a persistent BOND with the user, a short MEMORY of recent treatment, and a
// "director" that occasionally schedules little life-moments so it feels alive.
// life.js decides WHAT the rat does; this layer colors HOW it feels doing it.
//
// 순수 결정 로직 / pure logic: NO imports / NO THREE.js / NO DOM / NO Node APIs.
// 시간은 ctx.clockMs(호스트가 주는 단조 증가 ms)만 사용한다 — Date.now() 금지.
// Time comes only from ctx.clockMs (host-provided monotonic ms); never Date.now().
// 절대 throw하지 않으며, 모든 directive 필드를 항상 채워서 돌려준다.
// Never throws; every directive field is always present.

// ─────────────────────────────────────────────────────────────────────────────
// 작은 유틸 / tiny helpers
// ─────────────────────────────────────────────────────────────────────────────

/** [min,max]로 가두기 / clamp into [min,max]. */
function clamp(v, min, max) {
  if (!(v > min)) v = min;       // NaN-safe: NaN > min === false
  if (v > max) v = max;
  return v;
}

/** 유한 숫자 보정 / coerce to a finite number, else fallback. */
function num(v, fallback) {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}

/** [a,b) 실수 / random float in [a,b). */
function rand(a, b) {
  return a + Math.random() * (b - a);
}

/** 배열 무작위 원소 / random element of a (non-empty) array. */
function pick(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[(Math.random() * arr.length) | 0];
}

/** 선형 보간 / linear interpolate. */
function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * 시간상수 기반 1차 평활 / time-constant based exponential smoothing.
 * tau초의 시상수로 cur를 target에 부드럽게 접근시킨다(프레임율 독립).
 * Approach `target` from `cur` with time-constant `tau` seconds (framerate independent).
 */
function approach(cur, target, dt, tau) {
  if (tau <= 0) return target;
  const k = 1 - Math.exp(-dt / tau);
  return cur + (target - cur) * k;
}

// ─────────────────────────────────────────────────────────────────────────────
// 성격 특성 / personality TRAITS
//
// 첫 실행 때 한 번 시드되고 영구 저장된다. 각 값은 0..1.
// Seeded once at first run, persisted forever. Each in 0..1.
//   sass        — 시크/말대꾸 / how much it quips & acts aloof
//   clinginess  — 외로움 잘 탐 / how much it craves attention when ignored
//   laziness    — 게으름 / preference to lie/nap over moving
//   curiosity   — 호기심 / interest in the cursor & dragged files
//   gluttony    — 식탐 / how strongly food lifts its mood
// ─────────────────────────────────────────────────────────────────────────────

const TRAIT_KEYS = ['sass', 'clinginess', 'laziness', 'curiosity', 'gluttony'];

/** 새 성격을 무작위로 시드 / seed a fresh personality (mild variation around 0.5). */
function seedTraits() {
  const t = {};
  for (const k of TRAIT_KEYS) {
    // 0.5 중심, ±0.32 정도 변주 → 0.18..0.82 (극단 회피).
    // Centered at 0.5 with ~±0.32 spread → avoids degenerate extremes.
    t[k] = clamp(0.5 + rand(-0.32, 0.32), 0.05, 0.95);
  }
  return t;
}

/** 저장된 traits를 안전하게 정규화 / sanitize loaded traits. */
function sanitizeTraits(raw) {
  const t = seedTraits();
  if (raw && typeof raw === 'object') {
    for (const k of TRAIT_KEYS) {
      if (typeof raw[k] === 'number' && isFinite(raw[k])) {
        t[k] = clamp(raw[k], 0.05, 0.95);
      }
    }
  }
  return t;
}

// ─────────────────────────────────────────────────────────────────────────────
// 대사 풀 / Korean line pools — 시크하고 위트 있는 톤.
//
// 무드 + 유대(bond) 단계에 따라 톤이 변한다. 모두 짧게, 가끔만.
// Tone varies by mood and bond tier. Always short; emitted rarely (cooldowns).
// ─────────────────────────────────────────────────────────────────────────────

const LINES = {
  // 무드별 / by mood
  content:       ['뭐, 나쁘지 않네.', '평화롭군.', '...이대로 좋아.', '딱 적당해.'],
  grumpy:        ['건드리지 마.', '...오늘 별로야.', '흥.', '귀찮게 굴지 마.'],
  playful:       ['놀자는 거야?', '오, 재밌겠는데.', '잡아봐.', '심심하던 참인데.'],
  sleepy:        ['졸려...', '5분만 더.', '...하암.', '깨우지 마.'],
  affectionate:  ['...뭐, 곁에 있어도 돼.', '오늘은 좀 봐줄게.', '나쁘지 않은 손길이야.', '흠... 좋네.'],
  sulky:         ['흥, 저리 가.', '...삐졌어.', '말 안 걸 거야.', '됐어, 신경 꺼.'],
  smug:          ['역시 내가 최고지.', '봤지? 이게 나야.', '후훗.', '완벽해, 나란 쥐.'],
  curious:       ['...저게 뭐지.', '뭐 보냐.', '흥미로운데.', '저거 내 거야?'],
  bored:         ['...심심해.', '할 거 없나.', '하품 나온다.', '뭐라도 해봐.'],

  // 유대 단계별 인사/일상 / by bond tier (used for ambient lines)
  bondLow:       ['...누구세요.', '거리 좀 둬.', '아직 안 친해.', '흥, 두고 보자.'],
  bondMid:       ['이제 좀 익숙하네.', '뭐, 나쁜 집사는 아니야.', '오늘도 왔구나.'],
  bondHigh:      ['...너라서 봐주는 거야.', '없으면 좀 허전하더라. (작게)', '내 사람이지, 너.', '흥, 보고 싶었던 건 아니고.'],

  // 이벤트 반응 / event reactions
  petGood:       ['...계속해도 돼.', '음, 좋은데.', '거기, 좋아.', '흥, 봐주는 거야.'],
  petMeh:        ['...적당히 해.', '그래, 그래.', '됐어 이제.'],
  pokeOnce:      ['아얏!', '왜 찔러!', '...야.'],
  pokeMany:      ['그만하라고 했지.', '...진짜 화낸다.', '너 두고 봐.'],
  feedSmall:     ['간식? 받아두지.', '한 입 거리네.', '고작 이거?'],
  feedBig:       ['오, 제법인데.', '이건 좀 괜찮네.', '배부르다... 후훗.'],
  ignored:       ['...나 여기 있는데.', '바쁘셔?', '쳐다도 안 보네.', '흥, 됐어.'],
  danceTogether: ['이런 건 또 좋아.', '오, 같이 출까.', '리듬 좀 타는데?'],
};

// ─────────────────────────────────────────────────────────────────────────────
// 무드 정의 / mood definitions.
//
// 각 무드는 expr(작은 포즈 편향)과 기본 valence/arousal을 가진다.
// expr는 호스트가 기본 포즈 위에 "더하는" 작은 편향값이다(라디안/계수 가정).
// Each mood maps to small expr nudges + nominal valence/arousal.
// expr values are SMALL biases the host ADDS on top of its base pose.
// ─────────────────────────────────────────────────────────────────────────────

const MOODS = {
  //                eyeOpen earPerk earBack tailAmp tailSpeed browTilt  valence arousal
  content:      { eyeOpen: 0.00, earPerk: 0.05, earBack: 0.00, tailAmp: 0.15, tailSpeed: 0.20, browTilt: 0.00, valence:  0.45, arousal: 0.30 },
  affectionate: { eyeOpen:-0.08, earPerk: 0.20, earBack: 0.00, tailAmp: 0.40, tailSpeed: 0.55, browTilt: 0.15, valence:  0.80, arousal: 0.45 },
  playful:      { eyeOpen: 0.15, earPerk: 0.35, earBack: 0.00, tailAmp: 0.70, tailSpeed: 0.90, browTilt: 0.10, valence:  0.65, arousal: 0.85 },
  smug:         { eyeOpen:-0.05, earPerk: 0.25, earBack: 0.00, tailAmp: 0.30, tailSpeed: 0.35, browTilt:-0.10, valence:  0.55, arousal: 0.40 },
  curious:      { eyeOpen: 0.20, earPerk: 0.45, earBack: 0.00, tailAmp: 0.25, tailSpeed: 0.40, browTilt: 0.20, valence:  0.20, arousal: 0.60 },
  bored:        { eyeOpen:-0.10, earPerk:-0.10, earBack: 0.05, tailAmp: 0.10, tailSpeed: 0.15, browTilt:-0.05, valence: -0.10, arousal: 0.20 },
  sleepy:       { eyeOpen:-0.45, earPerk:-0.20, earBack: 0.10, tailAmp: 0.05, tailSpeed: 0.10, browTilt: 0.05, valence:  0.10, arousal: 0.08 },
  grumpy:       { eyeOpen: 0.05, earPerk:-0.05, earBack: 0.30, tailAmp: 0.20, tailSpeed: 0.50, browTilt:-0.30, valence: -0.50, arousal: 0.50 },
  sulky:        { eyeOpen:-0.15, earPerk:-0.15, earBack: 0.45, tailAmp: 0.08, tailSpeed: 0.20, browTilt:-0.20, valence: -0.65, arousal: 0.25 },
};

const MOOD_KEYS = Object.keys(MOODS);

/** 0 기본 expr / a zeroed expr object (the safe default). */
function zeroExpr() {
  return { eyeOpen: 0, earPerk: 0, earBack: 0, tailAmp: 0, tailSpeed: 0, browTilt: 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// 팩토리 / factory
// ─────────────────────────────────────────────────────────────────────────────

export function createPersonality() {
  // 내부 상태 / internal mutable soul-state. 호스트는 직접 만지지 않는다.
  let S;

  /** 깨끗한 초기 영혼 상태 / a fresh soul state. */
  function freshState() {
    return {
      traits: seedTraits(),     // 영구 성격 / persistent traits
      bond: 25,                 // 유대 0..100 (처음엔 서먹) / relationship, starts aloof
      moodId: 'content',        // 현재 무드 라벨 / current mood label
      valence: 0.3,             // 현재 정서가 / smoothed valence -1..1
      arousal: 0.3,             // 현재 각성도 / smoothed arousal 0..1
      // 현재 expr(부드럽게 추적) / smoothed expr (eases toward mood target).
      expr: zeroExpr(),

      // 최근 기억 / short memory window — 이벤트가 남긴 "여운".
      // 각 값은 시간에 따라 0으로 감쇠한다 / each decays toward 0 over time.
      mGood: 0,                 // 최근 받은 애정(쓰다듬/먹이/춤) / recent positive care
      mBad: 0,                  // 최근 받은 괴롭힘(찌르기) / recent pokes ("grudge")
      mFood: 0,                 // 최근 포만 여운 / recent fullness afterglow
      pokeStreak: 0,            // 짧은 시간 내 연속 찌르기 / consecutive pokes recently
      pokeStreakT: 0,           // 연속 찌르기 유효 시간 / time left for streak to count

      // 무드 랜덤 드리프트 / slow random mood drift (gives spontaneity).
      driftV: 0,                // valence 쪽 드리프트 / drift bias on valence
      driftA: 0,                // arousal 쪽 드리프트 / drift bias on arousal
      driftT: rand(8, 16),      // 다음 드리프트 갱신까지 / time to next drift retarget

      // 사용자 관심 추적 / attention tracking.
      lonelyT: 0,               // 무시당한 누적 시간(초) / seconds since last attention
      lastCareT: 0,             // 마지막 보살핌 이후(초) — 사용 안 해도 안전 / since last care

      // 쿨다운 타이머(초) / cooldown timers (seconds).
      sayCd: 4,                 // 다음 대사까지 / until next line allowed
      emoteCd: 2,               // 다음 emote까지 / until next emote allowed
      specialCd: 12,            // 다음 special까지 / until next special allowed
      // special별 개별 게이트 / per-special re-fire gates.
      gAttention: 0, gSulk: 0, gWiggle: 0, gStare: 0, gTease: 0, gZoom: 0,

      // 시계 / clock bookkeeping (호스트 clockMs 기반).
      lastClock: null,          // 직전 프레임 clockMs / previous frame clock
    };
  }

  S = freshState();

  // ── 이벤트 큐 / event queue ─────────────────────────────────────────────────
  // event()는 프레임 밖에서 들어올 수 있으니, 즉시 반영하되 일부는
  // 다음 update에서 special을 띄우도록 플래그를 남긴다.
  // event() may arrive between frames; apply immediately but stash flags so the
  // next update() can surface a matching special/emote/line.
  let pendingSpecial = null;   // 다음 프레임에 띄울 special 후보 / queued special id
  let pendingSay = null;       // 다음 프레임에 띄울 대사 후보 / queued line
  let pendingEmote = null;     // 다음 프레임에 띄울 emote / queued emote

  /**
   * 영혼 상태 복원 / restore persisted soul. 없거나 손상되면 무시(새 성격 유지).
   * Restores bond, traits, mood seed, memories. Ignores junk safely.
   */
  function load(saved) {
    try {
      if (!saved || typeof saved !== 'object') return;
      S.traits = sanitizeTraits(saved.traits);
      S.bond = clamp(num(saved.bond, S.bond), 0, 100);
      if (typeof saved.moodId === 'string' && MOODS[saved.moodId]) S.moodId = saved.moodId;
      S.valence = clamp(num(saved.valence, S.valence), -1, 1);
      S.arousal = clamp(num(saved.arousal, S.arousal), 0, 1);
      // 기억은 휘발성이지만, 최근 grudge 정도는 복원해 연속성을 준다.
      // Memories are volatile, but restore a little so reloads feel continuous.
      S.mGood = clamp(num(saved.mGood, 0), 0, 1);
      S.mBad = clamp(num(saved.mBad, 0), 0, 1);
      S.mFood = clamp(num(saved.mFood, 0), 0, 1);
    } catch (e) {
      // 손상된 저장 데이터 무시 / ignore corrupt save, keep fresh soul.
    }
  }

  /** 영구 저장용 평범한 객체 / plain object to persist. */
  function serialize() {
    try {
      return {
        v: 1,
        traits: { ...S.traits },
        bond: clamp(num(S.bond, 25), 0, 100),
        moodId: S.moodId,
        valence: clamp(num(S.valence, 0), -1, 1),
        arousal: clamp(num(S.arousal, 0), 0, 1),
        mGood: clamp(num(S.mGood, 0), 0, 1),
        mBad: clamp(num(S.mBad, 0), 0, 1),
        mFood: clamp(num(S.mFood, 0), 0, 1),
      };
    } catch (e) {
      return { v: 1, traits: seedTraits(), bond: 25, moodId: 'content' };
    }
  }

  /**
   * 상호작용 1건 기록 / record one interaction.
   * type: 'pet' | 'poke' | 'feed'(payload=MB) | 'drag' | 'dance' | 'ignore' | 'wake'
   * 즉시 유대/기억을 갱신하고, 다음 update에서 띄울 special/대사를 예약한다.
   * Updates bond/memory immediately and queues a fitting special/line for the next frame.
   */
  function event(type, payload) {
    try {
      const t = S.traits;
      switch (type) {
        case 'pet': {
          // 쓰다듬 → 좋은 기억↑, 유대↑(시크해도 결국 좋아함).
          S.mGood = clamp(S.mGood + 0.45, 0, 1);
          S.mBad = clamp(S.mBad - 0.25, 0, 1);     // 화 풀림 / soothes a grudge
          S.bond = clamp(S.bond + 0.6, 0, 100);
          S.lonelyT = 0;
          // 쓰다듬에 살짝 만족 신호 / small content beat.
          if (S.mBad < 0.3) queueEmote('heart', 0.5 + t.clinginess * 0.4);
          break;
        }
        case 'poke': {
          // 찌르기 → 나쁜 기억↑, 유대 약간↓, 연속 찌르기 누적.
          S.mBad = clamp(S.mBad + 0.5, 0, 1);
          S.mGood = clamp(S.mGood - 0.2, 0, 1);
          S.bond = clamp(S.bond - 0.8, 0, 100);
          S.lonelyT = 0;
          // 짧은 창 안의 연속 찌르기 / consecutive pokes within a short window.
          if (S.pokeStreakT > 0) S.pokeStreak += 1; else S.pokeStreak = 1;
          S.pokeStreakT = 6; // 6초 안에 또 찌르면 streak / streak window
          queueEmote('anger', 0.6 + t.sass * 0.4);
          // 반복 찌르면 삐져서 돌아앉기 / repeated pokes → sulk & turn away.
          if (S.pokeStreak >= 3 && S.gSulk <= 0) {
            queueSpecial('sulk_turn');
          }
          break;
        }
        case 'feed': {
          // 먹이 → 포만 여운, 식탐에 비례해 기분↑, 유대↑.
          const mb = clamp(num(payload, 1), 0, 5000);
          const big = mb >= 20; // 20MB+면 "큰 끼니" / "big meal" threshold
          S.mFood = clamp(S.mFood + (big ? 0.85 : 0.45), 0, 1);
          S.mGood = clamp(S.mGood + 0.2 + t.gluttony * 0.15, 0, 1);
          S.bond = clamp(S.bond + (big ? 0.9 : 0.4), 0, 100);
          S.lonelyT = 0;
          // 큰 걸 먹으면 으쓱 / smug wiggle after a big meal.
          if (big && S.gWiggle <= 0) queueSpecial('happy_wiggle');
          break;
        }
        case 'drag': {
          // 파일 흔들기 → 호기심 자극. 가끔 약올리듯 받아치기.
          S.lonelyT = 0;
          if (S.gTease <= 0 && Math.random() < 0.35 + t.curiosity * 0.4) {
            queueSpecial('tease_back');
          } else {
            queueEmote('dots', 0.5);
          }
          break;
        }
        case 'dance': {
          // 함께 춤 → 강한 긍정. 유대 크게↑.
          S.mGood = clamp(S.mGood + 0.55, 0, 1);
          S.mBad = clamp(S.mBad - 0.4, 0, 1);
          S.bond = clamp(S.bond + 1.0, 0, 100);
          S.lonelyT = 0;
          queueEmote('note', 0.9);
          queueSay(pick(LINES.danceTogether), 0.6);
          break;
        }
        case 'wake': {
          // 자다 깨움 → 살짝 짜증(졸림). 큰 영향 없음.
          S.mBad = clamp(S.mBad + 0.15, 0, 1);
          S.lonelyT = 0;
          break;
        }
        case 'ignore': {
          // 호스트가 "방금 무시했다"고 명시할 때(선택). 보통은 update가 자동 누적.
          S.lonelyT += 8;
          break;
        }
        default:
          break;
      }
    } catch (e) {
      // 이벤트는 절대 깨지지 않게 / events must never throw.
    }
  }

  // 예약 헬퍼들 / queue helpers — 확률 게이트로 가끔만 예약.
  function queueSpecial(id) { pendingSpecial = id; }
  function queueSay(line, p) { if (line && Math.random() < (p == null ? 1 : p)) pendingSay = line; }
  function queueEmote(e, p) { if (e && Math.random() < (p == null ? 1 : p)) pendingEmote = e; }

  /**
   * 무드 라벨 결정 / choose a mood label from valence/arousal + context.
   * 부드러운 정서 좌표를 사람이 읽는 라벨로 매핑한다(히스테리시스로 깜빡임 방지).
   * Maps the smoothed valence/arousal point to a readable label, with light
   * hysteresis (prefers keeping the current label) so it doesn't flicker.
   */
  function classifyMood(ctx) {
    const v = S.valence;
    const a = S.arousal;
    const energy = ctx.energy;
    const hunger = ctx.hunger;

    // 강한 상태는 우선권 / strong states win first.
    if (energy < 25) return 'sleepy';
    if (S.mBad > 0.55 && S.pokeStreak >= 3) return 'sulky';
    if (S.mBad > 0.5) return 'grumpy';
    if (S.mFood > 0.6 && v > 0.2) return 'smug';

    // 정서 좌표 기반 / by valence-arousal quadrant.
    let label;
    if (v >= 0.35) {
      label = a >= 0.6 ? 'playful' : 'affectionate';
      // 애정 무드는 유대가 어느 정도 있어야 / affectionate needs some bond.
      if (label === 'affectionate' && S.bond < 35) label = 'content';
    } else if (v <= -0.3) {
      label = a >= 0.45 ? 'grumpy' : 'sulky';
    } else {
      // 중립대 / neutral band.
      if (a >= 0.55) label = 'curious';
      else if (a <= 0.25 && hunger < 60) label = 'bored';
      else label = 'content';
    }

    // 히스테리시스: 현재 라벨이 후보와 "근접"하면 유지.
    // Hysteresis: if the current label is plausible, keep it to avoid flicker.
    if (S.moodId && MOODS[S.moodId] && S.moodId !== label) {
      const cur = MOODS[S.moodId];
      const near = Math.abs(cur.valence - v) < 0.22 && Math.abs(cur.arousal - a) < 0.22;
      // sleepy/sulky/grumpy/smug 같은 강제 무드에서 빠져나온 경우엔 유지하지 않음.
      if (near && !['sleepy', 'sulky', 'grumpy', 'smug'].includes(S.moodId)) {
        return S.moodId;
      }
    }
    return label;
  }

  /**
   * 목표 정서가/각성도 계산 / compute target valence & arousal.
   * 스탯 + 최근 기억 + 유대 + 성격 + 느린 드리프트를 합성한다.
   * Blends stats + recent memory + bond + traits + slow random drift.
   */
  function computeTarget(ctx) {
    const t = S.traits;
    const hunger = ctx.hunger;     // 0..100 (높을수록 배고픔)
    const energy = ctx.energy;     // 0..100
    const affection = ctx.affection; // 0..100 (호스트 스탯)

    // 기본 valence: 애정/포만은 +, 배고픔/저에너지는 -.
    // Baseline valence from needs.
    let v = 0;
    v += (affection - 50) / 100 * 0.5;          // 호스트 애정 스탯 / host affection
    v += (S.bond - 40) / 100 * 0.4;             // 유대 / bond
    v -= clamp((hunger - 55) / 45, 0, 1) * 0.5; // 배고프면 기분 나빠짐 / hunger drags
    v -= clamp((30 - energy) / 30, 0, 1) * 0.25; // 지치면 약간↓ / tiredness

    // 기억의 여운 / memory afterglow.
    v += S.mGood * 0.5;
    v += S.mFood * (0.25 + t.gluttony * 0.25);
    v -= S.mBad * 0.7;

    // 시크함은 긍정 표현을 살짝 깎는다(겉으로 덜 드러냄).
    // Sass slightly dampens outward positivity (chic = understated).
    if (v > 0) v *= (1 - t.sass * 0.18);

    // 느린 랜덤 드리프트 / slow spontaneous drift.
    v += S.driftV;

    // 각성도: 에너지·호기심·놀이 신호로 결정.
    // Arousal from energy, curiosity, play signals.
    let a = 0.3;
    a += (energy - 50) / 100 * 0.4;             // 기운 / energy
    a += t.curiosity * 0.15;                    // 호기심 많으면 기본 각성↑
    a -= t.laziness * 0.15;                     // 게으르면 각성↓
    a += S.mGood * 0.2 - S.mBad * 0.05;
    a += S.driftA;
    if (ctx.cursorNear) a += 0.12 + t.curiosity * 0.1; // 사람이 가까우면 흥미↑
    if (ctx.dragActive) a += 0.18 + t.curiosity * 0.12;

    return { v: clamp(v, -1, 1), a: clamp(a, 0, 1) };
  }

  /**
   * 메인 업데이트 / main per-frame update. 매 프레임 호출.
   * 절대 throw하지 않고, 모든 directive 필드를 항상 채워 돌려준다.
   * Never throws; returns a fully-populated directives object every frame.
   */
  function update(dt, ctx) {
    try {
      // ── 입력 정규화 / normalize inputs ─────────────────────────────────────
      let d = num(dt, 0.016);
      d = clamp(d, 0, 0.1);

      const c = ctx || {};
      const st = c.stats || {};
      const sctx = {
        hunger: clamp(num(st.hunger, 0), 0, 100),
        affection: clamp(num(st.affection, 50), 0, 100),
        energy: clamp(num(st.energy, 100), 0, 100),
        weight: clamp(num(st.weight, 0), 0, 100),
        cursorNear: !!c.cursorNear,
        dragActive: !!c.dragActive,
        busy: !!c.busy,
        activity: typeof c.activity === 'string' ? c.activity : 'lounge',
      };

      // clockMs는 참고용(외부 일관성). dt가 핵심 시간원.
      // clockMs is advisory; dt drives all internal timing. (No Date.now.)
      const clk = num(c.clockMs, S.lastClock == null ? 0 : S.lastClock);
      S.lastClock = clk;

      // ── 타이머 감쇠 / decay timers & memories ──────────────────────────────
      // 기억은 시상수 기반으로 부드럽게 0으로 / memories ease toward 0.
      S.mGood = S.mGood * Math.exp(-d / 25);   // 좋은 기억 ~25s 시상수
      S.mBad = S.mBad * Math.exp(-d / 30);     // grudge ~30s (조금 더 오래 간다)
      S.mFood = S.mFood * Math.exp(-d / 40);   // 포만 여운 ~40s
      if (S.mGood < 0.002) S.mGood = 0;
      if (S.mBad < 0.002) S.mBad = 0;
      if (S.mFood < 0.002) S.mFood = 0;

      S.pokeStreakT = Math.max(0, S.pokeStreakT - d);
      if (S.pokeStreakT <= 0) S.pokeStreak = 0;

      S.sayCd = Math.max(0, S.sayCd - d);
      S.emoteCd = Math.max(0, S.emoteCd - d);
      S.specialCd = Math.max(0, S.specialCd - d);
      S.gAttention = Math.max(0, S.gAttention - d);
      S.gSulk = Math.max(0, S.gSulk - d);
      S.gWiggle = Math.max(0, S.gWiggle - d);
      S.gStare = Math.max(0, S.gStare - d);
      S.gTease = Math.max(0, S.gTease - d);
      S.gZoom = Math.max(0, S.gZoom - d);

      // ── 외로움 누적 / loneliness accrual ───────────────────────────────────
      // 사람이 안 보고/안 만지면 외로움이 쌓인다. 가까이 있거나 상호작용하면 리셋.
      if (sctx.cursorNear || sctx.dragActive || sctx.busy) {
        S.lonelyT = 0;
      } else {
        S.lonelyT += d;
      }

      // ── 느린 무드 드리프트 / slow random mood drift ────────────────────────
      // 일정 간격마다 작은 목표 드리프트를 새로 뽑아 부드럽게 추적한다.
      S.driftT -= d;
      if (S.driftT <= 0) {
        S.driftT = rand(8, 18);
        // 성격이 변주폭에 영향 / traits flavor the drift range.
        S._driftVTarget = rand(-0.12, 0.14) + (S.traits.sass - 0.5) * -0.06;
        S._driftATarget = rand(-0.1, 0.12) + (S.traits.curiosity - 0.5) * 0.06;
      }
      S.driftV = approach(S.driftV, num(S._driftVTarget, 0), d, 4);
      S.driftA = approach(S.driftA, num(S._driftATarget, 0), d, 4);

      // ── 정서 좌표 갱신 / update smoothed valence/arousal ───────────────────
      const tgt = computeTarget(sctx);
      // 무드는 천천히 변해야 자연스럽다 / moods shift slowly (tau ~ 2.5s).
      S.valence = approach(S.valence, tgt.v, d, 2.5);
      S.arousal = approach(S.arousal, tgt.a, d, 2.0);

      // ── 무드 라벨 / classify mood label ────────────────────────────────────
      S.moodId = classifyMood(sctx) || 'content';
      const moodDef = MOODS[S.moodId] || MOODS.content;

      // ── expr 부드럽게 추적 / ease expr toward the mood's nudges ────────────
      // tau ~0.6s: 표정은 무드보다 약간 빠르게 따라온다.
      const target = moodDef;
      for (const k of ['eyeOpen', 'earPerk', 'earBack', 'tailAmp', 'tailSpeed', 'browTilt']) {
        S.expr[k] = approach(num(S.expr[k], 0), num(target[k], 0), d, 0.6);
      }

      // ── 디렉터: special moments / the "alive" director ─────────────────────
      let special = null;
      // 이벤트가 예약한 special을 먼저 소비 / consume an event-queued special first.
      // 사용자 반응(찌르기→삐짐 등)이라 즉각적이어야 하므로 ambient specialCd를
      // 무시하고, 대신 해당 special의 개별 게이트로만 도배를 막는다.
      // These are direct reactions to the user, so they bypass the ambient
      // specialCd and are gated only by their own per-special cooldown.
      if (pendingSpecial) {
        const gate = specialGateLeft(pendingSpecial);
        if (gate <= 0) {
          special = pendingSpecial;
          armSpecialGate(special);
          S.specialCd = rand(6, 10);
        }
        pendingSpecial = null; // 게이트 중이면 버린다 / drop if its gate is up
      }
      if (!special) {
        special = maybeDirect(sctx);
      }

      // ── prefer: life 레이어에 줄 부드러운 제안 / soft hint to life layer ────
      const prefer = computePrefer(sctx, special);

      // ── 대사 / occasional line ─────────────────────────────────────────────
      let say = null;
      if (pendingSay && S.sayCd <= 0) {
        say = pendingSay;
        pendingSay = null;
        S.sayCd = rand(8, 14);
      } else {
        pendingSay = null;
        say = maybeSay(sctx, special);
      }

      // ── emote / occasional floating emote ──────────────────────────────────
      let emote = null;
      if (pendingEmote && S.emoteCd <= 0) {
        emote = pendingEmote;
        pendingEmote = null;
        S.emoteCd = rand(2.5, 5);
      } else {
        pendingEmote = null;
        emote = maybeEmote(sctx, special);
      }

      // ── directive 조립 / assemble directives (all fields always present) ───
      return {
        mood: S.moodId,
        valence: clamp(num(S.valence, 0), -1, 1),
        arousal: clamp(num(S.arousal, 0), 0, 1),
        expr: {
          eyeOpen: num(S.expr.eyeOpen, 0),
          earPerk: num(S.expr.earPerk, 0),
          earBack: num(S.expr.earBack, 0),
          tailAmp: num(S.expr.tailAmp, 0),
          tailSpeed: num(S.expr.tailSpeed, 0),
          browTilt: num(S.expr.browTilt, 0),
        },
        prefer: prefer || null,
        say: say || null,
        emote: emote || null,
        special: special || null,
      };
    } catch (e) {
      // 절대 throw하지 않음 / never throw — return a calm neutral frame.
      return {
        mood: 'content',
        valence: 0,
        arousal: 0.3,
        expr: zeroExpr(),
        prefer: null,
        say: null,
        emote: null,
        special: null,
      };
    }
  }

  /** special별 남은 게이트 시간 / remaining per-special gate (0 = ready). */
  function specialGateLeft(id) {
    switch (id) {
      case 'demand_attention': return S.gAttention;
      case 'sulk_turn':        return S.gSulk;
      case 'happy_wiggle':     return S.gWiggle;
      case 'stare':            return S.gStare;
      case 'tease_back':       return S.gTease;
      default:                 return 0;
    }
  }

  /** special별 재발동 게이트 설정 / arm the per-special cooldown gate. */
  function armSpecialGate(id) {
    switch (id) {
      case 'demand_attention': S.gAttention = rand(40, 70); break;
      case 'sulk_turn':        S.gSulk = rand(25, 45); break;
      case 'happy_wiggle':     S.gWiggle = rand(20, 40); break;
      case 'stare':            S.gStare = rand(30, 55); break;
      case 'tease_back':       S.gTease = rand(18, 35); break;
      default: break;
    }
  }

  /**
   * 자발적 special 결정 / decide a spontaneous special moment.
   * 성격 + 무드 + 외로움/유대에 따라 가끔만 발동. 쿨다운으로 희소성 유지.
   * Fires rarely, gated by traits/mood/loneliness + cooldowns, so each feels special.
   */
  function maybeDirect(ctx) {
    if (S.specialCd > 0) return null;
    const t = S.traits;

    // 1) 외로울 때 관심 요구 / demand attention when ignored too long.
    //    clinginess가 높을수록 더 빨리/자주. 사람이 가까우면 발동 안 함.
    if (S.gAttention <= 0 && !ctx.cursorNear && !ctx.dragActive && !ctx.busy) {
      const threshold = lerp(75, 30, t.clinginess); // 30~75초 무시되면 / ignored window
      if (S.lonelyT > threshold) {
        // 확률적으로 1회 / probabilistic single beat.
        if (Math.random() < 0.5) {
          S.specialCd = rand(6, 10);
          armSpecialGate('demand_attention');
          return 'demand_attention';
        }
      }
    }

    // 2) 아주 행복할 때 줌미스 / zoomies when very happy & energetic.
    if (S.gZoom <= 0 && S.valence > 0.6 && S.arousal > 0.7 && ctx.energy > 55 && ctx.hunger < 55) {
      if (Math.random() < 0.02) {
        S.specialCd = rand(6, 10);
        S.gZoom = rand(30, 55);
        return 'happy_wiggle'; // 행복 신호(호스트가 zoomies와 연계 가능)
      }
    }

    // 3) 사람이 가까이 있는데 한가할 때 빤히 쳐다보기 / stare when cursor near & idle.
    if (S.gStare <= 0 && ctx.cursorNear && !ctx.dragActive &&
        (ctx.activity === 'lounge' || ctx.activity === 'lie' || ctx.activity === 'groom')) {
      const p = 0.004 + t.curiosity * 0.01 + t.clinginess * 0.006;
      if (Math.random() < p) {
        S.specialCd = rand(6, 10);
        armSpecialGate('stare');
        return 'stare';
      }
    }

    // 4) 삐진 상태 유지 중 가끔 돌아앉기 재강조 / occasional sulk re-turn while grumpy.
    if (S.gSulk <= 0 && S.moodId === 'sulky' && Math.random() < 0.003) {
      S.specialCd = rand(6, 10);
      armSpecialGate('sulk_turn');
      return 'sulk_turn';
    }

    return null;
  }

  /**
   * life 레이어에 줄 행동 제안 / soft activity hint for the life layer.
   * special과 충돌하지 않게 보수적으로 제안. 호스트는 무시해도 된다.
   * Conservative; host may ignore. Never forces — just biases.
   */
  function computePrefer(ctx, special) {
    const t = S.traits;
    // special이 행동을 함의하면 그에 맞춘 제안 / map specials to a hint.
    if (special === 'happy_wiggle' && S.valence > 0.6 && S.arousal > 0.7) return 'zoomies';
    if (special === 'sulk_turn') return 'sulk';
    if (special === 'demand_attention') return 'play';
    if (special === 'tease_back') return 'play';

    // 무드 기반 약한 제안 / weak mood-based hints (rare; mostly null).
    if (S.moodId === 'sleepy' && ctx.energy < 30) return 'nap';
    if (S.moodId === 'sulky') return 'sulk';
    if (S.moodId === 'playful' && Math.random() < 0.02) return 'play';
    if (S.moodId === 'affectionate' && ctx.cursorNear && Math.random() < 0.02) return 'play';
    // 게으른 성격은 가끔 눕기 제안 / lazy rats occasionally suggest lying down.
    if (t.laziness > 0.65 && S.arousal < 0.3 && Math.random() < 0.01) return 'lie';
    if (S.moodId === 'bored' && Math.random() < 0.008) {
      return Math.random() < 0.5 ? 'wander' : 'groom';
    }
    return null;
  }

  /** bond → 단계 라벨 / map bond to a tier name. */
  function bondTier() {
    if (S.bond >= 66) return 'bondHigh';
    if (S.bond >= 36) return 'bondMid';
    return 'bondLow';
  }

  /**
   * 가끔 한마디 / occasional Korean line, rate-limited by sayCd.
   * special이 있으면 그에 맞춘 대사를 우선. 아니면 무드/유대 기반.
   * Prefers a special-matched line; else mood/bond ambient lines (rare).
   */
  function maybeSay(ctx, special) {
    if (S.sayCd > 0) return null;
    const t = S.traits;

    // special 동반 대사 / line that accompanies a special moment.
    if (special) {
      let line = null;
      if (special === 'demand_attention') line = pick(LINES.ignored);
      else if (special === 'sulk_turn') line = pick(LINES.sulky);
      else if (special === 'happy_wiggle') line = pick(LINES.smug);
      else if (special === 'stare') line = pick(LINES.curious);
      else if (special === 'tease_back') line = pick(LINES.playful);
      if (line) {
        S.sayCd = rand(8, 14);
        return line;
      }
    }

    // 평상시 무드/유대 잡담 / ambient mood-or-bond chatter.
    // 기본 확률은 낮고, sass가 높으면 말이 좀 더 많다 / sassy rats quip more.
    const baseP = 0.004 + t.sass * 0.006;
    if (Math.random() < baseP) {
      // 60%는 무드 풀, 40%는 유대 풀 / mix mood & bond pools.
      let pool;
      if (Math.random() < 0.6 && LINES[S.moodId]) pool = LINES[S.moodId];
      else pool = LINES[bondTier()];
      const line = pick(pool);
      if (line) {
        // 시크한 무드일수록 살짝 더 긴 쿨다운 / quieter when aloof.
        S.sayCd = rand(10, 18) + (S.moodId === 'sulky' ? 6 : 0);
        return line;
      }
    }
    return null;
  }

  /**
   * 가끔 떠다니는 emote / occasional floating emote, rate-limited by emoteCd.
   * 무드에 어울리는 작은 기호를 드물게 / a small mood-fitting glyph, rarely.
   */
  function maybeEmote(ctx, special) {
    if (S.emoteCd > 0) return null;

    // special 동반 emote / emote that accompanies a special.
    if (special) {
      let e = null;
      if (special === 'demand_attention') e = 'dots';
      else if (special === 'sulk_turn') e = 'anger';
      else if (special === 'happy_wiggle') e = 'spark';
      else if (special === 'stare') e = 'dots';
      else if (special === 'tease_back') e = 'spark';
      if (e) { S.emoteCd = rand(3, 6); return e; }
    }

    // 무드 기반 드문 emote / rare mood-based ambient emote.
    const p = 0.003;
    if (Math.random() < p) {
      let e = null;
      switch (S.moodId) {
        case 'affectionate': e = 'heart'; break;
        case 'playful':      e = 'spark'; break;
        case 'smug':         e = 'note'; break;
        case 'sleepy':       e = 'zzz'; break;
        case 'grumpy':       e = 'anger'; break;
        case 'sulky':        e = 'anger'; break;
        case 'curious':      e = 'dots'; break;
        case 'bored':        e = 'sweat'; break;
        default:             e = null; break;
      }
      if (e) { S.emoteCd = rand(4, 8); return e; }
    }
    return null;
  }

  /** 상태 완전 초기화(새 성격 포함) / hard reset, reseeds personality. */
  function reset() {
    S = freshState();
    pendingSpecial = pendingSay = pendingEmote = null;
  }

  // 공개 인터페이스 / public interface.
  return { load, serialize, event, update, reset };
}
