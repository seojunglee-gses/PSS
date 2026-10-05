# 프로젝트 참여 기록과 재입장

## 기존 구조와 변경 범위

기존에는 `ppssProjects/{projectId}` 문서의 `accessCode`를 모든 로그인 사용자에게 전달하고, 작업 공간에서 브라우저가 코드를 비교했습니다. 성공 여부는 `sessionStorage`의 `ppss-project-access-{projectId}`에만 저장했습니다. 사용자별 영구 참여 기록은 없었습니다. 프로젝트 목록과 최근 선택 ID는 브라우저에 저장됐고, 일반 로그인 사용자에게도 넓은 Firestore 쓰기 권한이 있었습니다.

Firebase Authentication, 기존 `ppssProjects` 문서, 이메일 기반 시스템/사업 관리자 역할, `/workspace?projectId=...` 경로를 유지합니다. 프로젝트 목록과 관리 저장은 서버 API를 거치도록 바꿉니다. 이는 참여 코드 노출과 사용자 임의 담당자/코드 변경을 막기 위한 변경입니다. 사례·논문·공간 분석·AI 제공자·대화 저장 경로·기존 Firebase Storage는 변경하지 않습니다.

## 저장 위치

참여 기록은 **한 곳에만** 저장합니다.

`users/{uid}/projectMemberships/{projectId}`

```json
{"projectId":"project-1","role":"participant","joinedAt":"Firestore server timestamp"}
```

`joinedAt`은 실제 Firestore Timestamp입니다. 원본 코드·입력한 코드·코드 해시는 참여 기록에 저장하지 않습니다. 참여자의 관점 선택(일반 시민/사업자/도시계획가/공무원)과 관리 권한은 기존 체계를 유지하며, 참여 코드가 관리자 권한을 부여하지 않습니다.

`users/{uid}`에는 `lastProjectId`, `lastOpenedAt`을 병합 저장합니다. 잘못된 코드 시도는 `joinAttempt`에 최근 시작 시각·횟수·사업 ID만 기록합니다. 원본 코드는 기록하지 않습니다. 참여 정보와 최근 사업은 서버가 저장하고, 클라이언트는 자신의 정보를 읽을 수만 있습니다.

## 서버 API

- `GET /api/projects`: Firebase ID token 검증 후 사업 목록·참여한 사업 ID·유효한 최근 사업 ID를 조회합니다. 일반 사용자에게 코드를 전달하지 않으며 미참여 사업은 미리보기만 제공합니다. 관리자는 기존 관리 권한에 해당하는 사업의 설정을 확인할 수 있습니다.
- `POST /api/projects/enter`: 현재 UID와 사업을 확인합니다. 기존 참여/관리 권한이 있으면 코드를 요구하지 않습니다. 미참여 사용자는 서버에서 코드를 검증하고 트랜잭션으로 참여 기록과 최근 사업을 저장합니다. 잘못된 코드로 참여 기록이 생기지 않습니다. 코드 실패는 UID당 15분에 10회까지 허용합니다.
- `POST /api/projects`: 기존 생성/수정/삭제/최근 수정 시각 기록을 처리합니다. 생성/삭제는 시스템 관리자, 사업 정보와 자료 수정은 기존 사업 관리자 권한이 필요합니다. 참여자는 가입한 사업의 최근 수정 시각만 갱신할 수 있습니다. 관리 저장은 서버 성공 후 화면에 반영합니다.

모든 API는 `Authorization: Bearer <Firebase ID token>`을 받습니다. Admin SDK의 `verifyIdToken(token, true)`를 사용하며 요청 본문의 UID/역할은 권한 근거로 쓰지 않습니다. 인증 오류와 서버 설정 오류를 구분하고 코드/토큰을 응답이나 로그에 남기지 않습니다. 코드 입력 필요 여부는 `reason: "code_required"`로 전달해 한국어 문구 수정과 입장 로직을 분리합니다.

## 재입장 흐름

- 처음 참여: 로그인 → 사업 선택 → 참여 코드 입력 → 서버 검증/참여 기록 저장 → 작업 공간.
- 참여한 사업 한 개: 다음 로그인에서 Firebase 기록을 조회한 후 바로 해당 작업 공간으로 이동합니다.
- 여러 개: `내 프로젝트`에서 선택합니다. `최근 프로젝트 이어가기`는 Firebase에 기록된 최근 사업을 엽니다. 여러 사업이 있을 때는 자동으로 하나를 고르지 않습니다.
- 다른 사업 참여: 목록의 `새 프로젝트 참여` 영역에서 선택하고 기존 코드 입력 흐름을 진행합니다.
- 홈 메뉴를 직접 선택하면 `/?projects=1`로 목록을 열어, 하나만 참여한 사용자도 다른 사업에 참여할 수 있습니다.
- 로컬 최근 사업 ID는 UID별 탐색 편의 캐시입니다. 참여 여부를 판단하는 데 사용하지 않습니다. 캐시가 없거나 차단돼도 Firebase 기록으로 확인합니다. 과거 코드가 들어 있던 프로젝트 캐시는 제거하며 이전 세션 입장 표시는 무시합니다.

작업 공간의 내부 데이터 로딩·대화 컴포넌트는 서버 권한 확인이 끝난 후에만 마운트합니다. 계정/사업 변경 시 기존 승인은 즉시 무효로 처리합니다. 입장과 브라우저 포커스 복귀 때 참여 여부를 다시 확인합니다. 단순 포커스 복귀 확인 중에는 기존 편집 화면을 불필요하게 다시 마운트하지 않습니다.

## 회수와 보안 규칙

관리자가 참여 문서를 삭제하면 다음 입장 시 코드를 다시 입력해야 합니다. 문서에 `revoked: true`를 설정하면 기존 코드로도 재참여할 수 없습니다. 재허용하려면 신뢰할 수 있는 관리자 작업으로 회수를 해제하거나 문서를 정리해야 합니다. 삭제된 사업과 유효하지 않은 최근 사업 ID는 재입장 대상에서 제외합니다. 기존 시스템/사업 관리자 권한은 참여 문서와 별개의 기존 관리 권한이며 그대로 유지합니다.

`firestore.rules` 변경:

- 참여 기록과 사용자 탐색 상태: 자신의 정보만 읽기 허용, 클라이언트 쓰기 금지.
- `ppssProjects`: 클라이언트 읽기/쓰기 금지. 보호된 서버 API에서만 처리해 코드와 담당자를 임의로 바꾸지 못하게 합니다.
- 기존 사업별 컬렉션: 해당 사업의 참여/관리 권한이 필요합니다. 개인 대화는 자신의 UID만 읽고 씁니다. 개인 요약 쓰기는 해당 UID, 단계 잠금·공통 자료·현황 이미지·종합 요약 쓰기는 사업 관리 권한을 확인합니다.
- 광범위한 기존 와일드카드에서 위 보호 경로를 제외합니다. Firestore의 중첩 allow 규칙이 제한을 우회하지 못하도록 했습니다.
- 기존 비사업별 리소스 규칙과 Storage 규칙은 변경하지 않습니다. 공개 정적 GeoJSON과 기존 공개 이미지 URL에 새 비공개 정책을 추가하지 않습니다.

기존 참여자에게 자동 권한을 부여하지 않습니다. 신뢰할 수 있는 참여 기록이 없으므로 일반 참여자는 배포 후 코드를 **한 번 더** 입력해야 합니다. 기존 Firebase 사업/대화 자료를 삭제하거나 이동하지 않습니다. 로컬 데이터에서 서버 사업을 자동 생성하던 동작은 제거했습니다. 서버에 없는 사업은 시스템 관리자가 기존 관리 화면에서 등록해야 합니다.

## 운영 적용

**애플리케이션과 새 Firestore 규칙을 함께 배포해야 합니다. 기존의 광범위한 쓰기 규칙을 그대로 두고 이 기능을 운영하면 안 됩니다.**

서버에는 기존 관리 API에서도 사용하는 `FIREBASE_SERVICE_ACCOUNT_KEY`가 필요합니다. 로그인에 쓰는 Firebase 프로젝트의 서비스 계정을 서버 환경 변수로 설정하세요. 이 값은 `NEXT_PUBLIC_*` 변수나 프런트엔드에 넣지 않습니다. 이미 관리 API용으로 올바르게 설정됐다면 그대로 재사용합니다. 운영 Firestore 규칙은 `web/firestore.rules`를 사용합니다. `firebase.test.json`은 에뮬레이터 검증용 설정입니다.

이 작업에서는 운영 계정/비밀 키를 제공받지 않았으므로 운영 환경의 로그인·규칙 배포를 실행하지 않았습니다. 코드와 규칙, 테스트는 PR에서 함께 검토할 수 있습니다.

## 파일과 검증

추가: `lib/membership/{server,client}.ts`, `components/projects/ProjectAccessGate.tsx`, `pages/api/projects/{index,enter}.ts`, `tests/membership-emulator.test.mjs`, `tests/run-membership-tests.sh`, `firebase.test.json`, 이 문서.

수정: `lib/firebaseAdmin.ts`, `lib/projects.tsx`, `pages/index.tsx`, `pages/workspace/index.tsx`, `components/AppShell.tsx`, `firestore.rules`, `package.json`, `package-lock.json`. 개발용 의존성 `@firebase/rules-unit-testing`을 추가했습니다.

검증 명령:

```sh
# 로컬 Firestore 에뮬레이터만 사용합니다. 실제 사업 데이터를 대상으로 실행하지 않습니다.
npx firebase-tools emulators:exec --only firestore --project demo-pss-membership --config firebase.test.json "bash tests/run-membership-tests.sh"
bash tests/run-research-tests.sh
npm run build
```

2026-10-05 검증 결과:

- 실제 로컬 Firestore 에뮬레이터에서 참여 저장/재입장·복수 사업·최근 사업·코드 오류·회수·사용자 임의 권한/역할 변경 차단·프로젝트별 데이터 보호·기존 사업 자료 보존 검사 **14개 통과**.
- 기존 연구·공간 분석·대화 저장 테스트 **32개 통과**.
- TypeScript 및 프로덕션 빌드 통과. 신규 참여 API/모듈 ESLint 오류 없음. 전체 저장소에는 기존 lint 오류가 남아 있습니다.
- Chromium 1440px 데스크톱/390px 모바일에서 첫 참여, 새로고침, 로그아웃/로그인, 별도 브라우저 재입장, 복수 사업 선택, 다른 사업 참여, URL/세션 캐시 우회 차단, 포커스 복귀 시 회수 처리, 계정 변경, 선택 화면 가로 넘침, 프로젝트 캐시 차단, 비정상 서버 응답 시 입장 차단을 확인했습니다.
- 브라우저는 실제 프로젝트/참여 API와 Firestore 에뮬레이터를 사용하되, Firebase 로그인 토큰 검증 경계는 검증용 인증으로 대체했습니다. 기존 자료 분석의 사례/사업 맥락과 과거 대화 복원은 검증용 AI/대화 저장으로 확인했습니다. 운영 Google/Firebase 로그인 및 실제 LLM 통합 검증으로 해석하지 않습니다.
