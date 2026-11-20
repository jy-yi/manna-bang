# 만나방 — 인수인계서 (HANDOFF)

> **대상**: 이 저장소를 이어서 수정·배포할 사람 또는 AI
> **기준 커밋**: `5a5612f` (2026-11-17, "나이 표기를 한국나이로 전체 통일")
> **기준 파일**: `index.html` — **약 4,220줄 / 235,393 bytes**, 단일 파일
> **라이브**: <https://jy-yi.github.io/manna-bang/> (GitHub Pages, `main` 루트, 빌드 방식 legacy)

이 문서만 읽고도 ① 화면 문구 수정 ② 필드 추가 ③ 매칭 단계 변경 ④ 권한/주선자 관리 ⑤ Supabase 실전 전환까지 이어갈 수 있게 정리했습니다. 줄 번호는 위 기준 커밋의 `index.html` 기준입니다 — **코드를 고치면 줄 번호는 밀리므로, 먼저 아래 "앵커"로 찾고 줄 번호는 참고용으로만 쓰세요.**

---

## 0. 30초 요약

- **무엇**: 지인 소개 기반 프라이빗 소개팅 중매 웹앱. 소개팅 대상 = **매물**(번호로 관리), 프로필을 올린 사람 = **주선자**.
- **어떻게**: 빌드 없는 Vanilla HTML/CSS/JS. 화면·로직은 `index.html` 한 파일, 서버 연결은 `cloud.js` 한 층. **실전 데이터는 Supabase(Postgres + Storage + Auth)**, 사진은 비공개 버킷 + 서명 URL.
- **누가**: 주선자 모드(이름 + 개인 비번, 1시간 유지) / 손님 모드(입장코드, 탭 닫으면 해제, 읽기 전용). 방장(종윤, `is_owner`)은 ⚙️ 방장 관리에서 주선자 추가·비번 초기화·비활성.
- **핵심 흐름**: 매물 등록(사진 필수) → 목록·검색 → 상세에서 **💌 매칭 제안** → **현황판**에서 단계 진행(제안중→일정 조율→만남 완료→애프터→성사/패스) → 매칭 단위 **마담 리뷰** → 랭킹(성사×10 + 진행×3 + 보유×1).
- **모드**: 기본은 **실전(Supabase)**. 게이트 아래 **샘플 모드로 둘러보기**는 예전 `localStorage` 방식 그대로 남아 있어 인터넷·서버 없이도 발표·검증이 된다.

---

## 1. 절대 규칙 (확정된 것 — 바꾸기 전에 반드시 확인)

이 규칙들은 실제 사용 과정에서 겪은 문제를 고쳐 정한 것입니다. 새 기능을 넣다가 이걸 깨면 회귀입니다.

| # | 규칙 | 이유 / 근거 |
| --- | --- | --- |
| 1 | **`index.html`이 앱 본체.** 화면·로직은 `index.html` 안에서 고치고, 서버 호출은 `cloud.js` 층에서만 한다. 빌드 도구는 여전히 쓰지 않으며, 외부 라이브러리는 supabase-js 하나만(`vendor/`에 고정). | GitHub Pages에 정적 파일로 배포하는 구조. VS Code·npm 빌드 없이 바로 고쳐 올린다. |
| 2 | **개인정보 비노출.** 실명 대신 `매물 #07` 번호를 쓴다. 실명·연락처·상세 주소·실제 사진·비밀번호 실제 값을 코드·문서·커밋 메시지에 넣지 않는다. | 공개 저장소. 지인 정보가 곧 유출이다. |
| 3 | **나이는 전부 한국나이** — `koreanAge()`(1524) = `올해 - 출생연도 + 1`. 만나이 표기 금지. 목록·상세·현황판·공유 문구·검색·폼 힌트가 모두 이 함수를 거친다. | "만나이 같다?"는 지적을 받고 전면 통일했다. 새 화면을 만들어도 `koreanAge()`만 쓴다. |
| 4 | **용어는 '주선자'로 통일.** '중개사·중매인' 금지. 후기 기능 이름은 **'마담 리뷰'** 고정. | 탭·헤더·카톡 문구까지 전부 바꾼 상태다. |
| 5 | **모바일 뒤로가기 스택 유지.** 모달은 `history.pushState`/`popstate`로 엔트리를 **하나만** 쌓고, X·딤 닫기는 `history.back()`으로 함께 정리한다(§7.10). | 뒤로가기 한 번에 사이트가 닫히던 문제, 두 번 눌러야 닫히던 문제를 둘 다 고친 상태다. |
| 6 | **카톡 문구 포맷 유지**: `#` 금지 → `07번 매물`, `navigator.share`에 **title 넘기지 않기**, 빈 줄로 문단 구분, `· ` 항목 줄. | `#31`은 카톡에서 해시태그로 파랗게 링크되고, title을 같이 넘기면 "제목 - 본문"으로 제목이 두 번 보인다. |
| 7 | **손님 모드는 철저히 읽기 전용.** 현황판 탭·등록/수정/삭제·메모·리뷰·사진 저장/공유 전부 비노출. | 지인 외 사람이 링크로 들어오는 경로라 쓰기 권한이 새면 안 된다. |
| 8 | **사진은 필수 1~5장**, 긴 변 **900px / JPEG 0.78** 압축, **첫 장이 대표**. | 용량(localStorage 약 5MB) 보호 + 카드 로딩 속도. |
| 9 | **상태·매칭 단계 변경은 담당 주선자만**(`canManage`, `actAllowed`). | 남의 매물 상태를 바꾸면 현황판 전체가 어긋난다. |
| 10 | **저장 실패 시 롤백.** `save()`가 false면 화면 상태를 되돌리고 "사진 용량이 커서 저장하지 못했어요" 안내. | quota 초과로 화면과 저장본이 갈라지던 문제. `restoreAsset()`(3283) 참고. |
| 11 | **375px 모바일 우선.** 카드·현황판·모달은 375px에서 깨지지 않아야 하고, 340px 이하 구간은 별도 규칙이 있다(840–849행). | 주선자들이 전부 휴대폰으로 쓴다. |

---

## 2. 현재 상태

| 항목 | 값 |
| --- | --- |
| 저장소 | `jy-yi/manna-bang` (Public, 기본 브랜치 `main`) |
| Pages | `status: built`, `source: main /`, `https_enforced: true`, 라이브 200 |
| 파일 | `index.html`, `cloud.js`, `vendor/supabase-js-2.119.1.min.js`, `og-image.png`(1200×630), `icon-512.png`, `apple-touch-icon.png`(180), `README.md`, `HANDOFF.md` · 서버 정의(`schema.sql`, `functions/manna-admin/index.ts`, `config.toml`)는 공개 저장소에 두지 않고 별도 보관 |
| 외부 의존 | Pretendard Variable CDN (`cdn.jsdelivr.net`) 1개 + Supabase(`pzvlgehxokxpsinlshua`) |
| 저장 키 | 실전: `mannabang.auth.v2`(주선자 세션+토큰), `mannabang.guest.v2`(손님) · 샘플: `mannabang.prototype.v3`, `mannabang.emoji.v1` |
| 디버그 훅 | `window.__mannabang` — 콘솔에서 `state`, `demo`, `openAdmin()`, `filtered()` 등 확인 가능 |

### 저장 키 상세

| 키 | 저장소 | 내용 | 수명 |
| --- | --- | --- | --- |
| `STORAGE_KEY = 'mannabang.prototype.v3'` (1270) | localStorage | `{session, assets[], matches[], seq{}}` 전체 | 직접 초기화 전까지 |
| `AUTH_KEY = 'mannabang.auth.v1'` (1271) | localStorage | `{mode:'agent', session:'agN', expiresAt}` | `AUTH_TTL` = 1시간 (1273) |
| `GUEST_AUTH_KEY = 'mannabang.guest.v1'` (1272) | sessionStorage | `{mode:'guest', session:'guest'}` | 탭을 닫으면 해제 |
| `EMOJI_KEY = 'mannabang.emoji.v1'` (1388) | localStorage | `{ag1:'🌿', ag2:'🧭', ...}` | 영구 |

> 스키마를 바꿀 때는 **키 이름의 `.v3`를 올리고 `migrate()`(1701)에 이전 데이터 보정을 추가**하세요. 기존 사용자(주선자들)의 브라우저에 데이터가 남아 있습니다.

### 최근 변경 (2026-11-20, `35fee36`)

- **모바일 주소창에 상세 모달 상단이 잘리던 문제**: 페이지 맨 위(1·2번 매물)에서만 발생. 안드로이드 삼성인터넷·크롬은 주소창·툴바가 펼쳐진 상태에서 `vh`(레이아웃 뷰포트)가 실제 보이는 높이보다 커서 `92vh` 시트가 화면 위로 넘쳤다. `.modal` 에 `max-height:calc(100dvh - 16px)` 를 추가하고, 모달을 열 때마다 `fitSheet()`(`SHEET_OVERLAYS` = 상세·등록·방장·신규알림)가 `visualViewport.height` 의 92%로 overlay 높이·모달 `max-height` 를 px 로 다시 잡는다(`resize`·`orientationchange`·`visualViewport.resize` 에서 재보정). 열 때 `scrollTop = 0`(+`requestAnimationFrame`).
- **× 닫기 버튼**: `.modal-x` 를 `position:absolute` → `position:sticky` 로 바꿔 모달을 스크롤해도 화면 위쪽에 남는다(음수 마진으로 자리는 차지하지 않음).
- **라이트박스 확대**: `.lightbox`/`.lightbox img` 의 `touch-action:none` 이 두 손가락 핀치까지 막고 있었다 → `touch-action:pinch-zoom` 으로 완화. `bindSwipe()` 는 손가락이 2개 이상이거나 `visualViewport.scale > 1` 이면 스와이프로 처리하지 않는다.
- **손님 모드 사진 워터마크**: `.wm-layer`(SVG data URI 타일, `pointer-events:none`)를 상세 갤러리(`guest` 일 때만 렌더, `#detailWm`)와 라이트박스(`#lightboxWm`, `.lb-stage` 안)에 얹는다. 주선자 모드에는 렌더되지 않으며 탭·스와이프·핀치를 막지 않는다.
- 검증: `verify-modaltop.py` — 모달 상단 4개 뷰포트 + 라이트박스 핀치(대조군 포함)·스와이프 + 워터마크 73항목. `python3 verify-modaltop.py local|deploy` (Playwright, `LD_LIBRARY_PATH=/workspace/.libs/root/usr/lib/x86_64-linux-gnu`).

### 최근 변경 (2026-11-20, 식별 워터마크)

- **워터마크 문구를 고정 문구 → 동적 식별로**: `만나방 · 외부 공유 금지` → **`만나방 · YYYY.MM.DD HH:MM · {기기} {브라우저} · #매물번호`** (예: `만나방 · 2026.11.20 09:46 · iPhone 카톡 · #03`). 랜덤 브라우저 ID는 넣지 않는다(사용자 결정).
  - `wmStamp()` 열람 시각(0패딩), `wmDevice()` UA 판별 — 기기 `iPhone/iPad/Android/Mac/PC`, 브라우저 `카톡(KAKAOTALK) > 인스타 > 네이버 > 삼성인터넷 > 웨일 > Edge(EdgA/EdgiOS/Edg) > Chrome(CriOS/Chrome) > Safari > 브라우저` 순으로 검사(카톡·인스타 UA에도 Safari/Chrome 토큰이 있어 순서가 중요). iPadOS 13+ 사파리는 자신을 Macintosh 로 알리므로 `maxTouchPoints > 0` 이면 iPad 로 본다.
  - `paintWm()` 이 매물 상세를 그릴 때(`renderDetail` 끝)와 라이트박스를 열 때(`openLightbox`) 시각·기기·번호를 새로 찍어 `.wm-layer` 의 `background-image`(인라인)로 넣는다. 손님 모드에서만 호출되고, 주선자 모드에서는 `#detailWm` 요소 자체가 없다.
  - **타일 크기 자동 계산**: 문구가 길어져 고정 300×180 타일로는 대각선 글자가 경계에서 잘린다. `wmMeasure()` 가 canvas `measureText` 로 그 기기 폰트(`Apple SD Gothic Neo`→`Malgun Gothic`→`Noto Sans KR`)의 실제 폭을 재고, `wmSvg()` 가 -27° 기울인 글자의 외곽 상자 + 여백으로 `width`/`height` 를 잡는다. 흰색 0.62 + 그림자 0.16 은 그대로.
  - SVG 는 `wmXml()` 로 `& < > " '` 를 이스케이프한 뒤 `encodeURIComponent` 로 data URI 를 만든다.
  - **줄 간격(타일 높이) 조정 — 2026-11-20 촘촘히**: 사진 한 장에 2줄만 보이던 것을 3~4줄로. 타일 세로 높이가 곧 줄 간격이라 기울기·글자·여백을 `WM_CFG` 한 곳에 모았다(`{font:12, ls:0.3, rot:15, padX:14, padY:4, lineH:1.35}`). 27°·13px·여백 18px = 타일 168px → 15°·12px·여백 4px = 타일 84~96px(휴대폰 375×300 갤러리에서 3.1~3.6줄, PC 720×360 에서 3.7~4.3줄). 기기명이 긴 UA(`Android 삼성인터넷`)는 문구가 길어 타일이 ~14% 높다. 줄 사이 여백은 2×`padY` 라 겹치지 않고, 글자가 타일 경계에서 잘리지 않는 조건(타일 ≥ 기울인 글자 외곽)은 그대로다. `window.__mannabang.wmCfg` 로 값을 바꿔 바로 확인할 수 있다.
- 검증: `verify-dynwm.py` — UA 14종 판별, 문구 포맷·현재 시각, 다시 열 때 시각 갱신(시계 고정), 타일 ≥ 기울인 글자 외곽(잘림 없음) + 줄 사이 ≥6px + 갤러리 안 3~4줄(PC 포함), 라이트박스, 주선자 모드 미노출, 이스케이프 등 167항목. `python3 verify-dynwm.py local|deploy`.

---

## 3. 파일 지도

### 3.1 머리말 · 메타 (1–34)

| 행 | 내용 |
| --- | --- |
| 1–4 | `<!DOCTYPE html>` / `<html lang="ko">` / `<head>` / charset |
| 5–7 | viewport(`viewport-fit=cover`), `<title>` |
| 8–21 | theme-color `#FCF9F5`, description, OG 태그(og:url·og:image = Pages 주소) |
| 22–25 | Twitter card (`summary_large_image`) |
| 26–28 | apple-touch-icon, icon-512, 인라인 SVG 파비콘 |
| 29–34 | jsDelivr 사전 연결 + Pretendard Variable CSS |

### 3.2 CSS — `<style>` 35–864

| 행 | 블록 |
| --- | --- |
| 36–54 | `:root` 토큰(색·그림자·반경) + 기본 리셋 + 폰트 + 스크롤바 |
| **56–127** | **GATE** — 입장 화면, 주선자 칩(`.gchip`), 비밀번호 입력, 손님 폼, `.shake` 애니메이션 |
| 128–155 | 내 이모지 팝업(`.emoji-pop`) |
| 156–177 | APP SHELL — `.topbar`, `.who`, 손님 모드 헤더 |
| 178–204 | 대시보드(`.dash`, `.stat-grid`) |
| 205–219 | 탭(`.tabs`, `.tab`, `.nbadge` 배지) |
| 220–332 | 목록 패널 — 필터(`.filters`), 검색, 범위 입력, 카드(`.card`, `.thumb`), 상태 뱃지 |
| 333–342 | 바라는 조건(`.wish`, `.wish-chip`) |
| 343–379 | 마담 리뷰(`.rev-*`) |
| 380–392 | 현황판 안 리뷰 진입(`.brev-*`) |
| 400–456 | 현황판 — `.match`, `.mhead`, `.pair`, `.person`, `.steps`, `.mstage`, `.sbtn`, `.mquick` |
| 457–482 | 랭킹(`.lb`, `.bar`) |
| 483–498 | 오버레이·모달 기본(`.overlay`, `.modal`, `.modal-x`) |
| 499–524 | 갤러리·슬라이드·라이트박스 도구(`.gallery`, `.slide`, `.g-tools`, `.shot-btn`) |
| 525–610 | 상세 모달(`.detail-body`, `.spec-grid`, `.block`, `.tl`, `.proposal`, `.cand`, `.dfooter`, `.danger-bar`) |
| 611–627 | 공유 박스·카톡 버튼(`.share-box`, `.spick`, `.btn.kakao`) |
| 628–693 | 등록/수정 폼(`.form-*`, `.field`, `.seg`, `.extras`, `.wchip`) |
| 694–729 | 사진 등록(`.photo-pick`, `.photo-grid`, `.ph-item`, `.photo-secure`) |
| 730–746 | 라이트박스(`.lightbox`) |
| 747–756 | 토스트(`.toast`), 앱 푸터(`.appfoot`) |
| 757–764 | 권한 모드 — `.mode-guest`일 때 `#dashNew #btnNew #fMine #btnReset` 숨김, `.guest-note` |
| 765–788 | 신규 매물 완료 팝업(`.modal.na`, `.na-*`) |
| 790–863 | 반응형: ≥760 PC / ≤520 / ≤430 / ≤340 / 760–900 / ≤380 / `prefers-reduced-motion` |

### 3.3 HTML 본문 (866–1263)

| 행 | 블록 | 주요 id |
| --- | --- | --- |
| 868–916 | **GATE** | `gate`, `gateForm`, `gateChips`, `pwInput`, `gateErr`, `guestBtn`, `guestForm`, `guestPw`, `guestErr`, `guestEnter`, `guestCancel`, `pwWho` |
| 919–944 | APP 헤더 + 이모지 팝업 | `app`, `whoBox`, `whoName`, `whoAva`, `whoExit`, `emojiPop`, `epGrid`, `epInput`, `epApply`, `epCur` |
| 946–962 | 대시보드 | `dTotal`, `dPairs`, `dSub`, `sAvail`, `sProg`, `sDone`, `sRate`, `dashNew` |
| 964–969 | 탭 | `tabCntList`, `tabBadgeBoard`, `tabCntBoard` |
| 971–1032 | **TAB 1 매물 리스트** | `panel-list`, `btnNew`, `chips`, `q`, `qClear`, `fGender`, `fAge`, `fHeight`, `fAgent`, `fSort`, `fMine`, `ageRange`, `ageMin`, `ageMax`, `heightRange`, `hMin`, `hMax`, `resultLine`, `cards` |
| 1034–1044 | **TAB 2 현황판** | `panel-board`, `boardChips`, `boardLiveT/LiveN`, `boardPastT/PastN`, `boardLive`, `boardPast` |
| 1046–1059 | **TAB 3 주선자 랭킹** | `panel-agents`, `lbFormula`, `lb` |
| 1061 | 앱 푸터 | `btnReset` |
| 1064–1069 | 상세 모달 | `detailOverlay`, `detailContent` |
| 1072–1235 | 등록/수정 모달 | `formOverlay`, `assetForm`, `formTitle`, `formErr`, `f-photos`, `photoPick`, `photoGrid`, `photoHint`, `segGender`, `f-birth`, `birthHint`, `f-height`, `f-region`, `f-work`, `f-job`, `f-company`, `segSmoke`, `segDrink`, `f-mbti`, `wantsChips`, `f-wantInput`, `wantsAdd`, `f-tags`, `f-ideal`, `extras`, `addExtra`, `f-comment`, `f-agent`, `fAgentEmoji`, `fAgentName`, `f-status`, `formDanger`, form-foot |
| 1238–1248 | 신규 등록 완료 팝업 | `newAssetOverlay`, `naBody`, `naTitle` |
| 1251–1261 | 라이트박스 | `lightbox`, `lightboxImg`, `lightboxNo`, `lightboxClose`, `lbTools`, `lbSave`, `lbShare` |
| 1263 | 토스트 래퍼 | `toastWrap` |

### 3.4 JavaScript — `<script>` 1265–4216 (`(function(){ 'use strict'; … })()`)

| 행 | 블록 | 앵커 주석 |
| --- | --- | --- |
| 1269–1296 | 상수·AGENTS·STATUS·STAGES | `constants` |
| 1297–1320 | 바라는 조건 유틸(`WANT_PRESETS`, `cleanWants`, `wishLineHTML`) + 키 조건 헬퍼(`wantHeightOf`·`setWantHeight`·`renderWantHeight`·`wireWantHeight`) | `바라는 조건` |
| 1321–1386 | 마담 리뷰 정의(`REV_VIS`, `SEED_REVIEWS`, `visibleReviews`, `reviewableMatches`) | `마담 리뷰` |
| 1387–1413 | 이모지 환경설정(`EMOJI_KEY`, `loadEmojiPrefs`, `saveEmojiPref`) | `내 이모지` |
| 1414–1460 | **샘플 데이터**(`RAW` 매물 30건, `SEED_MATCHES` 6건) | `sample data` |
| 1461–1548 | 유틸·권한·인증(`isGuest`, `actAllowed`, `koreanAge`, `loadAuth`, `saveAgentAuth` …) | `utils`, `auth` |
| 1549–1615 | 일러스트(`PALETTES`, `avatarSVG`) — 사진 없을 때 프로필 그림 | `illustrations` |
| 1616–1724 | 상태(`store`, `seed`, `load`, `migrate`, `state`, `save`, `getAsset`, `getMatch`) | `state` |
| 1725–1819 | 필터(`F`, `AGE_BANDS`, `filteredAssets`) | `filters` |
| 1820–1828 | `toast` | `toast` |
| 1829–1859 | 헤더·대시보드 렌더(`counts`, `renderHeader`) | `render: header + dashboard` |
| 1860–1925 | 이모지 팝업(`renderEmojiGrid`, `openEmojiPop`, `applyAgentEmoji`) | `이모지 선택 팝업` |
| 1926–1955 | `renderDash` | |
| 1956–2035 | 목록(`renderChips`, `cardHTML`, `renderList`) | `render: list` |
| 2036–2196 | 현황판(`boardFilter`, `stepsHTML`, `personHTML`, `isIncomingProposal`, `matchHTML`, `renderBoard`) | `render: board` |
| 2197–2233 | 랭킹(`renderLeaderboard`) | `render: leaderboard` |
| 2234–2427 | 상세 모달 상태·리뷰(`detailId`, `reviewItemHTML`, `reviewBlockHTML`, `reviewAction`, `candidatesFor`) | `detail modal` |
| 2428–2617 | 공유(`shareLink` … `shareBlockHTML`, `doShare`, `doCopy`) | `kakao share`, `공유 문구` |
| 2618–2790 | `renderDetail` — 상세 화면 전체 조립 | |
| 2791–2852 | 뒤로가기/히스토리(`histEnter`, `histLeave`, `popstate`) | `popstate·히스토리 연동` |
| 2853–2952 | 액션(`setAssetStatus`, `setMatchStage`, `propose`, `addMemo`, `deleteAsset`) | `actions` |
| 2953–2973 | 사진 기본(`MAX_PHOTOS`, `photosOf`, `thumbHTML`) | `사진 (등록·대표·라이트박스)` |
| 2974–3222 | 사진 저장·공유·압축·업로드(`savePhoto`, `sharePhoto`, `compressImage`, `addPhotoFiles`) | `사진 저장·공유` |
| 3223–3289 | 스와이프(`bindSwipe`, `setSlide`) | `손가락 스와이프` |
| 3290–3469 | 폼(`openForm`, `wireFormFoot`, `closeForm`, `renderWantsChips`) | `form modal` |
| 3470–3568 | 신규 등록 완료 팝업(`renderNewAssetPop`, `naShare`, `naCopy`) | |
| 3569–4215 | **wiring** — 이벤트 연결 + 부팅 | `wiring` |
| 4057–4157 | 등록/수정 폼 submit (검증·저장·팝업/상세 전환) | |
| 4200–4215 | 부팅: `renderAll()` → 저장된 로그인 복원 → 딥링크 처리 | `boot` |

**wiring 내부 앵커**: 이모지 3581 / gate+`pwOf` 3607–3612 / `DEEP_ITEM` 3645 / `enterApp` 3651 / `tryLogin` 3670 / `exitToGate` 3698 / `GUEST_PW` 3723 / `submitGuest` 3737 / `switchTab` 3769 / 상태 칩 3787 / 검색·필터 3795 / 카드 클릭 3839 / 현황판 클릭 3845 / 상세 모달 클릭 3861 / 폼 오버레이 3937 / 사진 입력 3943 / 라이트박스 3977 / 성별·흄연·음주 seg 3994–4011 / 바라는 조건 4013 / 폼 submit 4057 / 초기화 버튼 4163 / 키보드 4180.

---

## 4. 데이터 구조

### 4.1 주선자 — `AGENTS` (1276–1286)

```js
{id:'ag1', name:'…', emoji:'🌿', role:'중개소 대표'}   // ag2~ag9는 role:'주선자'
```

- **9명 고정**, id는 `ag1`~`ag9`. 이름·이모지·직책은 이 배열이 유일한 출처.
- 이모지는 사용자가 바꿀 수 있고(`mannabang.emoji.v1`), 로드 시 `AGENTS[i].emoji`를 덮어쓴다.
- ⚠️ `AGENTS[0]`(ag1)이 **방장 역할**이며 `role`이 `중개소 대표`다. 지금은 표시용일 뿐 권한 차이는 없다.
- ⚠️ 이 저장소는 공개다. **실명을 문서·README·새 파일로 옮겨 적지 말 것.** 이름을 바꿔야 하면 이 배열만 고친다.
- 주선자를 추가하려면: `AGENTS`에 항목 추가 → `pwOf()`(3613)가 index 기반이므로 **비밀번호 발급 규칙도 함께 손봐야 한다**(§8.4).

### 4.2 매물 — `state.assets[]`

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| `id` | string | ✔ | `p{seq}` — `p1`~`p30` 샘플, 신규는 `p31`부터. **번호 = 등록 순서** |
| `gender` | `'M' \| 'F'` | ✔ | 성별 |
| `birth` | number | ✔ | 출생연도(1980–2004). 나이는 저장하지 않고 `koreanAge()`로 계산 |
| `height` | number | ✔ | cm (140–210) |
| `region` | string | ✔ | 거주지 (예: `서울 마포구`) |
| `workArea` | string | ✔ | 근무지 |
| `job` | string | ✔ | 직업 |
| `company` | string | | 직장 |
| `mbti` | string | | 대문자 4자 또는 `''` |
| `smoke` / `drink` | `'O' \| 'X' \| ''` | | 미입력은 `''` |
| `tags` | string[] | | `['#러닝','#연봉상위']` — 저장 시 `#` 자동 부착 |
| `wants` | string[] | | 바라는 조건. `cleanWants()`가 공백 정리·중복 제거·앞 `#` 제거 |
| `extras` | `{label, value}[]` | | 학력·종교·취미 등 자유 항목. 빈 라벨/값은 저장 시 제거 |
| `memo` | string | | **비고** — 손님에게 비노출 |
| `comment` | string | | 주선자 코멘트 — 상세에 인용 박스로 표시 |
| `agent` | `'agN'` | ✔ | 담당 주선자. **등록 시 로그인한 주선자로 고정**(폼에서 변경 불가) |
| `status` | `available\|progress\|matched\|hold` | ✔ | §5.1 |
| `photos` | string[] | ✔ | Data URL(`data:image/jpeg;base64,…`) 1~5장. **[0]이 대표** |
| `reviews` | Review[] | | §4.3 |
| `history` | `{at, by, text}[]` | | 최신이 앞(`unshift`). `by`는 **이름 문자열**(id 아님) |

### 4.3 마담 리뷰 — `asset.reviews[]`

```js
{id:'rv101', by:'ag3', m:'mt1', at:'2026-11-18', vis:'public'|'private', text:'…'}
```

- `m` = 리뷰 기준 매칭 id. **매칭 단위로 1건**(같은 매칭에 재작성 불가).
- `vis:'public'` → 주선자 전원 공개, `'private'` → 작성자 본인만.
- 작성 권한: **매칭 상대 매물의 담당 주선자일 때만**(`reviewableMatches`, 1374).
  예: 매물 A(내 담당) ↔ 매물 B(다른 주선자 담당) 이면, 나는 **B에 대한 리뷰**를 쓸 수 있다.
- 손님 모드에서는 `visibleReviews()`가 빈 배열을 돌려주고 작성 UI도 렌더되지 않는다.

### 4.4 매칭 — `state.matches[]`

```js
{id:'mt7', aId:'p3', bId:'p17', from:'a', stage:'제안중', at:'2026-11-18'}
```

| 필드 | 설명 |
| --- | --- |
| `id` | `mt{n}` — **기존 최대 번호 + 1**로 발급(중복 방지, `propose` 참고) |
| `aId` / `bId` | 두 매물. **성별이 같은 매물끼리는 제안 불가**(`candidatesFor`가 이성만 반환) |
| `from` | `'a'`(기본) 또는 `'b'` — **보낸 쪽**. 없으면 `'a'`로 간주(`matchFromSide`, 2076) |
| `stage` | `STAGES` 중 하나 |
| `at` | 제안일 `YYYY-MM-DD` |

> `from`은 나중에 추가된 필드다. 구 샘플(`mt1`~`mt6`)에는 없어서 `aId`가 보낸 쪽으로 해석된다. 마이그레이션 없이도 동작하지만, "보낸 쪽/받은 쪽" 표시가 필요한 새 데이터는 반드시 `from`을 넣는다.

### 4.5 전체 상태 — `state`

```js
{ session:'ag1', assets:[…], matches:[…], seq:{asset:31, match:6, review:100} }
```

- `session`: 현재 주선자 id. **손님 모드에서도 값은 남아 있지만 `MODE='guest'`가 모든 권한을 막는다.**
- `seq.asset`: 다음 매물 번호. `seq.match`: 다음 매칭 번호(안전장치로 `propose`에서 재계산). `seq.review`: 리뷰 id.

---

## 5. 상태 머신

### 5.1 매물 상태 — `STATUS` (1288–1293)

| 키 | 표시 | 배지 클래스 | 정렬 order |
| --- | --- | --- | --- |
| `available` | 🟢 매칭가능 | `.st-available` | 1 |
| `progress` | 🟡 진행중 | `.st-progress` | 2 |
| `matched` | 💘 성사 | `.st-matched` | 3 |
| `hold` | ⏸️ 보류 | `.st-hold` | 4 |

변경: `setAssetStatus(id, status, silent)` (2854) — **담당 주선자만**, 히스토리에 `상태 변경: 🟢 매칭가능 → ⏸️ 보류` 기록.

### 5.2 매칭 단계 — `STAGES` (1294)

`제안중 → 일정 조율 → 만남 완료 → 애프터 → 성사` 와 `패스`(중도 이탈).
`LIVE_STAGES`(1295) = 앞의 4개 → **"진행 중인 매칭"**으로 집계되는 구간.

`setMatchStage(mid, stage)` (2868)의 부수효과:

| 선택한 단계 | 두 매물의 `status` |
| --- | --- |
| `성사` | 둘 다 `matched` |
| `패스` | 둘 다 `available` |
| 그 외 | 둘 다 `progress` |

→ 양쪽 `history`에 `매칭 #7 단계 변경: 제안중 → 일정 조율 (매물 #12)` 형태로 unshift, `save()` 후 전체 렌더, 토스트.

> **주의**: 매물의 `status`는 매칭 단계가 덮어쓴다. 한 매물이 두 매칭에 걸리면 마지막 조작이 이긴다(현재 모델의 한계, §11 참고).

### 5.3 제안 만들기 — `propose(aId, bId)` (2886)

1. `nextNo` = 기존 매칭 최대 번호 + 1 → `mt{n}` 발급, `seq.match` 보정
2. `{id, aId, bId, from:'a', stage:'제안중', at:today()}` push
3. 두 매물 `status = 'progress'`, 양쪽 history에 제안/도착 기록
4. `save()` → `proposalOpen=false`, `boardFilter='all'`, `highlightMid=mid`
5. `renderAll()` → 상세 모달 닫기 → `switchTab('board')` → `renderBoard()`
6. 120ms 뒤 해당 카드로 `scrollIntoView`, 6초 뒤 강조 해제

### 5.4 삭제 — `deleteAsset(id)` (2932)

- 연결된 매칭 전부 제거, 상대 매물이 `progress`/`matched`였으면 `available`로 복구 + 히스토리 기록
- `state.assets`에서 제거, 열려 있던 상세/폼 닫기, 토스트에 `(매칭 N건 정리)` 표시

---

## 6. 핵심 함수 레퍼런스

### 6.1 유틸·포맷

| 함수 | 행 | 역할 |
| --- | --- | --- |
| `esc(s)` | 1540 | HTML 이스케이프. **모든 사용자 입력을 innerHTML에 넣을 때 반드시 통과** |
| `assetNo(a)` | 1528 | id 숫자 2자리 패딩 → `'07'` |
| `assetTitle(a)` | 1532 | `'매물 #07'` |
| `koreanAge(y)` | 1524 | `올해 - y + 1` |
| `birthLabel(a)` / `ageLabel(a)` | 1526 / 1527 | `'93년생'` / `'93년생 / 34세'` |
| `today()` / `fmtDate(s)` | 1533 / 1539 | `2026-11-18` / `2026.11.18` |
| `hash(s)` | 1543 | 일러스트 팔레트 결정용(모듈로 99991) |
| `oneLine(v)` | 2437 | 공유 문구용 공백 압축 |

### 6.2 렌더 계층

| 함수 | 행 | 비고 |
| --- | --- | --- |
| `renderAll()` | 3570 | 헤더→대시→칩→목록→현황판→랭킹 |
| `renderHeader()` | 1836 | 손님/주선자 헤더 분기, `#whoBox` innerHTML 재작성 → **이벤트는 여기서 다시 연결** |
| `renderDash()` | 1926 | 통계 4칸, 탭 카운트, 제안 배지, 서브 문구 |
| `renderChips()` / `renderList()` | 1957 / 1999 | 목록 |
| `cardHTML(a)` | 1977 | 카드 한 장 |
| `renderBoard()` | 2139 | 필터 칩 → 진행/지난 매칭 |
| `matchHTML(m)` | 2101 | 매칭 카드(단계 스텝·버튼·리뷰 진입) |
| `renderLeaderboard()` | 2200 | 점수 계산 + 정렬 + 바 그래프 |
| `renderDetail()` | 2618 | 상세 모달 전체 조립(갤러리·스펙·리뷰·상태·히스토리·공유·푸터) |
| `renderFormPhotos()` | 3087 | 사진 그리드·대표 배지·힌트 문구 |
| `renderNewAssetPop()` | 3474 | 등록 완료 팝업(미리보기 + 버튼) |

> 렌더 함수는 **전부 문자열 조합 → `innerHTML`** 방식이다. 상태를 바꾼 뒤에는 해당 렌더 함수를 다시 부르는 것이 원칙(부분 갱신은 `setSlide`만).

### 6.3 이벤트 위임 구조

| 컨테이너 | 행 | 처리 |
| --- | --- | --- |
| `#detailOverlay` | 3861 | `data-action` 값으로 분기(슬라이드·확대·저장·상태·제안·공유·수정·삭제) + `reviewAction()` 우선 |
| `#panel-board` | 3845 | 필터 칩 / `.sbtn` 단계 변경 / `.person` 상세 열기 / `rev-` 액션 |
| `#cards` | 3839 | 카드 클릭 → `openDetail` |
| `#formOverlay` | 3937 | 딤·`[data-close]` 닫기 |
| `#photoGrid` | 3954 | `[data-photo-del]`, `[data-photo-rep]` |
| `#lightbox` | 3979 | 닫기·저장·공유·좌우 이동·딤 클릭 |
| `document` | 4180 | Escape 계층 닫기, Arrow 키(라이트박스), `.person` Enter/Space |

---

## 7. 기능별 동작 상세

### 7.1 입장·인증·딥링크

- `tryLogin()`(3670): 이름 칩 미선택 → "먼저 본인 이름을 선택해 주세요." / 비번 불일치 → `.shake` 애니메이션.
- 성공 시 `state.session = gateAgent`, `save()`, `saveAgentAuth()` → `localStorage`에 `{expiresAt: now + 1h}`.
- 새로고침: `loadAuth()`(1492)가 `expiresAt`를 보고 복원. 만료면 `authExpired=true` → 게이트에 "보안을 위해 1시간이 지나 자동으로 로그아웃됐어요" 표시.
- `exitToGate()`(3698): 인증 삭제, 필터/입력 초기화, `history.replaceState(null,'',pathname)`로 URL의 `?item=` 제거.
- 딥링크: `?item=p12`(3645) → `enterApp(deepId, mode, restored)`(3651)가 상세를 연다. 저장된 로그인이 없으면 **손님 모드로 자동 입장**(4210).
- 손님 입장: `GUEST_PW`(3723) 비교 → `saveGuestAuth()`(sessionStorage).

> ⚠️ **보안상 가장 중요한 사실**: 비밀번호 검증이 **브라우저 안에서** 이뤄지고(`pwOf` 3613, `GUEST_PW` 3723), 소스가 공개되어 있다. 즉 **이 프로토타입은 실제 접근 제어가 아니다.** 실제 지인 개인정보를 넣으면 안 되고, 실서비스 전 반드시 서버 인증으로 바꿔야 한다(§9). 비밀번호 실제 값은 이 문서를 포함해 어디에도 적지 않는다.

### 7.2 권한 (주선자 vs 손님)

| 항목 | 판정 | 위치 |
| --- | --- | --- |
| 손님 여부 | `isGuest()` = `MODE === 'guest'` | 1462 |
| 매물 관리(상태·메모·수정·삭제) | `canManage(a)` = 손님 아님 **그리고** `a.agent === state.session` | 1463 |
| 액션 허용표 | `actAllowed(act, a)` — 손님은 `slide/share/copy/zoom`만 | 1464 |
| 현황판 탭 | 손님에게 `hidden`, `switchTab('board')` 요청은 `list`로 치환 | 3769–3772 |
| CSS 숨김 | `.mode-guest #dashNew, #btnNew, #fMine, #btnReset` | 758 |
| 상세에서 숨김 | 비고(`memo`), 진행 히스토리, 상태 변경, 리뷰 블록, 사진 저장/공유 도구 | 2618 이하 |
| 라이트박스 도구 | `#lbTools.hidden = isGuest()` | 3178 |

> 손님 모드는 **UI 숨김 + 핸들러 가드**를 함께 쓴다. 새 버튼을 추가하면 ① `actAllowed` ② 손님 CSS ③ 핸들러 가드 **세 곳**을 다 확인할 것.

### 7.3 목록·검색·필터·정렬

- `F` 객체(1726)가 유일한 필터 상태. `filteredAssets()`(1778)가 필터 + 검색 + 정렬을 한 번에 처리.
- **검색 haystack에 들어가는 것**: 매물 번호(`매물 #07`, `07`, `#07`), 직업, 직장, 거주지, 근무지, MBTI, 비고, extras(라벨+값), 태그, 담당 주선자 이름, 흡연/음주, `93년생`, `1993`, `34`, `34세`, 바라는 조건, `남성/여성`.
- **나이 필터는 전부 출생연도 구간**으로 계산한다(`AGE_BANDS` 1729): `y2000`=[2000,∞), `y96-99`=[1996,1999], `y92-95`=[1992,1995], `y1991`=[0,1991], `custom`=입력 범위(작은 값~큰 값 자동 정렬).
- 키 필터: `'160'`~`'180'` → `[n, Infinity]`, `custom` → 범위.
- 정렬: `created-desc`(기본) / `created-asc` / `age-asc` / `age-desc`. 동률이면 `assetNo` → 상태 order.
- 필터가 하나라도 걸리면 `resultLine`에 `필터 초기화` 버튼이 생기고, 클릭 시 `F`를 초기값으로 되돌린다(3795 이하 위임).

### 7.4 매물 상세·매칭 제안

- `openDetail(id)`(2831): `detailId` 설정, 슬라이드/제안/삭제 상태 초기화, `body.style.overflow='hidden'`, `histEnter('detail')`.
- 갤러리: 사진이 있으면 슬라이드 이미지 + 좌상단 `📥 일괄 저장 (N장)`(＋`📤 일괄 공유 (N장)`, 여러 장 공유 지원 브라우저), 없으면 `avatarSVG` 3종.
- 제목 아래 액션 줄 `.dacts`: **`📋 정보 복사` 하나만** 남는다(2026-11-20 정리). 사진 저장·공유는 갤러리 좌상단 한 곳으로 모아 위아래 중복을 없앴다.
- **제안 패널**: 푸터 `💌 매칭 제안` → `proposalOpen=true`. 후보는 `candidatesFor(a)`(2414) = **나와 다른 성별**, `available` 우선 → 나이순. `matched`는 선택 불가(`disabled`).
- 후보를 고르면 푸터가 **제안 전용 바**로 바뀐다: `닫기 / 💬 카톡 문구 / 제안 보내기 💌`. 후보 미선택 시 뒤 두 개 `disabled`.
- `💬 카톡 문구`는 `shareMine`에 후보를 넣고 공유 박스로 스크롤 — 제안 문구를 먼저 보여 주고 보내게 하는 흐름.

### 7.5 현황판

- `boardFilter`(2037): `all | mine | incoming | outgoing`. 손님이면 강제 `all`.
- `matchInvolvesMe`(2079) / `isIncomingProposal`(2085) / `isOutgoingProposal`(2091).
  - **내게 온 제안** = `stage==='제안중'` + 받는 쪽이 내 담당 + 보낸 쪽이 내가 아님.
- 칩 숫자는 **각 필터가 보여 줄 카드 수**와 일치해야 한다(과거 불일치 버그 수정 이력).
- `제안중` 카드는 `quick` 블록으로 `✅ 수락 · 일정 조율` / `✕ 패스`를 크게 노출하고, 단계 버튼 줄은 숨긴다.
- 필터가 `all`이 아니면 "지난 매칭" 섹션은 숨긴다.

### 7.6 마담 리뷰

- 작성 진입 3곳: ① 상세 `reviewBlockHTML`(2295) ② 현황판 카드의 `brev-pick`(2313) ③ 현황판 인라인 패널 `brev-panel`(2325).
- 작성 상태 변수: `revOpenKey`(`'매물id@매칭id'`), `revVis`, `revDraft`, `revDelArmed`. 재렌더에도 입력이 날아가지 않도록 `revDraft`가 `document` input 이벤트로 동기화된다(4016).
- `addReview()`(2342): 권한 재검증 → 중복 방지 → `unshift` → `save()` → `refreshReviewUI()`(2337 = 상세+현황판 재렌더) → 토스트.
- `reviewAction(btn)`(2355)이 `rev-`로 시작하는 액션을 전담. 처리했으면 `true`를 돌려 상세 핸들러가 중복 처리하지 않게 한다.
- 공개 범위 토글(`rev-vis`)과 삭제(`rev-del` → `rev-del-ok`, 확인 단계 있음)은 작성자만.

### 7.7 주선자 랭킹

```js
score = 성사(matched) * 10 + 진행(progress) * 3 + 보유(총 매물) * 1
```

- 정렬: score ↓ → 성사 ↓ → 진행 ↓ → 보유 ↓ (`renderLeaderboard`, 2200)
- 바 너비 = `score / maxScore * 100%`, 1~3위 🥇🥈🥉, 내 줄 `.me`
- 안내 문구(1049·1051)의 공식을 **바꾸면 코드·화면 문구·README를 함께** 고친다.

### 7.8 사진 파이프라인

```
파일 선택 → addPhotoFiles(3139)
  ├ 이미지 필터, 남은 자리(5 - 현재)만큼만
  ├ 파일별 순차 compressImage(3055)
  │   objectURL → Image → canvas(긴 변 900px, 흰 배경) → toDataURL('image/jpeg', 0.78)
  ├ formPhotos.push(Data URL) → renderFormPhotos()
  └ 완료 토스트(초과/실패 건수 안내, 처리 중엔 .photo-pick.busy)
저장(submit) → asset.photos = formPhotos.slice(0,5) → save()
```

- `MAX_PHOTOS=5` (2956), `PHOTO_MAX_EDGE=900` (2957), `PHOTO_QUALITY=0.78` (2958).
- 대표 = `photos[0]`. "대표" 버튼은 해당 사진을 `splice` → `unshift`.
- 카드 썸네일: `thumbHTML`(2966) — 첫 장 + `📷 n` 배지.
- 저장: `savePhoto(idx)`(2999) — Data URL → Blob → `<a download="만나방_매물07_1.jpg">` (4초 뒤 정리). 실패 시 "길게 눌러 저장" 안내.
- 공유: `sharePhoto(idx)`(3023) — `File` + `navigator.canShare({files})` 통과 시 `navigator.share`, 아니면 저장으로 대체.
- 파일명: `photoFileName(a, idx, mime)` — `만나방_매물07_1.jpg` 형식이고 확장자는 Blob MIME을 따른다(`photoExtOf`): jpg/png/webp/gif/heic/bmp.
- **사진 일괄 저장**: `saveAllPhotos()` — 상세 갤러리 **좌상단** `📥 일괄 저장 (N장)` 버튼(`data-action="save-all-photos"`, 라이트박스 하단에도 같은 버튼). 사진이 0장이면 버튼 자체를 그리지 않는다. 진행 라벨은 `bulkSaveBtns()`로 화면의 모든 일괄 저장 버튼에 동시에 반영된다. `photoBlobCache`(prewarm) → 없으면 `photoBlobOf` fetch → `triggerDownload`(a.download)를 **320ms 간격 순차**로 트리거하고, 버튼 라벨을 `저장 중 2/5…`로 바꾸며 `disabled` 처리, 끝나면 성공/실패 건수 토스트. `bulkBusy`로 중복 실행 차단.
- **사진 공유**: `shareAllPhotos()` + `canShareAny()` = `canShareMany()`(두 장짜리 더미 File로 `navigator.canShare({files})` 실지원 확인) `|| canSharePhoto()`. 1장짜리 매물도 같은 `📤 일괄 공유 (1장)` 버튼으로 공유되고, 이미 받아 둔 Blob으로 File[]을 만들어 `navigator.share({files})`. `AbortError`(사용자가 공유창을 닫음)는 토스트 없이 조용히 끝내고, 그 외 실패는 일괄 저장으로 대체한다.
- ⚠️ Supabase 서명 URL은 CORS(`access-control-allow-origin: *`)가 열려 있어 `fetch → Blob` 다운로드가 그대로 동작한다(2026-11-20 실측). 서명 유효시간(2시간)이 지난 URL은 fetch가 400이 되므로 실패 토스트 + "길게 눌러 저장" 안내로 떨어진다.
- 라이트박스: `openLightbox`(3178) `mb:'lightbox'` 엔트리를 따로 push, `closeLightbox`(3201)에서 `histSkipPop`으로 정리.
- ⚠️ 사진은 **localStorage에 base64로** 들어간다. 5장 × 900px면 대략 1~3MB. 큰 사진을 여러 장 올리면 quota(약 5MB)에 걸린다 → 저장 실패 시 롤백 + 안내 로직이 이미 있지만, 장수를 늘리려면 반드시 저장 위치를 바꿔야 한다(IndexedDB 또는 Supabase Storage).

### 7.9 공유 문구 포맷 (카톡·문자)

- `shareLink(id)`(2429) = 현재 경로 + `?item=p12` (해시·쿼리 제거).
- `shareSpecLines(a, opt)` → `📌 07번 매물 (여성)` + `shareSpecCore` + `shareSpecExtra`
  - `shareSpecCore(a)`: `· 93년생 (34세) · 162cm · ISTJ` / `· 거주: … / 근무: …` / `· 직업: … · …`
  - `shareSpecExtra(a)`: 작성된 항목만 — `· 흡연 X · 음주 O` / `· 매력 태그: …` / `· 바라는 조건: …` / `· 학력: …`(추가 정보 각 줄) / `· 비고: …` / `· 주선자 코멘트: …`. 빈 값은 줄 자체를 만들지 않는다.
  - `opt.full`(정보 복사)이면 `· 담당 주선자: 🌿 종윤`까지 붙인다.
- `assetProfileText(a)`(📋 정보 복사) = `shareSpecLines(a, {full:true})` + 빈 줄 + `👉 상세 보기` + 링크. 버튼은 상세 제목 아래 `.dacts`의 `data-action="copy-profile"`이며 손님 모드에서도 쓸 수 있다.
- `shareTpl(head, a, tail)`(2469): `제목 → 빈 줄 → 스펙 줄들 → 빈 줄 → 맺음말 → 👉 상세 보기 → 링크`
- `shareMessage(target, mine)`(2478): 주선자→주선자 제안. `mine`이 있으면 `우리 쪽 07번 매물(…)과 잘 어울릴 것 같아 여쭤봐요 😊`
- `guestMessage(target)`(2486): 손님→주선자 문의 문구.
- `newAssetNotice(a)`(2495): `🆕 새로운 매물이 등록됐어요!` + 주선자 표기 + `shareSpecCore`/`shareSpecExtra` 스펙 줄 + `👉 만나방에서 바로 보기` + 링크.
- 전송: `doShare()`(2596) `navigator.share({text})` — **title 금지**. 미지원·실패 시 클립보드로 대체(`doCopy` 2589, `copyText` 2570은 `document.execCommand` 폴백 포함).
- `shareAssetNo(a)`(2440) = `'07번 매물'`. **`#07`로 쓰지 말 것**(카톡 해시태그로 링크화).

### 7.10 모달 뒤로가기 스택

```
열기 : histEnter(kind)  → histOwned가 false면 pushState({mb:kind}), true면 replaceState
닫기 : histLeave()      → histOwned=false, histSkipPop++, history.back()
popstate             → lightbox > emoji > newAsset > form > detail 순으로 하나만 닫음
```

- `histOwned`(2795)는 **앱이 쌓은 엔트리는 항상 최대 1개**임을 보장한다. 상세→수정 전환(`edit`)처럼 모달이 이어질 때는 `closeDetail(true)`(히스토리 건드리지 않음) 후 `openForm()`이 `replaceState`로 엔트리를 **교체**한다.
- `histSkipPop`(2796)은 화면에서 닫아 스스로 `back()`을 부른 경우, 그 `popstate`를 세지 않기 위한 카운터. 1.2초 뒤 자동 리셋.
- 로드 시 `history.state.mb`가 남아 있으면 `replaceState(null,'')`로 청소한다(새로고침 후 뒤로가기 오작동 방지).
- ⚠️ 새 모달을 추가하면 ① `histState`/`histEnter` 호출 ② `popstate` 분기 ③ Escape 분기(4180) **세 곳**에 넣어야 한다.

### 7.11 신규 매물 등록 완료 팝업

- 저장 성공 경로(신규만): `renderAll()` → `closeForm(true)` → `openNewAssetPop(id)`(3536).
- `openNewAssetPop`은 `histEnter('newasset')`으로 **등록 모달의 엔트리를 이어받고**(replace), 남아 있던 토스트를 지운다(문구 가림 방지). `💬 카톡 단톡방에 알리기`에 포커스.
- 버튼: `naShare`(3510) 공유 / `naCopy`(3529) 복사 / `data-close` 닫기. **수정 저장 경로에서는 팝업을 띄우지 않는다.**

### 7.12 내 이모지

- `EMOJI_SUGGEST`(1389) 20종 + 직접 입력(`firstGrapheme` 1861로 첫 글자만).
- `applyAgentEmoji`(1910): `AGENTS[i].emoji` 변경 → `saveEmojiPref` → `renderAll()` + `fillAgentSelects()` + `renderGateChips()` + (상세 열려 있으면 `renderDetail()`).
- 팝업은 `#whoBox` 위치 기준으로 계산해 띄우고, 바깥 클릭·스크롤·리사이즈·Escape·뒤로가기에서 닫힌다.

---

## 8. 요청 유형별 수정 가이드

### 8.1 UI·테마 바꾸기

| 하고 싶은 것 | 고칠 곳 |
| --- | --- |
| 색 전체 톤 | `:root` 토큰(37–50). `--coral`/`--mint` 계열 값만 바꿔도 대부분 따라온다. 그라데이션에 하드코딩된 `#E09383,#BC6354`(탭·버튼·브랜드)도 함께 검색 |
| 모서리·그림자 | `--r-lg/-md/-sm`, `--shadow-s/-m` |
| 폰트 | 33행 CDN 링크 + `body`의 `font-family`(44행) |
| 문구 | HTML 본문(866–1263) + 렌더 함수 안의 문자열. **`renderHeader`는 innerHTML을 다시 쓰므로 문구도 여기 있다** |
| 로고·아이콘 | `icon-512.png`, `apple-touch-icon.png`, 인라인 SVG 파비콘(28행), `.brand-mark`(164행) |
| 카드 레이아웃 | `.card`(291), `.thumb`(299), `.card .l1/.ln/.tags/.wish/.l4`(306–338) |
| 반응형 | 790–863의 미디어 쿼리 |

**색을 바꿀 때 체크**: ① 상태 뱃지 4색(`.st-*`) ② 손님 모드 보라(`.who.guest`, `.share-box.guest`, `.photo-secure`) ③ 카톡 버튼 `#FEE500`은 카카오 브랜드색이라 그대로 두는 편 ④ OG 이미지(`og-image.png`)는 별도 이미지라 함께 교체해야 톤이 맞는다.

### 8.2 매물 필드 추가하기 (예: "차량 소유" 추가)

1. **폼 HTML**: 필드 블록 추가(1072–1235 사이, 예: 선택 항목 구역). `id="f-car"`.
2. **`openForm()`**(3373): 기존 값 채우기 — `set('f-car', a ? a.car : '')`.
3. **submit 핸들러**(4057): `data` 객체에 `car: val('f-car')` 추가.
4. **저장 경로 2곳**: 수정 경로는 `data`를 그대로 복사하므로 자동, **신규 경로는 `state.assets.push({...})`에 `car`를 명시적으로 추가**해야 한다(이 부분이 가장 자주 빠뜨리는 곳).
5. **카드**: `cardHTML`(1977)에 원하는 줄 추가(공간이 좁으니 `.ln` 안에).
6. **상세**: `renderDetail`(2618)의 `.spec-grid`(6칸 고정) 또는 `.block`으로 추가.
7. **검색**을 원하면 `filteredAssets`의 `hay` 배열(1801 부근)에 `a.car` 추가.
8. **마이그레이션**: `migrate()`(1701)에 `if(a.car === undefined) a.car = ''` 같은 보정 추가(기존 localStorage 데이터 대응).
9. **검증**: 375px 카드에서 한 줄이 넘치지 않는지, 폼이 2열 그리드(`.form-body`)에서 `wide`가 필요한지 확인.

### 8.3 매칭 단계 바꾸기

- `STAGES`(1294)와 `LIVE_STAGES`(1295)를 **함께** 수정. 스텝 UI는 `STAGES.slice(0,5)`까지만 그린다(`stepsHTML`, 2045) — 단계를 늘리면 이 상수도 조정.
- `setMatchStage`(2868)의 `성사`/`패스` 분기를 새 단계에 맞게 보완.
- 기존 데이터의 `stage` 문자열이 새 목록에 없으면 `stepsHTML`이 `idx=-1`이 되어 스텝이 비어 보인다 → `migrate()`에서 매핑 필요.
- **보류 중인 결정**: `제안중` 다음에 `검토중`을 둘지(§11). 넣는다면 `STAGES`에 삽입하고 `LIVE_STAGES`에도 넣은 뒤, 샘플 매칭(`SEED_MATCHES`)과 `mquick` 문구를 확인.

### 8.4 주선자·권한 관리 (방장 기능)

- 현재 상태: `AGENTS` 9명 **하드코딩**, 비밀번호는 `pwOf(agentId)`(3613)가 **배열 index 기반으로 계산**, 방장(ag1)도 다른 주선자와 권한 차이가 없다.
- 방장 기능을 넣을 때 필요한 것:
  1. `AGENTS`를 `state.agents`로 옮기고 `migrate()`에서 기존 배열을 seed로 주입 (id `ag10`부터 발급)
  2. `state.session === 'ag1'` 같은 방장 판정 + `isOwner()` 헬퍼
  3. 주선자 추가/비활성화/비밀번호 초기화 화면(별도 탭 또는 설정 모달) — 새 모달이면 §7.10의 세 곳에 히스토리 등록
  4. 비활성 주선자의 매물 처리 정책 결정(담당 유지 vs 이관). `AGENTS`에서 지우면 `agentById()`가 `AGENTS[0]`을 반환해 **이름이 엉뚱하게 표시**되므로, 삭제 대신 `active:false` 플래그를 권장
- ⚠️ 비밀번호를 계속 클라이언트에서 계산하면 방장 기능도 의미가 없다. **방장 기능은 서버 인증(§9)과 함께 가야 한다.**

### 8.5 사진 관련 조정

| 요청 | 방법 | 주의 |
| --- | --- | --- |
| 장수 늘리기(예: 8장) | `MAX_PHOTOS`(2956) + 폼 문구(1091, "최대 5장") + `photoHint` 문구 | localStorage quota. 8장 × 900px는 위험 |
| 압축 품질/크기 | `PHOTO_MAX_EDGE`(2957), `PHOTO_QUALITY`(2958) | 낮추면 화질, 높이면 용량 |
| 사진 없이 등록 허용 | submit의 `if(!formPhotos.length)` 블록(4074) 제거 + 문구/`req-note`(1077) 수정 | 사용자가 "사진 필수"로 확정한 규칙 — 바꾸려면 확인 필요 |
| 비공개 보관 안내 문구 | `.photo-secure`(1103) | 사용자가 직접 요청한 문구다 |

### 8.6 Supabase 연동 포인트 (프론트)

연동은 **`data` 계층 3곳만** 갈아끼우면 되도록 짜여 있다.

| 계층 | 현재 | 교체 지점 |
| --- | --- | --- |
| 읽기(부팅) | `state = load()` (1713) | 비동기 `await fetchState()`로. 부팅을 async IIFE로 바꾸고 `renderAll()` 전에 await |
| 쓰기 | `save()` (1715) | 변경분을 서버로. 낙관적 렌더 + 실패 시 롤백(`restoreAsset` 패턴 재사용) |
| 사진 | `asset.photos` Data URL | Storage 업로드 후 **경로/서명 URL**만 저장. `photosOf()`(2962)가 `data:image/`만 통과시키므로 **URL 허용으로 수정 필요** |

> `photosOf()`는 `p.indexOf('data:image/') === 0`으로 필터한다. Supabase URL을 쓰려면 이 조건을 `p.startsWith('http') || p.startsWith('data:image/')`로 바꾸고, `savePhoto`/`sharePhoto`의 `dataUrlToBlob` 경로에 `fetch(url).then(r=>r.blob())` 분기를 추가해야 한다.

---

## 9. Supabase 실전 연동 (구현 완료 · 2026-11-19)

> **프로젝트**: `https://pzvlgehxokxpsinlshua.supabase.co` · publishable(anon) 키는 `cloud.js` 안에 있습니다(공개되어도 되는 키).
> **service_role 키는 어디에도 넣지 않습니다.** 그 키가 필요한 작업(계정 생성·비번 초기화)은 Edge Function `manna-admin` 안에서만 씁니다.

### 9.0 파일

| 파일 | 역할 |
| --- | --- |
| `schema.sql` · `functions/manna-admin/index.ts` · `config.toml` | 서버 정의(SQL·Edge Function·함수 설정). **공개 저장소에는 두지 않고 별도 보관** — 2026-11-19 저장소 트리에서 제거(로컬 백업: `downloads/manna-bang-supabase-backup/`) |
| `cloud.js` | 브라우저 쪽 Supabase 계층(`window.MannaCloud`). 로그인·조회·쓰기·사진·방장 호출 |
| `vendor/supabase-js-2.119.1.min.js` | supabase-js v2 UMD 빌드 고정본 (CDN 장애 대비) |
| `index.html` | `DEMO` 플래그로 샘플/실전 모드를 가름. 실전 모드에서는 모든 변경이 `MannaCloud`를 거친다 |

### 9.1 테이블

```
agents(id 'ag1', name, emoji, role, active, is_owner, auth_uid→auth.users, created_at)
assets(id 'p31' ← asset_seq, agent_id→agents, gender, birth, height, region, work_area,
       job, company, mbti, smoke, drink, tags[], wants[], extras jsonb, memo, comment,
       status(available|progress|matched|hold), photos jsonb[경로], created_at, updated_at)
matches(id 'mt7' ← match_seq, a_id→assets cascade, b_id→assets cascade,
        sent_from('a'|'b'), stage(6단계), created_at)
reviews(id 'rv101' ← review_seq, asset_id→assets cascade, match_id→matches cascade,
        by_agent→agents, vis(public|private), body, created_at,
        unique(asset_id, match_id, by_agent))
asset_history(id bigint identity, asset_id→assets cascade, at date, by_name, body, created_at)
```

### 9.2 읽기 — `rpc('manna_state')` 하나

앱은 테이블을 직접 `select`하지 않고 `manna_state()` 한 번으로 `{agents, assets, matches, reviews, history}`를 받습니다.

- **손님**(로그인은 했지만 `agents.auth_uid`에 없는 계정 = `guest@manna.local`): `memo`는 빈 문자열, `history`는 `[]`, 리뷰는 `vis='public'`만.
- **주선자**: 전부 + 자기 비공개 리뷰.
- 사진은 `photos`에 **Storage 경로**만 있고, `cloud.js`가 `createSignedUrls(paths, 7200)`로 서명 URL을 붙여 `a.photos`(표시용) / `a.photoPaths`(삭제·보존용)로 나눠 들고 있습니다.

### 9.3 쓰기 — 권한은 DB에서 다시 검사

| 동작 | 경로 |
| --- | --- |
| 매물 등록/수정 | `manna_save_asset(p_id, p_data, p_history)` — 담당(또는 방장)만, 히스토리 한 줄까지 함께 |
| 상태 변경 | `manna_set_status(p_id, p_status, p_history)` |
| 메모 | `manna_add_history(p_id, p_text)` |
| 이모지 | `manna_set_emoji(p_emoji)` (본인만) |
| 매칭 제안 | `manna_propose(p_a, p_b)` → `mt7`, 양쪽 🟡 진행중 + 양쪽 히스토리 |
| 단계 변경 | `manna_set_stage(p_mid, p_stage)` — 성사/패스면 양쪽 상태도 변경 |
| 매물 삭제 | `manna_delete_asset(p_id)` — 연결 매칭 삭제 + 상대 상태 복구 + 히스토리 |
| 마담 리뷰 | `reviews` 테이블 직접 (RLS가 `by_agent = me`만 허용) |
| 사진 | `storage.from('manna-photos')` 업로드/삭제 (주선자만) |

모든 함수는 `security definer`이고, 함수 첫머리에서 `manna_agent_id()`·`is_owner()`로 호출자를 확인합니다. 클라이언트는 `assets`·`matches`·`asset_history`에 대한 **select/insert/update/delete 권한 자체가 없습니다**(revoke).

### 9.4 RLS · Storage

- `agents`: anon에게 `id, name, emoji, role, active` 컬럼만 select 허용(입장 화면의 이름 목록). 그 외 권한 없음.
- `assets`·`matches`·`asset_history`: 정책은 주선자 select만 두고, 클라이언트 grant는 회수(앱은 RPC로만 읽음). 손님에게 `memo`·`history`가 API로도 새지 않게 하기 위한 의도적 강화.
- `reviews`: 손님은 `vis='public'`만 select, insert/update/delete는 `by_agent = 나`.
- Storage: 버킷 `manna-photos` **public = false**, 파일 5MB·jpeg/png/webp. read = 로그인 전원, write/delete = 활동 중인 주선자.

### 9.5 계정 · 세션

- UI는 그대로 **이름 선택 + 개인 비번**(손님은 `손님 입장` + 입장코드)이고, 내부는 `{id}@manna.local` / `guest@manna.local` + `signInWithPassword`. 비번 규칙은 **숫자 6~8자리**(Supabase Auth 최소 길이 6). 단, 기존 4~5자리 비번도 로그인은 그대로 되고 새로 정할 때만 6자리 이상을 요구한다.
- 비번 생성 입력은 세 곳 모두 `^\d{6,8}$`로 검증한다: 게이트의 `doSetup()`(초기 계정), 방장 관리의 주선자 추가·비번 초기화(`data-adm` / `admPinInline`), 내 비번 변경(`pinGo`). Edge Function `manna-admin`의 `PIN_RE`도 같다.
- **주선자 1시간**(localStorage `mannabang.auth.v2` + `expiresAt`), **손님 탭 닫기 전까지**(sessionStorage `mannabang.guest.v2`). supabase-js 자체 저장은 끄고(`persistSession:false`) 우리가 만료·토큰만 관리합니다.
- ⚠️ **토큰 회전(refresh)의 주인은 `cloud.js` 하나뿐입니다.** supabase-js 는 세션이 90초 이하로 남으면 `getSession()` 안에서 스스로 `refresh_token` 을 회전시킵니다. 그러면 우리가 localStorage 에 들고 있는 refresh 사본이 죽은 토큰이 되고, **다음 새로고침에서 `refreshSession(죽은 토큰)` 이 실패해 로그인이 통째로 날아갑니다**(2026-11-19 실제 발생). 그래서:
  - 회전은 `cloud.js` 의 `refreshTokens()`(직접 fetch) 로만 하고, **만료 150초 전**(`AUTH_MARGIN`, 라이브러리 90초보다 이르게) 미리 갱신합니다.
  - 받은 새 토큰은 **즉시 레코드에 저장**하고, supabase-js 에는 방금 받은 신선한 토큰만 넣습니다(`importSession`). `refreshSession()` 은 쓰지 않습니다.
  - 동시 회전 금지(`refreshInFlight`) — 두 번 회전하면 먼저 받은 토큰이 죽습니다.
- `restore()` 결과는 4가지로 구분합니다: `{mode}` 복원 성공 / `{expired:true}` 1시간 지남 / `{dead:true}` 서버가 토큰을 거부(폐기) / `{retry:true}` **네트워크·5xx 일시 오류 → 기록 보존, 몇 번 자동 재시도**. 일시 오류에서 절대 `signOut()` 하지 않습니다.
- 부팅은 **세션 복원이 먼저**, 그다음 이름 목록입니다. 저장된 세션이 있으면 `#bootSplash` 가 게이트를 가린 채 복원하고 바로 앱으로 들어갑니다(게이트 깜빡임 없음). `CLOUD.restoreCandidate()` 가 네트워크 없이 그 판단만 합니다.

### 9.6 방장 관리 (⚙️ / 🔑)

헤더의 아이콘 버튼이 `#adminOverlay`를 엽니다. 방장(`is_owner`)에게는 주선자 목록(비번 초기화·비활성)과 새 주선자 추가가, 모두에게 **내 비밀번호 변경**이 보입니다. 모든 동작은 `manna-admin` Edge Function이 서버에서 권한을 확인합니다(`verify_jwt=false` + 함수 안 `getUser()` 검증).

### 9.7 최초 배포 순서

1. SQL Editor에서 `schema.sql`(별도 보관) 실행 → `agents` 9명 시드 생성, `manna-photos` 비공개 버킷 생성
2. `supabase functions deploy manna-admin --no-verify-jwt`
3. 사이트 주소에 `?setup=1`을 붙여 접속(`https://jy-yi.github.io/manna-bang/?setup=1`) → 게이트 아래 **🛠 처음 계정 만들기 (방장)** → 주선자 초기 비번·손님 입장코드(숫자 6~8자리) 입력 → bootstrap
4. 종윤(ag1) 선택 + 초기 비번으로 입장 → `⚙️ 방장 관리`에서 각자 비번 초기화 후 개별 전달

> `#setupOpen`(🛠 처음 계정 만들기)은 `bootGate()`가 기본으로 숨기고, `?setup=1`이 있을 때만 연다. 이미 계정이 있으면 서버 `already_bootstrapped` 403이 한 번 더 막는다. `doSetup()` 성공 시에도 다시 숨긴다.

### 9.8 샘플 모드

게이트 아래 **샘플 모드로 둘러보기**는 예전 그대로 `localStorage`(30건 시드)로 동작합니다. Supabase가 없거나 CDN·네트워크가 막혀도 이 버튼만은 항상 살아 있습니다(발표·시연용).

> 무료 플랜은 7일 미사용 시 일시 정지된다. `🛡️-supabase-무료-프로젝트-활성-유지` 스케줄이 두 프로젝트를 함께 깨우고 있다.

---

## 10. 검증 체크리스트 (배포 전)

- [ ] `python3 -m http.server 8000` 후 **375px** 뷰포트에서 목록·카드·현황판·상세·폼 확인 (카드 한 줄 넘침 없음)
- [ ] 콘솔 **에러 0건** (특히 `renderHeader` 재작성 뒤 이벤트 중복/누락, `AGENTS` 접근)
- [ ] 모달 뒤로가기: 상세 → 뒤로가기(모달만 닫힘, 사이트 유지) → 다시 상세 → X 닫기 → 뒤로가기 **한 번에** 이전 화면
- [ ] 상세 → 수정 전환 후 뒤로가기: 모달이 한 번만 닫히고 엔트리가 쌓이지 않음
- [ ] 라이트박스 열고 뒤로가기 → 라이트박스만 닫히고 상세는 유지
- [ ] 사진 업로드: 6장 선택 시 5장만 반영 + 안내 토스트, 대표 변경, 삭제, 저장 파일명 `만나방_매물NN_i.jpg`
- [ ] 사진 없이 저장 시도 → 사진 영역 강조 + 토스트 + 저장 차단
- [ ] 등록 완료 → 단톡방 팝업 문구에 `07번 매물`(O) / `#07`(X), 제목 중복 없음, 링크 `?item=` 포함
- [ ] 손님 모드: 현황판 탭 없음, 등록·수정·삭제·메모·리뷰·사진 저장/공유 버튼 없음
- [ ] 손님 모드에서 새로고침 → 유지(sessionStorage), 탭 닫고 다시 열기 → 게이트
- [ ] 주선자 로그인 → 새로고침 유지 → 1시간 뒤 만료 안내
- [ ] **새로고침 유지(만료 경로)**: 로그인 후 `localStorage['mannabang.auth.v2'].access` 를 이미 만료된 JWT 로 바꾸고 새로고침 → 게이트로 안 튕기고 앱 유지(`refresh_token` 요청 1회)
- [ ] **일시 오류 방어**: 새로고침 직후 서버가 5xx/오프라인이어도 `mannabang.auth.v2` 가 지워지지 않고, 서버가 돌아오면 새로고침으로 다시 들어감
- [ ] 부팅 중 게이트가 깜빡이지 않음(`#bootSplash` 가 가림)
- [ ] `?item=p12` 링크로 열기: 로그인 상태면 주선자 권한, 비로그인이면 손님 모드로 상세
- [ ] 매칭 제안 → 현황판 이동 + 강조 + 카드 상단 배치
- [ ] `수락 · 일정 조율`, `패스`, `성사` 각각 눌러 두 매물 상태가 규칙대로 바뀌는지
- [ ] 마담 리뷰: 상대 담당일 때만 작성 버튼, private 리뷰가 다른 주선자에게 안 보임
- [ ] 랭킹 점수 = 화면 안내 공식과 일치
- [ ] 나이 표기가 전부 한국나이 (`1993년생 → 34세`, 2026년 기준)
- [ ] 검색: `34`, `34세`, `93년생`, `1993`, 직업, 지역, 바라는 조건으로 각각 검색
- [ ] `데모 데이터 초기화` → 30건으로 복귀
- [ ] `index.html` 외 파일 변경 없음, `git status`에 임시 파일 없음
- [ ] 커밋·푸시 후 GitHub Pages `built` 확인 + 라이브 200 + 하드 리프레시로 반영 확인

---

## 11. 남은 일 (TODO)

| 우선순위 | 항목 | 비고 |
| --- | --- | --- |
| **사용자 작업** | `schema.sql`(별도 보관) 실행 · `manna-admin` 배포 · `?setup=1`로 열고 **🛠 처음 계정 만들기**로 bootstrap | §9.7 순서. 이 세 가지 전에는 로그인이 동작하지 않는다 |
| 중간 | `수락` 시 **`검토중`** 단계 추가 여부 결정 | 미정. 넣으면 §8.3 절차 |
| 중간 | 손님 입장코드 공유 방식 | 지금은 하나의 공용 코드. 필요하면 1회용 초대 링크로 |
| 낮음 | 한 매물이 여러 매칭에 걸릴 때 `status` 충돌 정리 | 서버도 마지막 조작 기준. 매칭에서 파생 계산 검토 |
| 낮음 | 카톡 공유 SDK(카카오 JavaScript SDK) 도입 검토 | 지금은 Web Share/클립보드 |
| 낮음 | 실시간 반영 | Supabase Realtime (여러 명이 동시에 쓰기 시작하면) |
| 낮음 | 데이터 내보내기(JSON/CSV) | `manna_state` 결과를 그대로 저장하면 된다 |
| 낮음 | 기존 샘플 데이터(30건)를 실전 DB로 옮기기 | 필요해지면 `RPC`로 넣는 스크립트를 만든다 (지금은 빈 DB로 시작) |

---

## 12. 함정과 주의

1. **`renderHeader()`가 `#whoBox`의 innerHTML을 갈아끼운다.** 그 안의 `#whoExit`·`#emojiBtn` 리스너는 매번 다시 붙여야 한다(1836–1859). 새 버튼을 넣으면 여기서 연결.
2. **`STATE`/`state` 이름 혼동 금지.** `STATUS`(매물 상태 정의, 1288)와 `state`(전체 데이터, 1713)는 다르다.
3. **`--mint`는 이름만 mint.** 실제 값은 `#D4796A`(피치). 이름 보고 초록으로 착각하지 말 것.
4. **`innerHTML` + 사용자 입력 = XSS 위험.** 폼에서 들어온 값은 반드시 `esc()`를 거친다. 새 렌더 코드를 쓸 때 특히 주의.
5. **`save()`는 실패할 수 있다**(quota). 반환값을 무시하면 화면과 저장본이 갈라진다. 새 저장 경로도 반드시 확인.
6. **`photosOf()`는 Data URL만 통과**(2962). URL로 바꾸면 사진이 사라진 것처럼 보인다.
7. **줄 번호는 밀린다.** 이 문서의 앵커 주석(`/* ---- filters ---- */` 등)으로 먼저 찾는다.
8. **`window.__mannabang`**(4202)은 디버그용이다. 콘솔에서 `__mannabang.state.assets.length`처럼 확인할 수 있지만, 배포본에 남아도 무해하다(읽기 + 렌더 트리거).
9. **`AGENTS`에서 주선자를 지우면** `agentById()`(1470)가 `AGENTS[0]`을 반환해 이름이 조용히 바뀐다. 삭제 대신 `active` 플래그.
10. **공개 저장소다.** 실명·연락처·사진·키·비밀번호를 코드·문서·커밋 메시지 어디에도 남기지 않는다. 테스트용 스크립트를 저장소에 두지 않는다(작업 파일은 저장소 밖에서 관리).
11. **supabase-js 에 토큰 회전을 맡기지 말 것.** `refreshSession()`·`getSession()` 내부 회전은 우리 레코드의 refresh 사본을 죽인다(§9.5). 회전은 `cloud.js` 의 `refreshTokens()` 로만 한다.
