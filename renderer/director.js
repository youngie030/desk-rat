// director.js — "Desk Rat" 상위 연출 / higher-level "alive" director (PURE LOGIC).
//
// life.js  = WHAT the rat does (lounge/wander/nap/zoomies…).
// personality.js = HOW it feels doing it (mood/bond/specials).
// director.js = the LAYER ON TOP: play with the cursor, react to the *kind* of
//   file dropped, behave by time-of-day, think idle thoughts, and grow through
//   bond milestones + a perceivable "trust/age" level.
//
// 순수 결정 로직 / pure logic: NO imports / NO THREE.js / NO DOM / NO Node APIs.
// 시간은 호스트가 주는 clockMs(벽시계 ms, Date.now 가능)와 dt만 사용.
// Time comes from host-provided clockMs (wall-clock ms — Date.now is FINE here,
// we need the real hour-of-day) and dt. Never calls Date.now itself.
// 절대 throw하지 않으며, 모든 출력 필드를 항상 채워 돌려준다.
// Never throws; every output field is always present.
//
// ─────────────────────────────────────────────────────────────────────────────
// HOST INTERFACE (see bottom of file for the full contract)
//
//   import { createDirector } from './director.js';
//   const director = createDirector();
//   try { director.load(JSON.parse(localStorage.getItem('deskrat.director'))); } catch {}
//
//   // per-frame, AFTER soul.update():
//   const out = director.update(dt, {
//     stats, mood, bond,            // bond 0..100 from soul (read soul.serialize().bond)
//     cursor: { x, y, inside, vx, vy }, // window-local cursor px + per-frame velocity
//     bodyScreen: { x, y },         // rat body anchor in window px (bodyScreen())
//     state, posture, activity,     // current app state machine + life hints
//     held, dragActive,
//     clockMs: Date.now(),          // REAL wall clock (for hour-of-day)
//   });
//   // out: { pose, say, emote, special, action, window, milestone, phase, trust }
//
//   // one-shot when a file finishes being eaten:
//   const r = director.onFeed({ paths, totalBytes });  // -> { category, say, emote, pose }
//
//   localStorage.setItem('deskrat.director', JSON.stringify(director.serialize()));
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// 작은 유틸 / tiny helpers (mirroring life.js / personality.js conventions)
// ─────────────────────────────────────────────────────────────────────────────

function clamp(v, min, max) {
  if (!(v > min)) v = min;        // NaN-safe
  if (v > max) v = max;
  return v;
}
function num(v, fallback) {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}
function rand(a, b) { return a + Math.random() * (b - a); }
function pick(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[(Math.random() * arr.length) | 0];
}
function str(v) { return typeof v === 'string' ? v : ''; }

// ─────────────────────────────────────────────────────────────────────────────
// (A2) 파일 종류 → 카테고리 / extension → category map
//
// 드롭된 파일의 확장자로 카테고리를 정하고, 카테고리별 1회성 반응을 낸다.
// Classify a dropped file by extension; emit a one-shot reaction per category.
// ─────────────────────────────────────────────────────────────────────────────

const EXT_CATEGORY = {
  // images
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image',
  bmp: 'image', tiff: 'image', tif: 'image', heic: 'image', svg: 'image',
  ico: 'image', avif: 'image', psd: 'image', raw: 'image',
  // audio + video lumped as "media"
  mp3: 'media', wav: 'media', flac: 'media', aac: 'media', ogg: 'media',
  m4a: 'media', wma: 'media', mp4: 'media', mkv: 'media', mov: 'media',
  avi: 'media', webm: 'media', flv: 'media', wmv: 'media', m4v: 'media',
  // archives
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive',
  bz2: 'archive', xz: 'archive', iso: 'archive', cab: 'archive', tgz: 'archive',
  // code / text
  js: 'code', ts: 'code', jsx: 'code', tsx: 'code', py: 'code', java: 'code',
  c: 'code', h: 'code', cpp: 'code', cc: 'code', cs: 'code', go: 'code',
  rs: 'code', rb: 'code', php: 'code', swift: 'code', kt: 'code', sh: 'code',
  html: 'code', css: 'code', json: 'code', xml: 'code', yml: 'code', yaml: 'code',
  md: 'code', txt: 'text', rtf: 'text', csv: 'text', log: 'text', ini: 'text',
  // documents (treated as a softer "text" cousin but flavored)
  pdf: 'doc', doc: 'doc', docx: 'doc', ppt: 'doc', pptx: 'doc',
  xls: 'doc', xlsx: 'doc', hwp: 'doc',
  // executables (the rat is wary of these)
  exe: 'exe', msi: 'exe', bat: 'exe', cmd: 'exe', com: 'exe',
  scr: 'exe', dll: 'exe', sys: 'exe', app: 'exe', dmg: 'exe',
};

// 카테고리별 반응 풀 / per-category reaction pools (chic / aloof / witty).
// pose 힌트는 app.js의 데모/상태 포즈 이름을 재사용 가능하게 둔다.
const FEED_REACT = {
  image: {
    say: ['오, 그림이네.', '예쁜 거 줬네.', '...찰칵. 잘 먹을게.', '눈요기부터 하고.'],
    emote: 'spark', pose: 'curious',
  },
  media: {
    say: ['음악이야? 흥얼흥얼.', '영상은 좀 길던데... 냠.', '리듬 타면서 먹어볼까.', '♪ 잘 먹겠습니다.'],
    emote: 'note', pose: 'dance',
  },
  archive: {
    say: ['압축된 거? 까는 재미가 있지.', '안에 뭐 들었으려나... 와그작.', '꾹꾹 눌러 담았네. 든든.', '한입에 여러 개, 이득이야.'],
    emote: 'spark', pose: 'eatgrab',
  },
  code: {
    say: ['코드 맛은... 좀 써.', '버그도 같이 먹었다.', '이거 안 돌아가던 거지? 없애줄게.', '세미콜론 맛이 나.'],
    emote: 'dots', pose: 'curious',
  },
  text: {
    say: ['글자 조각이네. 가볍다.', '메모는 한입거리지.', '...읽지도 않고 먹어버렸네.', '바삭한 텍스트.'],
    emote: 'dots', pose: 'eatgrab',
  },
  doc: {
    say: ['서류 작업은 질색인데... 없애줄게.', '문서 한 부, 처리 완료.', '딱딱한 맛이야.', '회의록? 냠, 사라졌다.'],
    emote: 'dots', pose: 'eatgrab',
  },
  exe: {
    say: ['이거... 위험한 냄새 나는데.', '실행파일? 조심조심... 와작.', '수상한 맛이야. 그래도 먹어줄게.', '으, 딱딱하고 무서워.'],
    emote: 'sweat', pose: 'poke',
  },
  huge: {
    say: ['우웁... 이건 너무 커!', '한 번에 이걸 다...? 끄응.', '대왕 간식이다!', '배 터지겠어... 후.'],
    emote: 'sweat', pose: 'full',
  },
  unknown: {
    say: ['이건... 뭔지 모르겠지만 냠.', '낯선 맛이네.', '뭐든 일단 먹고 보자.', '...정체불명. 그래도 맛은 봐야지.'],
    emote: 'dots', pose: 'eatgrab',
  },
};

const HUGE_BYTES = 200 * 1024 * 1024; // 200MB+ = "대왕 간식" overrides category flavor

function classifyExt(path) {
  const p = str(path).toLowerCase();
  const slash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  const name = slash >= 0 ? p.slice(slash + 1) : p;
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return 'unknown'; // no real extension (or dotfile)
  const ext = name.slice(dot + 1);
  return EXT_CATEGORY[ext] || 'unknown';
}

// ─────────────────────────────────────────────────────────────────────────────
// (B3) 시간대 / time-of-day phases (from real wall clock hour)
//
//   night    23:00–05:59  졸림, 낮은 텐션 / sleepy, low energy bias
//   morning  06:00–10:59  기지개·하품, 점점 깸 / morning stretch & yawn
//   day      11:00–17:59  보통 / neutral baseline
//   evening  18:00–22:59  나른·아늑 / cozy wind-down
// ─────────────────────────────────────────────────────────────────────────────

function phaseFor(hour) {
  const h = clamp(num(hour, 12), 0, 23);
  if (h >= 23 || h < 6) return 'night';
  if (h < 11) return 'morning';
  if (h < 18) return 'day';
  return 'evening';
}

const PHASE_GREET = {
  morning: ['...벌써 아침이야?', '하암... 좋은 아침.', '기지개 좀 켜고.', '오늘도 시작이네.'],
  day:     ['햇볕 좋다.', '나른한 오후네.', '점심은 먹었어?', '평화로운 낮이야.'],
  evening: ['해 진다.', '하루 끝나가네.', '...아늑한 저녁이야.', '오늘 수고했어.'],
  night:   ['이 시간까지 안 자?', '졸려... 너도 자.', '밤이야. 조용히 해.', '...별 보러 갈까.'],
};

// 시간대별 한 번씩 뜨는 연출 / once-per-phase staged behaviors.
const PHASE_ACTION = {
  morning: 'stretch', // 기지개·하품 / morning stretch + yawn
  evening: 'settle',  // 자리 정돈하듯 한 바퀴 / cozy settle
  night:   'yawn',    // 하품 / yawn
};

// ─────────────────────────────────────────────────────────────────────────────
// (B4) 생각 풍선 / THOUGHT BUBBLES — idle musings, distinct from reactions.
//
// 무드/유대/시간대로 풀을 고른다. 반응 대사와 겹치지 않게 "혼잣말" 톤.
// Chosen by mood / bond tier / phase. A private "musing" tone, never a reaction.
// ─────────────────────────────────────────────────────────────────────────────

const THOUGHTS = {
  // by bond tier
  bondLow: [
    '저 사람, 믿어도 되나.', '아직은 거리 두기.', '내 영역인데...', '뭘 보는 거지, 자꾸.',
  ],
  bondMid: [
    '이제 좀 익숙해졌나.', '나쁜 집사는 아니야.', '오늘도 옆에 있네.', '...있으면 편하긴 해.',
  ],
  bondHigh: [
    '이 자리, 마음에 들어.', '너 없을 때가 더 심심해.', '...우리 꽤 오래됐지.', '뭐, 정들었나 봐.',
    '네 냄새가 나면 안심돼.',
  ],
  // by mood (musings, not reactions)
  content: ['먼지 한 톨이 떠다니네.', '시간이 천천히 가.', '...아무 생각 안 하기.', '꼬리가 간질간질.'],
  bored:   ['뭐 재밌는 거 없나.', '벽지 무늬나 세어볼까.', '하품이 나오려고 해.', '...심심해 죽겠네.'],
  curious: ['저 구석엔 뭐가 있을까.', '소리가 났는데.', '저게 움직였나?', '냄새가... 어디서 나지.'],
  sleepy:  ['눈꺼풀이 무거워.', '꿈에선 치즈 산이었는데.', '...조금만 더 누워야지.', '하암.'],
  playful: ['뭐든 굴려보고 싶어.', '저거 쫓고 싶다.', '심심한데 장난이나.', '근질근질하네.'],
  smug:    ['역시 난 멋져.', '오늘 털 상태 완벽.', '나만한 쥐 없지.', '후훗.'],
  // by phase (ambient flavor)
  night:   ['세상이 조용해.', '달이 밝네.', '다들 자나 봐.', '...밤은 길어.'],
  morning: ['공기가 차갑네.', '아침 햇살이 좋아.', '오늘은 뭐 하지.', '커피 냄새 난다.'],
  day:     ['해가 중천이네.', '나른한 오후.', '낮잠 각인데.', '바닥에 뭐 떨어졌나.'],
  evening: ['하루가 저무네.', '불빛이 따뜻해.', '...오늘도 무사히.', '저녁 공기 좋다.'],
};

// ─────────────────────────────────────────────────────────────────────────────
// (A1) PLAY — 커서 놀이 / cursor play (chase / pounce / peekaboo).
//
// 사용자가 쥐 위 근처에서 커서를 빠르게 흔들면 놀이 모드로 진입.
// 쥐가 커서를 쫓다가(chase) 가까워지면 덮친다(pounce). 가만히 있으면 시들해진다.
// When the user wiggles the cursor fast near the rat, play kicks in: the rat
// chases the cursor, pounces when close, and loses interest if it goes still.
// ─────────────────────────────────────────────────────────────────────────────

const PLAY_SAY = ['잡았다!', '거기 섯!', '못 잡을걸~', '요리조리...', '이거 재밌네!'];
const PLAY_POUNCE_SAY = ['덮쳤다!', '잡았어!', '에잇!', '내 거!'];

// ─────────────────────────────────────────────────────────────────────────────
// (C6/C7) 유대 마일스톤 + 신뢰 레벨 / bond milestones + perceivable trust level.
//
// trust 0..4: 영구 저장. bond가 임계 위로 처음 올라간 적이 있으면 잠금 해제(unlock).
// trust never *drops* an unlock once reached (memory of the relationship), but
// the live tier shown can dip with bond. Unlocks fire a one-shot milestone.
// ─────────────────────────────────────────────────────────────────────────────

const MILESTONES = [
  // threshold(bond) , trustLevel , id ............ unlock summary
  { bond: 20, level: 1, id: 'acquainted',  unlock: ['greet'] },
  { bond: 40, level: 2, id: 'familiar',    unlock: ['greet', 'sit_closer'] },
  { bond: 60, level: 3, id: 'trusting',    unlock: ['greet', 'sit_closer', 'trick'] },
  { bond: 80, level: 4, id: 'bonded',      unlock: ['greet', 'sit_closer', 'trick', 'name'] },
];

const MILESTONE_SAY = {
  acquainted: ['...이름이 뭐였더라.', '뭐, 얼굴은 익혔어.', '슬슬 알 것 같아.'],
  familiar:   ['이제 좀 친해진 것 같네.', '너 오면 반갑긴 해.', '단골 집사로 인정.'],
  trusting:   ['...너한테는 보여줄게. 봐봐!', '믿어도 될 것 같아.', '특별히 재주 하나.'],
  bonded:     ['우린 이제 한 팀이야.', '...너라서 다행이야.', '평생 집사 확정.'],
};

// 유대 단계별 인사 / greeting lines when the user returns (trust>=1).
const GREET_SAY = {
  1: ['...왔어?', '음, 너구나.', '안녕은 무슨.'],
  2: ['왔구나!', '기다린 건 아니고.', '어서 와.'],
  3: ['보고 싶었어!', '왔어왔어!', '오늘도 반가워.'],
  4: ['내 사람 왔다!', '제일 좋아하는 집사!', '어서 와, 보고 싶었어.'],
};

// ─────────────────────────────────────────────────────────────────────────────
// 팩토리 / factory
// ─────────────────────────────────────────────────────────────────────────────

export function createDirector() {
  let S;

  function freshState() {
    return {
      // ── 영구(저장) / persisted ──
      trust: 0,                 // 0..4 perceivable level, monotonic unlock memory
      unlocked: {},             // { greet:true, sit_closer:true, ... }
      milestoneSeen: {},        // { acquainted:true, ... } so we announce once
      petName: null,            // C6 "learns its name" placeholder (host may set)
      ageDays: 0,               // rough age in days the rat has been "alive"
      bornMs: null,             // first-seen wall clock ms

      // ── 세션/연출(휘발) / volatile session ──
      lastSeenMs: null,         // wall clock at last frame (for return detection)
      greetedThisSession: false,
      phase: 'day',
      phaseActionDone: {},      // { 'morning|2026-06-03': true } once-per-phase-per-day
      lastPhaseKey: null,

      // play state machine
      play: 'off',              // off | chase | pounce | cooldown
      playT: 0,                 // time in current play sub-state
      playCd: 0,                // cooldown before play can re-arm
      wiggle: 0,                // accumulated cursor "wiggle energy"
      pounceSaid: false,

      // thought-bubble pacing
      thoughtCd: rand(20, 40),

      // milestone announce queue
      pendingMilestone: null,

      // greet pacing
      awayT: 0,                 // seconds cursor has been absent
    };
  }

  S = freshState();

  // ── 저장/복원 / persistence ────────────────────────────────────────────────
  function load(saved) {
    try {
      if (!saved || typeof saved !== 'object') return;
      S.trust = clamp(num(saved.trust, 0), 0, 4) | 0;
      if (saved.unlocked && typeof saved.unlocked === 'object') {
        for (const k in saved.unlocked) if (saved.unlocked[k]) S.unlocked[k] = true;
      }
      if (saved.milestoneSeen && typeof saved.milestoneSeen === 'object') {
        for (const k in saved.milestoneSeen) if (saved.milestoneSeen[k]) S.milestoneSeen[k] = true;
      }
      if (typeof saved.petName === 'string') S.petName = saved.petName.slice(0, 24);
      S.ageDays = clamp(num(saved.ageDays, 0), 0, 100000);
      S.bornMs = num(saved.bornMs, null);
    } catch (e) { /* ignore corrupt save */ }
  }

  function serialize() {
    try {
      return {
        v: 1,
        trust: clamp(num(S.trust, 0), 0, 4) | 0,
        unlocked: { ...S.unlocked },
        milestoneSeen: { ...S.milestoneSeen },
        petName: S.petName || null,
        ageDays: clamp(num(S.ageDays, 0), 0, 100000),
        bornMs: num(S.bornMs, null),
      };
    } catch (e) {
      return { v: 1, trust: 0, unlocked: {}, milestoneSeen: {}, petName: null, ageDays: 0, bornMs: null };
    }
  }

  // 호스트가 이름을 지어줄 때 / host can name the rat once 'name' is unlocked.
  function setName(name) {
    try {
      if (S.unlocked.name && typeof name === 'string' && name.trim()) {
        S.petName = name.trim().slice(0, 24);
        return true;
      }
    } catch (e) {}
    return false;
  }

  // ── (A2) 먹이 반응 / one-shot when a feed completes ─────────────────────────
  // 호스트는 trash 결과로 paths + totalBytes를 알 수 있다(app.js runEat gulp).
  function onFeed(info) {
    try {
      const i = info || {};
      const paths = Array.isArray(i.paths) ? i.paths : [];
      const bytes = num(i.totalBytes, 0);
      let cat = paths.length ? classifyExt(paths[0]) : 'unknown';
      // 여러 파일을 한 번에 → 카테고리가 섞이면 archive 느낌으로 / mixed = archive vibe.
      if (paths.length > 1) {
        let mixed = false;
        const first = classifyExt(paths[0]);
        for (let k = 1; k < paths.length; k++) {
          if (classifyExt(paths[k]) !== first) { mixed = true; break; }
        }
        if (mixed) cat = 'archive';
      }
      if (bytes >= HUGE_BYTES) cat = 'huge'; // 크기가 카테고리를 덮어씀 / size overrides
      const r = FEED_REACT[cat] || FEED_REACT.unknown;
      return { category: cat, say: pick(r.say), emote: r.emote, pose: r.pose };
    } catch (e) {
      return { category: 'unknown', say: null, emote: 'dots', pose: 'eatgrab' };
    }
  }

  // ── play 무력화 헬퍼 / clear play sub-state ─────────────────────────────────
  function endPlay(cd) {
    S.play = 'off';
    S.playT = 0;
    S.wiggle = 0;
    S.pounceSaid = false;
    S.playCd = num(cd, rand(6, 12));
  }

  // ── 출력 기본형 / blank output (all fields present) ─────────────────────────
  function blank() {
    return {
      pose: null,        // pose/state hint string (host maps; null = leave as-is)
      say: null,         // a line to speak (host: say(text))
      emote: null,       // floating emote key (same vocab as soul: spark/heart/note/sweat/anger/zzz/dots)
      special: null,     // higher-level special id (host may stage)
      action: null,      // discrete action: 'stretch'|'yawn'|'settle'|'trick'|'greet'|'pounce'|null
      window: null,      // optional window nudge { dx, dy } in px (host may apply)
      milestone: null,   // { id, level, unlock:[...], say } when one is reached, else null
      phase: S.phase,    // current day phase string
      trust: S.trust,    // current trust level 0..4
      playing: S.play !== 'off',
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 메인 업데이트 / main per-frame update. Never throws.
  // ─────────────────────────────────────────────────────────────────────────
  function update(dt, ctx) {
    try {
      let d = clamp(num(dt, 0.016), 0, 0.1);
      const c = ctx || {};
      const out = blank();

      const stats = c.stats || {};
      const energy = clamp(num(stats.energy, 100), 0, 100);
      const mood = str(c.mood) || 'content';
      const bond = clamp(num(c.bond, 25), 0, 100);
      const state = str(c.state) || 'idle';
      const posture = str(c.posture) || 'sit';
      const activity = str(c.activity) || 'lounge';
      const held = !!c.held;
      const dragActive = !!c.dragActive;

      const cur = c.cursor || {};
      const cx = num(cur.x, -9999);
      const cy = num(cur.y, -9999);
      const cInside = !!cur.inside;
      const cvx = num(cur.vx, 0);
      const cvy = num(cur.vy, 0);
      const body = c.bodyScreen || {};
      const bx = num(body.x, 0);
      const by = num(body.y, 0);

      const clk = num(c.clockMs, S.lastSeenMs == null ? 0 : S.lastSeenMs);

      // ── age / birth bookkeeping ──────────────────────────────────────────
      if (S.bornMs == null && clk > 0) S.bornMs = clk;
      if (S.bornMs != null && clk > 0) {
        const days = (clk - S.bornMs) / 86400000;
        if (days > S.ageDays) S.ageDays = days; // monotonic, real elapsed days
      }
      out.ageDays = S.ageDays;

      // ── (B3) time-of-day phase ───────────────────────────────────────────
      const hour = clk > 0 ? new Date(clk).getHours() : 12;
      const dayKey = clk > 0 ? new Date(clk).toISOString().slice(0, 10) : 'na';
      const phase = phaseFor(hour);
      S.phase = phase;
      out.phase = phase;

      // ── return / greet detection ─────────────────────────────────────────
      // cursor absent → away timer grows; on return after a while, greet once.
      const present = cInside || cvx !== 0 || cvy !== 0 || dragActive;
      if (present) {
        if (S.awayT > 25 && !S.greetedThisSession && S.unlocked.greet && state === 'idle') {
          out.action = 'greet';
          out.say = pick(GREET_SAY[S.trust] || GREET_SAY[1]);
          out.emote = S.trust >= 3 ? 'heart' : null;
          S.greetedThisSession = true;
        }
        S.awayT = 0;
      } else {
        S.awayT += d;
        if (S.awayT > 120) S.greetedThisSession = false; // long absence re-arms greet
      }

      // ── timers ───────────────────────────────────────────────────────────
      S.playCd = Math.max(0, S.playCd - d);
      S.thoughtCd = Math.max(0, S.thoughtCd - d);
      S.lastSeenMs = clk;

      // wiggle energy decays; grows with cursor speed while near the rat.
      const near = cInside && Math.hypot(cx - bx, cy - by) < 220;
      const speed = Math.hypot(cvx, cvy); // px/frame
      if (near && !held && !dragActive) {
        S.wiggle = clamp(S.wiggle + (speed > 6 ? speed * 0.02 * d * 60 : -0.3 * d), 0, 6);
      } else {
        S.wiggle = clamp(S.wiggle - 1.2 * d, 0, 6);
      }

      // ── (A1) PLAY state machine ──────────────────────────────────────────
      // Only when otherwise idle/curious and not busy with eat/held/drag.
      const playAllowed = !held && !dragActive &&
        (state === 'idle' || state === 'curious') &&
        energy > 25;

      if (S.play === 'off') {
        if (playAllowed && S.playCd <= 0 && S.wiggle > 3.2) {
          S.play = 'chase';
          S.playT = 0;
          S.pounceSaid = false;
        }
      } else if (!playAllowed && S.play !== 'cooldown') {
        endPlay(rand(4, 8));
      }

      if (S.play === 'chase') {
        S.playT += d;
        out.pose = 'play';
        out.special = 'play_chase';
        out.playing = true;
        // nudge the window a little toward the cursor so it "chases".
        const dx = cx - bx, dy = cy - by;
        const dd = Math.hypot(dx, dy) || 1;
        if (dd > 90) {
          const step = clamp(140 * d, 0, 12); // gentle, px/frame
          out.window = { dx: (dx / dd) * step, dy: (dy / dd) * step * 0.5 };
        } else {
          // close enough → pounce.
          S.play = 'pounce';
          S.playT = 0;
        }
        // occasional play chatter
        if (S.playT > 0.8 && Math.random() < 0.5 * d) out.say = pick(PLAY_SAY);
        // give up if the cursor goes still or wanders off
        if (speed < 2) S.wiggle = clamp(S.wiggle - 1.5 * d, 0, 6);
        if (S.wiggle < 1 || !near || S.playT > 8) endPlay(rand(5, 10));
      } else if (S.play === 'pounce') {
        S.playT += d;
        out.pose = 'pounce';
        out.action = 'pounce';
        out.special = 'play_pounce';
        out.playing = true;
        if (!S.pounceSaid) { out.say = pick(PLAY_POUNCE_SAY); out.emote = 'spark'; S.pounceSaid = true; }
        if (S.playT > 0.5) {
          // back to chasing if cursor still near & moving, else wind down.
          if (near && speed > 4 && S.wiggle > 1.5) { S.play = 'chase'; S.playT = 0; S.pounceSaid = false; }
          else endPlay(rand(6, 12));
        }
      }

      // ── (B3) once-per-phase staged action (only when idle & not playing) ──
      if (!out.action && S.play === 'off' && state === 'idle' && !held) {
        if (S.lastPhaseKey !== phase) {
          const pk = phase + '|' + dayKey;
          const act = PHASE_ACTION[phase];
          if (act && !S.phaseActionDone[pk]) {
            S.phaseActionDone[pk] = true;
            S.lastPhaseKey = phase;
            out.action = act;                       // 'stretch' | 'yawn' | 'settle'
            out.pose = act === 'stretch' ? 'stretch' : (act === 'settle' ? 'curl' : null);
            if (Math.random() < 0.8) out.say = pick(PHASE_GREET[phase]);
            // prune yesterday's keys cheaply
            for (const k in S.phaseActionDone) {
              if (k.indexOf(dayKey) === -1) delete S.phaseActionDone[k];
            }
          } else {
            S.lastPhaseKey = phase;
          }
        }
      }

      // ── (C6) bond milestones ─────────────────────────────────────────────
      // Walk thresholds; unlock anything bond now qualifies for; announce once.
      for (const m of MILESTONES) {
        if (bond >= m.bond && !S.milestoneSeen[m.id]) {
          S.milestoneSeen[m.id] = true;
          if (m.level > S.trust) S.trust = m.level;     // trust rises, never falls
          for (const u of m.unlock) S.unlocked[u] = true;
          S.pendingMilestone = {
            id: m.id, level: m.level, unlock: m.unlock.slice(),
            say: pick(MILESTONE_SAY[m.id]),
          };
        }
      }
      out.trust = S.trust;
      // surface a queued milestone when the moment is calm (not mid-eat/play).
      if (S.pendingMilestone && !out.action && S.play === 'off' &&
          (state === 'idle' || state === 'curious') && !held) {
        out.milestone = S.pendingMilestone;
        if (!out.say) out.say = S.pendingMilestone.say;
        out.emote = out.emote || 'heart';
        S.pendingMilestone = null;
      }

      // ── (C6) trust-gated trick: very rarely, an idle "show off" when bonded ──
      if (!out.action && S.play === 'off' && S.unlocked.trick &&
          state === 'idle' && !held && (mood === 'playful' || mood === 'smug')) {
        if (Math.random() < 0.0025 * d * 60) {
          out.action = 'trick';
          out.special = 'show_trick';
          out.pose = 'dance';
          out.emote = 'spark';
        }
      }

      // ── (B4) thought bubbles — idle musings (low priority, no spam) ───────
      if (!out.say && S.play === 'off' && S.thoughtCd <= 0 && !held && !dragActive &&
          (state === 'idle') &&
          (posture === 'sit' || posture === 'lie' || activity === 'lounge' || activity === 'lie')) {
        if (Math.random() < 0.5) {
          out.say = pickThought(mood, bond, phase);
          // emote: a faint "…" sometimes for a pensive beat.
          if (!out.emote && Math.random() < 0.15) out.emote = 'dots';
        }
        S.thoughtCd = rand(28, 55); // thoughts are sparse
      }

      out.playing = S.play !== 'off';
      return out;
    } catch (e) {
      const o = blank();
      return o;
    }
  }

  // bond tier + mood + phase 풀에서 생각 한 줄 / pick an idle thought.
  function pickThought(mood, bond, phase) {
    const pools = [];
    const tier = bond >= 66 ? 'bondHigh' : bond >= 36 ? 'bondMid' : 'bondLow';
    if (THOUGHTS[tier]) pools.push(THOUGHTS[tier]);
    if (THOUGHTS[mood]) pools.push(THOUGHTS[mood]);
    if (THOUGHTS[phase]) pools.push(THOUGHTS[phase]);
    const pool = pools.length ? pools[(Math.random() * pools.length) | 0] : THOUGHTS.content;
    const line = pick(pool);
    // 이름을 알면 가끔 이름을 섞은 따뜻한 생각 / occasionally weave in a name.
    if (line && S.petName && bond >= 66 && Math.random() < 0.15) {
      return line; // (이름 연출은 호스트가 GREET 등에 쓰면 충분) keep musing clean
    }
    return line;
  }

  function reset() {
    S = freshState();
  }

  return { load, serialize, setName, onFeed, update, reset };
}
