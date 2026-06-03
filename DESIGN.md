# Desk Rat — 속마음 설계 (Inner Life Design)

> 시크하지만 정 많은 책상 쥐. 스탯 바가 아니라 "성격 있는 생물"로 느껴지게.
> A chic rat with an inner life — personality, moods, a bond it actually keeps,
> a short memory that holds tiny grudges, and a director that throws little
> spontaneous "moments" so it feels like it has a will of its own.

이 문서는 `renderer/personality.js`(순수 로직 영혼 모듈)의 모델과, 호스트(app.js)가
플러그인해야 할 **느린 스탯 감쇠 상수**, 그리고 통합 방법을 설명한다.

---

## 1. 개념 / Concept

`life.js`는 "**무엇을** 하는가"(lounge/wander/nap/zoomies …)를 정한다.
`personality.js`는 "**어떤 마음으로** 하는가"를 정한다 — 같은 '눕기'라도 만족해서 눕는
것과 삐져서 돌아눕는 것은 다르다. 두 레이어는 독립이며, personality는 life 위에 얹혀
표정(expr) 편향, 가끔의 한마디(say), 떠다니는 기호(emote), 그리고 한 번씩 터지는
특별한 순간(special)을 더한다. life에는 강제가 아닌 **약한 제안**(prefer)만 흘린다.

핵심 정서 모델은 **valence(유쾌함, -1..1) × arousal(각성도, 0..1)** 2축이다. 이 부드러운
좌표를 사람이 읽는 무드 라벨로 매핑하고, 라벨에서 표정/말투/특별행동을 끌어낸다.

---

## 2. 성격 / Personality (TRAITS)

첫 실행 때 한 번 시드되어 **영구 저장**되는 5개 특성(각 0..1, 0.05~0.95로 클램프, 0.5 중심 ±0.32):

| trait | 의미 | 영향 |
|---|---|---|
| `sass` | 시크함/말대꾸 | 긍정 정서를 겉으로 덜 드러냄(understated), 잡담이 조금 더 잦음 |
| `clinginess` | 외로움 잘 탐 | 무시당하면 더 빨리 `demand_attention` 발동(임계 30~75초) |
| `laziness` | 게으름 | 기본 각성도↓, 가끔 `lie` 제안 |
| `curiosity` | 호기심 | 커서/드래그에 각성↑, `stare`/`tease_back` 확률↑ |
| `gluttony` | 식탐 | 먹이 시 기분 상승 폭↑, 포만 여운 가중치↑ |

특성은 모든 것에 "색"을 입힌다 — 같은 상황도 개체마다 반응이 다르게 느껴진다.

---

## 3. 무드 / Mood

목표 valence·arousal을 매 프레임 합성한 뒤(시상수 평활, valence τ≈2.5s / arousal τ≈2.0s),
좌표를 라벨로 분류한다. **부드럽게** 변하고 깜빡이지 않게 히스테리시스를 넣었다.

**목표 정서 합성 요소:** 호스트 affection 스탯, bond, hunger(배고프면↓), energy(지치면↓),
최근 기억(mGood/mFood +, mBad −), 느린 랜덤 드리프트(8~18초마다 새 목표), 특성 보정.

**9개 무드와 표정 편향(expr) 요약:**

| mood | 언제 | 표정 경향 |
|---|---|---|
| `content` | 평온한 중립 | 살짝 귀 쫑긋, 잔잔한 꼬리 |
| `affectionate` | 유쾌 + 유대 충분(+커서 근처) | 눈 반쯤·귀 앞으로·꼬리 살랑 |
| `playful` | 유쾌 + 높은 각성 | 눈 크게·귀 쫑긋·꼬리 크게 빠르게 |
| `smug` | 큰 끼니 직후 포만 여운 | 눈 가늘게·눈썹 으쓱(−) |
| `curious` | 중립 + 높은 각성(커서/드래그) | 눈 크게·귀 활짝·눈썹↑ |
| `bored` | 중립 + 낮은 각성, 배 안 고픔 | 눈/귀 축 처짐 |
| `sleepy` | energy < 25 | 눈 거의 감김·귀 처짐 |
| `grumpy` | 나쁜 기억 큼 | 귀 뒤로·눈썹 찡그림(−)·꼬리 탁탁 |
| `sulky` | 연속 찌르기 후 삐짐 | 귀 뒤로 많이·눈 가늘게·꼬리 죽음 |

`expr` 값은 호스트 기본 포즈에 **더하는 작은 편향**이다(τ≈0.6s로 부드럽게 추적). 0이 기본.

---

## 4. 유대 / Bond (EGO)

지속되는 관계 수치(0..100, 처음 25 — 서먹). 좋은 대접에 오르고 방치/괴롭힘에 내린다.

| 이벤트 | bond Δ |
|---|---|
| pet | +0.6 |
| feed (작은 끼니) | +0.4 / (20MB+ 큰 끼니) +0.9 |
| dance (함께 춤) | +1.0 |
| poke | −0.8 |

**bond 단계가 말투를 바꾼다:** Low(<36) 아예 서먹/경계, Mid(36~66) 익숙함, High(≥66)
시크하지만 따뜻함("…너라서 봐주는 거야"). bond는 affectionate 무드의 진입 조건이기도 하다
(bond<35면 affectionate 대신 content로 강등).

### 최근 기억 / Memory window
이벤트는 즉시 3개의 "여운" 변수에 흔적을 남기고 시간에 따라 0으로 감쇠한다:
- `mGood` (좋은 손길) τ≈25s
- `mBad` (grudge, 조금 더 오래) τ≈30s
- `mFood` (포만 여운) τ≈40s

덕분에 찌른 직후엔 잠깐 삐쳐 있고(grudge), 쓰다듬으면 grudge가 풀리며 서서히 데워진다.

---

## 5. 이벤트 반응 / Event reactions

`event(type, payload)` — `'pet' | 'poke' | 'feed'(payload=MB) | 'drag' | 'dance' | 'ignore' | 'wake'`.
즉시 bond/기억을 갱신하고, 다음 프레임에 띄울 special/대사/emote를 예약한다.

- **pet** → mGood↑, mBad 살짝 풂, bond↑. 화 안 났으면 `heart` emote.
- **poke** → mBad↑, bond↓, 6초 내 연속이면 streak 누적. `anger` emote. **streak≥3 → `sulk_turn`**.
- **feed(MB)** → 포만 여운(20MB+면 "큰 끼니"). 큰 끼니면 **`happy_wiggle`** + bond 더↑.
- **drag** (파일 흔들기) → 호기심 자극. 확률적으로 **`tease_back`**(약올리듯 받아치기), 아니면 `dots`.
- **dance** → 강한 긍정, bond 최대 상승, `note` emote + 함께 춤 대사.
- **wake** (자다 깨움) → 약간 짜증(mBad 소량).
- **ignore** (선택) → 외로움 누적 가속. (보통은 update가 자동 누적하므로 호출 불필요.)

> 사용자 반응형 special(sulk_turn/happy_wiggle/tease_back 등)은 ambient 쿨다운을 우회해
> **즉각** 뜬다. 단, 각 special의 개별 게이트로 도배는 막는다.

---

## 6. 특별한 순간 / Special moments (the "alive" director)

희소하게(개별 게이트 + ambient 쿨다운 6~10s) 터져서 "자기 의지가 있는" 느낌을 준다.

| id | 트리거 | 게이트 | 호스트 반응 제안 |
|---|---|---|---|
| `demand_attention` | 너무 오래 무시(clinginess에 따라 30~75초) | 40~70s | 화면 쪽 보며 칭얼, 콩콩 / `dots` |
| `sulk_turn` | 연속 3회+ 찌르기, 또는 sulky 무드 중 가끔 | 25~45s | 등 돌려 앉기, 무반응 / `anger` |
| `happy_wiggle` | 큰 끼니 직후, 또는 아주 행복(valence>0.6 & arousal>0.7) | 20~40s | 으쓱 엉덩이 흔들 / `spark`. prefer=`zoomies` 동반 가능 |
| `stare` | 커서 가까이 + 한가(lounge/lie/groom) | 30~55s | 사용자를 빤히 응시 |
| `tease_back` | 파일을 흔들 때(drag) 확률적 | 18~35s | 같이 장난, 받아치기 / `spark` |

`special`은 매 프레임 대부분 null이며 한 번에 하나만 나온다.

---

## 7. 목소리 / Voice

짧고 건조하고 시크/위트 있는 한국어 한 줄. 무드 풀 + 유대 단계 풀 + 이벤트 반응 풀을
섞어 쓰고, 내부 쿨다운(say 기본 8~18초, 무드/상황별 가변)으로 **절대 도배하지 않는다**.

> 예: '흥, 이제 왔어?', '...귀찮게 하지 마.', '오늘은 좀 봐줄게.', '나 여기 있는데.',
> '...너라서 봐주는 거야.', '배부르다... 후훗.'

각 풀은 4개 안팎으로 충분히 다양하게 준비. sass가 높으면 잡담 확률이 조금 더 높다.

---

## 8. 느린 스탯 감쇠 상수 / SLOW stat-decay constants  ★호스트가 플러그인★

현재 `app.js tickStats()`는 스탯이 **수 초~수 분**에 다 닳는다(예: hunger 0.45/s → 약 3.7분에
0→100). 살아있는 펫은 **수십 분** 단위로 천천히 변해야 자연스럽다. 아래 상수로 교체 권장.

| 스탯 | 현재 | **권장(느림)** | 근거(완주 시간) |
|---|---|---|---|
| hunger 상승 | `+dt*0.45` | **`+dt*0.040`** | 0→100 ≈ **41.7분** (목표 30~45분대) |
| energy 평상 소모 | `-dt*0.25` | **`-dt*0.030`** | 100→0 ≈ 55분(가만히 있어도 아주 천천히) |
| energy 활동(walk) | `eRate=1` | **`eRate=0.040`** | 활동만 하면 ≈42분에 소진(40~60분 목표) |
| energy 줌미스(walk+zoomies) | `eRate=4` | **`eRate=0.12`** | 격렬해서 빨리 닳지만 여전히 분 단위 |
| energy 댄스 | `eRate=6` | **`eRate=0.20`** | 가장 빠른 소모(짧게 추므로 OK) |
| energy 낮잠 회복(sleep) | `eRate=-9`(즉 +9/s) | **`eRate=-0.55`** (= +0.55/s) | 0→100 회복 ≈ **3분**(낮잠은 수 분이면 충분) |
| affection 중립 드리프트 | `*(55-aff)*dt*0.01` | **`*(55-aff)*dt*0.0015`** | 시상수 ≈11분, 아주 잔잔하게 중립으로 |
| weight 감소(슬림) | `-dt*0.12` | **`-dt*0.010`** | 100→0 ≈ 2.8시간, 살은 천천히 빠짐 |

**먹이 시 즉발 변화는 그대로 둬도 됨**(이벤트라 시간 감쇠와 무관):
`hunger -= 25 + mb*0.4`, `weight += portion*40`, `affection += 3`.

> 요지: 평상 감쇠는 **분당 ~1~2.5포인트** 수준으로 낮춘다. 그래야 personality의 무드가
> 스탯 급변에 휘둘리지 않고, 사용자가 한참 자리를 비워도 쥐가 "서서히" 배고파지고 졸려진다.
> 낮잠 회복만 예외적으로 빠르게(수 분) 둬서 nap이 의미 있게 동작하도록 한다.

---

## 9. 호스트 통합 / Integration (app.js)

```js
import { createPersonality } from './personality.js';
const soul = createPersonality();

// 1) 부팅 시 복원 / restore on boot
try { soul.load(JSON.parse(localStorage.getItem('deskrat.soul'))); } catch {}

// 2) 상호작용 때 event() 호출 / call on interactions
//    pet(우클릭)·poke(좌클릭)·feed(먹기 완료, MB 전달)·drag(파일 드래그 시작)
//    ·dance(더블클릭/트레이/자발 댄스)·wake(낮잠 중 강제로 깨움)
soul.event('pet');
soul.event('feed', fileMB);

// 3) 매 프레임 update() — life.update() 호출 직후가 좋다(activity를 넘기려고)
const dir = soul.update(dt, {
  stats,                         // {hunger,affection,energy,weight}
  cursorNear, dragActive, busy,  // 불리언
  activity: curActivity,         // life가 정한 현재 활동 문자열
  clockMs: performance.now(),    // 단조 증가 ms (Date.now 대신; 모듈은 dt로만 계산)
});

// 4) expr 적용: 기본 포즈 위에 "더한다"(작은 편향)
target.eyeOpen += dir.expr.eyeOpen;     // 등 — 각자의 베이스에 가산
target.earPerk += dir.expr.earPerk;
// tailAmp/tailSpeed는 꼬리 흔들기 진폭/속도에 가산, browTilt는 눈썹 기울기

// 5) say / emote — life의 것과 동일 채널 재사용
if (dir.say) say(dir.say, 1.6);
if (dir.emote) {
  const map = { spark:['note','✨'], heart:['note','💗'], note:['note','♪'],
                sweat:['z','💦'], anger:['z','💢'], zzz:['z','💤'], dots:['z','…'] };
  const e = map[dir.emote]; if (e) spawnFloat(e[0], e[1]);
}

// 6) special — 한 번씩 호스트가 연출(선택적, 모르는 id는 무시)
switch (dir.special) {
  case 'demand_attention': /* 화면 쪽 보며 콩콩 */ break;
  case 'sulk_turn':        /* 등 돌려 앉기 */ break;
  case 'happy_wiggle':     /* 으쓱 흔들기, 원하면 zoomies로 */ break;
  case 'stare':            /* 사용자 응시 */ break;
  case 'tease_back':       /* 같이 장난 */ break;
}

// 7) prefer — life에 줄 약한 힌트(강제 아님, 무시 가능)
//    'wander'|'lie'|'groom'|'nap'|'zoomies'|'dance'|'sulk'|'play'|null
//    예: dir.prefer==='nap'이면 life의 nap 진입 임계를 살짝 낮추는 식.

// 8) 주기적으로 저장 / persist periodically (stats 저장과 함께)
localStorage.setItem('deskrat.soul', JSON.stringify(soul.serialize()));
```

**적용 순서 권장:** `runLife(dt)`로 activity 확정 → `soul.update(dt, {…, activity})` →
expr 가산/say/emote/special/prefer 반영. soul은 절대 throw하지 않고 모든 필드를 항상 채워
주므로 방어 코드 없이 바로 써도 안전하다.

---

## 10. 견고성 / Robustness
- 어떤 입력에도 throw하지 않음(20만 프레임 + NaN/null 퍼징 검증, bad-field 0).
- 모든 directive 필드 항상 present, valence∈[-1,1] / arousal∈[0,1] / expr 전부 유한수.
- 시간은 `dt`로만 계산(clockMs는 참고용) → 결정 친화적, Date.now 미사용.
- say/emote/special 모두 내부 쿨다운으로 희소 → 스팸 없음.
- `load()`는 손상/누락 저장 데이터를 무시하고 새 성격을 유지.
