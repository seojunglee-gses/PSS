# Kakao 지도·자연어 공간 검색 운영 안내

## 구현 범위와 사전 점검

- Next.js 14.2.5 / React 18 / Pages API Routes, Firebase Authentication·Admin SDK, Turf 7, MapLibre 5를 그대로 사용합니다. 패키지를 추가하지 않았습니다.
- 기존 지도는 MapLibre + OpenFreeMap(OSM 기반)이었습니다. `OSMSpatialMap.tsx`로 보존했고 제공자 선택을 `SpatialMap.tsx`에 두었습니다.
- 기존 GeoJSON 검증은 WGS84 `[경도, 위도]`를 요구합니다. Kakao SDK 경계에서만 `LatLng(위도, 경도)`로 바꿉니다. 미터·면적은 기존 Turf 계산을 사용하며 투영 좌표를 경위도로 간주하지 않습니다.
- 기존 도구는 영역 통계·버퍼·중첩·우선순위 분석입니다. 계산 엔진과 저장된 `SpatialResult` 구조는 바꾸지 않았습니다.
- 기존 레이어 표시·선택·속성 확인·가시성 제어를 재사용했습니다. 별도의 도형 그리기/편집 도구는 현재 저장소에 없어 새로 만들지 않았습니다. 사례/사업 편집 기능은 건드리지 않았습니다.
- 프로젝트 시설의 실제 데이터는 프로젝트별 업로드/공개 파일에서 읽습니다. 저장소에는 회복의 숲 시설의 실제 좌표가 들어 있지 않아 이름만으로 위치를 만들지 않습니다.

## 변경 파일

| 영역 | 파일 |
| --- | --- |
| 지도 제공자와 기존 지도 | `components/spatial/SpatialMap.tsx`, `OSMSpatialMap.tsx` |
| Kakao 렌더링·6종 GeoJSON·구멍·선택·확대 | `components/spatial/KakaoSpatialMap.tsx`, `lib/spatial/kakao-map.ts` |
| 자연어 입력·후보·결과·취소 | `components/spatial/NaturalLanguageGIS.tsx`, `lib/spatial/use-geo.ts` |
| 기존 공간 도구 연결 | `components/spatial/SpatialAnalysis.tsx` |
| 구조화된 질문·좌표·시설 별칭 | `lib/spatial/geo-query.ts` |
| 공식 장소/도보 API 클라이언트 | `lib/spatial/kakao-server.ts` |
| 권한 있는 프로젝트 지오메트리 조회·장소 해석 | `lib/spatial/geo-server.ts` |
| 인증된 서버 엔드포인트 | `pages/api/spatial/query.ts` |
| 대화 연결·기존 자료 선택 | `pages/workspace/index.tsx`, `lib/research/routing.ts` |
| 지도 내부 ID 보호·문구 | `lib/spatial/loader.ts`, `lib/i18n.tsx` |
| Vercel 공개 사업 파일 포함 | `next.config.js` (공간 API 파일 추적 범위만 추가) |
| 설정 예제·검증 | `.env.example`, `.gitignore`, `tests/geo.test.mjs`, `tests/localization.test.mjs`, `tests/run-research-tests.sh` |

## Vercel 환경변수와 배포 절차

```dotenv
NEXT_PUBLIC_KAKAO_JS_KEY=<Kakao JavaScript key>
KAKAO_REST_API_KEY=<Kakao REST API key>
```

JavaScript 키는 공개 SDK용입니다. REST 키를 `NEXT_PUBLIC_` 변수에 넣으면 안 됩니다. 기존 Firebase/OpenAI 환경변수는 그대로 유지합니다.

1. Kakao Developers의 해당 앱에서 카카오맵 사용을 활성화합니다. 무료 쿼터 적용 앱인지 먼저 확인합니다.
2. JavaScript SDK 도메인에 `https://pss-gamma.vercel.app`을 확인합니다. 로컬/미리보기 검증에는 해당 도메인도 따로 등록해야 합니다.
3. Vercel의 필요한 환경(Preview/Production)에 위 두 변수를 각각 설정합니다. JavaScript 키는 빌드 시 포함되므로 설정 후 다시 빌드해야 합니다.
4. Preview에서 유효한 키로 실제 지도·검색·도보 경로 및 실제 사업 건물/필지 정렬을 확인합니다. 키가 없으면 기존 지도와 오류 안내를 사용합니다. 키가 있으면 Kakao SDK 로딩을 시도하며 실패하면 OSM으로 돌아갑니다.
5. 검증 후 운영자가 PR 병합/운영 배포를 진행합니다. 이번 작업에서는 운영 배포·유료 이용 설정을 실행하지 않습니다.

## 서버 API와 비용 제어

`POST /api/spatial/query`

```json
{
  "projectId": "existing-project-id",
  "question": "이 건물에서 약국까지 얼마나 걸려?",
  "context": {
    "selected": { "layerId": "uploaded-buildings", "featureId": "existing-feature-id" },
    "mapCenter": [127.0, 37.5]
  },
  "choices": {},
  "locale": "ko"
}
```

- 기존 Firebase Bearer 토큰과 사업 관리자/참여 권한 확인을 재사용합니다. 클라이언트가 보내는 선택 ID는 서버의 실제 레이어에서 다시 찾습니다. 직접 선택한 지도 점/중심은 유효한 WGS84인지 검사합니다.
- 사용자·사업별 인스턴스당 분당 12회, 요청 24KB, 질문 1,000자, 조회 결과 최대 10곳, 반경 기본 1km/최대 20km입니다. 빈 검색은 한 차례 최대 3배로 반경을 넓힙니다.
- 도보 순위는 직선거리 후보 최대 3곳에만 경로를 요청합니다. 전체 시설의 최단 도보 순위라고 주장하지 않습니다.
- 외부 요청은 12초 제한과 취소 신호를 사용합니다. 입력 제안은 350ms 뒤 예시/실제 내부 시설명을 필터링하며, 입력 중 외부 검색은 하지 않습니다. 제출/예시 선택 시에만 API를 호출합니다.
- 장소 중복 시 주소·분류를 보여주고 선택을 받습니다. 외부 후보 선택은 사용자/사업/원래 질문/장소명에 묶인 5분 HMAC 토큰으로 검증합니다. 내부 후보도 서버의 실제 시설 목록에서 다시 확인합니다.
- 제한은 서버 인스턴스별 메모리 방식이며, 여러 Vercel 인스턴스를 합친 전역 제한이나 Kakao 총 사용량 보장은 아닙니다. 실제 한도는 Kakao 콘솔에서 확인해야 합니다. 별도 유료 인프라는 도입하지 않았습니다.
- 키·토큰·원본 외부 응답을 로그에 기록하지 않습니다. REST 키 누락/권한/429/네트워크/경로 없음은 구분해서 안내합니다.

## 검색·자연어·도보 경로

- `PLACE_SEARCH`, `CATEGORY_SEARCH`, `NEARBY_SEARCH`, `STRAIGHT_DISTANCE`, `WALKING_ROUTE`, `NEAREST_PLACE`, `RADIUS_SEARCH`, `EXISTING_GIS_QUERY`를 규칙으로 분류합니다. 분류 전용 LLM 호출은 없습니다. 복잡한 모든 문장을 이해하는 범용 언어 모델은 아니므로 모호한 질문에는 장소/조건을 구체적으로 적어야 합니다.
- 내부 시설명/별칭 → Kakao 키워드 검색 순서입니다. 이름·별칭은 기존 `name`, `title`, `label`, `시설명`, `건물명`, `명칭`, `aliases`, `alias`, `별칭` 속성을 읽습니다. 실제 데이터에 정식 이름이 있을 때만 타워/전파기지 별칭을 추가합니다. ‘경로당’ 등 일반명은 한 후보여도 확인을 받습니다.
- 위치 우선순위는 명시한 출발 장소 → 선택한 도형/지도 점 → 사업 경계 중심 → 지도 중심입니다. 명시한 ‘현재 지도 중심’은 선택 도형과 구분합니다. 상호 검색은 위치 선호만 주고 반경으로 임의 제외하지 않습니다.
- 임의 상호는 `/v2/local/search/keyword.json`, 일반 업종명은 지원 코드가 있으면 `/v2/local/search/category.json`을 사용합니다. 전용 코드가 없는 정류장·공원·복지시설 등은 키워드 검색합니다. 특정 업체/결과/좌표를 하드코딩하지 않습니다.
- 도보는 `/v2/routing/walk`에 `start_x/start_y/end_x/end_y`, `input_coord=WGS84`, `output_coord=WGS84`, `route_mode=BROAD_FIRST`를 보냅니다. `status=OK`와 전체 거리·시간·각 경로 좌표를 검증합니다. `totalDistance`는 미터, `totalTime`은 초입니다.
- 초록 출발·빨강 도착·보라 검색·주황 선택, 실선 도보·점선 직선·청록 반경을 구분합니다. 출입구 속성 `entrance_lng/entrance_lat` 또는 `entrance_lon/entrance_lat`을 우선합니다. 없으면 도형 대표점이나 검색 POI 좌표임을 밝힙니다.
- 도보 실패 시 직선 거리만 표시하고 시간을 만들지 않습니다. 도보 도달권(isochrone)은 구현하지 않았습니다. ‘도보 5분 범위’에는 한계를 설명하고 원형 버퍼를 대신 내놓지 않습니다.
- Data Analysis 자동 선택/공간 자료만 선택한 대화에서 새 도구를 실행합니다. 사례/논문을 함께 명시한 대화는 기존 근거 답변 흐름을 유지합니다. 지도 검색창은 별도로 사용할 수 있습니다.

## 데이터·약관

Firestore 컬렉션/프로젝트 문서/Storage 경로/보안 규칙/로그인 방식을 변경하지 않았습니다. 지도 초기화에서 지오메트리를 덮어쓰거나 파일을 이전하지 않습니다.

업로드된 **사업 소유 지오메트리만** 사용자/사업/파일 리비전/정규화 버전별로 최대 2분, 20항목/총 30MB 메모리에 보관합니다. 매 조회마다 최신 메타데이터와 읽기 권한을 확인합니다. 기존 건물용도 정규화 파일 재사용 방식도 유지합니다.

서버리스 함수가 기존 공개 프로젝트 파일도 읽도록 `next.config.js`에 공간 API 전용 파일 추적 경로를 추가했습니다. 공개 파일을 비공개 자료로 옮기거나 새 데이터 모델을 만들지는 않습니다.

Kakao 원본 검색 결과/경로/좌표/선택 토큰은 Firestore나 브라우저 영구 저장소에 보관하지 않습니다. 대화에는 원래 사용자 질문과 결과를 지도에서 확인하라는 안내만 저장하고, 이번 접속에서만 실제 답변을 연결해 표시합니다. 따라서 새 Kakao 결과는 새로고침/다른 기기에서 다시 조회해야 하며 기존 연구·사례·Turf 분석 이력 저장은 유지됩니다.

확인한 일반 운영정책은 사용자 환경 개선 목적 외 캐시와 최신 상태를 유지하지 않는 캐시를 금지합니다. 비카카오 지도에 외부 데이터를 재표시할 수 있다고 가정하지 않고, Kakao 결과/경로는 Kakao 지도에서만 시각화합니다. OSM에서는 자체 사업 레이어와 텍스트 결과/공식 상세 링크만 제공합니다. SDK의 로고/저작권 표시는 숨기지 않습니다. 공개 서비스 운영자는 실제 앱에 적용되는 약관/권한을 배포 전에 확인해야 합니다.

공식 문서(2026-10-23 확인):

- [카카오맵 설정·무료 적용 앱 조건](https://developers.kakao.com/docs/latest/ko/kakaomap/common)
- [장소 검색](https://developers.kakao.com/docs/latest/ko/local/dev-guide)
- [도보 경로 REST API](https://developers.kakao.com/docs/latest/ko/kakaomap/rest-api)
- [쿼터·요금](https://developers.kakao.com/docs/latest/ko/getting-started/quota)
- [플랫폼 운영정책](https://developers.kakao.com/terms/latest/ko/site-policies)

문서상 무료 일간 제공량은 지도 Web SDK 300,000건, 키워드/카테고리 검색 각각 100,000건, 도보 경로 1,000건입니다. **개발자 계정에서 카카오맵을 처음 활성화한 앱에만 무료 쿼터가 적용**됩니다. 두 번째 이후 앱이나 무료량 초과 사용에는 비즈월렛/유료 설정이 필요할 수 있습니다. 자동 활성화하지 않았으며 가격/조건은 바뀔 수 있습니다. 프로젝트 키가 어느 무료 앱에 속하는지 이번 환경에서는 확인할 수 없습니다.

## 검증과 남은 확인

`bash web/tests/run-research-tests.sh` **104개 통과**, `bash web/tests/run-membership-tests.sh`의 실제 Firestore 에뮬레이터 권한/사업 편집 검증 **15개 통과**. Next 프로덕션 빌드(타입 검사 포함) 통과. 신규 모듈 lint 오류/경고 0개이며 기존 수정 파일의 기존 진단(오류 5개/경고 21개)은 증가하지 않았습니다.

`bash web/tests/run-research-tests.sh`에 GIS 검증을 포함합니다. 자동 테스트는 실제 요청 형식, 좌표 순서/거리, 내부 시설 별칭, 임의 상호, 업종 폴백/확장, 공식 경로 응답 형식, 오류, 도보 후보 제한, 토큰/권한, 캐시 리비전, 기존 자료 라우팅/연구/사례/편집/대화 이력을 검사합니다.

브라우저 테스트는 SDK와 외부 결과를 **대체한 테스트 데이터**로 지도 연결·선택·경로·모호성 확인·취소·OSM 전환, 1440/820/1180/390px 화면을 확인했습니다. 실제 SDK 키/REST 키/운영 Firebase 자격증명이 없어 유효 키 지도 로딩, 실제 업체/도보 결과, 실제 사업 데이터 정렬·시설 별칭 연결은 아직 검증하지 못했습니다. 키 설정 후 Preview에서 해당 항목을 확인해야 합니다. 테스트용 시설 좌표를 실제 시설 좌표로 배포하지 않았습니다.
