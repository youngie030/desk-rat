# 데스크톱 펫(Desk Rat) 제작 비법 — 인수인계 플레이북

> 이 문서는 "바탕화면에 사는 3D 쥐(데스크톱 펫)" 프로젝트를 만들며 얻은 **모든 노하우·함정·검증 기법**을 한 파일로 정리한 것입니다.
> 비슷한 프로젝트(Electron + Three.js 데스크톱 펫/캐릭터)를 진행하는 다른 세션이 **삽질을 반복하지 않도록** 만들었습니다.
> 결과물(github.com/youngie030/desk-rat)이 완벽하진 않지만, 여기 적힌 함정만 피해도 시간을 크게 아낍니다.

---

## 0. 한 줄 요약 / 가장 중요한 것 3가지

1. **서브에이전트는 화면을 못 본다.** 스크린샷·레퍼런스 이미지를 볼 수 있는 건 메인 루프(나)뿐. → 시각 검수는 직접, 서브에이전트는 "수치/로직 두뇌"로.
2. **검증은 PowerShell 스크린샷 루프로 한다.** (8장이 이 문서의 핵심. 거의 그대로 복붙 가능)
3. **`Math.sin(절대시간 × 가변rate)`는 떨림 버그를 만든다.** 위상 누적기를 써라. (4장)

---

## 1. 아키텍처 개요

```
Electron(메인) ── 투명·항상위·프레임없는 오버레이 창
   │  main.js      : 창 생성, 글로벌 커서 폴링, 휴지통 이동, 창 이동(배회), 트레이
   │  preload.js   : contextBridge 안전 IPC (파일경로 해석, trash, 커서, moveWindow)
   └─ renderer/ (브라우저 컨텍스트)
        index.html        : 투명 캔버스 + 말풍선/스탯 패널 DOM
        app.js            : Three.js 씬 + 상태머신 + 포즈 컨트롤러 + 인터랙션
        rat.js            : 절차적 로우폴리 쥐 모델 (스키닝 없이 그룹 계층 리깅)
        life.js           : 자율 행동 두뇌 (배회/눕기/낮잠/그루밍/줌미스) — 순수 로직
        personality.js    : 성격/기분/유대(soul) — 순수 로직
        director.js       : 상위 "살아있음" 디렉터 (놀이/파일종류반응/시간대/마일스톤) — 순수 로직
        vendor/three.module.js
```

핵심 설계 원칙:
- **렌더링(app.js/rat.js)과 "두뇌"(life/personality/director)를 분리.** 두뇌는 순수 로직(no THREE/DOM/Node, `Math.random`만)이라 서브에이전트가 작성·검증하기 좋고, 안정적.
- 두뇌는 매 프레임 `update(dt, ctx)` → "지금 뭘 해야 하는가" 객체 반환. app.js가 그걸 포즈/창이동/대사로 번역.

---

## 2. 데스크톱 펫 "플랫폼" 비법 (Electron)

### 2.1 투명·항상위·클릭스루 오버레이 창
```js
win = new BrowserWindow({
  width: 480, height: 520, x, y,
  frame: false, transparent: true, resizable: false, movable: false,
  skipTaskbar: true, alwaysOnTop: true, hasShadow: false, focusable: true,
  webPreferences: { preload, contextIsolation: true, nodeIntegration: false },
});
win.setAlwaysOnTop(true, 'screen-saver');           // 다른 창 위로
win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
win.setIgnoreMouseEvents(true, { forward: true });  // 기본 클릭스루
```

### 2.2 ★클릭스루 토글은 "메인 프로세스의 글로벌 커서 폴링"으로 한다 (가장 중요한 트릭)
DOM 마우스 이벤트로 클릭스루를 토글하면 **OS 드래그앤드롭 중에는 이벤트가 안 와서** 드롭이 안 먹는다.
대신 메인에서 16ms마다 `screen.getCursorScreenPoint()`로 커서를 추적하고, 렌더러가 알려준 "쥐 실루엣 원(중심+반지름)" 안에 있으면 `setIgnoreMouseEvents(false)`로 켠다. 이러면 **OS 파일 드래그 도중에도** 커서가 쥐 위로 오면 창이 인터랙티브가 되어 드롭이 정상 처리된다.
```js
setInterval(() => {
  const pt = screen.getCursorScreenPoint();
  const b = win.getBounds();
  const dx = pt.x - b.x - ratRegion.cx, dy = pt.y - b.y - ratRegion.cy;
  const inside = ratRegion.r > 0 && dx*dx + dy*dy <= ratRegion.r*ratRegion.r;
  if (inside && !interactive) { win.setIgnoreMouseEvents(false); interactive = true; }
  else if (!inside && interactive) { win.setIgnoreMouseEvents(true, { forward: true }); interactive = false; }
  win.webContents.send('cursor', { x: pt.x-b.x, y: pt.y-b.y, inside, w: b.width, h: b.height,
    wx: b.x, wy: b.y, /* + 작업영역 sx,sy,sw,sh */ });
}, 16);
```
렌더러는 매 프레임 쥐 몸 중심을 화면좌표로 투영해 `reportRegion({cx,cy,r})`로 보고. (들고 있을 땐 r을 크게 잡아 커서가 빠져나가 mouseup을 놓치지 않게.)

### 2.3 ★파일 → 휴지통: `shell.trashItem()` 을 써라 (PowerShell 쓰지 마라)
처음에 PowerShell `DeleteFile($args[0],...)`로 했다가 **두 번 실패**함:
- `-Command`에 경로를 `$args[0]`로 넘기면 파싱 에러(UnexpectedToken).
- 한글 경로(`C:\Users\사용자\...`)가 콘솔 코드페이지에서 깨짐.

해결: Electron 내장 **`shell.trashItem(filePath)`** — 유니코드 안전, 의존성 0, 진짜 휴지통으로 감.
```js
ipcMain.handle('trash-file', async (_e, filePath) => {
  let size = 0;
  try { const st = fs.statSync(filePath); size = st.isDirectory() ? dirSize(filePath) : st.size; }
  catch (err) { return { ok:false, error:err.message }; }
  try { await shell.trashItem(filePath); return { ok:true, size }; }
  catch (err) { return { ok:false, error:err.message, size }; }
});
```
(만약 굳이 PowerShell이 필요하면 경로를 스크립트에 직접 임베드 후 `-EncodedCommand`(UTF-16LE base64)로 넘겨라. 절대 `$args`+`-Command` 조합 쓰지 말 것.)

### 2.4 드롭된 파일의 실제 경로: preload의 `webUtils.getPathForFile`
Electron 32+부터 `File.path`가 제거됨. preload에서:
```js
const { webUtils } = require('electron');
contextBridge.exposeInMainWorld('deskrat', {
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
  ...
});
```
렌더러 drop 핸들러는 **반드시 try/catch + 빈 경로 필터**. (휴지통에서 파일을 복구하려 드래그하면 가상 항목이 와서 깨질 수 있음.)

### 2.5 창이 화면을 "걸어다니게" 하기 (배회)
배회 = 창 자체를 이동. `move-window` IPC로 메인이 `win.setPosition`. **좌표 NaN 가드 필수**(안 하면 크래시).
```js
ipcMain.on('move-window', (_e, pos) => {
  if (!win || win.isDestroyed()) return;
  if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return; // ★NaN 가드
  const wa = screen.getPrimaryDisplay().workArea, b = win.getBounds();
  const x = Math.round(Math.max(wa.x, Math.min(wa.x+wa.width-b.width, pos.x)));
  const y = Math.round(Math.max(wa.y, Math.min(wa.y+wa.height-b.height, pos.y)));
  try { win.setPosition(x, y); } catch {}
});
```
배회 목표는 작업영역 **바닥 밴드(아래 25%)** 로 치우치게 잡아야 "바닥을 걷는" 느낌. (life.js가 담당)

### 2.6 마우스로 집어 옮기기(뒷목 잡기)
좌클릭 후 6px 이상 이동하면 "들기" 상태로 전환, 매 프레임 `moveWindow(커서 - 잡은오프셋)`로 창이 커서를 따라옴. 짧은 클릭=찌르기, 더블클릭=춤과 구분(클릭은 240ms 지연 후 발동, 더블클릭/드래그가 취소).

---

## 3. 절차적 3D 모델 (Three.js, 스키닝 없음)

### 3.1 리깅: 그룹 계층 + 이징되는 포즈 채널
스키닝/본 없이 **Group 계층**으로 관절을 만들고 회전/위치로 애니메이션.
```
root(전체) → bodyGroup → torso, belly, legL/R{knee}, armL/R{shoulder,elbow,paw},
                         neck → head → skull,snout,nose,jaw,eyeL/R{ball,lid},earL/R, tail/tailSegs[]
```
포즈는 **채널 기반**: `def`(기본값) → 매 프레임 상태머신이 `target.*` 설정 → `cur`를 `target`으로 이징 → `applyPose`에서 cur를 실제 관절에 적용 + 절차적 모션(호흡·꼬리·시선) 덧셈.
- 일시적 채널(rootY, rootRotZ, armSpread, squash, bodyYaw, groom...)은 매 프레임 상단에서 0으로 리셋 후 상태가 덮어쓴다. 안 그러면 이전 상태값이 남아 붙음.

### 3.2 ★원본(밈 "rrat") 닮게 만드는 비율 비법
모델링 자문 결과 핵심: **큰 머리 · 긴(but 적당히 둥근) 주둥이 · 가는 사지 · 낮은 배의 슬림 펀(pear)형 · 긴 꼬리.**
- 머리를 키워라(전체 키의 ~35~40%). 작은 머리가 제일 안 닮아 보이는 원인.
- 토르소는 LatheGeometry로 "낮은 배 펀형"(가장 넓은 곳을 아래로). 위는 가는 목으로.
- 사지는 가늘게. 단, 너무 가늘면 분리돼 보임(정강이 r≈0.082, 팔뚝 r≈0.066, 허벅지 r0.10이 하한).
- 눈은 **두개골 위가 아니라 주둥이 쪽으로 내려서** 박아라. 안 그러면 "공에 박힌 구슬".

### 3.3 ★"도형 붙인 느낌" 없애기 = 관절 블렌드 + 캡슐
초기엔 원기둥+구를 붙여 관절이 분리돼 보였다("도형 몇 개 붙인 것 같다"는 피드백). 해결:
- 사지를 **CapsuleGeometry**(둥근 끝)로.
- 모든 관절(어깨/엉덩이/목/꼬리밑)에 **블렌드 덩어리(작은 구)** 를 두고 사지 윗부분을 몸통에 **박아 넣기**. → 이음새가 가려져 "하나의 개체"로 읽힘.
- 단, 블렌드 덩어리가 크면 "어깨/허벅지가 너무 크다"는 피드백을 받음. 작게 + 몸 안쪽으로.
- **재질은 하나만 공유**(모든 부위 같은 fur material)해야 한 피부로 읽힘.

### 3.4 ★스무스 vs 플랫 셰이딩 — 레퍼런스를 봐라
- 처음엔 "GTA3처럼 각진 폴리곤" 요청 → `flatShading:true`.
- 그런데 더 정확한 레퍼런스 사진을 보니 **PS2 게임 모델은 Gouraud 스무스**였다(실루엣만 로우폴리). → **`flatShading:false`** 로 바꾼 게 싱크로율을 가장 크게 올린 단일 변경.
- 스무스로 바꾸면 일부 낮은 세그먼트가 각져 보이니, **머리·토르소·주둥이만 세그먼트 약간 상향**(토르소 14/두개골 12/주둥이 12/눈 10). 사지·꼬리는 그대로.
- `LatheGeometry/Sphere/Capsule/Cone`은 기본 스무스 노멀을 가짐 → `computeVertexNormals()` 불필요(직접 머지/수정한 지오메트리만 필요).

### 3.5 텍스처: 저해상도 캔버스 + 필터 선택
캔버스에 베이스색 + 무작위 얼룩(speckle)을 그려 `CanvasTexture`로. 필터가 룩을 좌우:
- `NearestFilter` = 레트로 픽셀(밈 *분위기*엔 맞지만 가까이서 사각 노이즈로 보임).
- `LinearFilter` = 매끈/부드러움(실제 게임모델의 소프트한 룩). **스무스 추구면 Linear.**
- speckle/density는 낮게(과하면 지저분). 색은 갈색 말고 **중성 회색**(레퍼런스가 회색빛).

### 3.6 등/배 명암: 정점 색(vertex color)
지오메트리 정점 위치(y/z)로 색 계수를 계산해 `setAttribute('color')`, 재질 `vertexColors:true`(텍스처에 곱해짐). 등(−z)·위쪽을 어둡게, 낮은 배를 밝게. 스무스 셰이딩이 이미 그라데이션을 주니 **대비는 약하게**(세면 줄무늬처럼 보임).

### 3.7 눈 하이라이트가 떠 보이는 문제
글린트(흰 점)를 **눈알의 자식**으로, 눈알 반지름 표면에 작게 배치 → 눈과 함께 움직여 붙어 보임. 글린트를 `emissive`로 주면 어두운 눈알 위에서 또렷이 살아있는 느낌(가장 싼 "생기" 업그레이드).

### 3.8 배(belly)는 별도 구 + fullness로 스케일
배를 살짝 밝은 밑색의 별도 구로 두고, "배부름(0..1)"에 따라 스케일↑. ★초기 버그: 배부름 배율을 과하게 줘서 배가 머리까지 삼킴. 현실적 배율(최대 ~1.3x)로.

---

## 4. ★★애니메이션 노하우 & 치명적 함정

### 4.1 떨림(tremble) 버그 #1: `sin(절대시간 × 가변rate)`
"왤케 떨어?"의 진짜 원인. 호흡/꼬리에서
```js
const breath = Math.sin(t * breathRate) * amp;   // ❌ t는 누적시간(수십·수백초), breathRate가 무드로 미세 변동
```
→ rate가 0.01만 바뀌어도 큰 t와 곱해져 **위상이 확 점프 → 매 프레임 화면이 떨림.**
해결: **위상 누적기**.
```js
breathPhase += breathRate * dt;                  // ✅ rate가 변해도 위상 연속
const breath = Math.sin(breathPhase) * amp;
```
꼬리 속도(`tailSpeed`)도 동일하게 `tailPhase += tSpd*dt`. **rate/speed가 런타임에 바뀌는 모든 sin은 누적기로.**

### 4.2 떨림 버그 #2: 언더댐프 스프링 + 진동성 타깃
"서보→근육" 느낌을 주려고 표현 채널에 스프링 오버슈트를 넣었더니 떨림. 두 가지 규칙:
- **스프링은 step 변화 채널에만**(bodyLean, armRaise, armSpread, bodyYaw). `rootY/squash/neckX`처럼 매 프레임 **고주파 sin 타깃**을 받는 채널을 스프링에 넣으면 공진→떨림.
- **거의 임계감쇠**로: `ζ≈1`. `damp ≈ 2*sqrt(stiff)`. (예: stiff 90 → damp 19.) 언더댐프(ζ<1)는 링잉.
```js
const SPRING = { bodyLean:1, armRaise:1, armSpread:1, bodyYaw:1 }; // 진동성 채널 제외
for (const key in target) {
  if (SPRING[key]) { const a=(target[key]-cur[key])*90 - (vel[key]||0)*19; vel[key]=(vel[key]||0)+a*dt; cur[key]+=vel[key]*dt; }
  else cur[key] = lerp(cur[key], target[key], 1 - Math.pow(0.001, dt));
}
```
- 꼬리 스프링 체인도 임계감쇠로(언더댐프면 끝이 떰).

### 4.3 떨림 정량 측정법 (객관적 검증)
눈으로 "떠는지"는 애매하니 **연속 프레임 픽셀차의 최소값**으로 판정. 쥐를 정지 상태(커서를 쥐 위에)로 두고 ~12쌍 측정:
- 최소값이 낮으면(<5) 상시 떨림 없음. 높은 일부 값은 깜빡임/숨쉬기 이벤트.
- 우리 케이스: 수정 전 MIN≈39(상시) → 수정 후 MIN≈2.9. (스크립트는 8.4 참고)

### 4.4 자연스러운 보행 사이클 (스키닝 없이)
- ★발 미끄러짐(skate)의 근본 원인: **보폭 위상(stepPhase)이 창 이동 속도와 무관**. → life.js에서 `cadence = speedPx / STRIDE_PX`(STRIDE_PX≈46px)로 **이동거리 1주기당 보폭 1회**가 되게.
- 발 plant: stance(접지) 구간은 다리를 **선형으로 뒤로 쓸기**(sawtooth)로 → 몸이 앞으로 가는 만큼 발이 뒤로 가 "바닥에 붙은" 듯. swing 구간만 무릎 들어 발 띄움.
- 무게이동: 발 디딜 때 몸이 살짝 가라앉고(roll/pitch), 머리는 토르소 롤/요를 **반대로 상쇄**(시선 안정).
- 빠를 땐(줌미스) duty↓·무릎 lift↑로 trot 느낌.
- 방향 전환: 역방향 감지 시 `turnT`로 잠깐 보행 멈추고 yaw만 회전(문워크 방지). `bodyYaw`는 `walkAmt`로 게이트(다리 램프와 함께 돌게).

### 4.5 2차 모션(살아있음의 핵심)
- **꼬리 follow-through**: 몸의 yaw/roll **속도**를 구동력으로, 세그먼트가 시차로 따라오는 스프링 체인. 끝 세그먼트일수록 처지게(catenary).
- **뱃살/귀 출렁임**: root의 수직 속도로 구동되는 작은 스프링 → 착지/홉에서 출렁.
- **호흡**: rate를 arousal에 연동 + 진폭 천천히 swell. 가끔 깊은 "한숨".
- **idle 미세동작**: 느린 무게이동(2차 하모닉 섞어 비반복), 주기적 킁킁(빠른 코 떨림), 한쪽 귀 플릭(샤프), 더블 블링크, "커서 훔쳐보고 시크하게 외면".
- **전환 앤티시페이션**: 춤 진입 시 살짝 웅크렸다 팔 펼치기, 먹기 grab을 이즈인.

### 4.6 결정적 포즈 캡처(검증용)
무드/포즈가 확률적이라 검증이 어려움 → **데모 투어 모드**(env로 켜고 포즈를 순환)를 만들고, 포즈가 바뀔 때 `console.log('POSE:xxx')` 마커를 찍어, 캡처 스크립트가 그 마커를 보고 +1.1s 후 캡처. (env 데모는 idle 단계에서 잠깐 배회하니 **창을 찾아 그 위치에서** 캡처할 것.)

---

## 5. "살아있는" 시스템 (다마고치)

### 5.1 스탯
- 4개: hunger/affection/energy/weight (0..100), `localStorage`에 저장.
- ★**감소율은 매우 느리게**(수십 분 단위). hunger +0.040/s(≈42분), energy idle −0.030/s(≈55분), 낮잠 회복 −0.55/s 등. 초 단위로 빠지면 "잠깐 자리 비웠는데 굶어죽음" → 컴플레인.
- ★hunger 의미 주의: **0=배부름/만족, 100=굶주림.** 패널은 "배고픔 바 = 100−hunger(=배부른 정도)"로 표시. "스탯 풀로" 요청 = hunger 0, affection 100, energy 100.

### 5.2 두뇌 모듈은 "순수 로직"으로 분리
`life.js`(저수준 활동), `personality.js`(성격/기분/유대), `director.js`(상위 디렉터: 놀이·파일종류반응·시간대·마일스톤). 모두:
- import/THREE/DOM/Node 없음, `Math.random`만, **절대 throw 안 함**(모든 입력 기본값 처리), `update(dt,ctx)`가 항상 완전한 객체 반환.
- 시간대 등 "벽시계"가 필요하면 **호스트가 `clockMs:Date.now()`를 ctx로 주입**(모듈이 직접 Date.now 호출 X — 결정성/테스트 위해).
- 호스트(app.js)는 출력을 포즈/창이동/말풍선/이모트로 번역. `say`는 `bubbleTimer<=0`일 때만 표시(인터랙션 대사 안 덮게).

### 5.3 성격이 "진짜 자아"처럼 느껴지게
- 첫 실행 때 성향(사스/게으름/호기심/식탐) 시드 → 저장. 성향이 모든 반응에 색을 입힘.
- 기분 9종은 valence×arousal로 부드럽게(τ 스무딩+히스테리시스, 깜빡이지 않게). **기분별 표정 바이어스(눈/귀/꼬리/눈썹기울기)를 충분히 다르게** 줘야 구분됨.
- 유대(bond) 영구 누적 + 단기 메모리(찌르면 잠깐 삐침, 쓰다듬으면 데워짐).
- 대사 풀은 **깊게(무드별 7~9개)** + **직전 대사 반복 방지(lastSay)** + 쿨다운. 4개 풀이면 금방 반복 들킴.

---

## 6. 견고성(크래시 방지)

### 6.1 ★휴지통 열면 쥐가 멈추던 버그 = WebGL 컨텍스트 손실
무거운 Explorer 창(휴지통)이 열릴 때 GPU 컨텍스트가 리셋되며 WebGL 컨텍스트가 날아가 렌더 루프가 영구 정지. 해결:
```js
let ctxLost = false;
canvas.addEventListener('webglcontextlost', (e)=>{ e.preventDefault(); ctxLost=true; }, false);
canvas.addEventListener('webglcontextrestored', ()=>{ ctxLost=false; }, false);
function frame(){ try { if(!ctxLost) frameBody(); } catch(err){ console.error(err); } requestAnimationFrame(frame); }
```
★교훈: **프레임 루프 본문은 try/catch로 감싸고, requestAnimationFrame은 무조건 호출.** 한 프레임이 throw해도 루프가 죽지 않게. (이거 안 하면 어떤 예외든 펫이 영구 정지.)
+ `window.addEventListener('error'/'unhandledrejection')`로 로깅, drop 핸들러 try/catch, move-window NaN 가드.

---

## 7. ★서브에이전트 활용 워크플로우

- **서브에이전트는 화면/이미지를 못 본다.** 레퍼런스 사진도, 렌더 스크린샷도 못 봄. → **시각적 충실도(닮기)는 무조건 메인 루프가 직접** 스크린샷→Read 루프로.
- 서브에이전트가 잘하는 것:
  - **순수 로직 모듈 작성**(life.js, personality.js, director.js를 통째로 만들고 자체 퍼징까지).
  - **수치 모델링 자문**: 내가 "레퍼런스는 이렇고 현재 코드는 저렇다"를 글로 정확히 묘사 + 코드를 읽게 하면, **구체적 수치(반지름/위치/세그먼트/프로파일 좌표)** 를 랭크해서 줌. 내가 적용·검증.
  - **코드 검수**: 통합 코드를 읽고 계약 위반/버그를 잡아줌(예: 이모트 종류 하드코딩, 대사 우선순위 등 실제 버그 적발).
- **자문 루프**: (내가 본 현황을 글로) → 에이전트가 랭크된 스펙 → 내가 적용 → 스크린샷 검증 → 필요시 재자문. "에이전트=두뇌, 나=눈".
- 여러 도메인(모델/모션/시스템)은 **병렬로** 띄우되, **같은 파일을 동시에 편집하면 충돌**하니 에이전트는 스펙(텍스트)이나 **새 파일**만 만들게 하고 통합은 내가.

---

## 8. ★★검증 툴킷 (이 문서에서 제일 재사용성 높음)

> 데스크톱 오버레이는 "투명 + 배회 + 항상위"라 일반 스크린샷이 까다롭다. 아래가 핵심.

### 8.0 앱 실행 (함정)
- `npm start`를 **`run_in_background:true`** 로 띄워라. PowerShell `Start-Job` / `Start-Process -Hidden`은 **electron이 안 살아남았다**(자식 프로세스가 정리됨).

### 8.1 바탕화면 영역 스크린샷 → PNG (그리고 Read로 본다)
```powershell
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height
$g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen(0,0,0,0,$bmp.Size)
$crop=$bmp.Clone((New-Object System.Drawing.Rectangle 1440,560,480,520),$bmp.PixelFormat)
$crop.Save("C:\path\_shot.png"); $g.Dispose();$bmp.Dispose()
```
→ 그 다음 **Read 툴로 `_shot.png`** 를 읽어 눈으로 확인.

### 8.2 ★배회하는 투명 창의 현재 위치 찾기 (user32)
창이 돌아다니므로 위치를 모름. 프로세스+창 크기(≈480×520)로 찾는다.
```powershell
Add-Type @'
using System;using System.Runtime.InteropServices;
public class W{
 [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f,IntPtr l);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out RECT r);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 public delegate bool EnumProc(IntPtr h,IntPtr l);
 public struct RECT{public int L,T,R,B;}
 public static int[] Find(uint[] pids){ int[] res=null;
  EnumWindows((h,l)=>{ if(!IsWindowVisible(h))return true; uint p; GetWindowThreadProcessId(h,out p);
   foreach(var pid in pids) if(p==pid){ RECT r; GetWindowRect(h,out r); int w=r.R-r.L,ht=r.B-r.T;
     if(w>=440&&w<=520&&ht>=480&&ht<=560) res=new int[]{r.L,r.T,w,ht}; } return true;},IntPtr.Zero);
  return res; } }
'@
$pids=(Get-Process electron).Id
$w=[W]::Find([uint32[]]$pids)   # → @(x,y,width,height) 또는 $null
```
이 `$w` 위치에서 8.1로 크롭하면 항상 쥐를 정확히 잡는다.

### 8.3 걷는 방향/이동 검증
창 x를 시간차로 샘플 → `dx<0`이면 왼쪽 이동. 그 순간 캡처해 쥐가 **이동 방향을 바라보는지**(거꾸로 걷지 않는지) 확인.

### 8.4 떨림 정량화 (인접 프레임 픽셀차의 최소값)
```powershell
# (8.2의 Find로 $w 얻고, 커서를 쥐 위에 둬 정지시킨 뒤)
function Grab($w){ $b=New-Object System.Drawing.Bitmap $w[2],$w[3]; $g=[System.Drawing.Graphics]::FromImage($b); $g.CopyFromScreen($w[0],$w[1],0,0,$b.Size); $g.Dispose(); $b }
$diffs=@(); $prev=Grab $w
for($k=0;$k -lt 14;$k++){ Start-Sleep -Milliseconds 70; $cur=Grab $w
  $sum=0;$n=0; for($y=0;$y -lt $cur.Height;$y+=8){ for($x=0;$x -lt $cur.Width;$x+=8){
    $pa=$prev.GetPixel($x,$y);$pb=$cur.GetPixel($x,$y)
    $sum+=[Math]::Abs($pa.R-$pb.R)+[Math]::Abs($pa.G-$pb.G)+[Math]::Abs($pa.B-$pb.B);$n++ } }
  $diffs+=[Math]::Round($sum/$n,1); $prev=$cur }
($diffs|Measure-Object -Minimum).Minimum   # MIN<5 면 상시 떨림 없음
```

### 8.5 실제 드래그/클릭/들기 시뮬레이션 (user32 mouse_event)
```powershell
Add-Type '...[DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
          [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint a,uint b,uint c,int d);
          public const uint LD=2,LU=4,RD=8,RU=16;'
[M]::SetCursorPos($x,$y); [M]::mouse_event([M]::LD,0,0,0,0)  # 누르고
# 여러 단계로 SetCursorPos 이동(드래그 시작 임계 + dragover 발생)
[M]::mouse_event([M]::LU,0,0,0,0)                            # 놓기(drop)
```
탐색기에서 실제 파일을 끌어 쥐에 드롭 → 휴지통 이동까지 **엔드투엔드** 검증. (단, 우클릭=2,4가 아니라 RD=8/RU=16.)
- 휴지통 실제 이동 확인: `Shell.Application` COM의 `Namespace(0xA).Items()`에서 파일명 검색.

### 8.6 스탯 강제 세팅 (renderer localStorage 주입)
모듈 스코프 변수는 외부에서 못 만지니, **executeJavaScript로 localStorage를 세팅하고 `win.reload()`**:
```js
// main에서 (env로 일회성 게이트, 끝나면 코드 원복)
win.webContents.executeJavaScript(
  "localStorage.setItem('deskrat.stats', JSON.stringify({hunger:0,affection:100,energy:100,weight:35}))"
).then(()=>win.reload());   // reload 후 loadStats가 새 값 읽음
```

---

## 9. Electron / Windows 함정 치트시트

- 앱 실행은 `run_in_background:true` + `npm start`. (Start-Job/Start-Process-Hidden ✗)
- PowerShell은 Windows PowerShell 5.1: `&&`/`||`/삼항 없음. 한글 출력 콘솔 인코딩 주의. 여기-스트링에 이모지/슬래시 많으면 파싱 깨질 수 있음 → **커밋 메시지는 파일로 `git commit -F`**.
- `File.path` 제거됨 → `webUtils.getPathForFile`(preload).
- 휴지통은 `shell.trashItem` (PowerShell DeleteFile ✗).
- `getCursorScreenPoint`는 **OS 드래그 중에도 동작** → 클릭스루 토글의 신뢰 소스.
- 투명창 캡처: 일반 스크린샷에 다른 창이 겹치면 그게 찍힘. 항상위(screen-saver)라도 Claude 미리보기 패널/편집기 위에 있을 수 있으니 8.2로 창을 직접 찾아 크롭.
- DESKRAT_DEMO 등 dev 훅은 env 게이트로 두고 프로덕션에선 안 돌게. 검증 끝나면 임시 코드 원복.

---

## 10. 파일 맵 (이 프로젝트)

| 파일 | 역할 | 핵심 비법 위치 |
|---|---|---|
| `main.js` | 창/커서폴링/휴지통/창이동/트레이 | 2.1~2.5, 6.1 |
| `preload.js` | 안전 IPC 브리지 | 2.3, 2.4 |
| `renderer/app.js` | 씬·상태머신·포즈·인터랙션 | 3.1, 4.x, 6.1 |
| `renderer/rat.js` | 절차적 로우폴리 모델 | 3.2~3.8 |
| `renderer/life.js` | 자율 활동 두뇌(순수로직) | 2.5, 4.4 |
| `renderer/personality.js` | 성격/기분/유대(순수로직) | 5.2, 5.3 |
| `renderer/director.js` | 놀이/파일반응/시간대/마일스톤 | 5.2 |

---

## 11. 우선순위 추천 (새 프로젝트라면 이 순서로)

1. **플랫폼 먼저 확실히**: 투명 오버레이 + 글로벌커서 클릭스루(2.2) + 드롭→`shell.trashItem`(2.3) + 프레임루프 try/catch(6.1). 여기서 막히면 나머지 다 무의미.
2. **검증 루프 세팅**(8장): 스크린샷+창찾기+픽셀차. 이게 있어야 모델/모션을 빠르게 반복.
3. **모델은 레퍼런스 보고 비율부터**(3.2), 그 다음 셰이딩(3.4)·색·텍스처. 도형 분리감은 블렌드+캡슐(3.3).
4. **모션의 떨림 함정(4.1/4.2)을 처음부터 피하라**(위상 누적기, 임계감쇠 스프링). 나중에 잡으려면 원인 찾기 어렵다.
5. **두뇌는 순수 로직 모듈로 분리**(5.2)해서 서브에이전트에 맡기고, 스탯은 느리게(5.1).
6. **반복**: 자문(에이전트)→적용→스크린샷 검증. 시각 판단은 항상 직접.

---

_이 문서는 실제 시행착오(두 번의 PowerShell 휴지통 실패, "도형 붙은 느낌"·"어깨 큼"·"거꾸로 걷기"·"왤케 떨어"·"휴지통 열면 멈춤" 피드백)를 통해 얻은 것이라, 같은 함정은 이걸로 한 번에 건너뛸 수 있습니다._
