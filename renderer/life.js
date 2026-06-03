// life.js — "Desk Rat" 생명 시스템 / life-system brain (PURE LOGIC).
//
// 이 모듈은 렌더링/윈도우 이동을 직접 하지 않는다. 매 프레임 update(dt, ctx)를
// 호출하면 "지금 쥐가 무엇을 해야 하는가"를 기술하는 activity 객체를 돌려준다.
// This module renders nothing. The host calls update(dt, ctx) each frame and we
// return an `activity` object describing what the rat should be doing. The host
// translates that into poses + window movement.
//
// 순수 결정 로직: NO imports / NO THREE.js / NO DOM / NO Node APIs.
// Pure decision logic. Math.random() is allowed (runs in the renderer at runtime).

// ─────────────────────────────────────────────────────────────────────────────
// 작은 유틸들 / tiny helpers
// ─────────────────────────────────────────────────────────────────────────────

/** 숫자를 [min,max]로 가둔다 / clamp a number into [min,max]. */
function clamp(v, min, max) {
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

/** v가 유한한 숫자가 아니면 fallback / coerce to a finite number, else fallback. */
function num(v, fallback) {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}

/** [a,b) 사이 실수 / random float in [a,b). */
function rand(a, b) {
  return a + Math.random() * (b - a);
}

/** 배열에서 무작위 원소 / random element of an array. */
function pick(arr) {
  return arr[(Math.random() * arr.length) | 0];
}

// 상황별 대사 풀 / per-situation Korean line pools (chic / aloof tone).
const LINES = {
  idle: ['...심심하네.', '햇볕 좋다.', '귀찮아.', '오늘은 뭐 하지.', '...뭐 보냐.'],
  forage: ['...출출한데.', '뭐 먹을 거 없나.', '배고파.', '간식 어디 갔지.'],
  groom: ['단장 좀 하고.', '깔끔이 최고지.', '...흐트러졌네.'],
  lie: ['좀 누울게.', '아 편하다.', '낮잠 각인데.'],
  zoomies: ['가자!', '신난다!', '잡아봐!'],
};

// ─────────────────────────────────────────────────────────────────────────────
// 팩토리 / factory
// ─────────────────────────────────────────────────────────────────────────────

export function createLife() {
  // 내부 상태 / internal mutable state ─ 호스트는 절대 직접 만지지 않는다.
  let S;

  /** 상태를 깨끗한 lounge로 초기화 / reset internal state to a fresh lounge. */
  function freshState() {
    return {
      name: 'lounge',        // 현재 활동 / current activity
      posture: 'sit',        // 현재 포즈 힌트 / current posture hint
      facing: 1,             // 기억하는 바라보는 방향 / remembered facing (default 1 = right)

      dwell: rand(6, 12),    // 이 활동을 더 유지할 시간(초) / remaining dwell seconds
      target: null,          // 걸어갈 윈도우 좌상단 목표 / window top-left target {x,y} or null
      speedPx: 0,            // 현재 이동 속도 px/s / current move speed
      stepPhase: 0,          // 보행 위상 0..1 / gait phase

      // 줌미스 전용 / zoomies bookkeeping
      dashesLeft: 0,         // 남은 대시 횟수 / remaining dashes

      // 타이머/쿨다운 / timers & cooldowns
      sayCooldown: 0,        // 다음 대사까지 / time until another line allowed
      emoteTimer: 0,         // 주기적 emote 누적시간 / accumulator for periodic emotes
      saidThisActivity: false, // 이 활동 시작 후 이미 말했는지 / spoke once this activity
      zoomiesGate: 0,        // 줌미스 재발동 쿨다운 / cooldown before zoomies can fire again
    };
  }

  S = freshState();

  /**
   * 새 배회 목표 선택 / pick a new wander target (window top-left position).
   * 윈도우 전체가 화면 안에 있도록 클램프하고, 바닥 밴드에 치우치게 한다.
   * Clamp so the whole window stays inside screen; bias y toward the bottom band.
   */
  function pickTarget(win, screen) {
    const minX = screen.x;
    const maxX = screen.x + screen.w - win.w;
    const minY = screen.y;
    const maxY = screen.y + screen.h - win.h;

    // 화면이 윈도우보다 작은 비정상 케이스 방어 / guard degenerate ranges.
    const loX = Math.min(minX, maxX);
    const hiX = Math.max(minX, maxX);
    const loY = Math.min(minY, maxY);
    const hiY = Math.max(minY, maxY);

    const tx = rand(loX, hiX);

    // 바닥 밴드: 허용 y범위의 아래쪽 ~25%. 가끔(20%) 조금 더 높이 허용.
    // Bottom band: lowest ~25% of allowed y; occasionally allow a bit higher.
    const span = hiY - loY;
    let ty;
    if (Math.random() < 0.2) {
      ty = rand(loY + span * 0.4, hiY); // 가끔 더 높은 곳 / occasionally higher
    } else {
      ty = rand(loY + span * 0.75, hiY); // 보통 바닥 근처 / usually near floor
    }

    return { x: clamp(tx, loX, hiX), y: clamp(ty, loY, hiY) };
  }

  /**
   * 한 활동을 시작 / begin an activity: 포즈/체류시간/목표/속도를 설정.
   * Sets posture, dwell timer, target, speed for the chosen activity name.
   */
  function startActivity(name, win, screen) {
    S.name = name;
    S.saidThisActivity = false;
    S.emoteTimer = 0;
    S.stepPhase = 0;
    S.dashesLeft = 0;

    switch (name) {
      case 'lounge':
        S.posture = 'sit';
        S.target = null;
        S.speedPx = 0;
        S.dwell = rand(6, 12);
        break;

      case 'lie':
        S.posture = 'lie';
        S.target = null;
        S.speedPx = 0;
        S.dwell = rand(8, 16);
        break;

      case 'groom':
        S.posture = 'groom';
        S.target = null;
        S.speedPx = 0;
        S.dwell = rand(2.5, 4);
        break;

      case 'nap':
        S.posture = 'sleep';
        S.target = null;
        S.speedPx = 0;
        S.dwell = Infinity; // energy가 회복될 때까지 / until energy recovers
        break;

      case 'wander':
        S.posture = 'walk';
        S.target = pickTarget(win, screen);
        S.speedPx = rand(55, 75);
        S.dwell = rand(4, 8); // 도착 후 머무는 시간 / dwell after arrival
        break;

      case 'forage':
        S.posture = 'walk';
        S.target = pickTarget(win, screen);
        S.speedPx = rand(60, 80); // 조금 더 분주 / slightly busier
        S.dwell = rand(2, 5);     // 자주 새 지점으로 / hop to new spots more often
        break;

      case 'zoomies':
        S.posture = 'walk';
        S.target = pickTarget(win, screen);
        S.speedPx = 240;                 // 빠르게 / fast
        S.dashesLeft = 2 + ((Math.random() * 2) | 0); // 2~3회 대시 / 2-3 dashes
        S.dwell = rand(0.5, 1.2);
        break;

      default:
        S.posture = 'sit';
        S.target = null;
        S.speedPx = 0;
        S.dwell = rand(6, 12);
        break;
    }
  }

  /**
   * 가중 무작위로 평범한 일상 활동 하나를 시작 / start a weighted idle activity.
   * lounge가 가장 흔하고, wander/lie/groom이 뒤따른다.
   */
  function startWeightedIdle(win, screen) {
    // 가중치 / weights (lounge most common, then wander, lie, groom).
    const table = [
      ['lounge', 38],
      ['wander', 30],
      ['lie', 20],
      ['groom', 12],
    ];
    let total = 0;
    for (const [, w] of table) total += w;
    let r = Math.random() * total;
    for (const [nm, w] of table) {
      r -= w;
      if (r <= 0) {
        startActivity(nm, win, screen);
        return;
      }
    }
    startActivity('lounge', win, screen);
  }

  /** 중립 휴식 activity(양보용) / neutral resting activity used when yielding. */
  function yieldActivity() {
    // 진행 중인 배회를 리셋해 사용자에게 "집중"하게 한다.
    // Reset any in-progress wander so the rat pays attention to the user.
    S.name = 'lounge';
    S.posture = 'sit';
    S.target = null;
    S.speedPx = 0;
    S.stepPhase = 0;
    S.dashesLeft = 0;
    S.dwell = rand(6, 12);
    S.saidThisActivity = false;
    return {
      name: 'lounge',
      posture: 'sit',
      moveWindowTo: null,
      speedPx: 0,
      facing: S.facing, // 마지막 방향 유지 / keep last facing
      stepPhase: 0,
      say: null,
      emote: null,
    };
  }

  /** 최종 출력 객체 생성 헬퍼 / build the activity output object. */
  function output(moveWindowTo, speedPx, say, emote) {
    return {
      name: S.name,
      posture: S.posture,
      moveWindowTo: moveWindowTo || null,
      speedPx: num(speedPx, 0),
      facing: S.facing === -1 ? -1 : 1,
      stepPhase: clamp(num(S.stepPhase, 0), 0, 1),
      say: say != null ? say : null,
      emote: emote != null ? emote : null,
    };
  }

  /**
   * 메인 업데이트 / main per-frame update.
   * 절대 throw하지 않는다 — 모든 필드를 방어적으로 기본값 처리.
   * Never throws; defaults all ctx fields defensively.
   */
  function update(dt, ctx) {
    try {
      // ── 입력 정규화 / normalize inputs ───────────────────────────────────
      let d = num(dt, 0.016);
      d = clamp(d, 0, 0.05); // clamp-safe: 가끔 0.05까지 / occasional large steps

      const c = ctx || {};
      const stats = c.stats || {};
      const hunger = clamp(num(stats.hunger, 0), 0, 100);
      const affection = clamp(num(stats.affection, 50), 0, 100);
      const energy = clamp(num(stats.energy, 100), 0, 100);
      // weight는 현재 로직에 직접 쓰진 않지만 인터페이스상 안전 처리.
      // weight is read for completeness though unused in decisions.
      // (eslint-friendly read)
      void clamp(num(stats.weight, 50), 0, 100);

      const cursorNear = !!c.cursorNear;
      const dragActive = !!c.dragActive;
      const busy = !!c.busy;

      const winIn = c.win || {};
      const win = {
        x: num(winIn.x, 0),
        y: num(winIn.y, 0),
        w: Math.max(1, num(winIn.w, 200)),
        h: Math.max(1, num(winIn.h, 200)),
      };
      const scrIn = c.screen || {};
      const screen = {
        x: num(scrIn.x, 0),
        y: num(scrIn.y, 0),
        w: Math.max(1, num(scrIn.w, 1920)),
        h: Math.max(1, num(scrIn.h, 1080)),
      };

      // 타이머 감소 / tick down cooldowns (always, even when yielding).
      S.sayCooldown = Math.max(0, S.sayCooldown - d);
      S.zoomiesGate = Math.max(0, S.zoomiesGate - d);

      // ── 1) 양보 / YIELD: busy or drag or cursorNear ─────────────────────
      if (busy || dragActive || cursorNear) {
        return yieldActivity();
      }

      // ── 2) 졸림 → 낮잠 / NAP when tired ─────────────────────────────────
      // energy < 22 진입, energy > 75 까지 유지.
      if (S.name !== 'nap' && energy < 22) {
        startActivity('nap', win, screen);
      }
      if (S.name === 'nap') {
        if (energy > 75) {
          // 깨어남 → 일상으로 / wake up into idle life.
          startWeightedIdle(win, screen);
        } else {
          // 자는 동안 / while napping: stay put, periodic 'sleep' emote (~2.5s).
          S.emoteTimer += d;
          let emote = null;
          if (S.emoteTimer >= 2.5) {
            S.emoteTimer = 0;
            emote = 'sleep';
          }
          let say = null;
          if (!S.saidThisActivity) {
            // 잠들 때 한 번만 / one quiet line when dozing off.
            S.saidThisActivity = true;
          }
          return output(null, 0, say, emote);
        }
      }

      // ── 3) 배고픔 → 채집 / FORAGE when hungry (and not tired) ────────────
      // hunger > 70. 낮잠이 아닐 때만. 진입 시 forage 시작.
      if (energy >= 22 && hunger > 70 && S.name !== 'forage' && S.name !== 'zoomies') {
        startActivity('forage', win, screen);
      }
      // 배고픔이 해소되면 forage 종료를 dwell 만료에 맡긴다 / let dwell end it.

      // ── 4) 행복 → 줌미스 / ZOOMIES when happy ───────────────────────────
      // affection>70 && energy>55 && hunger<55 → ~1.5%/s 확률로 발동.
      if (
        S.name !== 'zoomies' &&
        S.name !== 'forage' &&
        S.zoomiesGate <= 0 &&
        affection > 70 &&
        energy > 55 &&
        hunger < 55
      ) {
        // 초당 1.5% → 프레임당 확률 = 0.015 * dt / per-frame probability.
        if (Math.random() < 0.015 * d) {
          startActivity('zoomies', win, screen);
        }
      }

      // ── 이동 처리 / movement toward target ──────────────────────────────
      let moveWindowTo = null;
      let speedPx = 0;
      let arrived = false;

      if (S.target && S.speedPx > 0) {
        const dx = S.target.x - win.x;
        const dy = S.target.y - win.y;
        const dist = Math.hypot(dx, dy);

        // 도착 판정: 몇 px 이내 / arrival within a few px.
        const ARRIVE = 6;
        if (dist <= ARRIVE) {
          arrived = true;
          S.stepPhase = 0;
        } else {
          // 수평 이동 방향으로 facing 설정 / face horizontal travel direction.
          if (Math.abs(dx) > 0.5) {
            S.facing = dx < 0 ? -1 : 1;
          }
          // 보행 위상 진행: 한 보행 주기가 STRIDE_PX 만큼의 실제 이동에 대응하도록
          // cadence를 이동 속도에서 유도 → 발이 미끄러지지 않는다.
          // advance gait phase; cadence derived from travel speed so one cycle ==
          // STRIDE_PX of window travel (feet stop sliding).
          const STRIDE_PX = 46;
          const cadence = S.speedPx / STRIDE_PX;
          S.stepPhase = (S.stepPhase + d * cadence) % 1;
          if (S.stepPhase < 0) S.stepPhase += 1;

          moveWindowTo = { x: S.target.x, y: S.target.y };
          speedPx = S.speedPx;
        }
      }

      // ── 도착 후 처리 / on arrival ───────────────────────────────────────
      if (arrived) {
        if (S.name === 'zoomies' && S.dashesLeft > 0) {
          // 다음 대시 / chain another dash.
          S.dashesLeft -= 1;
          S.target = pickTarget(win, screen);
          S.speedPx = 240;
          S.stepPhase = 0;
          // dust emote는 아래 주기 로직에서 가끔 / dust handled below.
        } else {
          // 목표 도달, 속도 0, 체류 타이머 시작 / clear target, begin dwell.
          S.target = null;
          S.speedPx = 0;
          S.stepPhase = 0;
          moveWindowTo = null;
          speedPx = 0;
          if (S.dwell === Infinity || S.dwell <= 0) {
            S.dwell = rand(3, 7);
          }
          // 줌미스가 끝났다면 재발동 쿨다운 / set cooldown after zoomies ends.
          if (S.name === 'zoomies') {
            S.zoomiesGate = rand(20, 45);
          }
        }
      }

      // ── 체류 타이머 / dwell countdown (정지 상태일 때만 의미) ────────────
      // 이동 중이 아니면 dwell을 깎고, 만료되면 다음 활동을 고른다.
      // While not moving toward a target, count down dwell; on expiry pick next.
      if (!S.target) {
        S.dwell -= d;
        if (S.dwell <= 0) {
          // 다음 활동 선택 / choose the next activity.
          if (energy < 22) {
            startActivity('nap', win, screen);
          } else if (hunger > 70) {
            startActivity('forage', win, screen);
          } else {
            startWeightedIdle(win, screen);
          }
        }
      }

      // ── emote 주기 / one-shot emote hints ───────────────────────────────
      let emote = null;
      S.emoteTimer += d;
      if (S.name === 'zoomies' && speedPx > 0) {
        // 달리는 동안 가끔 먼지 / dust occasionally while dashing (~ every 0.6s).
        if (S.emoteTimer >= 0.6) {
          S.emoteTimer = 0;
          if (Math.random() < 0.7) emote = 'dust';
        }
      } else if (S.name === 'groom') {
        // 그루밍 끝물에 반짝 / sparkle near the end of grooming.
        if (!S.saidThisActivity && S.dwell <= 0.6 && Math.random() < 0.5) {
          emote = 'sparkle';
        }
      }

      // ── say 대사 / one-shot Korean lines (rate-limited, once per activity) ─
      let say = null;
      if (!S.saidThisActivity && S.sayCooldown <= 0) {
        let pool = null;
        let chance = 0;
        if (S.name === 'forage') {
          pool = LINES.forage;
          chance = 0.02; // 자주, 하지만 쿨다운으로 ~8s 제한 / cooldown-limited ~8s
        } else if (S.name === 'zoomies') {
          pool = LINES.zoomies;
          chance = 0.05;
        } else if (S.name === 'groom') {
          pool = LINES.groom;
          chance = 0.01;
        } else if (S.name === 'lie') {
          pool = LINES.lie;
          chance = 0.008;
        } else if (S.name === 'lounge') {
          pool = LINES.idle;
          chance = 0.006;
        }
        if (pool && Math.random() < chance) {
          say = pick(pool);
          S.saidThisActivity = true;
          // 상황별 쿨다운 / per-situation cooldown before the next line.
          S.sayCooldown = S.name === 'forage' ? rand(8, 12) : rand(10, 18);
        }
      }

      return output(moveWindowTo, speedPx, say, emote);
    } catch (e) {
      // 절대 throw하지 않음 / never throw: fall back to a safe neutral frame.
      return {
        name: 'lounge',
        posture: 'sit',
        moveWindowTo: null,
        speedPx: 0,
        facing: S && S.facing === -1 ? -1 : 1,
        stepPhase: 0,
        say: null,
        emote: null,
      };
    }
  }

  /** 상태 초기화 / reset internal state back to a fresh lounge. */
  function reset() {
    S = freshState();
  }

  return { update, reset };
}
