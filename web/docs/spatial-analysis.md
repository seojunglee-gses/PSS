# 공간 분석 MVP

프로젝트 관리자는 설정의 **공간정보**에서 파일을 등록할 수 있습니다. 기존 정적 GeoJSON 등록도 유지합니다. 업로드 형식·권한·Storage/Firestore 경로는 [프로젝트 공간정보](spatial-datasets.md)를 참고하세요.

자료 분석 왼쪽에 `사례 살펴보기 / 공간 분석 / 답변 근거` 보기 탭을 제공합니다. 기존 사례·논문 자료 선택 메뉴와 Firebase 대화 경로는 유지합니다. 기본 공간 데이터와 가상 사업 결과는 제공하지 않습니다.

## 사업별 데이터 등록

1. QGIS 등에서 데이터를 정리하고 **EPSG:4326 (경도, 위도)**로 재투영합니다.
2. GeoJSON으로 내보내 `web/public/data/projects/{projectId}/`에 넣습니다.
3. 같은 폴더에 `config.json`을 만듭니다. 해당 사업 ID와 파일만 등록합니다. 등록되지 않은 파일은 읽지 않습니다.
4. 변경 내용을 배포하면 레이어가 나타납니다. 코드 변경은 필요하지 않습니다.

```json
{
  "projectId": "project-1",
  "layers": [
    {
      "id": "boundary",
      "label": "대상지 경계",
      "type": "polygon",
      "role": "boundary",
      "source": "/data/projects/project-1/boundary.geojson",
      "defaultVisible": true,
      "color": "#64748b",
      "displayFields": ["name"],
      "fieldLabels": { "name": "이름" }
    },
    {
      "id": "buildings",
      "label": "건물",
      "type": "polygon",
      "role": "buildings",
      "source": "/data/projects/project-1/buildings.geojson",
      "displayFields": ["use", "height"],
      "fieldLabels": { "use": "용도", "height": "높이 (m)" },
      "averageFields": ["height"]
    },
    {
      "id": "zones",
      "label": "인구 구역",
      "type": "polygon",
      "role": "population",
      "source": "/data/projects/project-1/population.geojson",
      "populationField": "population",
      "displayFields": ["population", "elderly_ratio", "green_ratio"],
      "fieldLabels": { "population": "인구", "elderly_ratio": "고령 인구 비율", "green_ratio": "녹지 비율" }
    }
  ],
  "priority": {
    "layerId": "zones",
    "criteria": [
      { "field": "elderly_ratio", "direction": "higher", "weight": 1 },
      { "field": "green_ratio", "direction": "lower", "weight": 1 }
    ]
  }
}
```

이 예시의 인구·우선순위 기준은 설정 방법을 설명하기 위한 것이며 플랫폼 기본 공식이 아닙니다. 실제 사업 기준은 담당자가 정합니다. 사업 ID는 영문·숫자·하이픈·밑줄, 최대 128자입니다. 레이어 ID도 같은 문자 집합을 사용합니다. 파일명은 같은 사업 폴더의 영문·숫자·하이픈·밑줄 + `.geojson`만 허용합니다. 원격 URL, 다른 사업 경로, 하위 경로와 경로 이동은 허용하지 않습니다.

파일 예: `boundary.geojson`, `buildings.geojson`, `green.geojson`, `roads.geojson`, `population.geojson`, `facilities.geojson`. 없는 파일을 미리 등록할 필요가 없습니다. `config.json`이 없으면 빈 상태를 표시하고, 일부 파일이 없거나 잘못되면 해당 레이어만 사용 불가로 표시합니다. 설정 ID가 현재 사업과 다르면 로드하지 않습니다.

## 지원 데이터와 지도

- MapLibre GL JS, Turf.js를 사용합니다. 지도 코드는 공간 분석을 열 때 동적으로 로드합니다.
- `FeatureCollection`과 단일 `Feature`를 지원합니다. Point/MultiPoint(`point`), LineString/MultiLineString(`line`), Polygon/MultiPolygon(`polygon`). GeometryCollection, null geometry, 비어 있는 데이터는 지원하지 않습니다.
- 좌표는 경도 ±180, 위도 ±90 범위여야 합니다. 면의 링은 닫혀 있어야 합니다. 투영 좌표를 자동 변환하지 않습니다. 위상 오류·자가 교차 도형은 QGIS에서 먼저 수정해주세요.
- 기본 지도는 외부 타일 없이 사업 레이어를 표시합니다. 전체 레이어 범위로 자동 이동하며 확대·축소를 제공합니다. 배경 지도 공급자는 아직 추가하지 않습니다.
- 클릭한 도형의 원본 자료에서 `displayFields`에 지정된 속성만 표시합니다. 없는 속성은 생략합니다. Feature `id`를 설정하는 것이 좋습니다. 없으면 배열 순서를 식별자로 사용하므로 파일 재정렬 후 동일성을 보장하지 않습니다.
- `color`는 6자리 HEX 색상입니다. 범례와 체크박스로 표시/숨김을 제어합니다.

## 분석 범위와 계산 의미

- **영역 통계**: 클릭한 면을 분석 영역으로 사용합니다. 켜진 레이어만 통계에 사용합니다. 개수는 영역에 걸친 도형을 포함합니다. 건물·녹지 면적은 영역에 맞춰 잘라 합집합으로 계산하므로 겹치는 면적을 중복 집계하지 않습니다. `role`이 `buildings`, `green`, `facilities`, `population`인 자료에서만 해당 지표를 만듭니다. 경계·건물·녹지는 면 자료여야 합니다.
- **인구**: `populationField`에 실제 유한한 숫자가 있어야 합니다. Point 또는 분석 영역에 완전히 포함된 Polygon/MultiPolygon만 집계합니다. 인구 구역이 일부 걸치거나 속성값이 없으면 전체 인구 지표를 생략하고 이유를 표시합니다. 면적 비례 인구 추정은 하지 않습니다. MultiPoint 인구 집계는 지원하지 않습니다.
- **평균**: `averageFields`로 설정한 숫자 속성을 집계합니다. 누락값은 제외하며 평균에 사용한 도형 수를 함께 표시합니다. 면적 가중 평균이 아닌 도형별 산술 평균입니다.
- **버퍼**: 선택한 점·선·면에서 100/300/500m 완충 영역을 만들고 같은 통계를 계산합니다. 코드 함수는 양수 10,000m 이하를 지원합니다.
- **중첩**: 지정한 두 면 레이어 전체의 교차 영역을 구하고 합집합 면적을 표시합니다. 특정 인구·녹지 조건은 원본 레이어에서 사전에 필터링하세요. 임의 속성 조건 편집기는 제공하지 않습니다.
- **우선지역**: 설정된 레이어에서 기준별 min/max로 0~1 정규화 후 가중 평균을 계산합니다. `higher`/`lower`로 방향을 설정합니다. 모든 값이 같으면 해당 기준은 0.5입니다. 필요한 숫자 필드가 누락된 도형이 있으면 실행을 막고 필드명을 표시합니다. 상위 20개 도형 ID와 연속 점수를 표시합니다. 핫스팟·통계적 유의성 분석이 아닙니다.
- Turf의 `area`, `bbox`, `centroid`, `buffer`, `booleanPointInPolygon`, `intersect`, `union`을 사용할 수 있습니다. 좌표/면적 계산은 코드가 담당합니다.

## AI 대화와 저장

분석 후 `다음 질문에 이 공간 분석 결과 첨부`를 선택합니다. 기존 사례/논문 메뉴를 변경하지 않고, 자료 분석 API에 별도 `spatialContext`를 전달합니다. 원본 GeoJSON·좌표·원시 속성은 전달하지 않습니다. 서버가 허용된 요약 필드·길이·유한한 숫자를 검사하고 그 외 최상위 필드는 버립니다.

맥락에는 사업 ID, 분석 유형, 계산 시각, 사용 레이어 ID, 선택 도형 ID/거리/설정 등 매개변수, 지표, 주의사항, 우선순위 상위 목록만 포함합니다. LLM은 이를 종합 해석과 사업 적용 부분에서 공간 분석 결과로 구분해서 해석합니다. 사례/논문 인용 ID에 공간 분석을 섞지 않습니다. 결과는 브라우저에서 계산한 입력이며 서버가 원본 파일을 다시 계산·검증한 결과는 아닙니다.

최신 분석 요약은 **사용자 UID + 사업 ID**로 구분한 localStorage에 저장합니다. 전체 데이터·선택 도형 좌표는 저장하지 않습니다. 지도 선택과 켜진 레이어는 보기 진입 시 기본값으로 돌아가고, 마지막 요약은 복원됩니다. 자료 파일 변경 후에는 다시 계산해주세요. 결과 첨부 선택은 재접속/사업/사용자 변경 시 초기화됩니다.

질문에 실제로 첨부한 요약은 기존 assistant 대화의 선택 필드 `analysis.spatialContext`로 함께 저장됩니다. 따라서 기존 대화 복원 시 해당 답변의 공간 분석 요약을 답변 근거에서 확인할 수 있습니다. Firestore 컬렉션·경로·규칙은 변경하지 않습니다. 최신 분석 상태 자체는 기기 간 동기화하지 않습니다. 실제 Firebase 계정과 운영 AI 키를 사용한 통합 검증은 별도로 필요합니다.

## 성능과 파일 취급

작거나 중간 크기 사업 자료용 MVP입니다. 파일당 10MB, 20,000개 도형, 사업당 20개 레이어를 제한합니다. 중첩은 도형 조합 100,000개 이하로 제한합니다. 로더는 URL별 결과를 최대 40개 캐시하고 실패한 자료는 다시 읽을 수 있습니다. 대규모/복잡한 면의 Turf 연산은 브라우저 메인 스레드를 잠시 막을 수 있습니다. 워커·벡터 타일·공간 인덱스는 아직 제공하지 않습니다.

`public/data` 자료는 공개 정적 리소스입니다. 비공개/민감한 속성이 담긴 자료를 여기에 배포하지 마세요. 프로젝트 업로드 파일은 인증 API로 읽습니다. 사용자 임의 원격 URL 로드는 추가하지 않습니다.

## 개발 검증

`bash tests/run-research-tests.sh`로 기존 연구·대화 테스트와 공간 분석 테스트를 실행합니다. `tests/fixtures/spatial`은 실제 사업 자료가 아닌 소형 검증 전용 자료이고 `public`에 복사하지 않습니다. 브라우저 검증은 별도 개발 하네스에서만 이 경로의 데이터를 사용합니다.

## 구현 파일과 검증 결과

추가 파일:

- `components/spatial/SpatialAnalysis.tsx`, `SpatialMap.tsx`, `SpatialSummary.tsx`: 공간 보기·지도·현재/과거 결과 요약.
- `lib/spatial/types.ts`, `loader.ts`, `engine.ts`, `context.ts`, `labels.ts`: 설정·GeoJSON 검증/로드·계산·대화 요약 검증·한국어 표시.
- `tests/spatial.test.mjs`, `tests/fixtures/spatial/{config.json,boundary.geojson,green.geojson,facilities.geojson}`: 검증 전용 데이터와 분석 테스트.
- `public/data/projects/README.md`, 이 문서: 실제 사업 자료를 넣을 위치와 등록 방법.

수정 파일:

- `pages/workspace/index.tsx`: 세 번째 보기, 사용자/사업별 최신 결과, 첨부 여부, 해당 답변에 사용한 결과 복원.
- `pages/_app.tsx`, `styles/globals.css`: MapLibre CSS와 공간 분석 버튼 스타일.
- `pages/api/research/answer.ts`, `lib/research/{types,evidence,answer}.ts`: 선택적 공간 요약 입력·저장·해석 프롬프트. 기존 사례/논문 인용 검증은 유지.
- `package.json`, `package-lock.json`: MapLibre GL JS 5.24.x, Turf.js 7.4.x 추가. 기존 누락 의존성을 포함해 lockfile을 갱신.
- `tests/run-research-tests.sh`, `tests/research.test.mjs`: 공간 엔진/맥락/API 회귀 검사 연결.

2026-10-05 검증:

- 연구·대화 저장·공간 분석/API 단위 테스트 **32개 통과**.
- TypeScript와 프로덕션 빌드 통과. 공간 분석 신규 코드 ESLint 오류 없음. 전체 lint는 기존과 같은 27개 오류/40개 경고가 남아 있습니다.
- 별도 개발 하네스 + Chromium에서 1440px 데스크톱/390px 모바일 확인. 실제 컴포넌트와 Turf 계산에 검증용 GeoJSON을 넣어 지도 표시·레이어 토글·원본 도형 클릭·영역/버퍼/중첩/우선순위·요약 첨부·과거 답변 근거·localStorage 복원을 확인했습니다. 모바일 가로 넘침 없음, 지도 높이 360px 확보.
- config/file 404 상태에서도 공간 빈 화면과 사례 보기가 정상 작동합니다. 다른 projectId로 전환하면 해당 설정 경로만 요청하고 이전 사업 결과는 복원하지 않습니다.
- 기존 네 대화 단계의 저장/복원, 별도 브라우저 간 복원, 읽기/쓰기 실패, 계정 전환 중 요청/요약 읽기 보호 회귀 검사 통과.
- MapLibre 6.x의 별도 worker 로딩이 Next.js 14에서 실패하는 것을 확인해 번들 worker가 있는 5.24.x를 사용했습니다.
- 브라우저 Firebase·AI 응답은 검증용 대체 구현입니다. 실제 사업 GeoJSON, 운영 Firebase 계정, 운영 LLM을 사용한 통합 검증은 아직 하지 않았습니다. 실제 계획 결과나 운영 데이터 검증으로 해석하지 마세요.
