import type { Locale } from "./i18n";

export type ChatStage = "problem" | "data" | "alternatives" | "evaluation" | "report";
export type StageChatGuide = { title: string; description: string; suggestedQuestions: readonly string[] };

const guides: Record<Locale, Record<ChatStage, StageChatGuide>> = {
  ko: {
    problem: {
      title: "무엇이 가장 중요한 문제인지 정리해볼까요?",
      description: "현재 사업의 배경과 이해관계자 의견을 바탕으로 주요 문제와 우려사항을 함께 정리할 수 있어요.",
      suggestedQuestions: ["이 사업의 주요 문제는 무엇인가요?", "주민 입장에서 가장 우려할 점은 무엇인가요?", "사업 목표와 현재 문제 사이에 어떤 차이가 있나요?", "다른 이해관계자는 어떤 점을 중요하게 볼까요?"],
    },
    data: {
      title: "무엇을 살펴볼까요?",
      description: "사례와 학술자료를 바탕으로 이 사업에 참고할 만한 전략과 시사점을 찾아볼 수 있어요.",
      suggestedQuestions: ["비슷한 도시재생 사례에서는 어떤 문제를 겪었나요?", "젠트리피케이션을 줄이기 위해 어떤 방법을 사용했나요?", "지역 상권 활성화와 관련된 연구를 찾아주세요.", "우리 사업에 적용할 수 있는 전략을 정리해주세요."],
    },
    alternatives: {
      title: "어떤 계획안을 만들어볼까요?",
      description: "앞 단계에서 정리한 문제와 분석 결과를 바탕으로 여러 가지 계획 아이디어를 만들어볼 수 있어요.",
      suggestedQuestions: ["보행환경을 개선할 수 있는 계획안을 제안해주세요.", "지역 상권과 공공공간을 함께 활성화할 수 있을까요?", "주민과 방문객 모두를 고려한 대안을 만들어주세요.", "지금까지 나온 의견을 반영해 계획안을 정리해주세요."],
    },
    evaluation: {
      title: "어떤 기준으로 비교해볼까요?",
      description: "제안된 계획안의 장단점을 비교하고 이해관계자 관점에서 평가할 수 있어요.",
      suggestedQuestions: ["각 계획안의 장단점을 비교해주세요.", "주민 입장에서 어떤 안이 가장 적절한가요?", "상권 활성화 측면에서는 어떤 안이 좋은가요?", "지속가능성과 실행 가능성을 함께 비교해주세요."],
    },
    report: {
      title: "어떤 안이 가장 적절할까요?",
      description: "평가 결과와 이해관계자 의견을 종합해 최종 의사결정을 정리할 수 있어요.",
      suggestedQuestions: ["평가 결과를 종합하면 어떤 안이 가장 적절한가요?", "이해관계자 간 의견 차이는 무엇인가요?", "최종안에서 보완해야 할 점은 무엇인가요?", "최종 선택 이유를 정리해주세요."],
    },
  },
  en: {
    problem: { title: "What matters most in this project?", description: "Identify key problems and concerns using the project background and stakeholder perspectives.", suggestedQuestions: ["What are the main problems in this project?", "What should residents be most concerned about?", "Where do current problems differ from the project goals?", "What matters most to other stakeholders?"] },
    data: { title: "What would you like to explore?", description: "Explore cases and research to find strategies and insights for this project.", suggestedQuestions: ["What problems did similar urban regeneration projects face?", "What approaches have been used to reduce gentrification?", "Find research on revitalizing local businesses.", "Summarize strategies we could apply to our project."] },
    alternatives: { title: "What plans could we develop?", description: "Build planning ideas from the problems and analysis identified in earlier stages.", suggestedQuestions: ["Suggest a plan to improve walkability.", "How could we revitalize local businesses and public spaces together?", "Create an alternative that considers residents and visitors.", "Develop a plan that reflects the feedback so far."] },
    evaluation: { title: "How should we compare the plans?", description: "Compare the strengths and weaknesses of proposed plans from stakeholder perspectives.", suggestedQuestions: ["Compare the strengths and weaknesses of each plan.", "Which plan best meets residents’ needs?", "Which plan would best support local businesses?", "Compare sustainability and feasibility together."] },
    report: { title: "Which plan is the best fit?", description: "Bring together evaluation results and stakeholder perspectives to support the final decision.", suggestedQuestions: ["Which plan is the best fit based on the evaluations?", "Where do stakeholder opinions differ?", "What should we improve in the final plan?", "Summarize the reasons for the final choice."] },
  },
  zh: {
    problem: { title: "一起梳理最重要的问题吧", description: "结合项目背景和利益相关方的意见，梳理主要问题与担忧。", suggestedQuestions: ["这个项目的主要问题是什么？", "居民最担心哪些问题？", "项目目标与当前问题有哪些差距？", "其他利益相关方最看重什么？"] },
    data: { title: "您想了解哪些资料？", description: "从案例和学术研究中寻找可供本项目参考的策略与启示。", suggestedQuestions: ["类似的城市更新项目遇到了哪些问题？", "哪些方法有助于减轻绅士化的影响？", "请查找有关振兴本地商业的研究。", "请整理适用于本项目的策略。"] },
    alternatives: { title: "可以提出哪些规划方案？", description: "根据前面阶段的问题和分析结果，探索不同的规划思路。", suggestedQuestions: ["请提出改善步行环境的方案。", "如何同时激活本地商业与公共空间？", "请提出兼顾居民和访客的方案。", "请结合已有意见整理规划方案。"] },
    evaluation: { title: "用哪些标准比较方案？", description: "比较各方案的优缺点，并从利益相关方的角度进行评估。", suggestedQuestions: ["请比较各方案的优缺点。", "哪个方案最符合居民的需求？", "哪个方案最有利于振兴本地商业？", "请综合比较可持续性与可行性。"] },
    report: { title: "哪个方案最合适？", description: "综合评估结果和利益相关方的意见，整理最终决策。", suggestedQuestions: ["综合评估结果，哪个方案最合适？", "利益相关方之间有哪些意见分歧？", "最终方案还有哪些方面需要完善？", "请整理最终选择的理由。"] },
  },
};

export function stageChatGuide(stage: string, locale: Locale): StageChatGuide | undefined {
  return guides[locale][stage as ChatStage];
}
