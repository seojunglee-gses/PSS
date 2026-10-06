# 프로젝트 공간정보

프로젝트 설정(`/setting?projectId=...`)에 독립된 **공간정보** 섹션을 추가합니다. 배경 문서 업로드·추출·AI 정리와 파일/메타데이터를 공유하지 않습니다. 기존 공간 분석 기능만 연결하며 새 고급 GIS 분석과 Shapefile 지원은 추가하지 않습니다.

## 권한

홈에서 프로젝트 생성·수정 시 지정한 **해당 프로젝트 관리자**와 기존 전체 플랫폼 관리자는 로그인 후 설정에서 바로 공간정보를 업로드·교체·삭제할 수 있습니다. 별도 권한 지정은 필요하지 않습니다. 서버는 기존 `canManageProject`와 `ppssProjects/{projectId}.projectAdmin`을 그대로 사용합니다. 다른 사업 관리자, 일반 참여자, 도시계획가 관점만 선택한 사용자는 쓰기 권한이 없습니다.

공간정보 API는 Firebase ID token을 검증하고 현재 프로젝트 관리자 정보를 조회합니다. 파일 업로드 후 Firestore 트랜잭션에서도 관리자 정보를 다시 확인합니다. 홈에서 담당자를 변경하면 이전 담당자의 쓰기 권한은 사라지고 새 담당자가 바로 관리할 수 있습니다. 읽기는 기존 관리자 또는 유효한 사업 참여 기록이 있는 사용자만 허용합니다.

설정의 별도 공간정보 관리 권한 부여·회수 화면과 API는 제거했습니다. 이전 `ppssSpatialPermissions_{projectId}` 기록은 권한 판단에 사용하지 않으며 새 기록을 만들지 않습니다. 기존 기록을 삭제하거나 노출하지 않도록 Firestore 직접 접근 제한은 유지합니다.

## 저장

- Storage: `ppss-spatial-datasets/{projectId}/{datasetId}/{revisionId}/original.{geojson|json|csv}`.
- Firestore: `ppssSpatialDatasets_{projectId}/{datasetId}`.
- 메타데이터: `projectId`, `datasetId`, `name`, `type`, `fileName`(원본 파일명), `uploadedAt`(서버가 생성한 Firestore Timestamp), `uploadedBy`(UID), `storagePath`, `revisionId`, `size`, `format`, `geometryType`(polygon/line/point 또는 null).

기존 `base/{projectId}` Storage 경로와 `collection_{projectId}` Firestore 관례를 따릅니다. 원본 파일은 Storage에 저장하며 내용·공개 다운로드 URL·다운로드 토큰을 문서에 저장하지 않습니다. 실제 파일 읽기도 인증 API를 사용합니다.

자료 유형은 `project_boundary`, `buildings`, `parcels`, `roads`, `public_facilities`, `other`. 경계/건물/필지는 면 자료, 도로는 선 자료입니다. 필지용 신규 계산 역할은 추가하지 않습니다.

사업당 20개, 파일당 3MiB, UTF-8을 지원합니다. 기존 서버 업로드 방식의 Base64 요청이 서버리스 요청 크기 제한 안에 들어가도록 크기를 제한했습니다. 서버가 파일명·유형·크기·실제 내용을 검증합니다.

## 형식과 분석 연결

건물 용도는 [서버 기준 코드표](building-use-reference.md)로 해석합니다. 건물 자료를 처음 처리할 때 원본과 별도의 정규화 GeoJSON을 저장하고 선택 메타데이터 필드 `normalizedStoragePath`, `normalizedId`, `buildingUseVersion`으로 재사용합니다. 원본·처리 결과 모두 3MiB 이하이며 코드표 버전이나 업로드 파일이 바뀔 때만 다시 처리합니다.

GeoJSON/JSON은 GeoJSON Feature 또는 FeatureCollection으로 준비합니다. 기존 검증기로 EPSG:4326 좌표 범위, 도형 종류, 닫힌 면, 최대 20,000개 도형을 검사합니다. 임의 JSON을 좌표로 추측하지 않습니다.

CSV는 헤더 포함 20,000행/100열 이하입니다. 따옴표·쉼표·줄바꿈·BOM을 처리하며 longitude/latitude, lon/lat, lng/lat, 경도/위도 열은 점 레이어로 읽습니다. 잘못되거나 누락된 좌표는 거부합니다. 좌표 없는 CSV는 보관만 하고 설정/공간 분석 화면에 계산 불가 이유를 표시합니다. 도형·좌표·면적을 추정하지 않습니다.

기존 정적 `/data/projects/{projectId}/config.json`은 유지합니다. 인증된 업로드 목록을 추가 레이어로 결합합니다. 원본 업로드 파일은 사용자 간 공유 메모리 캐시를 사용하지 않습니다. 사용자 임의 원격 URL은 허용하지 않습니다.

교체는 datasetId를 유지하고 새 revisionId에 파일을 저장한 뒤 메타데이터를 트랜잭션으로 갱신합니다. 이전 버전을 기대한 동시 수정은 거부합니다. 실패한 저장은 새 파일을 정리하고 성공 후 이전 파일을 삭제합니다. 삭제는 메타데이터 제거 후 원본 파일을 정리합니다. Storage 정리 실패 시 비공개 미참조 파일이 남을 수 있으며 서버에 정리 실패를 기록합니다. 이전 버전/삭제된 자료는 읽기 API로 접근할 수 없습니다. 과거 대화와 공간 분석 요약은 변경하지 않습니다.

## 운영 적용

새 자료 경로는 `firestore.rules`에서 유효한 사업 참여자 읽기만 허용하고 모든 클라이언트 쓰기를 금지합니다. 이전에 사용한 권한 경로는 직접 읽기·쓰기 금지를 유지합니다. 기존 와일드카드에서 새 경로를 제외하여 제한 우회를 막습니다. Admin SDK API가 자료 메타데이터를 저장합니다.

저장소에는 운영 Storage 규칙이 없습니다. `spatial-storage-access.rules`는 **기존 버킷 규칙에 병합할 블록**이며 전체 규칙을 대체하는 파일이 아닙니다. `ppss-spatial-datasets/**`의 클라이언트 직접 읽기/쓰기를 금지하고 기존 광범위 allow 규칙에서도 이 접두어를 제외해야 합니다. 중첩 allow가 제한을 무력화하지 않도록 기존 이미지/배경 문서 경로의 정책은 보존합니다.

기존 `FIREBASE_SERVICE_ACCOUNT_KEY`와 버킷 설정을 재사용합니다. 애플리케이션·Firestore 규칙과 운영 Storage 제한을 함께 적용해야 합니다. 운영 규칙 조회/배포와 운영 로그인/파일 저장은 실행하지 않았습니다.

## 검증

2026-10-06: 실제 로컬 Firestore 에뮬레이터에서 공간정보 검사 14개 통과. 기존 프로젝트 생성→관리자 진입→별도 권한 없는 업로드→담당자 변경, 이전 권한 기록 무시/노출 차단, 부여·회수 API 거부, 원본/메타데이터 분리, 관리자 변경 중 업로드 차단, 버전 교체/충돌/삭제/회수, 직접 쓰기 차단, CSV/JSON 검증, 인증 로더, API 인증, 사업별 경로와 파일 수 제한을 검사했습니다. Storage Bucket은 메모리 테스트 구현을 사용했습니다.

기존 참여/보안 검사 14개, 연구/공간/대화 저장 검사 39개 통과. TypeScript 포함 프로덕션 빌드와 새 모듈 lint 통과. 관련 없는 기존 lint 오류는 수정하지 않았습니다.

브라우저에서 관리자 GeoJSON 업로드·새로고침·JSON 교체·삭제, 좌표 CSV와 보관 전용 CSV, Shapefile 거부, 업로드한 레이어의 실제 지도 표시와 기존 면적 계산을 확인했습니다. 별도 권한 지정 없이 프로젝트 관리자의 업로드가 가능하며 권한 부여·회수 항목이 표시되지 않는지 확인했습니다. 390px 모바일 가로 넘침 없음, 일반 참여자/계획가 관점의 관리 화면·API 차단, 참여 회수 후 읽기 거부, 플랫폼 관리자 관리 화면을 확인했습니다. 브라우저 오류와 배경 문서 업로드 호출은 없었습니다.

브라우저는 실제 설정/공간 분석 컴포넌트, 실제 프로젝트/공간정보 API, 로컬 Firestore를 사용했습니다. 인증과 Storage는 테스트 구현이며 운영 Firebase 검증으로 해석하지 않습니다.

검증 명령: 로컬 Firestore 실행 후 `bash tests/run-spatial-dataset-tests.sh`, `bash tests/run-membership-tests.sh`, `bash tests/run-research-tests.sh`, `npm run build`.
