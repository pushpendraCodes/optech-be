import nodemailer from "nodemailer";
import type { FirebaseError } from "firebase-admin/app";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { messaging } from "../config/firebase.js";

let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!env.SMTP_HOST || !env.SMTP_USER) return null;
  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS.replace(/\s+/g, "") },
  });
  return transporter;
}

export async function sendWhatsApp(to: string, text: string) {
  logger.info({ to, text }, "WhatsApp skipped — admin sends messages manually");
  return { ok: true, stub: true, manual: true };
}

export async function sendEmail(
  to: string,
  subject: string,
  text: string,
  attachments?: { filename: string; content: Buffer }[],
) {
  const mailer = getTransporter();
  if (!mailer) {
    logger.info({ to, subject }, "Email skipped — SMTP not configured");
    return { ok: false, skipped: true };
  }
  await mailer.sendMail({
    from: env.EMAIL_FROM,
    to,
    subject,
    text,
    attachments,
  });
  return { ok: true };
}

const stalePushCodes = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
]);

export function isStalePushTokenError(err: unknown) {
  const code = (err as FirebaseError)?.code;
  return typeof code === "string" && stalePushCodes.has(code);
}

export async function sendPush(
  token: string,
  title: string,
  body: string,
  link?: string,
  data?: Record<string, string>,
) {
  if (!messaging) {
    logger.info({ title }, "Push skipped — Firebase not configured");
    return { ok: false, skipped: true as const };
  }

  try {
    await messaging.send({
      token,
      notification: { title, body },
      data: {
        title,
        body,
        ...(data ?? {}),
        ...(link ? { link } : {}),
      },
      webpush: {
        notification: { title, body },
        fcmOptions: link ? { link } : undefined,
      },
    });
    return { ok: true as const };
  } catch (err) {
    const code = (err as FirebaseError)?.code;
    if (code === "messaging/third-party-auth-error") {
      logger.warn(
        { code },
        "Web push auth failed — in Firebase Console enable Cloud Messaging API and configure Web Push certificates (VAPID) under Project settings → Cloud Messaging",
      );
    }
    throw err;
  }
}
