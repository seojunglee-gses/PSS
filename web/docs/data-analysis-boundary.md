# 자료 분석 화면·사업구역 경계 연동

## 화면과 대화

자료 분석 제목/설명을 문제 정의와 같은 제목 스타일로 복원했습니다. 사례 살펴보기·공간 분석·답변 근거 탭과 좌우 패널은 유지합니다. 문제 정의의 본문/편집 UI는 바꾸지 않았습니다.

공간 분석의 별도 자연어 입력창과 전송 버튼을 제거했습니다. ‘우리 지역 살펴보기’의 세 주제(지역의 공간적 특징, 생활환경과 접근성, 지역의 문제와 개선 가능성)는 설명/추천 질문만 바꾸며 API를 호출하지 않습니다. 추천 질문을 누르면 Workspace의 기존 `handleSend`를 호출합니다. 기존 수동 자료 선택도 유지합니다.

왼쪽은 지도·자료·결과·장소 중복 선택을 표시합니다. 오른쪽은 기존 대화 및 설명을 담당합니다. 도구 실행의 후속 장소 선택은 기존 요청을 이어서 해결하며 별도 대화 세션을 만들지 않습니다. 같은 접속에서 최근 공간 답변은 후속 질문의 기존 대화 맥락에도 포함합니다. Kakao 결과의 영구 저장 제한은 유지합니다.

기존 네 가지 계산 도구는 ‘세부 공간 분석 도구’에 접어 두었습니다. 지도에서 숨긴 건물/필지도 계산에 사용할 수 있도록 표시 여부와 계산 대상은 구분합니다. Turf 계산 함수 자체를 복제하거나 바꾸지 않았습니다.

## 사업별 경계 설정과 저장

기존 `/api/projects/spatial-datasets`, `SpatialDatasetManager`, Firebase Admin Storage 업로드, 메타데이터 컬렉션을 재사용합니다. `project_boundary` 유형은 기존에 있었으며 새 이름으로 바꾸지 않았습니다.

프로젝트 문서의 새 선택 필드:

```json
{
  "spatialSettings": {
    "activeBoundaryDatasetId": "existing-uploaded-dataset-id-or-null",
    "defaultNearbyMeters": 500
  }
}
```

- 위치: `ppssProjects/{projectId}`. 하나의 ID만 활성 경계입니다. 기본 검색 범위는 내부(0), +500m, +1km 중 하나입니다.
- 데이터셋: 기존 `ppssSpatialDatasets_{projectId}/{datasetId}`에 `sourceCrs`, `boundaryMetadata: {bbox, center, areaSqm}`만 추가합니다. 지오메트리를 Firestore에 중복 저장하지 않습니다.
- 원본 파일: 기존 `ppss-spatial-datasets/{projectId}/{datasetId}/{revisionId}/original.{format}` 경로 그대로입니다. 원본 바이트는 변경하지 않습니다.
- 설정에서 기존 업로드 폼으로 파일 등록 → 경계 자료 선택 → 미리보기 → 저장합니다. 기존 파일 선택과 기본 검색 거리 저장을 함께 지원합니다.
- 경계 교체/해제에는 확인을 받습니다. 활성 데이터셋 파일 교체/삭제도 확인합니다. 설정에서 연결만 해제하면 파일은 유지합니다. 파일 삭제 버튼은 기존 방식대로 원본과 메타데이터를 삭제하며 활성 연결도 해제합니다.
- 다른 건물·필지·시설 자료는 삭제하지 않습니다. 기존 파일 교체 시 이전 버전 파일을 정리하는 기존 동작도 유지합니다.
- 서버의 기존 사업/시스템 관리자 판정과 트랜잭션을 재사용합니다. 참여자는 활성 경계를 변경할 수 없습니다. 다른 사업의 데이터셋은 지정할 수 없습니다. 활성 ID와 선택 파일 리비전의 변경을 확인해 오래된 설정으로 덮어쓰는 것을 막습니다.

## 지오메트리와 좌표계

Polygon/MultiPolygon Feature 및 FeatureCollection을 지원합니다. 좌표·링·자기 교차·도형 유형을 검증합니다. 최대 파일 크기는 기존 3MB, 경계 Feature 수는 500개입니다. 여러 Feature는 파생 계산에서 합집합으로 묶어 중복 면적을 제거합니다. 원본은 유지합니다.

- WGS84/EPSG:4326: 원본 좌표계 선택 또는 신뢰할 수 있는 파일 CRS 메타데이터로 확인합니다.
- Web Mercator/EPSG:3857: 원본은 그대로 보관하고, 읽기/파생 계산 시 복사본을 WGS84로 변환합니다.
- 메타데이터와 사용자 선택이 다르면 거절합니다. 메타데이터가 없는 신규 경계 파일은 명시적 확인 없이 추측하지 않습니다.
- 기존 좌표계 기록이 없는 업로드를 활성화할 때도 WGS84 확인이 필요합니다. 기존 업로드는 이미 경위도 범위 검증을 통과한 자료입니다.
- EPSG:5179 등은 지원하지 않습니다. GIS 프로그램에서 EPSG:4326 또는 EPSG:3857로 변환한 뒤 등록해야 합니다.

면적·경계 전체 버퍼는 Turf의 지리 계산을 사용합니다. 중심이 도형 밖이나 구멍에 있으면 도형 위의 대표점을 사용합니다. 경계가 바뀌면 최신 파일 리비전으로 파생 값을 다시 구합니다. 지도는 활성 경계 bbox에 맞추며 기본 레이어는 경계와 주요 시설입니다. 건물/필지는 숨기되 읽기·선택·계산은 유지합니다. ‘사업구역으로 돌아가기’는 경계 extent로 돌아가 임시 표시를 숨기며 대화/원본/저장 기록은 지우지 않습니다.

## Kakao 공간 검색

Kakao 검색에 지오메트리를 직접 보내지 않습니다. 선택한 사업 경계 전체에 0/500/1000m 버퍼를 적용하고, 이를 포함하는 검색 창을 최대 4개 사용합니다. 길쭉하거나 분리된 경계도 고려합니다. 검색 응답은 반드시 실제 반환 좌표로 point-in-polygon 검사하여 경계/버퍼 밖 후보와 구멍 안 후보를 제외합니다.

페이지당 최대 15건, 검색당 외부 요청 최대 6회, 페이지 최대 3쪽으로 제한하고 장소 ID를 중복 제거합니다. 폭넓은 편의시설 질문은 지원 업종(편의점·약국·병원·카페·주민센터)을 같은 제한 내에서 조회합니다. 이것은 전체 업체 조사나 완전한 최단 시설 순위가 아닙니다. 제한을 결과에 표시합니다.

‘서울역 근처’처럼 다른 출발 위치를 명시하면 해당 위치를 존중합니다. 선택 위치가 사업 범위 밖인 경우에도 그 위치 중심의 기존 검색을 사용할 수 있습니다. 활성 경계가 없으면 경계 필터를 쓰지 못한다는 안내와 함께 선택 위치/지도 중심으로 기존 검색을 수행합니다. 특정 상호·장소 중복 선택·실제 도보 경로·직선 거리 구분은 유지합니다. 도보 도달권을 원형 버퍼로 대신하지 않습니다.

자료 기반 면적·건물 수·시설 위치 질문은 서버에서 권한 있는 실제 사업 레이어로 처리합니다. 자료에 없는 도로폭·인구·이용 행태를 만들어내지 않습니다. 해석 질문에 전달하는 선택 도형도 서버의 실제 레이어 ID/Feature ID로 확인합니다. 참여자의 관찰·해석·가설과 측정값을 구분하고, 불완전한 자료로 위험/수요 부족/재개발 필요/주민 합의를 단정하지 않도록 답변 지침을 보완했습니다.

## 개인 기록과 3단계 연결

기존 프로젝트 요약 문서는 사업 구성원이 읽을 수 있으므로 개인 기록을 추가하지 않았습니다. 이미 본인만 읽고 쓸 수 있는 단계별 대화 문서에 선택 필드를 추가했습니다:

`users_{projectId}/{uid}/steps/data.analysisReview`

```json
{
  "findings": [{"id":"stable-id","kind":"observation","text":"personal note","createdAt":"ISO time","sources":["uploaded-dataset-id"]}],
  "summary": {"conditions":"", "issues":"", "opportunities":""},
  "updatedAt":"ISO time"
}
```

새 `/api/projects/analysis-review`의 GET/POST는 로그인한 본인의 문서만 사용합니다. 사용자 ID를 요청 본문에서 받지 않습니다. 위치 저장은 실제 프로젝트 지오메트리를 확인하고, 계산 저장은 기존 Turf 함수로 서버에서 재계산합니다. 참여자 관찰/문제/개선 가능성/계획 해석은 의견으로 구분합니다. 레코드는 40개, 메모는 1,500자, 요약 항목은 각각 3,000자 이하입니다.

저장한 기록으로 빈 요약 초안을 만들거나 ‘지역 현황·주요 문제·개선 가능성’을 직접 검토/수정할 수 있습니다. 단계 완료 확인창에서 검토로 돌아갈 수 있습니다. 기존 단계 완료·요약 보고서·관리자 잠금은 교체하지 않았으며, 완료/잠긴 단계의 새 기록 수정도 서버에서 거절합니다.

3단계 이후의 기존 `loadProjectContext`에서 해당 로그인 사용자의 검토 기록만 읽습니다. 저장 당시의 개인 기록임을 밝히며 최신 데이터의 사실이나 주민 전체의 합의로 취급하지 않습니다. 단계 요약은 비공개 초안으로 생성해 참여자가 검토하며, 공동 보고서에는 사용자가 공유를 선택한 검토 문장만 전달합니다. 개인 검토 문서 자체를 공개하지 않습니다. 새 Firestore 컬렉션·Storage 경로·보안 규칙은 만들지 않았습니다. 기존 대화 문서에는 merge로 기록하여 대화 로그를 덮어쓰지 않습니다.

## 검증과 운영

기존 Kakao 환경변수는 그대로 사용합니다. 서버리스 함수에서 공개 프로젝트 파일도 읽도록 관련 API의 파일 추적 범위를 지정했습니다. 새 의존성은 없습니다. 운영 배포는 실행하지 않습니다.

- 연구/공간/대화/지역화 자동 검증: `bash web/tests/run-research-tests.sh`
- 업로드·권한·실제 Firestore 규칙·개인 기록·사업 경계 검증: `bash web/tests/run-spatial-dataset-tests.sh`
- 기존 프로젝트/회원 회귀: `bash web/tests/run-membership-tests.sh`
- 타입 검사와 프로덕션 빌드, 변경 파일 lint 비교 수행.
- 브라우저: 기존 업로드 → 미리보기 → 활성 저장 → 새로고침, 기본 레이어/상세 레이어, 추천 질문 단일 대화 전달, 개인 위치/관찰/요약 저장·복원, 초기화, 문제 정의 유지, 1440/820/1180/390px 확인.

Kakao SDK는 브라우저 테스트용 대체 구현, 외부 검색/도보 응답은 자동 테스트 fixture를 사용했습니다. 실제 사업 경계/업체/도보 경로와 유효 키 지도는 운영 Preview에서 확인해야 합니다. 외부 API의 반환 수/페이지 제한으로 완전한 업체 목록은 보장하지 않습니다. 지원하지 않는 CRS는 외부 변환이 필요합니다.

## 변경 파일

- 화면: `pages/workspace/index.tsx`, `components/spatial/{SpatialAnalysis,NaturalLanguageGIS,SpatialMap,KakaoSpatialMap,OSMSpatialMap,SpatialDatasetManager,ProjectBoundarySettings,AnalysisReviewPanel}.tsx`, `lib/i18n.tsx`
- 경계·검색·기록: `lib/spatial/{boundary,analysis-review,dataset-server,datasets,geo-query,geo-server,kakao-server,loader,types}.ts`
- 대화/맥락: `lib/project-context-server.ts`, `lib/research/answer.ts`, `pages/api/workspace-summary.ts`
- API: `pages/api/projects/{spatial-datasets,analysis-review}.ts`, `pages/api/spatial/query.ts`
- 설정/검증: `next.config.js`, `tests/{boundary,spatial-datasets,localization}.test.mjs`, `tests/run-research-tests.sh`, `tests/run-spatial-dataset-tests.sh`, 본 문서

대화 진행·단계 요약 검토·명시적 공유의 추가 정책과 전체 최종 검증 결과는 [conversational-facilitation.md](conversational-facilitation.md)에 정리했습니다.
