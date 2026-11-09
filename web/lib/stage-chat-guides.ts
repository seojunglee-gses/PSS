import { normalizeRoleId, type Locale, type RoleId } from "./i18n";

export type ChatStage = "problem" | "data" | "alternatives" | "evaluation" | "report";
export type StarterPrompt = { label: string; prompt: string };
export type StageChatGuide = { title: string; description: string; suggestedQuestions: readonly [StarterPrompt, StarterPrompt, StarterPrompt] };

const guides: Record<Locale, Record<ChatStage, Omit<StageChatGuide, "suggestedQuestions">>> = {
  ko: {
    problem: {
      title: "무엇이 가장 중요한 문제인지 정리해볼까요?",
      description: "현재 사업의 배경과 이해관계자 의견을 바탕으로 주요 문제와 우려사항을 함께 정리할 수 있어요.",
    },
    data: {
      title: "무엇을 살펴볼까요?",
      description: "사례와 학술자료를 바탕으로 이 사업에 참고할 만한 전략과 시사점을 찾아볼 수 있어요.",
    },
    alternatives: {
      title: "어떤 계획안을 만들어볼까요?",
      description: "앞 단계에서 정리한 문제와 분석 결과를 바탕으로 여러 가지 계획 아이디어를 만들어볼 수 있어요.",
    },
    evaluation: {
      title: "어떤 기준으로 비교해볼까요?",
      description: "제안된 계획안의 장단점을 비교하고 이해관계자 관점에서 평가할 수 있어요.",
    },
    report: {
      title: "어떤 안이 가장 적절할까요?",
      description: "평가 결과와 이해관계자 의견을 종합해 최종 의사결정을 정리할 수 있어요.",
    },
  },
  en: {
    problem: { title: "What matters most in this project?", description: "Identify key problems and concerns using the project background and stakeholder perspectives.",  },
    data: { title: "What would you like to explore?", description: "Explore cases and research to find strategies and insights for this project.",  },
    alternatives: { title: "What plans could we develop?", description: "Build planning ideas from the problems and analysis identified in earlier stages.",  },
    evaluation: { title: "How should we compare the plans?", description: "Compare the strengths and weaknesses of proposed plans from stakeholder perspectives.",  },
    report: { title: "Which plan is the best fit?", description: "Bring together evaluation results and stakeholder perspectives to support the final decision.",  },
  },
  zh: {
    problem: { title: "一起梳理最重要的问题吧", description: "结合项目背景和利益相关方的意见，梳理主要问题与担忧。",  },
    data: { title: "您想了解哪些资料？", description: "从案例和学术研究中寻找可供本项目参考的策略与启示。",  },
    alternatives: { title: "可以提出哪些规划方案？", description: "根据前面阶段的问题和分析结果，探索不同的规划思路。",  },
    evaluation: { title: "用哪些标准比较方案？", description: "比较各方案的优缺点，并从利益相关方的角度进行评估。",  },
    report: { title: "哪个方案最合适？", description: "综合评估结果和利益相关方的意见，整理最终决策。",  },
  },
};

const suggestedQuestions: Record<Locale, Record<ChatStage, Record<RoleId, StageChatGuide["suggestedQuestions"]>>> = {
  ko: {
    problem: {
      public: [
        { label: "우리 동네의 변화", prompt: "우리 동네에서 가장 먼저 바뀌었으면 하는 것은 무엇일까요?" },
        { label: "기존 시설 활용", prompt: "기존 시설을 더 잘 활용하면 해결할 수 있는 문제도 있을까요?" },
        { label: "주민의 다양한 기대", prompt: "주민마다 이 사업에 기대하는 점이 어떻게 다를까요?" },
      ],
      business: [
        { label: "사업자에게 생길 변화", prompt: "이 사업이 지역 사업자들에게 어떤 변화를 가져올까요?" },
        { label: "상권과 함께 성장", prompt: "새로운 공간이 지역 상권과 함께 성장할 방법은 없을까요?" },
        { label: "방문객 증가의 영향", prompt: "방문객 증가와 기존 상인의 영업환경이 충돌할 수도 있을까요?" },
      ],
      planners: [
        { label: "문제의 구조적 원인", prompt: "이 지역의 여러 문제는 어떤 구조적 원인으로 연결되어 있을까요?" },
        { label: "기존 자원의 가능성", prompt: "기존 공간과 시설을 활용해 새로운 가능성을 발견할 수 있을까요?" },
        { label: "문제의 우선순위", prompt: "서로 다른 주민 요구 중 어떤 문제를 우선 정의해야 할까요?" },
      ],
      government: [
        { label: "운영의 핵심 과제", prompt: "사업을 추진하고 운영할 때 가장 먼저 해결해야 할 문제는 무엇일까요?" },
        { label: "기존 사업·시설과 연계", prompt: "기존 사업이나 시설과 연계해 운영 효과를 높일 방법은 없을까요?" },
        { label: "주민과 실무진의 목표", prompt: "주민의 요구와 실무진의 목표가 다른 부분은 무엇일까요?" },
      ],
    },
    data: {
      public: [
        { label: "생활 불편과 자료", prompt: "우리 동네의 생활 불편을 어떤 자료로 확인할 수 있을까요?" },
        { label: "비슷한 지역의 해결법", prompt: "비슷한 지역에서는 이런 문제를 어떻게 해결했을까요?" },
        { label: "자료에 없는 경험", prompt: "지금 자료에서 잘 드러나지 않는 주민들의 경험은 무엇일까요?" },
      ],
      business: [
        { label: "상권 변화와 접근성", prompt: "지역 상권의 변화와 접근성을 어떤 자료로 살펴볼 수 있을까요?" },
        { label: "상권 활성화 사례", prompt: "유사한 도시재생 사례에서 상권 활성화는 어떻게 이루어졌을까요?" },
        { label: "방문객과 상권 효과", prompt: "방문객 수가 늘어나는 것만으로 상권이 좋아진다고 볼 수 있을까요?" },
      ],
      planners: [
        { label: "중요한 공간 지표", prompt: "대상지의 공간적 문제를 분석하려면 어떤 지표가 중요할까요?" },
        { label: "현황과 사례 비교", prompt: "지역 현황과 유사 사례를 비교하면 어떤 계획적 시사점을 얻을까요?" },
        { label: "자료로 모르는 특성", prompt: "현재 자료만으로 판단하기 어려운 공간적 특성은 무엇일까요?" },
      ],
      government: [
        { label: "추진·운영의 근거", prompt: "사업의 추진과 운영 방향을 뒷받침할 핵심 근거는 무엇일까요?" },
        { label: "다른 사업의 운영 경험", prompt: "유사한 사업의 운영 성과와 한계에서 무엇을 배울 수 있을까요?" },
        { label: "운영 성과를 확인할 자료", prompt: "사업 효과와 운영 성과를 판단하려면 어떤 자료가 추가로 필요할까요?" },
      ],
    },
    alternatives: {
      public: [
        { label: "일상적으로 찾는 공간", prompt: "주민들이 일상적으로 찾고 싶은 공간은 어떤 모습일까요?" },
        { label: "세대가 함께 쓰는 공간", prompt: "하나의 공간에서 여러 세대가 함께 활동할 방법은 없을까요?" },
        { label: "새 시설 없는 개선", prompt: "새로운 시설을 만들지 않고도 생활환경을 개선할 수 있을까요?" },
      ],
      business: [
        { label: "상권 연계 아이디어", prompt: "지역 상권과 연계할 수 있는 공간이나 프로그램은 무엇일까요?" },
        { label: "사업자 참여 운영", prompt: "지역 사업자들이 직접 참여하는 새로운 운영 모델은 가능할까요?" },
        { label: "주민과 방문객의 공간", prompt: "방문객과 지역 주민 모두에게 도움이 되는 공간은 어떤 모습일까요?" },
      ],
      planners: [
        { label: "기존 자원으로 대안 찾기", prompt: "대상지의 기존 자원을 활용한 서로 다른 계획 대안을 만들어 볼까요?" },
        { label: "배치와 프로그램 대안", prompt: "공간 배치와 프로그램을 달리하면 어떤 대안이 가능할까요?" },
        { label: "공공성과 경제성", prompt: "공공성과 경제성을 함께 고려한 새로운 설계 방향은 무엇일까요?" },
      ],
      government: [
        { label: "서로 다른 실행 대안", prompt: "사업 목표를 달성할 수 있는 서로 다른 실행 대안은 무엇일까요?" },
        { label: "시설·프로그램 연계", prompt: "기존 시설과 프로그램을 연계하는 운영 대안을 구상해 볼까요?" },
        { label: "예산·인력 부담", prompt: "예산과 인력 부담을 줄이면서 운영 효과를 높일 방법은 무엇일까요?" },
      ],
    },
    evaluation: {
      public: [
        { label: "일상에 도움이 되는 안", prompt: "어떤 대안이 주민들의 일상생활에 가장 도움이 될까요?" },
        { label: "이용에서 소외되는 사람", prompt: "이 공간을 실제로 이용하기 어려운 사람은 없을까요?" },
        { label: "미관과 편의성", prompt: "보기 좋은 설계와 실제로 편리한 설계는 어떻게 다를까요?" },
      ],
      business: [
        { label: "상권에 도움이 되는 안", prompt: "어떤 대안이 지역 상권에 가장 실질적인 도움이 될까요?" },
        { label: "기존 상인의 불이익", prompt: "새로운 시설이 기존 상인의 영업에 불리하게 작용할 수도 있을까요?" },
        { label: "방문객과 경제 효과", prompt: "방문객 증가와 지역경제 효과를 어떻게 비교할 수 있을까요?" },
      ],
      planners: [
        { label: "공간적 효과 비교", prompt: "대안별 공간적 효과와 한계를 비교해 볼까요?" },
        { label: "접근성과 지속가능성", prompt: "접근성, 공공성, 지속가능성 사이에 어떤 상충관계가 있을까요?" },
        { label: "이용자 요구의 균형", prompt: "서로 다른 이용자의 요구를 가장 균형 있게 반영한 대안은 무엇일까요?" },
      ],
      government: [
        { label: "목표 대비 효과", prompt: "어떤 대안이 사업 목표 대비 효과가 높을까요?" },
        { label: "장기 운영 부담", prompt: "초기 사업비뿐 아니라 장기 운영 부담은 어떻게 다를까요?" },
        { label: "운영 지속성과 수용성", prompt: "실행 가능성, 운영 지속성, 주민 수용성을 어떻게 함께 평가할까요?" },
      ],
    },
    report: {
      public: [
        { label: "꼭 반영할 요소", prompt: "주민 입장에서 꼭 반영되었으면 하는 요소는 무엇일까요?" },
        { label: "주민 의견의 조정", prompt: "다른 주민들의 의견과 다를 때 어떤 부분을 조정할 수 있을까요?" },
        { label: "사업 이후 주민 참여", prompt: "사업이 끝난 뒤에도 주민들이 참여할 수 있는 방법은 무엇일까요?" },
      ],
      business: [
        { label: "사업자의 우선 조건", prompt: "사업자 입장에서 우선적으로 반영해야 할 조건은 무엇일까요?" },
        { label: "주민과 상인의 절충", prompt: "주민과 상인 모두 수용할 수 있는 절충안은 무엇일까요?" },
        { label: "운영에 참여하는 방법", prompt: "지역 사업자들이 사업 운영에 참여할 방법은 없을까요?" },
      ],
      planners: [
        { label: "대안의 장점 결합", prompt: "여러 대안의 장점을 결합한 최종 계획은 가능할까요?" },
        { label: "의견 조정의 원칙", prompt: "이해관계자 간 의견 차이를 어떤 계획 원칙으로 조정할까요?" },
        { label: "유지할 공간 요소", prompt: "최종안에서 반드시 유지해야 할 공간적 요소는 무엇일까요?" },
      ],
      government: [
        { label: "사업 추진 우선순위", prompt: "제한된 예산에서 어떤 사업부터 추진하는 것이 적절할까요?" },
        { label: "의견 충돌의 판단 기준", prompt: "의견이 충돌할 때 어떤 기준으로 의사결정을 해야 할까요?" },
        { label: "운영과 성과 관리", prompt: "사업 추진 이후 운영과 성과 관리는 어떻게 이어갈까요?" },
      ],
    },
  },
  en: {
    problem: {
      public: [
        { label: "Neighborhood change", prompt: "What would we most like to change in our neighborhood first?" },
        { label: "Reuse existing facilities", prompt: "Could we solve some problems by making better use of existing facilities?" },
        { label: "Residents’ expectations", prompt: "How might residents differ in what they hope this project will achieve?" },
      ],
      business: [
        { label: "Changes for businesses", prompt: "What changes could this project bring for local businesses?" },
        { label: "Grow with local shops", prompt: "How could new spaces grow together with local businesses?" },
        { label: "Effects of more visitors", prompt: "Could more visitors create difficulties for existing businesses?" },
      ],
      planners: [
        { label: "Underlying causes", prompt: "What underlying causes connect the different problems in this area?" },
        { label: "Existing resources", prompt: "Could existing spaces and facilities open up new possibilities?" },
        { label: "Problem priorities", prompt: "Which problems should we prioritize when residents have different needs?" },
      ],
      government: [
        { label: "Key public issue", prompt: "What is the most important public issue this project should address?" },
        { label: "Connect existing projects", prompt: "Could we connect this project with existing programs or public facilities?" },
        { label: "Residents and policy goals", prompt: "Where might residents’ needs differ from the administration’s goals?" },
      ],
    },
    data: {
      public: [
        { label: "Evidence of daily difficulties", prompt: "What data could help us understand everyday difficulties in our neighborhood?" },
        { label: "Lessons from similar areas", prompt: "How have similar areas addressed these problems?" },
        { label: "Experiences missing in data", prompt: "Which resident experiences are missing from the data we have?" },
      ],
      business: [
        { label: "Business and access data", prompt: "What data could help us examine changes in local business and accessibility?" },
        { label: "Business revitalization cases", prompt: "How have similar urban regeneration projects supported local businesses?" },
        { label: "Visitors versus business gains", prompt: "Does an increase in visitors necessarily mean local businesses are doing better?" },
      ],
      planners: [
        { label: "Key spatial indicators", prompt: "Which indicators matter when analyzing spatial problems at the site?" },
        { label: "Compare conditions and cases", prompt: "What planning insights could we gain by comparing local conditions with similar cases?" },
        { label: "Gaps in spatial data", prompt: "Which spatial conditions are difficult to assess with the data available?" },
      ],
      government: [
        { label: "Evidence for the project", prompt: "What evidence would best explain the need for this project?" },
        { label: "Lessons from public projects", prompt: "What can we learn from the outcomes and limitations of similar public projects?" },
        { label: "Data to assess effects", prompt: "What additional data would help us assess the project’s effects?" },
      ],
    },
    alternatives: {
      public: [
        { label: "Spaces for everyday life", prompt: "What kind of space would residents want to visit in everyday life?" },
        { label: "Spaces across generations", prompt: "How could different generations share activities in one space?" },
        { label: "Improve without new facilities", prompt: "Could we improve daily life without building new facilities?" },
      ],
      business: [
        { label: "Connect local businesses", prompt: "What spaces or programs could connect with local businesses?" },
        { label: "Business-led operations", prompt: "Could we develop a new operating model with local businesses taking part?" },
        { label: "Spaces for residents and visitors", prompt: "What kind of space could benefit both visitors and local residents?" },
      ],
      planners: [
        { label: "Alternatives from local resources", prompt: "Shall we explore different planning alternatives using the site’s existing resources?" },
        { label: "Layouts and programs", prompt: "What alternatives could different layouts and programs make possible?" },
        { label: "Public benefit and viability", prompt: "What new design directions could balance public benefit and economic viability?" },
      ],
      government: [
        { label: "Implementation alternatives", prompt: "What different implementation options could achieve the project’s goals?" },
        { label: "Link public facilities", prompt: "Shall we develop an alternative that connects with existing public facilities?" },
        { label: "Costs and operations", prompt: "How could we improve outcomes while reducing costs and operating burdens?" },
      ],
    },
    evaluation: {
      public: [
        { label: "Benefits in daily life", prompt: "Which alternative would help residents most in their daily lives?" },
        { label: "Who might be left out?", prompt: "Might anyone find it difficult to use this space?" },
        { label: "Appearance and usability", prompt: "How might an attractive design differ from one that is convenient to use?" },
      ],
      business: [
        { label: "Benefits for local business", prompt: "Which alternative would offer the most practical support for local businesses?" },
        { label: "Risks to existing shops", prompt: "Could a new facility put existing businesses at a disadvantage?" },
        { label: "Visitors and economic effects", prompt: "How can we compare visitor growth with benefits to the local economy?" },
      ],
      planners: [
        { label: "Compare spatial effects", prompt: "Shall we compare the spatial effects and limitations of each alternative?" },
        { label: "Access and sustainability", prompt: "What trade-offs might exist between accessibility, public benefit and sustainability?" },
        { label: "Balance user needs", prompt: "Which alternative best balances the needs of different users?" },
      ],
      government: [
        { label: "Effectiveness against goals", prompt: "Which alternative would best achieve the project’s goals?" },
        { label: "Long-term operating burden", prompt: "How do the alternatives differ in initial costs and long-term operating burdens?" },
        { label: "Public value and acceptance", prompt: "How can we evaluate public benefit, feasibility and resident acceptance together?" },
      ],
    },
    report: {
      public: [
        { label: "Must-have elements", prompt: "What should the final plan include from residents’ perspectives?" },
        { label: "Reconcile resident views", prompt: "Where could we compromise when other residents have different views?" },
        { label: "Participation after completion", prompt: "How could residents remain involved after the project is completed?" },
      ],
      business: [
        { label: "Business priorities", prompt: "What conditions should take priority from a business owner’s perspective?" },
        { label: "Resident–business compromise", prompt: "What compromise could both residents and local businesses accept?" },
        { label: "Participate in operations", prompt: "How could local businesses take part in running the project?" },
      ],
      planners: [
        { label: "Combine alternative strengths", prompt: "Could a final plan combine the strengths of different alternatives?" },
        { label: "Principles for resolving differences", prompt: "What planning principles could help reconcile stakeholder differences?" },
        { label: "Spatial elements to retain", prompt: "Which spatial features must be retained in the final plan?" },
      ],
      government: [
        { label: "Implementation priorities", prompt: "Which actions should we prioritize within a limited budget?" },
        { label: "Criteria for disagreements", prompt: "What criteria should guide decisions when opinions conflict?" },
        { label: "Operations and monitoring", prompt: "How should operations and performance monitoring continue after implementation?" },
      ],
    },
  },
  zh: {
    problem: {
      public: [
        { label: "社区优先改变什么", prompt: "我们最希望社区先改变什么？" },
        { label: "利用现有设施", prompt: "更好地利用现有设施，能否解决一些问题？" },
        { label: "居民的不同期待", prompt: "居民对这个项目的期待可能有哪些不同？" },
      ],
      business: [
        { label: "商户面临的变化", prompt: "这个项目会给本地商户带来哪些变化？" },
        { label: "与本地商业共成长", prompt: "新空间如何与本地商业共同发展？" },
        { label: "游客增加的影响", prompt: "游客增加会不会影响现有商户的经营环境？" },
      ],
      planners: [
        { label: "问题的深层原因", prompt: "这个地区的不同问题与哪些深层原因有关？" },
        { label: "现有资源的可能性", prompt: "利用现有空间和设施，能否发现新的可能性？" },
        { label: "问题优先级", prompt: "面对不同的居民需求，应优先界定哪些问题？" },
      ],
      government: [
        { label: "核心公共问题", prompt: "这个项目最需要解决的公共问题是什么？" },
        { label: "联动现有项目", prompt: "能否与现有项目或公共设施联动？" },
        { label: "居民与行政目标", prompt: "居民需求与行政目标有哪些不同？" },
      ],
    },
    data: {
      public: [
        { label: "日常不便的证据", prompt: "哪些资料能帮助我们了解社区的日常不便？" },
        { label: "类似地区的经验", prompt: "类似地区是如何解决这些问题的？" },
        { label: "资料遗漏的体验", prompt: "现有资料遗漏了哪些居民体验？" },
      ],
      business: [
        { label: "商业变化与可达性", prompt: "哪些资料能帮助我们了解本地商业变化和可达性？" },
        { label: "商业振兴案例", prompt: "类似城市更新项目是如何振兴本地商业的？" },
        { label: "游客与商业收益", prompt: "游客增加是否就意味着本地商业改善了？" },
      ],
      planners: [
        { label: "关键空间指标", prompt: "分析场地的空间问题时，哪些指标最重要？" },
        { label: "对比现状与案例", prompt: "对比本地现状与类似案例，能获得哪些规划启示？" },
        { label: "空间资料的不足", prompt: "仅凭现有资料，哪些空间特征还难以判断？" },
      ],
      government: [
        { label: "项目的核心证据", prompt: "哪些核心证据能说明项目的必要性？" },
        { label: "公共项目的经验", prompt: "类似公共项目的成效与局限能带来哪些启示？" },
        { label: "评估效果所需资料", prompt: "评估项目效果还需要哪些资料？" },
      ],
    },
    alternatives: {
      public: [
        { label: "日常愿意来的空间", prompt: "什么样的空间会让居民愿意日常来访？" },
        { label: "跨世代共享空间", prompt: "不同世代如何在同一个空间共同活动？" },
        { label: "不新建设施的改善", prompt: "不新建设施，是否也能改善生活环境？" },
      ],
      business: [
        { label: "联动本地商业", prompt: "哪些空间或活动可以与本地商业联动？" },
        { label: "商户参与运营", prompt: "能否设计让本地商户直接参与的运营模式？" },
        { label: "居民与游客共用空间", prompt: "什么样的空间能让游客和居民共同受益？" },
      ],
      planners: [
        { label: "利用现有资源构思", prompt: "一起利用场地现有资源，探索不同的规划方案吧？" },
        { label: "布局与活动方案", prompt: "改变空间布局和活动内容，会带来哪些方案？" },
        { label: "公共利益与经济性", prompt: "哪些新设计方向能兼顾公共利益与经济可行性？" },
      ],
      government: [
        { label: "不同实施方案", prompt: "哪些不同的实施方案可以实现项目目标？" },
        { label: "联动公共设施", prompt: "一起构思与现有公共设施联动的方案吧？" },
        { label: "成本与运营负担", prompt: "如何减轻预算和运营负担，同时提高效果？" },
      ],
    },
    evaluation: {
      public: [
        { label: "对日常生活的帮助", prompt: "哪个方案最能帮助居民的日常生活？" },
        { label: "谁可能难以使用", prompt: "是否有人会难以实际使用这个空间？" },
        { label: "美观与便利", prompt: "好看的设计与方便使用的设计可能有哪些不同？" },
      ],
      business: [
        { label: "对本地商业的帮助", prompt: "哪个方案最能切实帮助本地商业？" },
        { label: "现有商户的风险", prompt: "新设施会不会对现有商户的经营产生不利影响？" },
        { label: "游客与经济效果", prompt: "如何比较游客增长与本地经济收益？" },
      ],
      planners: [
        { label: "比较空间效果", prompt: "一起比较各方案的空间效果与局限吧？" },
        { label: "可达性与可持续性", prompt: "可达性、公共利益与可持续性之间有哪些取舍？" },
        { label: "平衡使用者需求", prompt: "哪个方案最均衡地回应了不同使用者的需求？" },
      ],
      government: [
        { label: "目标达成效果", prompt: "哪个方案最能实现项目目标？" },
        { label: "长期运营负担", prompt: "各方案的初期成本和长期运营负担有哪些不同？" },
        { label: "公共利益与接受度", prompt: "如何综合评价公共利益、可行性和居民接受度？" },
      ],
    },
    report: {
      public: [
        { label: "必须体现的要素", prompt: "从居民角度，最终方案必须体现什么？" },
        { label: "协调居民分歧", prompt: "与其他居民意见不同时，哪些方面可以协调？" },
        { label: "项目结束后的参与", prompt: "项目结束后，居民还能如何参与？" },
      ],
      business: [
        { label: "商户的优先条件", prompt: "从商户角度，应优先考虑哪些条件？" },
        { label: "居民与商户的折中", prompt: "怎样的折中方案能让居民与商户都接受？" },
        { label: "参与运营的方法", prompt: "本地商户可以如何参与项目运营？" },
      ],
      planners: [
        { label: "结合方案优点", prompt: "能否结合不同方案的优点，形成最终规划？" },
        { label: "协调分歧的原则", prompt: "哪些规划原则能帮助协调利益相关方的分歧？" },
        { label: "保留的空间要素", prompt: "最终方案中必须保留哪些空间要素？" },
      ],
      government: [
        { label: "实施优先级", prompt: "预算有限时，应优先推进哪些工作？" },
        { label: "分歧时的判断标准", prompt: "意见冲突时，应依据什么标准决策？" },
        { label: "运营与成效管理", prompt: "项目实施后，如何持续开展运营与成效管理？" },
      ],
    },
  },
};

export function stageChatGuide(stage: string, locale: Locale, role?: string | null): StageChatGuide | undefined {
  if (!Object.prototype.hasOwnProperty.call(guides[locale], stage)) return undefined;
  const guide = guides[locale][stage as ChatStage];
  const questions = suggestedQuestions[locale][stage as ChatStage];
  const stakeholder = normalizeRoleId(role);
  return { ...guide, suggestedQuestions: stakeholder && Object.prototype.hasOwnProperty.call(questions, stakeholder) ? questions[stakeholder] : questions.public };
}

export type DataSuggestionContext = "spatial" | "spatial-result" | "facilities" | "cases" | "research" | "project";
// Data Analysis only: deterministic follow-ups for the material currently visible on the left.
const dataFollowUps: Record<Locale, Record<DataSuggestionContext, readonly [readonly [string, string], readonly [string, string], readonly [string, string]]>> = {
  ko: {
    spatial: [["주요 시설", "우리 지역에는 어떤 주요 시설이 있어?"], ["개선 장소", "개선이 필요한 장소를 찾으려면 어떤 자료부터 확인해야 해?"], ["유사 사례", "비슷한 사업 사례를 보여줘."]],
    "spatial-result": [["공간 특징", "여기서 어떤 특징이 보여?"], ["추가 확인", "이 공간 분석에서 추가로 확인할 점은 뭐야?"], ["사업 적용", "이 공간 분석이 우리 사업에 어떤 의미가 있어?"]],
    facilities: [["시설 분포", "여기서 시설 분포에 어떤 특징이 보여?"], ["시설 부족", "여기서 시설이 부족한지 판단하려면 무엇을 더 확인해야 해?"], ["사업 적용", "이 공간 분석이 우리 사업에 어떤 의미가 있어?"]],
    cases: [["핵심 성과", "이 사례의 핵심 성과는 뭐야?"], ["지역 비교", "이 사례는 우리 지역과 어떤 점이 비슷해?"], ["사업 적용", "이 사례에서 우리 사업에 적용할 만한 점은 뭐야?"]],
    research: [["연구 내용", "이 논문의 주요 내용은 뭐야?"], ["연구 비교", "이 연구와 다른 관련 연구는 어떤 점에서 같거나 달라?"], ["사업 적용", "이 연구를 우리 사업에 적용할 때 무엇을 고려해야 해?"]],
    project: [["자료 핵심", "이 자료에서 우리 사업과 관련된 핵심 내용은 뭐야?"], ["필요 자료", "이 자료를 바탕으로 분석하려면 무엇을 더 확인해야 해?"], ["유사 사례", "이 자료와 관련된 비슷한 사업 사례를 보여줘."]],
  },
  en: {
    spatial: [["Key local facilities", "What key facilities are in our area?"], ["Places to improve", "What information should we check first to identify places needing improvement?"], ["Similar projects", "Show me similar project cases."]],
    "spatial-result": [["Patterns in this view", "What patterns do you see here?"], ["What to check next", "What else should we check in this spatial analysis?"], ["Meaning for our project", "What does this spatial analysis mean for our project?"]],
    facilities: [["Facility distribution", "What patterns do you see in the facility distribution here?"], ["Assessing facility gaps", "What else do we need to check before judging whether facilities are lacking here?"], ["Meaning for our project", "What does this spatial analysis mean for our project?"]],
    cases: [["Key case outcomes", "What are this case's key outcomes?"], ["Compare with our area", "How is this case similar to our area?"], ["Apply to our project", "What could we apply from this case to our project?"]],
    research: [["Main research findings", "What are this paper's main findings?"], ["Compare research evidence", "How does this study compare with other related research?"], ["Apply to our project", "What should we consider when applying this study to our project?"]],
    project: [["Key project information", "What are this material's key points for our project?"], ["Information still needed", "What else should we check to analyze this material?"], ["Find related cases", "Show me similar project cases related to this material."]],
  },
  zh: {
    spatial: [["本地主要设施", "我们地区有哪些主要设施？"], ["寻找改善地点", "要识别需要改善的地点，应该先查看哪些资料？"], ["类似项目案例", "请展示类似项目的案例。"]],
    "spatial-result": [["资料中的特点", "这里呈现出哪些特点？"], ["进一步确认", "这项空间分析还需要确认哪些信息？"], ["对本项目的意义", "这项空间分析对本项目有什么意义？"]],
    facilities: [["设施分布特点", "这里的设施分布有哪些特点？"], ["判断设施缺口", "在判断这里是否缺少设施之前，还需要确认什么？"], ["对本项目的意义", "这项空间分析对本项目有什么意义？"]],
    cases: [["案例主要成效", "这个案例的主要成效是什么？"], ["与本地区比较", "这个案例与我们地区有哪些相似之处？"], ["应用于本项目", "这个案例有哪些值得应用于本项目的做法？"]],
    research: [["研究主要内容", "这篇论文的主要发现是什么？"], ["比较研究依据", "这项研究与其他相关研究有哪些异同？"], ["应用于本项目", "将这项研究应用于本项目时应考虑什么？"]],
    project: [["项目资料重点", "这份资料中与本项目相关的重点是什么？"], ["仍需补充的资料", "分析这份资料还需要确认什么？"], ["寻找相关案例", "请展示与这份资料相关的类似项目案例。"]],
  },
};
export function dataAnalysisStarterPrompts(locale: Locale, context: DataSuggestionContext): StageChatGuide["suggestedQuestions"] {
  const items = dataFollowUps[locale][context];
  const prompt = ([label, prompt]: readonly [string, string]): StarterPrompt => ({ label, prompt });
  return [prompt(items[0]), prompt(items[1]), prompt(items[2])];
}
