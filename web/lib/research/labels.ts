import type { Locale } from "../i18n";

const en = {
  evidence: "Evidence", analysisChat: "Analysis Chat", cases: "Case Studies", research: "Research Papers",
  choose: "Choose evidence sources", remove: "Remove", defaults: "No selection: use Case Studies and Research Papers.",
  caseEvidence: "Case Evidence", researchEvidence: "Research Evidence", browse: "Browse / edit project case materials",
  empty: "Ask a question to retrieve evidence. Results will appear here.", loading: "Retrieving evidence and preparing an answer…",
  scope: "Evidence scope: Abstract-based", scopeDetail: "Research findings use available abstracts, not full papers. Missing methods, sample sizes and statistics cannot be inferred.",
  papers: "relevant papers", period: "Publication period", topics: "Top topics", openAccess: "Open access", unknown: "Not available",
  citations: "citations", used: "Abstract available · used for synthesis", metadata: "Metadata only · no abstract · not used for synthesis",
  why: "Matched terms", contextual: "Project case material for contextual comparison; no direct keyword match.",
  question: "Evidence for", summary: "Summary", agreement: "What the studies agree on", differences: "Differences and context",
  integrated: "Integrated interpretation", implications: "Implications for this project", limitations: "Limitations of the available evidence",
  sources: "Sources supplied to the analysis", view: "View evidence", projectMaterial: "Project case material", researchFindings: "Key research findings",
  caseFindings: "Case-based findings and lessons", notable: "Most cited among retrieved papers", authorUnknown: "Authors not available",
  sourceHelp: "Choose one or more sources. Clear all selections to use both sources.", evidenceError: "The answer could not be completed. Retrieved evidence is shown below.",
};
type Labels = typeof en;
const ko: Labels = {
  evidence: "근거 자료", analysisChat: "분석 채팅", cases: "사례 연구", research: "연구 논문",
  choose: "근거 출처 선택", remove: "제거", defaults: "선택하지 않으면 사례 연구와 연구 논문을 모두 사용합니다.",
  caseEvidence: "사례 근거", researchEvidence: "연구 근거", browse: "프로젝트 사례 자료 보기 / 편집",
  empty: "질문을 보내면 검색된 근거가 여기에 표시됩니다.", loading: "근거를 검색하고 답변을 준비하는 중…",
  scope: "근거 범위: 초록 기반", scopeDetail: "논문 전체가 아닌 공개된 초록을 사용합니다. 없는 방법론, 표본 수, 통계는 추론할 수 없습니다.",
  papers: "개의 관련 논문", period: "발행 기간", topics: "주요 주제", openAccess: "오픈 액세스", unknown: "정보 없음",
  citations: "회 인용", used: "초록 있음 · 답변 근거로 제공", metadata: "메타데이터만 있음 · 초록 없음 · 답변 근거에서 제외",
  why: "일치하는 용어", contextual: "프로젝트 사례 비교 자료입니다. 질문과 직접 일치하는 검색어는 없습니다.",
  question: "이 질문의 근거", summary: "요약", agreement: "연구 간 공통점", differences: "차이점과 맥락",
  integrated: "통합 해석", implications: "현재 프로젝트에 대한 시사점", limitations: "이용 가능한 근거의 한계",
  sources: "분석에 제공된 출처", view: "근거 보기", projectMaterial: "프로젝트 사례 자료", researchFindings: "핵심 연구 결과",
  caseFindings: "사례 기반 결과와 교훈", notable: "검색된 논문 중 인용 수가 높은 논문", authorUnknown: "저자 정보 없음",
  sourceHelp: "하나 이상의 출처를 선택하세요. 모두 제거하면 두 출처를 함께 사용합니다.", evidenceError: "답변을 완료하지 못했습니다. 검색된 근거는 아래에 표시됩니다.",
};
const zh: Labels = {
  evidence: "证据", analysisChat: "分析对话", cases: "案例研究", research: "研究论文",
  choose: "选择证据来源", remove: "移除", defaults: "未选择时同时使用案例研究和研究论文。",
  caseEvidence: "案例证据", researchEvidence: "研究证据", browse: "查看 / 编辑项目案例资料",
  empty: "提出问题后，检索到的证据将显示在这里。", loading: "正在检索证据并准备回答…",
  scope: "证据范围：基于摘要", scopeDetail: "研究结论基于可用摘要，而非论文全文。无法推断缺失的方法、样本量或统计数据。",
  papers: "篇相关论文", period: "发表期间", topics: "主要主题", openAccess: "开放获取", unknown: "信息不可用",
  citations: "次引用", used: "摘要可用 · 用于综合分析", metadata: "仅元数据 · 无摘要 · 未用于综合分析",
  why: "匹配词", contextual: "用于背景比较的项目案例资料；无直接关键词匹配。",
  question: "此问题的证据", summary: "摘要", agreement: "研究共同点", differences: "差异与背景",
  integrated: "综合解读", implications: "对当前项目的启示", limitations: "可用证据的局限",
  sources: "提供给分析的来源", view: "查看证据", projectMaterial: "项目案例资料", researchFindings: "主要研究发现",
  caseFindings: "案例发现与经验", notable: "检索论文中被引用最多的论文", authorUnknown: "作者信息不可用",
  sourceHelp: "选择一个或多个来源。清除选择将同时使用两个来源。", evidenceError: "无法完成回答。检索到的证据显示如下。",
};
export const researchLabels = (locale: Locale): Labels => ({ en, ko, zh })[locale];
