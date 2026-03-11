import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Locale = "en" | "ko" | "zh";

type Messages = Record<string, string>;

const STORAGE_KEY = "ppss-locale";

const messagesByLocale: Record<Locale, Messages> = {
  en: {
    "language.label": "Language",
    "language.en": "English",
    "language.ko": "한국어",
    "language.zh": "中文",
    "nav.home": "Home",
    "nav.workspace": "Workspace",
    "nav.report": "Report",
    "nav.setting": "Setting",
    "shell.platform": "PPSS Platform",
    "shell.title": "AI-assisted",
    "shell.role": "Role",
    "shell.systemStatus": "System Status",
    "shell.model": "Model: GPT-supported workflow",
    "shell.latency": "Latency: 1.3s · Ready",
    "shell.signedInAs": "Signed in as",
    "shell.notAuthenticated": "Not authenticated",
    "shell.logout": "Log out",
    "home.badge": "Home",
    "home.title": "AI-assisted PPSS portal",
    "home.description": "Select your role to sign in and access the PPSS platform, matching the stakeholder flow presented in the study.",
    "home.signIn": "Sign in",
    "home.secureAccess": "Secure access",
    "home.signInWorkspace": "Sign in to Workspace",
    "home.role": "Role",
    "home.close": "Close",
    "home.authNotConfigured": "Firebase authentication is not configured. Provide NEXT_PUBLIC_FIREBASE_* environment variables to enable login.",
    "home.email": "Email",
    "home.password": "Password",
    "home.continue": "Continue to Workspace",
    "home.or": "or",
    "home.google": "Sign up with Google",
    "home.error.roleSignIn": "Select a role before signing in.",
    "home.error.roleSignUp": "Select a role before signing up.",
    "home.error.signIn": "Unable to sign in. Please try again.",
    "home.error.google": "Google sign up failed. Please try again.",
    "role.public": "The Public",
    "role.business": "Business Owners",
    "role.planners": "Planners",
    "role.government": "Government",
    "roledesc.public": "Review shared PPSS updates and community impact summaries.",
    "roledesc.business": "Coordinate manufacturing objectives and monitor process plan progress.",
    "roledesc.planners": "Develop prompt-driven plans, assess safety checks, and validate outputs.",
    "roledesc.government": "Audit compliance, review reports, and manage policy-driven oversight.",
  },
  ko: {
    "language.label": "언어",
    "language.en": "English",
    "language.ko": "한국어",
    "language.zh": "中文",
    "nav.home": "홈",
    "nav.workspace": "워크스페이스",
    "nav.report": "리포트",
    "nav.setting": "설정",
    "shell.platform": "PPSS 플랫폼",
    "shell.title": "AI 지원",
    "shell.role": "역할",
    "shell.systemStatus": "시스템 상태",
    "shell.model": "모델: GPT 기반 워크플로",
    "shell.latency": "지연 시간: 1.3초 · 준비 완료",
    "shell.signedInAs": "로그인 역할",
    "shell.notAuthenticated": "인증되지 않음",
    "shell.logout": "로그아웃",
    "home.badge": "홈",
    "home.title": "AI 기반 PPSS 포털",
    "home.description": "역할을 선택해 로그인하고, 연구에서 제시된 이해관계자 흐름에 맞춰 PPSS 플랫폼에 접속하세요.",
    "home.signIn": "로그인",
    "home.secureAccess": "보안 접속",
    "home.signInWorkspace": "워크스페이스 로그인",
    "home.role": "역할",
    "home.close": "닫기",
    "home.authNotConfigured": "Firebase 인증이 설정되지 않았습니다. 로그인하려면 NEXT_PUBLIC_FIREBASE_* 환경 변수를 설정하세요.",
    "home.email": "이메일",
    "home.password": "비밀번호",
    "home.continue": "워크스페이스로 계속",
    "home.or": "또는",
    "home.google": "Google로 가입",
    "home.error.roleSignIn": "로그인 전에 역할을 선택하세요.",
    "home.error.roleSignUp": "가입 전에 역할을 선택하세요.",
    "home.error.signIn": "로그인할 수 없습니다. 다시 시도해 주세요.",
    "home.error.google": "Google 가입에 실패했습니다. 다시 시도해 주세요.",
    "role.public": "일반 시민",
    "role.business": "사업자",
    "role.planners": "기획자",
    "role.government": "정부",
    "roledesc.public": "공유된 PPSS 업데이트와 지역사회 영향 요약을 검토합니다.",
    "roledesc.business": "제조 목표를 조율하고 공정 계획 진행 상황을 모니터링합니다.",
    "roledesc.planners": "프롬프트 기반 계획을 수립하고 안전 점검 및 결과를 검증합니다.",
    "roledesc.government": "규정 준수와 보고서를 점검하고 정책 기반 감독을 수행합니다.",
  },
  zh: {
    "language.label": "语言",
    "language.en": "English",
    "language.ko": "한국어",
    "language.zh": "中文",
    "nav.home": "首页",
    "nav.workspace": "工作区",
    "nav.report": "报告",
    "nav.setting": "设置",
    "shell.platform": "PPSS 平台",
    "shell.title": "AI 辅助",
    "shell.role": "角色",
    "shell.systemStatus": "系统状态",
    "shell.model": "模型：GPT 支持工作流",
    "shell.latency": "延迟：1.3秒 · 就绪",
    "shell.signedInAs": "当前登录角色",
    "shell.notAuthenticated": "未认证",
    "shell.logout": "退出登录",
    "home.badge": "首页",
    "home.title": "AI 辅助 PPSS 门户",
    "home.description": "请选择角色登录并访问 PPSS 平台，对应研究中的利益相关者流程。",
    "home.signIn": "登录",
    "home.secureAccess": "安全访问",
    "home.signInWorkspace": "登录工作区",
    "home.role": "角色",
    "home.close": "关闭",
    "home.authNotConfigured": "Firebase 身份验证尚未配置。请提供 NEXT_PUBLIC_FIREBASE_* 环境变量以启用登录。",
    "home.email": "邮箱",
    "home.password": "密码",
    "home.continue": "继续进入工作区",
    "home.or": "或",
    "home.google": "使用 Google 注册",
    "home.error.roleSignIn": "登录前请先选择角色。",
    "home.error.roleSignUp": "注册前请先选择角色。",
    "home.error.signIn": "无法登录，请重试。",
    "home.error.google": "Google 注册失败，请重试。",
    "role.public": "公众",
    "role.business": "企业负责人",
    "role.planners": "规划人员",
    "role.government": "政府",
    "roledesc.public": "查看共享的 PPSS 更新与社区影响摘要。",
    "roledesc.business": "协调制造目标并跟踪流程计划进度。",
    "roledesc.planners": "制定提示驱动计划，评估安全检查并验证输出。",
    "roledesc.government": "审查合规性、报告并执行政策监督。",
  },
};

type I18nContextValue = {
  locale: Locale;
  setLocale: (nextLocale: Locale) => void;
  t: (key: string) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>("en");

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const storedLocale = window.localStorage.getItem(STORAGE_KEY) as Locale | null;
    if (storedLocale && messagesByLocale[storedLocale]) {
      setLocale(storedLocale);
    }
  }, []);

  const updateLocale = (nextLocale: Locale) => {
    setLocale(nextLocale);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, nextLocale);
    }
  };

  const value = useMemo<I18nContextValue>(() => {
    return {
      locale,
      setLocale: updateLocale,
      t: (key: string) => messagesByLocale[locale][key] ?? messagesByLocale.en[key] ?? key,
    };
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return context;
}
