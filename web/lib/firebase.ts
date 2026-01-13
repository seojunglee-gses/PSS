import { initializeApp, getApps } from "firebase/app";
import { getFirestore, addDoc, collection } from "firebase/firestore";

type EvaluationPayload = {
  submittedAt: string;
  rankings: Record<string, number>;
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

export const sendEvaluationResult = async (payload: EvaluationPayload) => {
  const app = getFirebaseApp();
  if (!app) {
    return;
  }
  const db = getFirestore(app);
  await addDoc(collection(db, "ppssEvaluations"), payload);
};
