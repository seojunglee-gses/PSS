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

type SiteImage = {
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

export const saveCurrentSiteImage = async (
  file: File,
  updatedBy: string
): Promise<SiteImage | null> => {
  const app = getFirebaseApp();
  if (!app) {
    return null;
  }
  const db = getFirestore(app);
  const storage = getStorage(app);
  const imageId = `${file.name}-${file.size}-${file.lastModified}`.replace(
    /[^a-zA-Z0-9._-]/g,
    "_"
  );
  const existingSnapshot = await getDoc(doc(db, "ppssSiteImages", "current"));
  const existing = existingSnapshot.exists()
    ? (existingSnapshot.data() as SiteImage)
    : null;
  if (existing && existing.imageId === imageId) {
    return existing;
  }
  const storagePath = `ppss-site-images/${imageId}`;
  await uploadBytes(ref(storage, storagePath), file);
  const downloadUrl = await getDownloadURL(ref(storage, storagePath));
  const payload: SiteImage = {
    imageId,
    storagePath,
    downloadUrl,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
  await setDoc(doc(db, "ppssSiteImages", "current"), payload, { merge: true });
  return payload;
};

export const loadCurrentSiteImage = async (): Promise<SiteImage | null> => {
  const app = getFirebaseApp();
  if (!app) {
    return null;
  }
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
  };
  await setDoc(doc(db, "ppssGeneratedImages", payload.imageId), record);
  return record;
};

export const loadGeneratedImages = async (): Promise<GeneratedImage[]> => {
  const app = getFirebaseApp();
  if (!app) {
    return [];
  }
  const db = getFirestore(app);
  const snapshot = await getDocs(collection(db, "ppssGeneratedImages"));
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
