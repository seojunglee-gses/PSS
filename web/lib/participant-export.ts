import type { ParticipantExport, ExportRecord } from "./participant-export-server";

export type ExportFiles = Record<string, Uint8Array>;
export const exportFileName = (name: string) => name.replace(/[^a-zA-Z0-9가-힣@._-]/g, "_").replace(/^\.+/, "_").slice(0, 100) || "participant";
const bytes = (text: string) => new TextEncoder().encode(text);
const json = (value: unknown) => bytes(JSON.stringify(value, null, 2));
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
function csv(rows: unknown[][]) {
  return bytes("\ufeff" + rows.map(row => row.map(value => {
    let text = value === null || value === undefined ? "" : String(value);
    // CSV is a convenience view; preserve exact values in the accompanying JSON.
    if (/^[\s]*[=+@-]/.test(text) || /^[\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }).join(",")).join("\r\n"));
}
export function participantExportFiles(data: ParticipantExport): ExportFiles {
  const files: ExportFiles = {};
  files["participant.json"] = json({ schemaVersion: data.schemaVersion, exportedAt: data.exportedAt, projectId: data.projectId, userId: data.userId, participantId: data.participantId });
  files["conversation.json"] = json({ steps: data.steps, legacy: data.legacyChat });
  files["summaries.json"] = json({ personal: data.personal, workspace: data.summary });
  files["evaluations.json"] = json({ evaluations: data.evaluations, submissions: data.submissions, publishedImages: data.publishedImages });
  files["images.json"] = json(data.generatedImages);
  const activity: unknown[] = [];
  const dialogue: unknown[][] = [["source_path", "stage", "archive", "source_index", "message_id", "session_id", "created_at", "sender", "text", "image_id"]];
  const logs = (record: ExportRecord | null, stage: string, archived: boolean, values: unknown) => {
    if (!record || !Array.isArray(values)) return;
    values.forEach((value, sourceIndex) => {
      const log = object(value);
      dialogue.push([record.path, stage, archived, sourceIndex, log.id ?? log.messageId, log.sessionId ?? record.data.sessionId, log.createdAt, log.sender, log.text, log.imageId]);
      if (log.activity || log.sender === "system" || log.type === "activity" || log.type === "event") activity.push({ sourcePath: record.path, stage, archived, sourceIndex, log: value });
    });
  };
  for (const step of data.steps) {
    logs(step.document, step.stageId, false, step.document?.data.logs);
    for (const archive of step.archives) logs(archive, step.stageId, true, object(archive.data.previous).logs);
  }
  const legacy = data.legacyChat?.data;
  if (legacy?.logsByStep && typeof legacy.logsByStep === "object") {
    for (const [stage, values] of Object.entries(legacy.logsByStep)) logs(data.legacyChat, stage, false, values);
  } else logs(data.legacyChat, "legacy", false, legacy?.logs);
  files["conversation.csv"] = csv(dialogue);
  files["activity-logs.json"] = json({ coverage: "Recorded activity events only; not a complete clickstream. Legacy and archived sources may overlap.", entries: activity });
  files["rankings.csv"] = csv([["record_id", "source_path", "submitted_at", "user_id", "image_id", "rank"], ...data.evaluations.flatMap(row => Object.entries(object(row.data.rankings)).map(([imageId, rank]) => [row.id, row.path, row.data.submittedAt, row.data.userId, imageId, rank]))]);
  data.generatedImages.forEach((image, index) => {
    const base = `images/${String(index + 1).padStart(3, "0")}-${exportFileName(image.id)}`;
    files[`${base}.json`] = json(image);
    files[`${base}-prompt.txt`] = bytes(typeof image.data.note === "string" ? image.data.note : "");
  });
  files["README.txt"] = bytes(`PPSS 참여자 연구자료 내보내기\n\n사업: ${data.projectId}\n참여자: ${data.participantId}\n내보낸 시각: ${data.exportedAt}\n\nJSON은 저장된 원문 필드와 문서 ID·경로를 보존합니다. CSV는 열람용이며 수식으로 인식될 수 있는 값 앞에는 작은따옴표를 붙였습니다.\nconversation.json에는 단계별 원문과 과거 저장 형식, 초기화 전 보관 기록을 별도로 담습니다. 같은 발언이 여러 저장 형식에 존재할 수 있으므로 전체를 합산하지 마세요.\nevaluations.json에는 평가 원문·선택 기록 및 제출 이미지 연결을 담습니다. rankings.csv는 순위만 펼친 열람용 자료입니다.\nimages.json과 images/에는 모든 저장된 생성·수정 버전, 프롬프트(note), 모델 설정 및 부모 이미지 연결 등 기존 메타데이터가 있습니다. 프롬프트가 저장되어 있지 않으면 새로 생성하지 않습니다.\nactivity-logs.json에는 저장된 사례·논문·지도 열람 등의 명시적 이벤트만 담습니다. 과거에 수집하지 않은 클릭·체류시간·로그인 이력은 복원하지 않습니다.\n원본 이미지 다운로드 실패는 image-downloads.json에 기록됩니다. 이미지 URL·메타데이터와 나머지 연구 기록은 유지됩니다.\n내보내기는 순차 읽기이며 여러 문서 전체에 대한 단일 시점 스냅샷은 아닙니다. 원본 DB 및 Storage에는 쓰지 않습니다.\n`);
  return files;
}
