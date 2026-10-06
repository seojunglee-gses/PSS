# 건물 용도 코드 기준 자료

원본은 사용자가 첨부한 `buinding code.xlsx`의 **건축물용도코드 조회자료** 시트입니다. `코드값`, `코드값의미`, `비고` 열을 읽었습니다. 원본 파일을 `data/reference/source/buinding code.xlsx`에 바이트 그대로 보관했습니다. 첨부 파일과 보관 파일의 SHA-256은 모두 `1ab10ef0f71374d459bb236403b0fa5c92ca3039aa26b24917dface095388866`입니다.

## 변환

`web` 디렉터리에서 Python 표준 라이브러리만으로 실행합니다. 추가 Excel 패키지나 런타임 설치는 필요하지 않습니다.

```sh
python3 scripts/build-building-use-codes.py
# 다른 개정 원본을 사용할 때:
python3 scripts/build-building-use-codes.py --source /path/to/updated.xlsx
```

결과는 비공개 서버 자료 `data/reference/building_use_codes.json`이며 `{ "03000": { "name": "제1종근린생활시설", "note": "2009년 12월 24일 개정" } }` 형식입니다. 상세 검증 기록은 `data/reference/building_use_codes.report.json`에 보관합니다. 두 파일과 원본은 `public`에 넣지 않습니다.

변환 결과:

| 항목 | 결과 |
| --- | --- |
| 읽은 Excel 행 | 969행: 헤더 1행 + 데이터 968행 |
| 유효한 5자리 코드 행 / 고유 코드 | 694행 / 694개 |
| 중복 / 충돌 / 형식 오류 | 0 / 0 / 0 |
| 앞자리 0을 보존한 코드 | 293개 |
| 제외한 4자리 코드 | 274개 |
| 제외 행 중 5자리 변경 표시 | 271개 |
| 변경 표시 없는 제외 행 | `0000`(기타), `7001`(축사), `7002`(가축시설) |

4자리 값을 0으로 채우거나 다른 코드로 추정하지 않았습니다. 예를 들어 과거 `3000`의 뜻은 `근린생활시설`로, 현재 `03000`의 뜻과 같다고 볼 수 없으므로 별개로 취급합니다. 변경 표시 없는 세 행도 보고서에서 검토할 수 있습니다.

동일 코드·동일 의미는 합치고 서로 다른 의미는 충돌로 보고합니다. 동일 의미의 여러 행에 다른 비고가 있으면 모두 보존합니다. 충돌/형식 오류/수식 셀이 있으면 보고서를 남기고 실패하며 기존 JSON을 덮어쓰지 않습니다. 숫자 값에서 사라진 앞자리 0을 임의로 복원하지 않습니다.

| 코드 | 원본에 있는 이름 |
| --- | --- |
| `03000` | 제1종근린생활시설 |
| `14000` | 업무시설 |
| `02000` | 공동주택 |
| `04000` | 제2종근린생활시설 |

## 실행 시 조회와 저장

`lib/spatial/building-use-server.ts`만 기준 JSON을 import합니다. 서버 프로세스/인스턴스가 시작할 때 모듈에 로드되어 재사용됩니다. API 요청 중 Excel을 읽거나 변환 스크립트를 실행하지 않습니다. 코드표는 사용자 업로드·편집 항목이 아닙니다.

새 건물 자료 업로드·교체 시 용도 정보를 붙인 GeoJSON을 **한 번 처리하여 별도로 저장**합니다. 원본은 기존 경로에 그대로 남깁니다. 이후 공간 분석 요청은 저장된 처리 결과를 읽으며 기준표를 다시 대조하지 않습니다.

- 원본: 기존 `ppss-spatial-datasets/{projectId}/{datasetId}/{revisionId}/original.{ext}`.
- 처리 결과: 같은 폴더의 `normalized-{buildingUseVersion}-{normalizedId}.geojson`.
- 기존 메타데이터 문서에 선택 필드 `normalizedStoragePath`, `normalizedId`, `buildingUseVersion`을 추가합니다. `buildingUseVersion`은 서버 JSON 내용의 SHA-256입니다. 인증/권한/참여 문서는 변경하지 않습니다.

이전 업로드는 처음 읽을 때 결과를 저장한 후 재사용합니다. 기준 JSON이 바뀌면 버전을 비교하여 최초 읽기에서만 다시 처리합니다. 코드표 갱신은 스크립트 실행→JSON 검토·커밋→서버 재배포로 적용합니다. 파일 교체 시 새 revision에 다시 처리하며 삭제·교체 시 원본과 처리 결과를 함께 정리합니다. 동시 최초 읽기는 하나의 결과만 연결하고 나머지 임시 파일을 정리합니다. 처리 결과를 저장할 때 참여 권한과 현재 자료 버전을 재확인합니다. 기존 Storage 정리 실패 시 비공개 미참조 파일이 남을 수 있다는 제한은 그대로입니다.

원본과 처리 결과 모두 기존 3MiB 제한을 검사합니다. 용도 정보를 추가하여 처리 결과가 제한을 넘으면 파일을 나눠 업로드하도록 안내합니다. Storage 직접 접근 제한은 기존 공간정보 경로를 재사용하며 공개 다운로드 URL을 만들지 않습니다.

정적 공개 건물 레이어는 `/api/spatial/building-use-codes`에 **고유한 5자리 코드만** 보내 서버 이름을 조회하고, 브라우저에서 해당 레이어의 처리 결과를 캐시합니다. 공간 분석을 다시 실행할 때 조회를 반복하지 않습니다. 이 API는 요청된 코드의 기준 이름만 반환하고 코드표 업로드·수정이나 사업 파일 저장을 받지 않습니다. 정적 자료·기준표 배포 후 열린 브라우저는 새로고침하여 새 캐시를 사용합니다. 비공개 사업 건물 자료를 사용자 간 공유 브라우저 메모리 캐시에 넣지 않습니다.

## 해석 일관성

`use_code`를 우선하고, 이 필드가 없을 때 명시적인 코드 필드 `mainPurpsCd`, `main_purps_cd`, `용도코드`를 지원합니다. 임의 속성(예: 숫자 열 `A9`)을 용도 코드라고 추정하지 않습니다. 원래 속성과 도형은 유지하고 정규화 결과에 문자열 `use_code`와 기준 JSON의 `use_name`을 붙입니다. 업로드된 임의 `use_name`은 기준 이름으로 대체합니다.

정확히 일치하지 않는 값(`XXXXX`, `3000`, 누락 등)은 코드를 유지하고 `use_name: "용도 정보 없음"`으로 표시합니다. 앞자리 0을 채우거나 상위 용도를 추정하지 않습니다.

기존 지도 속성 표시 목록에 `use_name`/`use_code`만 연결합니다. 기존 영역·버퍼 통계의 건물 수를 용도 코드별로 집계하여 `buildingUses`에 담고 기존 요약 텍스트 영역에 표시합니다. 요약은 개수가 많은 20개 코드를 담으며 생략된 코드 수를 알립니다. 전체 건물 수는 유지합니다. 저장된 요약 복원도 이 필드를 보존합니다.

AI 답변 API는 전달받은 용도별 집계의 이름을 서버 JSON으로 확인한 후 모델에 전달합니다. 따라서 임의 이름을 모델에 주지 않으며 `use_name`으로 설명하고 `use_code`로 추적할 수 있습니다. 집계는 기존 클라이언트 GIS 결과이며 서버가 독립 검증한 통계라고 주장하지 않습니다. 지도 속성·기존 요약 표현만 연결하고 자료 분석 레이아웃이나 업로드 UI는 변경하지 않습니다.

## 검증과 변경 파일

검사 대상은 변환 재현/원본 해시/중복·충돌 처리(Python), 실제 Firestore 에뮬레이터의 업로드·저장 재사용·이전 자료·버전 변경·동시 최초 처리·권한 회수, 서버 조회 API, 정적 레이어 캐시, 지도 속성, 용도별 통계·복원 및 실제 답변 API의 모델 전달 값입니다. 인증과 Storage는 테스트 구현이며 운영 Firebase 검증으로 해석하지 않습니다. 사용자가 건물 GeoJSON을 첨부하지 않았고 저장소의 공개 사업 데이터에도 실제 건물 파일이 없으므로 GeoJSON 코드 매칭은 `03000` 등으로 구성한 테스트 자료를 사용합니다.

2026-10-06 결과: Python 변환 검사 3개, 공간정보/건물 용도 검사 25개, 연구·공간·대화 검사 40개(총 68개) 통과. 프로덕션 빌드/TypeScript와 변경 모듈 ESLint 통과. 브라우저에서 실제 업로드 건물의 지도 속성 `제1종근린생활시설`/`03000`, 기존 요약의 용도별 1동 집계, 원래 저장·교체·삭제·권한 차단과 모바일 가로 넘침 없음을 확인했습니다. 브라우저 오류와 배경 문서 업로드 호출은 없었습니다. 기준 JSON의 원본 이름/비고가 브라우저 정적 JS 번들에 포함되지 않는 것도 확인했습니다. 운영 배포는 하지 않았습니다.

- 자료: `data/reference/source/buinding code.xlsx`, `data/reference/building_use_codes.json`, `data/reference/building_use_codes.report.json`.
- 변환: `scripts/build-building-use-codes.py`.
- 서버 조회/공통 해석: `lib/spatial/building-use-server.ts`, `lib/spatial/building-use.ts`, `pages/api/spatial/building-use-codes.ts`.
- 기존 공간 처리 연결: `lib/spatial/dataset-server.ts`, `lib/spatial/datasets.ts`, `lib/spatial/loader.ts`, `lib/spatial/engine.ts`, `lib/spatial/types.ts`, `lib/spatial/context.ts`, `components/spatial/SpatialSummary.tsx`.
- AI 공간 맥락: `lib/research/evidence.ts`, `lib/research/answer.ts` (논문 검색/OpenAlex·제공자 선택 로직 유지).
- 검사: `tests/test_building_use_conversion.py`, `tests/building-use.test.mjs`, `tests/spatial-datasets.test.mjs`, `tests/research.test.mjs`, `tests/run-spatial-dataset-tests.sh`, `tests/run-research-tests.sh`.
- 문서: `docs/building-use-reference.md`, `docs/spatial-datasets.md`.
