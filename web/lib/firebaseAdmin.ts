import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

const adminEmail = "test@snu.ac.kr";

const getServiceAccount = () => {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    return null;
  }
  const parsed = JSON.parse(raw);
  if (parsed.private_key) {
    parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  }
  return parsed;
};

const getAdminApp = () => {
  if (getApps().length) {
    return getApps()[0];
  }
  const serviceAccount = getServiceAccount();
  if (!serviceAccount) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY is not configured.");
  }
  return initializeApp({
    credential: cert(serviceAccount),
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  });
};

export const adminDb = () => getFirestore(getAdminApp());

export const adminBucket = () => {
  const app = getAdminApp();
  return getStorage(app).bucket();
};

export const verifyAdminRequest = async (authorization?: string) => {
  if (!authorization) {
    throw new Error("Authorization header missing.");
  }
  const token = authorization.replace("Bearer ", "");
  const auth = getAuth(getAdminApp());
  const decoded = await auth.verifyIdToken(token);
  if (decoded.email !== adminEmail) {
    throw new Error("Admin access required.");
  }
  return decoded;
};

export const buildDownloadUrl = (storagePath: string, token: string) => {
  const bucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  if (!bucket) {
    throw new Error("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET is not configured.");
  }
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(
    storagePath
  )}?alt=media&token=${token}`;
};
