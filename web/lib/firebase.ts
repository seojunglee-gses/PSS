import { initializeApp, getApps } from "firebase/app";
import {
  getFirestore,
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  query,
  where,
} from "firebase/firestore";
import {
  getStorage,
  ref,
  getBytes,
  getDownloadURL,
  uploadBytes,
  uploadString,
} from "firebase/storage";

type EvaluationPayload = {
  submittedAt: string;
  rankings: Record<string, number>;
  userId?: string;
  role?: string;
};

export type WorkspaceSummary = {
  stageSummaries: Record<string, string>;
  overallSummary: string;
  role?: string;
  completedStages?: string[];
  updatedAt?: string;
  alternativesInitialized?: boolean;
};

type ExecutiveSummary = {
  keywords: string[];
  currentStage: string;
  stageId?: string;
  stageSummaries: {
    problemDefinition: string;
    dataAnalysis: string;
    designAlternatives: string;
    designEvaluation: string;
    decision: string;
  };
  createdAt?: string;
};

type StageLockState = {
  lockedStages: Record<string, boolean>;
  revisedAfterLock?: Record<string, boolean>;
  updatedAt?: string;
  updatedBy?: string;
};

type BackgroundKnowledge = {
  curatedText: string;
  updatedAt?: string;
  updatedBy?: string;
};

type BackgroundKnowledgeArchive = {
  fileName: string;
  storagePath: string;
  contentType: string;
  size: number;
  uploadedAt: string;
  uploadedBy: string;
};

export type SiteImage = {
  imageId: string;
  storagePath: string;
  downloadUrl: string;
  updatedAt?: string;
  updatedBy?: string;
};

type GeneratedImage = {
  imageId: string;
  label: string;
  note: string;
  storagePath: string;
  downloadUrl: string;
  createdAt: string;
  userId?: string;
};

type SubmittedDesign = {
  userId: string;
  imageId: string;
  createdAt: string;
  label: string;
  note: string;
  downloadUrl: string;
};

type EvaluationImage = {
  userId: string;
  imageId: string;
  createdAt: string;
  label: string;
  note: string;
  downloadUrl: string;
};

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const isConfigReady = Object.values(firebaseConfig).every(Boolean);

const getFirebaseApp = () => {
  if (!isConfigReady) {
    throw new Error("Firebase config is not ready");
  }
  if (!getApps().length) {
    return initializeApp(firebaseConfig);
  }
  return getApps()[0];
};

const getFirebaseStorage = () => {
  const app = getFirebaseApp();
  if (!app) {
    return null;
  }
  return getStorage(app);
};

export const sendEvaluationResult = async (payload: EvaluationPayload) => {
  const app = getFirebaseApp();
  if (!app) {
    return;
  }
  const db = getFirestore(app);
  await addDoc(collection(db, "ppssEvaluations"), payload);
};

export const loadEvaluationResults = async (): Promise<EvaluationPayload[]> => {
  const app = getFirebaseApp();
  if (!app) {
    return [];
  }
  const db = getFirestore(app);
  const snapshot = await getDocs(collection(db, "ppssEvaluations"));
  return snapshot.docs.map((docSnap) => docSnap.data() as EvaluationPayload);
};

export const saveChatLogsToStorage = async (
  userId: string,
  logs: unknown
) => {
  const storage = getFirebaseStorage();
  if (!storage) {
    return;
  }
  const logRef = ref(storage, `ppss-chat-logs/${userId}.json`);
  await uploadString(logRef, JSON.stringify(logs), "raw");
};

export const loadChatLogsFromStorage = async <T>(
  userId: string
): Promise<T | null> => {
  const storage = getFirebaseStorage();
  if (!storage) {
    return null;
  }
  try {
    const logRef = ref(storage, `ppss-chat-logs/${userId}.json`);
    const data = await getBytes(logRef);
    const text = new TextDecoder().decode(data);
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
};

export const saveChatLogsToFirestore = async (
  userId: string,
  logsByStep: Record<string, unknown>,
  updatedBy?: string
) => {
  const app = getFirebaseApp();
  if (!app) {
    return;
  }
  const db = getFirestore(app);
  await setDoc(
    doc(db, "ppssChatLogs", userId),
    {
      logsByStep,
      updatedAt: new Date().toISOString(),
      updatedBy,
    },
    { merge: true }
  );
};

export const loadChatLogsFromFirestore = async <T>(
  userId: string
): Promise<T | null> => {
  const app = getFirebaseApp();
  if (!app) {
    return null;
  }
  const db = getFirestore(app);
  const snapshot = await getDoc(doc(db, "ppssChatLogs", userId));
  if (!snapshot.exists()) {
    return null;
  }
  const data = snapshot.data() as { logsByStep?: T; logs?: unknown };
  if (data.logsByStep) {
    return data.logsByStep;
  }
  if (Array.isArray(data.logs)) {
    const grouped = (data.logs as Array<{ stepId?: string }>).reduce<
      Record<string, unknown[]>
    >((acc, log) => {
      const stepId = log.stepId ?? "unknown";
      if (!acc[stepId]) {
        acc[stepId] = [];
      }
      acc[stepId].push(log);
      return acc;
    }, {});
    return grouped as T;
  }
  return null;
};

export const saveWorkspaceSummary = async (
  userId: string,
  summary: Partial<WorkspaceSummary>
) => {
  const app = getFirebaseApp();
  if (!app) {
    return;
  }
  const db = getFirestore(app);
  await setDoc(
    doc(db, "ppssWorkspaceSummaries", userId), 
    {
    ...summary,
    updatedAt: new Date().toISOString(),
    },
    {merge: true}
    );
  };

export const loadWorkspaceSummary = async (
  userId: string
): Promise<WorkspaceSummary | null> => {
  const app = getFirebaseApp();
  if (!app) {
    return null;
  }
  const db = getFirestore(app);
  const snapshot = await getDoc(doc(db, "ppssWorkspaceSummaries", userId));
  if (!snapshot.exists()) {
    return null;
  }
  return snapshot.data() as WorkspaceSummary;
};

export const loadAllWorkspaceSummaries = async (): Promise<
  Array<{ userId: string; summary: WorkspaceSummary }>
> => {
  const app = getFirebaseApp();
  if (!app) {
    return [];
  }
  const db = getFirestore(app);
  const snapshot = await getDocs(collection(db, "ppssWorkspaceSummaries"));
  return snapshot.docs.map((docSnap) => ({
    userId: docSnap.id,
    summary: docSnap.data() as WorkspaceSummary,
  }));
};

export const loadLatestExecutiveSummariesByStage = async (): Promise<
  Pick<ExecutiveSummary, "keywords" | "stageSummaries"> | null
> => {
  const app = getFirebaseApp();
  if (!app) {
    return null;
  }
  const db = getFirestore(app);
  const snapshot = await getDocs(collection(db, "ppssExecutiveSummaries"));
  if (snapshot.empty) {
    return null;
  }
  const perStage: Record<string, ExecutiveSummary> = {};
  snapshot.docs.forEach((docSnap) => {
    const data = docSnap.data() as ExecutiveSummary;
    if (!data.stageId) {
      return;
    }
    const existing = perStage[data.stageId];
    if (!existing || (data.createdAt ?? "") > (existing.createdAt ?? "")) {
      perStage[data.stageId] = data;
    }
  });

  const keywords = Array.from(
    new Set(
      Object.values(perStage).flatMap((entry) => entry.keywords ?? [])
    )
  ).slice(0, 5);

  const stageSummaries = {
    problemDefinition: "",
    dataAnalysis: "",
    designAlternatives: "",
    designEvaluation: "",
    decision: "",
  };

  if (perStage.problem?.stageSummaries?.problemDefinition) {
    stageSummaries.problemDefinition =
      perStage.problem.stageSummaries.problemDefinition;
  }
  if (perStage.data?.stageSummaries?.dataAnalysis) {
    stageSummaries.dataAnalysis = perStage.data.stageSummaries.dataAnalysis;
  }
  if (perStage.alternatives?.stageSummaries?.designAlternatives) {
    stageSummaries.designAlternatives =
      perStage.alternatives.stageSummaries.designAlternatives;
  }
  if (perStage.evaluation?.stageSummaries?.designEvaluation) {
    stageSummaries.designEvaluation =
      perStage.evaluation.stageSummaries.designEvaluation;
  }
  if (perStage.report?.stageSummaries?.decision) {
    stageSummaries.decision = perStage.report.stageSummaries.decision;
  }

  return { keywords, stageSummaries };
};

export const loadStageLocks = async (): Promise<StageLockState | null> => {
  const app = getFirebaseApp();
  if (!app) {
    return null;
  }
  const db = getFirestore(app);
  const snapshot = await getDoc(doc(db, "ppssStageLocks", "current"));
  if (!snapshot.exists()) {
    return null;
  }
  return snapshot.data() as StageLockState;
};

export const saveStageLocks = async (
  payload: StageLockState
): Promise<void> => {
  const app = getFirebaseApp();
  if (!app) {
    return;
  }
  const db = getFirestore(app);
  await setDoc(
    doc(db, "ppssStageLocks", "current"),
    {
      ...payload,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
};

export const saveBackgroundKnowledge = async (payload: {
  curatedText: string;
  updatedBy: string;
}) => {
  const app = getFirebaseApp();
  if (!app) {
    return;
  }
  const db = getFirestore(app);
  await setDoc(
    doc(db, "ppssBackgroundKnowledge", "current"),
    {
      curatedText: payload.curatedText,
      updatedBy: payload.updatedBy,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
};

export const loadBackgroundKnowledge = async (): Promise<
  BackgroundKnowledge | null
> => {
  const app = getFirebaseApp();
  if (!app) {
    return null;
  }
  const db = getFirestore(app);
  const snapshot = await getDoc(doc(db, "ppssBackgroundKnowledge", "current"));
  if (!snapshot.exists()) {
    return null;
  }
  return snapshot.data() as BackgroundKnowledge;
};

export const archiveBackgroundKnowledgeFile = async (
  file: File,
  uploadedBy: string
) => {
  const app = getFirebaseApp();
  if (!app) {
    return;
  }
  const storage = getStorage(app);
  const db = getFirestore(app);
  const timestamp = new Date().toISOString();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `ppss-background-knowledge/originals/${timestamp}-${safeName}`;
  await uploadBytes(ref(storage, storagePath), file);
  const archivePayload: BackgroundKnowledgeArchive = {
    fileName: file.name,
    storagePath,
    contentType: file.type || "application/octet-stream",
    size: file.size,
    uploadedAt: timestamp,
    uploadedBy,
  };
  await addDoc(collection(db, "ppssBackgroundKnowledgeArchives"), archivePayload);
};
  
   export const saveCurrentSiteImage = async (
    file: File,
    updatedBy: string
  ): Promise<SiteImage | null> => {
    const app = getFirebaseApp();
    if (!app) return null;
  
    const db = getFirestore(app);
    const storage = getStorage(app);
  
    const ext =
      file.type === "image/png"
        ? "png"
        : file.type === "image/jpeg"
          ? "jpg"
          : "png";
  
    const timestamp = Date.now();
    const storagePath = `ppss-site-image/${timestamp}.${ext}`;
    const storageRef = ref(storage, storagePath);
  
    // 1️⃣ 업로드
    await uploadBytes(storageRef, file);
  
    // 2️⃣ URL 생성 (이 줄이 핵심)
    const downloadUrl = await getDownloadURL(storageRef);
  
    const payload: SiteImage = {
      imageId: String(timestamp),
      storagePath,
      downloadUrl,
      updatedAt: new Date().toISOString(),
      updatedBy,
    };
  
    // 3️⃣ Firestore current 포인터 갱신
    await setDoc(doc(db, "ppssSiteImages", "current"), payload, { merge: true });
  
    return payload;
  };

export const loadCurrentSiteImage = async (): Promise<SiteImage | null> => {
  const app = getFirebaseApp();
  if (!app) return null;

  const db = getFirestore(app);
  const snapshot = await getDoc(doc(db, "ppssSiteImages", "current"));
  if (!snapshot.exists()) {
    return null;
  }

  return snapshot.data() as SiteImage;
};

export const saveGeneratedImageFromBase64 = async (payload: {
  imageId: string;
  base64: string;
  label: string;
  note: string;
  userId: string;
}): Promise<GeneratedImage | null> => {
  const app = getFirebaseApp();
  if (!app) {
    return null;
  }
  const db = getFirestore(app);
  const existingSnapshot = await getDoc(
    doc(db, "ppssGeneratedImages", payload.imageId)
  );
  if (existingSnapshot.exists()) {
    return existingSnapshot.data() as GeneratedImage;
  }
  const storage = getStorage(app);
  const storagePath = `ppss-generated-images/${payload.imageId}.png`;
  const base64 = payload.base64.includes(",")
    ? payload.base64.split(",")[1]
    : payload.base64;
  await uploadString(ref(storage, storagePath), base64, "base64", {
    contentType: "image/png",
  });
  const downloadUrl = await getDownloadURL(ref(storage, storagePath));
  const createdAt = new Date().toISOString();
  const record: GeneratedImage = {
    imageId: payload.imageId,
    label: payload.label,
    note: payload.note,
    storagePath,
    downloadUrl,
    createdAt,
    userId: payload.userId,
  };
  await setDoc(doc(db, "ppssGeneratedImages", payload.imageId), record);
  return record;
};

export const loadGeneratedImages = async (
  userId: string
): Promise<GeneratedImage[]> => {
  const app = getFirebaseApp();
  if (!app) {
    return [];
  }
  const db = getFirestore(app);
  const snapshot = await getDocs(
    query(
      collection(db, "ppssGeneratedImages"),
      where("userId", "==", userId)
    )
  );
  return snapshot.docs
    .map((docSnap) => docSnap.data() as GeneratedImage)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
};

export const loadGeneratedImage = async (
  imageId: string
): Promise<GeneratedImage | null> => {
  const app = getFirebaseApp();
  if (!app) {
    return null;
  }
  const db = getFirestore(app);
  const snapshot = await getDoc(doc(db, "ppssGeneratedImages", imageId));
  if (!snapshot.exists()) {
    return null;
  }
  return snapshot.data() as GeneratedImage;
};

export const saveUserDesignSubmission = async (
  userId: string,
  imageId: string
) => {
  const app = getFirebaseApp();
  if (!app) {
    return;
  }
  const db = getFirestore(app);
  await addDoc(collection(db, "ppssUserDesignSubmissions"), {
    userId,
    imageId,
    createdAt: new Date().toISOString(),
  });
};

export const loadSubmittedDesigns = async (): Promise<SubmittedDesign[]> => {
  const app = getFirebaseApp();
  if (!app) {
    return [];
  }
  const db = getFirestore(app);
  const submissionsSnap = await getDocs(
    collection(db, "ppssUserDesignSubmissions")
  );
  if (submissionsSnap.empty) {
    return [];
  }
  const latestByUser = submissionsSnap.docs.reduce<
    Record<string, { imageId: string; createdAt: string }>
  >((acc, docSnap) => {
    const data = docSnap.data() as {
      userId?: string;
      imageId?: string;
      createdAt?: string;
    };
    if (!data.userId || !data.imageId || !data.createdAt) {
      return acc;
    }
    const existing = acc[data.userId];
    if (!existing || data.createdAt > existing.createdAt) {
      acc[data.userId] = {
        imageId: data.imageId,
        createdAt: data.createdAt,
      };
    }
    return acc;
  }, {});

  const entries = await Promise.all(
    Object.entries(latestByUser).map(async ([userId, submission]) => {
      const imageSnap = await getDoc(
        doc(db, "ppssGeneratedImages", submission.imageId)
      );
      if (!imageSnap.exists()) {
        return null;
      }
      const image = imageSnap.data() as GeneratedImage;
      return {
        userId,
        imageId: submission.imageId,
        createdAt: submission.createdAt,
        label: image.label,
        note: image.note,
        downloadUrl: image.downloadUrl,
      } as SubmittedDesign;
    })
  );

  return entries
    .filter((entry): entry is SubmittedDesign => Boolean(entry))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
};

export const loadEvaluationImages = async (): Promise<EvaluationImage[]> => {
  const app = getFirebaseApp();
  if (!app) {
    return [];
  }
  const db = getFirestore(app);
  const snapshot = await getDocs(collection(db, "ppssEvaluationImages"));
  if (snapshot.empty) {
    return [];
  }
  return snapshot.docs
    .map((docSnap) => docSnap.data() as EvaluationImage)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
};
