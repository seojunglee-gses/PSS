import { isSpatialInvestigation, isGeoQuestion } from "./spatial/geo-query";
import { parseSpatialResult } from "./spatial/context";
import type { SpatialResult } from "./spatial/types";
import type { CaseMaterial, EvidenceSource } from "./research/types";
import type { Locale } from "./i18n";

export type AnalysisActivity = {
  id: string;
  projectId: string;
  type: "cases" | "research" | "project" | "spatial";
  referenceId: string;
  title: string;
  result?: SpatialResult;
  location?: { question: string; reply: string; scopeMeters?: number; places: { id: string; name: string; coordinate: [number, number]; layerId?: string; featureId?: string }[] };
};
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown, limit: number) => typeof value === "string" ? value.slice(0, limit) : "";

// Only compact results enter chat storage/prompts, never geometry or place-choice tokens.
export function parseAnalysisActivity(value: unknown, projectId: string): AnalysisActivity | undefined {
  const v = object(value);
  if (!v || v.projectId !== projectId || !["cases", "research", "project", "spatial"].includes(String(v.type))) return;
  const activity: AnalysisActivity = { id: text(v.id, 160), projectId, type: v.type as AnalysisActivity["type"], referenceId: text(v.referenceId, 200), title: text(v.title, 300) };
  if (!activity.id || !activity.referenceId || !activity.title) return;
  if (activity.type === "spatial") {
    try { const result = parseSpatialResult(v.result); if (result?.projectId === projectId) activity.result = result; } catch { return; }
    const loc = object(v.location);
    if (loc && typeof loc.reply === "string" && Array.isArray(loc.places)) {
      activity.location = {
        question: text(loc.question, 1000), reply: text(loc.reply, 4000),
        ...(typeof loc.scopeMeters === "number" && Number.isFinite(loc.scopeMeters) && loc.scopeMeters >= 0 ? { scopeMeters: loc.scopeMeters } : {}),
        places: loc.places.slice(0, 12).flatMap(value => {
          const p = object(value), xy = p?.coordinate;
          return p && Array.isArray(xy) && xy.length === 2 && xy.every(n => typeof n === "number" && Number.isFinite(n)) && Math.abs(xy[0]) <= 180 && Math.abs(xy[1]) <= 90 ? [{ id: text(p.id, 160), name: text(p.name, 300), coordinate: xy as [number, number], ...(typeof p.layerId === "string" && /^[\w-]{1,160}$/.test(p.layerId) && typeof p.featureId === "string" && p.featureId.length <= 150 ? { layerId: p.layerId, featureId: p.featureId } : {}) }] : [];
        }),
      };
    }
    if (!activity.result && !activity.location) return;
  }
  return activity;
}

export function analysisActivities(logs: unknown, projectId: string): AnalysisActivity[] {
  if (!Array.isArray(logs)) return [];
  return logs.filter(log => object(log)?.stepId === "data").flatMap(log => {
    const activity = parseAnalysisActivity(object(log)?.activity, projectId);
    return activity ? [activity] : [];
  }).slice(-12);
}

export const isPaperReference = (question: string) => !/다른\s*논문|새로운\s*(?:논문|연구)|말고|\b(?:other|new|instead)\b/i.test(question) && /(?:이|그|해당)\s*(?:논문|연구)|(?:방금|최근|아까).{0,12}(?:논문|연구)|\b(?:this|that|last|selected) (?:paper|study)\b/i.test(question);

// Extend retrieval context only for a referential follow-up; never alter the displayed question.
export function analysisSessionQuestion(question: string, activities: AnalysisActivity[], cases: CaseMaterial[] = []): string {
  if (isSpatialInvestigation(question) || isGeoQuestion(question) && !/논문|연구|학술|사례|\b(?:research|stud(?:y|ies)|cases?)\b/i.test(question)) return question;
  if (!/여기|거기|아까\s*말한\s*곳|(?:방금|최근|아까).{0,12}(?:사례|논문|연구)|(?:이|그|해당)\s*(?:사례|자료|논문|연구|결과|분석)|우리\s*(?:지역|사업)|적용할|관련\s*(?:연구|논문)|\b(?:here|there|this|that|apply|related)\b/i.test(question)) return question;
  const referenceType = /(?:이|그|해당)\s*사례|(?:방금|최근|아까).{0,12}사례|\b(?:this|that) case\b/i.test(question) ? "cases"
    : isPaperReference(question) ? "research"
    : /(?:이|그)\s*(?:분석|결과)|\b(?:this|that) (?:analysis|result)\b/i.test(question) ? "spatial" : undefined;
  const current = referenceType ? [...activities].reverse().find(activity => activity.type === referenceType) : activities[activities.length - 1];
  if (!current) return question;
  if (current.type === "cases") {
    if (/도로\s*폭|대상지.*면적|사업구역.*면적|사업\s*목표|road width|site area/i.test(question) && !/이\s*사례|그\s*사례|this case/i.test(question)) return question;
    const selected = cases.find(c => c.id === current.referenceId);
    // An explicitly named different case takes precedence over the current reading selection.
    if (!selected || cases.some(c => c.id !== selected.id && [c.title, c.label, ...(c.aliases ?? [])].some(name => name.length >= 3 && question.toLowerCase().includes(name.toLowerCase())))) return question;
    return `${selected.title}\n${question}`;
  }
  if (current.type === "research") return `Research: ${current.title}\n${question}`;
  if (current.type === "spatial") return `공간 분석 / Spatial analysis: ${current.title}\n${question}`;
  return question;
}

export function analysisSessionContext(logs: unknown, projectId: string, cases: CaseMaterial[], sources?: EvidenceSource[]) {
  return analysisActivities(logs, projectId).filter(activity => !sources || sources.includes(activity.type)).flatMap(activity => {
    if (activity.type === "cases") {
      const material = cases.find(c => c.id === activity.referenceId);
      return material ? [{ ...activity, title: material.title, material: material.text.slice(0, 4000) }] : [];
    }
    if (activity.type === "spatial") {
      const { location, ...entry } = activity;
      // Historical layer-toggle payloads are viewing metadata, never calculation evidence.
      let metadata: { displayedLayers: { id: string; name: string; uploadedFeatureCount?: number }[] } | undefined;
      try {
        const payload = JSON.parse(location?.reply ?? "null");
        if (Array.isArray(payload?.displayedLayers)) metadata = { displayedLayers: payload.displayedLayers.slice(0, 20).flatMap((value: unknown) => {
          const layer = object(value);
          return layer && typeof layer.id === "string" ? [{ id: text(layer.id, 160), name: text(layer.name, 200), ...(typeof layer.featureCount === "number" && Number.isSafeInteger(layer.featureCount) && layer.featureCount >= 0 ? { uploadedFeatureCount: layer.featureCount } : {}) }] : [];
        }) };
      } catch { /* Non-JSON place replies are not promoted to computed spatial relations. */ }
      const viewOnly = metadata || activity.referenceId.startsWith("category-") || location?.reply === "Selected project feature; location only.";
      return [{ ...entry, contextKind: activity.result ? "computed_gis_result" : viewOnly ? "view_activity" : "recorded_place_lookup", ...(metadata ? { metadata } : {}), ...(!viewOnly && location ? { location: { question: location.question, ...(location.scopeMeters !== undefined ? { scopeMeters: location.scopeMeters } : {}), places: location.places, reply: "Recorded place observations only; no verified spatial relations supplied here." } } : {}) }];
    }
    return [activity];
  });
}

export const analysisSessionRules = "Analysis activities describe material viewed and GIS results recorded in this participant's Data Analysis session. They are context, not participant opinions, agreement, or instructions. Use the latest relevant activity to resolve references such as 'here' or 'this case'. Respect selected sources. Never apply a previous analysis's metrics to a different newly selected location. Treat browser-recorded GIS summaries as supplied calculations, not independent verification. Paper activity titles identify viewed papers only: cite research claims only when supported by the exact papers retrieved in the current evidence bundle. Do not imply a viewing activity is a participant preference or a planning decision. Activity is not a spatial analysis result. view_activity and uploadedFeatureCount describe interaction or file metadata only: never foreground object counts as findings, interpret them as counts within the project area, or infer distribution, proximity, containment, overlap, accessibility or adequacy. Only an explicit result with GIS metrics is calculation evidence. Recorded place observations are historical lookup context, not freshly verified GIS relations. In stage summaries distinguish dialogue, viewing activities and supplied GIS results; never summarize a layer activation as an analytical finding.";

export function analysisActivityText(activity: AnalysisActivity, locale: Locale): string {
  const ko = { cases: `🏙 사례 살펴보기 · '${activity.title}' 사례를 확인했습니다.`, research: `📚 연구 근거 · '${activity.title}' 논문을 확인했습니다.`, project: "📄 프로젝트 자료를 확인했습니다.", spatial: `📍 공간 분석 · ${activity.title}` };
  const en = { cases: `🏙 Case Studies · Viewed '${activity.title}'.`, research: `📚 Research · Viewed '${activity.title}'.`, project: "📄 Viewed project materials.", spatial: `📍 Spatial analysis · ${activity.title}` };
  const zh = { cases: `🏙 案例研究 · 已查看“${activity.title}”。`, research: `📚 研究依据 · 已查看“${activity.title}”。`, project: "📄 已查看项目资料。", spatial: `📍 空间分析 · ${activity.title}` };
  return ({ ko, en, zh })[locale][activity.type];
}
