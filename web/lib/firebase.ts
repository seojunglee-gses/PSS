import { initializeApp, getApps } from "firebase/app";
import {
  getFirestore,
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
} from "firebase/firestore";
import { getStorage, ref, getBytes, uploadBytes, uploadString } from "firebase/storage";

type EvaluationPayload = {
  submittedAt: string;
  rankings: Record<string, number>;
};

type WorkspaceSummary = {
  stageSummaries: Record<string, string>;
  overallSummary: string;
  updatedAt?: string;
};

type ExecutiveSummary = {
  keywords: string[];
  currentStage: string;
  stageSummaries: {
    problemDefinition: string;
    dataAnalysis: string;
    designAlternatives: string;
    designEvaluation: string;
    decision: string;
  };
  createdAt?: string;
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
    return null;
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

export const saveWorkspaceSummary = async (
  userId: string,
  summary: WorkspaceSummary
) => {
  const app = getFirebaseApp();
  if (!app) {
    return;
  }
  const db = getFirestore(app);
  await setDoc(doc(db, "ppssWorkspaceSummaries", userId), {
    ...summary,
    updatedAt: new Date().toISOString(),
  });
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

export const loadLatestExecutiveSummary = async (): Promise<
  ExecutiveSummary | null
> => {
  const app = getFirebaseApp();
  if (!app) {
    return null;
  }
  const db = getFirestore(app);
  const execQuery = query(
    collection(db, "ppssExecutiveSummaries"),
    orderBy("createdAt", "desc"),
    limit(1)
  );
  const snapshot = await getDocs(execQuery);
  const docSnapshot = snapshot.docs[0];
  if (!docSnapshot) {
    return null;
  }
  return docSnapshot.data() as ExecutiveSummary;
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
