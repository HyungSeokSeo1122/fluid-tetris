# Fluid Tetris

Tetrominoes that behave like viscous liquid. You still spawn, move, rotate, and drop the seven classic shapes. After they land, the blobs drip into gaps, merge with the same color, and clear only when a whole row is one solid color.

플루이드 테트리스는 끈적한 액체처럼 움직이는 테트리스입니다. 일곱 가지 고전 조각을 소환하고, 이동하고, 회전하고, 떨어뜨립니다. 착지한 뒤에는 틈으로 스며들고, 같은 색과 합쳐지며, **한 줄이 전부 같은 색**일 때만 지워집니다.

## English

### Run

```bash
npm install
npm run dev
```

Open the URL Vite prints (default `http://127.0.0.1:5173`).

```bash
npm test        # fluid, clear, scoring, and ooze checks
npm run build   # typecheck + production bundle
npm run preview # serve the production build
```

There is no backend. The best score, mute choice, and stage gates are stored in `localStorage`.

Static hosting on private S3 + CloudFront is documented in [DEPLOY.md](DEPLOY.md). A push to `main` publishes staging. A `v*` tag publishes production. Both sites require a Cognito user that an admin creates; there is no public sign-up.

### Controls

| Action | Desktop | Touch |
| --- | --- | --- |
| Move | `←` `→` | Swipe, or the arrow buttons (hold to repeat) |
| Rotate clockwise | `↑` or `X` | Tap the board, or `↻` |
| Rotate counter-clockwise | `Z` | `↺` |
| Soft drop | `↓` | Short swipe down, or hold `↓` |
| Hard drop | `Space` | Long swipe down, or `Drop` |
| Hold | `C` or `Shift` | — |
| Pause | `P` or `Esc` | Pause button |
| Mute | `M` | Sound button |
| Restart | `R` | Restart |

On a phone, the board also takes gestures: tap to rotate clockwise, swipe sideways to shift, short swipe down to nudge, long swipe down to hard-drop. The on-screen buttons stay fixed to the bottom edge so they remain reachable.

Hold (`C` or `Shift`) stores the active piece, or swaps it with the piece already held. The swap is spent until that piece locks, matching classic hold. The held piece returns in its spawn shape, with its color kept.

### Sound

Mute with `M` or the **Sound** button. The choice is saved in this browser under the `localStorage` key `fluid-tetris-muted` (`1` muted, `0` on). Sounds are synthesized with the Web Audio API, so the game does not ship audio files:

- a quiet tick while soft drop actually moves the piece
- a short blip when same-color liquid merges
- a splash when a row clears
- a descending tone on game over

### Stage gates

The **Stage gates** panel edits how many cleared rows are required before stage 2 and stage 3. Those fields write `stages[1].afterLines` and `stages[2].afterLines`. Defaults are **4** and **8**. Set them to **6** and **14** to try a longer opening without editing code.

Values are saved in the `localStorage` key `fluid-tetris-stage-gates` as `{ "stage2": 4, "stage3": 8 }`. They apply to the current run immediately (the active stage is recomputed from rows already cleared) and to later games. Stage 3 stays strictly above stage 2. **Reset 4 / 8** restores the defaults. Fall speed, viscosity, and the color pool still live only in `src/config.ts`.

### Rules

- The well is 10 columns by 20 visible rows. Two hidden rows above the well are the spawn zone.
- The active piece falls as a soft tetromino. While it is supported, minos hanging over a gap drip downward. Higher viscosity makes that drip slower, so you can still slide and rotate it. Rotating reforms the classic shape when there is room.
- Hard drop slams the piece down, finishes the drip immediately, and locks it.
- Locked liquid is a cellular fluid: blobs fall straight down, and supported stacks slowly slump into shorter neighboring columns. A single flat layer does not smear sideways, so a finished row stays intact.
- Same-color bodies that were separate flash brighter when they touch. That starts or extends a merge chain.
- A row clears only when all 10 cells are full and the **same color**. Mixed rows never clear. The row flashes, splashes, then disappears. Liquid above settles through the gap.
- The game ends when locked fluid occupies the spawn zone, or the next piece cannot spawn.
- Cleared rows advance the run through stage 1, stage 2, and stage 3. Each stage speeds the fall, thins the liquid, and can add a color.

### Scoring

- Soft drop: 1 point per row. Hard drop: 2 points per row traveled before the drip.
- Merge: `mergeBonus × chain` (chain starts at 1 on the first contact).
- Line clear base is `[0, 100, 300, 600, 1000]` for 0–4 rows. Clearing several rows at once multiplies that base: **2 rows ×1.5**, **3 rows ×2.5**, **4 rows ×4**. The first same-color contact starts a chain at ×1. Each later merge adds `chainStep` (0.25), so chain 2 is ×1.25, chain 3 is ×1.50, and so on.
- The chain resets after `chainWindow` seconds without another merge.

### Balance

Edit `src/config.ts`. The four designer knobs are stage 1, and they stay in sync with the first entry of `stages`:

| Knob | Effect |
| --- | --- |
| `fallSpeed` | Rows per second for the active piece |
| `viscosity` | Higher = slower ooze while the piece is active, and slower slump after it locks |
| `colorPoolSize` | How many entries from the front of `colors` can spawn |
| `colors` | Palette. Shipped order is cyan, magenta, amber, lime, violet |

`stages` is the level table the run actually reads. A stage turns on once cleared rows reach its `afterLines`. The in-game Stage gates panel overrides stage 2 and stage 3 `afterLines` (defaults 4 and 8) and stores that override in `localStorage`. The table below is the shipped default.

| Stage | afterLines | colorPoolSize | viscosity | fallSpeed | Colors |
| --- | --- | --- | --- | --- | --- |
| stage1 | 0 | 3 | 0.85 | 0.6 | Cyan, magenta, amber |
| stage2 | 4 | 4 | 0.6 | 0.9 | Adds lime |
| stage3 | 8 | 5 | 0.4 | 1.2 | Adds violet |

Ooze interval is `max(0.05, viscosity × tuning.oozeViscosityScale)` seconds per one-cell drip. Seep interval is `tuning.seepBase + viscosity × tuning.seepViscosityScale`. With the shipped scales, stage 1 drips about every 0.72s and stage 3 about every 0.34s.

## 한국어

### 실행

```bash
npm install
npm run dev
```

Vite가 출력하는 주소로 접속합니다 (기본 `http://127.0.0.1:5173`).

```bash
npm test        # 유체, 줄 삭제, 점수, 스며듦 검사
npm run build   # 타입 검사 + 프로덕션 빌드
npm run preview # 빌드 결과 미리보기
```

서버는 없습니다. 최고 점수, 음소거, 스테이지 게이트는 브라우저 `localStorage`에 저장됩니다.

비공개 S3 + CloudFront 배포는 [DEPLOY.md](DEPLOY.md)에 있습니다. `main` 푸시는 스테이징, `v*` 태그는 프로덕션입니다. 두 사이트 모두 관리자가 만든 Cognito 사용자만 플레이할 수 있고, 공개 가입은 없습니다.

### 조작

| 동작 | 데스크톱 | 터치 |
| --- | --- | --- |
| 이동 | `←` `→` | 좌우 스와이프, 또는 화살표 버튼 (길게 누르면 반복) |
| 시계 방향 회전 | `↑` 또는 `X` | 보드를 탭, 또는 `↻` |
| 반시계 방향 회전 | `Z` | `↺` |
| 소프트 드롭 | `↓` | 짧게 아래로 스와이프, 또는 `↓` 길게 누르기 |
| 하드 드롭 | `Space` | 길게 아래로 스와이프, 또는 `Drop` |
| 홀드 | `C` 또는 `Shift` | — |
| 일시정지 | `P` 또는 `Esc` | Pause |
| 음소거 | `M` | Sound |
| 재시작 | `R` | Restart |

휴대폰에서는 보드 제스처도 동작합니다. 탭하면 시계 방향 회전, 좌우 스와이프는 이동, 짧게 내리면 살짝 내리고, 길게 내리면 하드 드롭입니다. 화면 아래 버튼은 아래에 고정되어 스크롤해도 누를 수 있습니다.

홀드(`C` 또는 `Shift`)는 조작 중인 조각을 보관하거나, 이미 보관 중인 조각과 바꿉니다. 그 조각이 고정되기 전에는 한 번만 쓸 수 있습니다. 다시 나올 때는 처음 소환 모양이고, 색은 그대로입니다.

### 소리

`M` 또는 **Sound** 버튼으로 음소거합니다. 선택은 이 브라우저의 `localStorage` 키 `fluid-tetris-muted`에 저장됩니다 (`1` 음소거, `0` 켜짐). 소리는 Web Audio API로 합성하므로 오디오 파일을 넣지 않습니다.

- 소프트 드롭으로 조각이 실제로 내려갈 때의 짧은 틱
- 같은 색 액체가 합쳐질 때의 짧은 블립
- 줄을 지울 때의 스플래시
- 게임 오버 때의 하강음

### 스테이지 게이트

**Stage gates** 패널에서 스테이지 2와 스테이지 3으로 넘어가기 위해 지워야 하는 줄 수를 바꿉니다. 이 값은 `stages[1].afterLines`와 `stages[2].afterLines`입니다. 기본값은 **4**와 **8**입니다. 코드를 고치지 않고 초반을 길게 보려면 **6**과 **14**로 두면 됩니다.

값은 `localStorage` 키 `fluid-tetris-stage-gates`에 `{ "stage2": 4, "stage3": 8 }` 형태로 저장됩니다. 현재 판에 바로 적용되고(이미 지운 줄 수로 현재 스테이지를 다시 계산), 이후 게임에도 유지됩니다. 스테이지 3 게이트는 항상 스테이지 2보다 큽니다. **Reset 4 / 8** 은 기본값으로 되돌립니다. 낙하 속도, 점도, 색 풀은 계속 `src/config.ts`에만 있습니다.

### 규칙

- 필드는 가로 10칸, 보이는 세로 20칸입니다. 그 위의 숨은 2칸이 소환 구역입니다.
- 조작 중인 조각은 부드러운 테트로미노입니다. 바닥이나 액체에 걸린 뒤, 틈 위에 걸쳐 있는 칸만 아래로 흘러내립니다. 점도가 높을수록 이 흐름이 느려서, 그 사이에 좌우 이동과 회전이 가능합니다. 회전이 성공하면 공간이 있는 한 원래 모양으로 다시 모입니다.
- 하드 드롭은 조각을 바닥까지 내린 다음 흘러내림을 즉시 끝내고 고정합니다.
- 고정된 액체는 세포형 유체입니다. 덩어리는 아래로 떨어지고, 받쳐진 더미는 더 낮은 옆 열로 천천히 흘러갑니다. 한 층짜리 바닥은 옆으로 퍼지지 않아서, 완성된 줄이 지워지기 전에 흩어지지 않습니다.
- 서로 떨어져 있던 같은 색이 닿으면 밝게 반짝이며 병합 체인이 시작되거나 이어집니다.
- 줄은 10칸이 **모두 같은 색**으로 채워졌을 때만 지워집니다. 색이 섞이면 지워지지 않습니다. 줄이 잠깐 반짝이고 튀긴 뒤 사라지며, 위의 액체는 빈 공간으로 가라앉습니다.
- 고정된 액체가 소환 구역에 닿거나, 다음 조각이 나올 자리가 없으면 게임 오버입니다.
- 지운 줄이 쌓이면 스테이지 1, 2, 3으로 넘어갑니다. 스테이지가 오를수록 낙하가 빨라지고, 액체가 묽어지며, 색이 하나씩 늘어납니다.

### 점수

- 소프트 드롭은 내려간 줄당 1점, 하드 드롭은 낙하한 줄당 2점입니다 (착지 후 스며드는 칸은 제외).
- 병합은 `mergeBonus × chain` 입니다. 첫 접촉의 체인은 1입니다.
- 줄 삭제 기본점은 0–4줄에 대해 `[0, 100, 300, 600, 1000]` 입니다. 한 번에 여러 줄을 지우면 기본점에 배수를 곱합니다. **2줄 ×1.5**, **3줄 ×2.5**, **4줄 ×4**. 같은 색이 처음 닿으면 체인이 ×1로 시작합니다. 그 다음 병합마다 `chainStep`(0.25)이 더해져, 체인 2는 ×1.25, 체인 3은 ×1.50입니다.
- 병합 없이 `chainWindow` 초가 지나면 체인이 끊깁니다.

### 밸런스 조절

`src/config.ts` 를 수정합니다. 위쪽 네 값은 스테이지 1이고, `stages` 의 첫 항목과 같게 유지합니다.

| 값 | 효과 |
| --- | --- |
| `fallSpeed` | 조작 중인 조각의 초당 낙하 줄 수 |
| `viscosity` | 높을수록 조작 중 흘러내림과 고정 후 옆 흐름이 느려집니다 |
| `colorPoolSize` | `colors` 앞에서부터 몇 색을 소환에 쓸지 |
| `colors` | 팔레트. 기본 순서는 시안, 마젠타, 앰버, 라임, 바이올렛 |

실제로 판이 읽는 난이도는 `stages` 배열입니다. 지운 줄 수가 그 스테이지의 `afterLines` 에 닿으면 바뀝니다. 게임 안의 Stage gates 패널이 스테이지 2와 3의 `afterLines`를 덮어쓰며(기본 4와 8), 그 값은 `localStorage`에 저장됩니다. 아래 표는 출고 기본값입니다.

| 스테이지 | afterLines | colorPoolSize | viscosity | fallSpeed | 색 |
| --- | --- | --- | --- | --- | --- |
| stage1 | 0 | 3 | 0.85 | 0.6 | 시안, 마젠타, 앰버 |
| stage2 | 4 | 4 | 0.6 | 0.9 | 라임 추가 |
| stage3 | 8 | 5 | 0.4 | 1.2 | 바이올렛 추가 |

조작 중 한 칸 흘러내리는 간격은 `max(0.05, viscosity × tuning.oozeViscosityScale)` 초입니다. 고정 후 옆 흐름 간격은 `tuning.seepBase + viscosity × tuning.seepViscosityScale` 초입니다. 기본 스케일에서 스테이지 1은 약 0.72초마다, 스테이지 3은 약 0.34초마다 한 칸씩 흘러내립니다.
