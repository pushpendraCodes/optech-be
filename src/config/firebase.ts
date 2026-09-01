import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import admin from "firebase-admin";
import { env } from "./env.ts";
import { logger } from "./logger.ts";

type ServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
};

function loadServiceAccount(): ServiceAccount | null {
  if (env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    try {
      const filePath = resolve(process.cwd(), env.FIREBASE_SERVICE_ACCOUNT_PATH);
      return JSON.parse(readFileSync(filePath, "utf8")) as ServiceAccount;
    } catch (err) {
      logger.error({ err, path: env.FIREBASE_SERVICE_ACCOUNT_PATH }, "Failed to read Firebase service account file");
      return null;
    }
  }

  if (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
    return {
      project_id: env.FIREBASE_PROJECT_ID,
      client_email: env.FIREBASE_CLIENT_EMAIL,
      private_key: env.FIREBASE_PRIVATE_KEY,
    };
  }

  return null;
}

export function initFirebase() {
  if (admin.apps.length) return admin.app();

  const account = loadServiceAccount();
  if (!account) {
    logger.warn(
      "Firebase Admin not configured — set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY in backend/.env",
    );
    return null;
  }

  const app = admin.initializeApp({
    credential: admin.credential.cert({
      projectId: account.project_id,
      clientEmail: account.client_email,
      privateKey: account.private_key,
    }),
  });
  logger.info({ projectId: account.project_id }, "Firebase Admin initialized");
  return app;
}

export const firebaseApp = initFirebase();
export const messaging = firebaseApp ? admin.messaging() : null;
