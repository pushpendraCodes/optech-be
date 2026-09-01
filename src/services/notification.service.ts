import { Notification, NotificationReceipt, Student, User, AdminAlert, AdminAlertReceipt } from "../models/index.js";
import type { NotificationDoc } from "../models/index.js";
import { sendPush, isStalePushTokenError } from "./messaging.service.js";
import { clearStudentPushToken, clearUserPushToken } from "../utils/push-token.js";
import { logger } from "../config/logger.js";
import { env } from "../config/env.js";
import { Queue } from "bullmq";
import { redis } from "../config/redis.js";
import { QUEUE_NAMES } from "../constants/cache.js";

export const notificationQueue = new Queue(QUEUE_NAMES.notifications, {
  connection: redis,
  prefix: "optech",
});

export async function enqueueBroadcast(notificationId: string, delayMs = 0) {
  await notificationQueue.add(
    "broadcast",
    { notificationId },
    { delay: delayMs, removeOnComplete: true },
  );
}

type NotifyStudentsInput = {
  type: NotificationDoc["type"];
  title: string;
  body: string;
  audience: NotificationDoc["audience"];
  course?: string;
  batch?: string;
  student?: string;
  createdBy?: string;
};

export async function notifyStudents(input: NotifyStudentsInput) {
  const note = await Notification.create(input);
  await enqueueBroadcast(String(note._id));
  return note;
}

function staffAlertUrl(link?: string) {
  if (!link) return env.ADMIN_URL;
  if (link.startsWith("http")) return link;
  const base = env.ADMIN_URL.replace(/\/$/, "");
  return `${base}${link.startsWith("/") ? link : `/${link}`}`;
}

export async function notifyStaffAlert(input: {
  type: string;
  title: string;
  body: string;
  link?: string;
}) {
  const alert = await AdminAlert.create(input);
  const staffUsers = await User.find({ kind: "staff", status: "active" }).select("_id pushToken").lean();
  if (!staffUsers.length) return alert;

  await AdminAlertReceipt.insertMany(
    staffUsers.map((user) => ({
      alert: alert._id,
      user: user._id,
    })),
  );

  const pushLink = staffAlertUrl(input.link);
  const pushData = { type: input.type, link: input.link ?? "" };

  for (const user of staffUsers) {
    if (!user.pushToken) continue;
    try {
      await sendPush(user.pushToken, input.title, input.body, pushLink, pushData);
    } catch (err) {
      if (isStalePushTokenError(err)) {
        await clearUserPushToken(String(user._id));
      }
      logger.warn({ userId: user._id, err }, "Staff push delivery failed");
    }
  }

  return alert;
}

export async function notifyNewEnquiry(input: {
  name: string;
  phone: string;
  email: string;
  course: string;
  message?: string;
}) {
  const lines = [`${input.name} · ${input.phone}`, input.course];
  if (input.message?.trim()) lines.push(input.message.trim().slice(0, 120));

  return notifyStaffAlert({
    type: "enquiry",
    title: "New website enquiry",
    body: lines.join(" — "),
    link: "/enquiries",
  });
}

async function resolveAudience(note: InstanceType<typeof Notification>) {
  if (note.audience === "ALL") {
    return Student.find({ blocked: false }).select("_id pushToken").lean();
  }
  if (note.audience === "STUDENT" && note.student) {
    return Student.find({ _id: note.student, blocked: false }).select("_id pushToken").lean();
  }
  if (note.audience === "COURSE" && note.course) {
    const { Enrollment } = await import("../models/index.js");
    const ens = await Enrollment.find({ course: note.course, status: "active" }).select("student").lean();
    const ids = ens.map((e) => e.student);
    return Student.find({ _id: { $in: ids }, blocked: false }).select("_id pushToken").lean();
  }
  if (note.audience === "BATCH" && note.batch) {
    const { Enrollment } = await import("../models/index.js");
    const ens = await Enrollment.find({ batch: note.batch, status: "active" }).select("student").lean();
    const ids = ens.map((e) => e.student);
    return Student.find({ _id: { $in: ids }, blocked: false }).select("_id pushToken").lean();
  }
  return [];
}

export async function deliverNotification(notificationId: string) {
  const note = await Notification.findById(notificationId);
  if (!note || note.sentAt) return;

  const students = await resolveAudience(note);
  for (const s of students) {
    await NotificationReceipt.updateOne(
      { notification: note._id, student: s._id },
      { $setOnInsert: { notification: note._id, student: s._id } },
      { upsert: true },
    );
    if (s.pushToken) {
      try {
        await sendPush(s.pushToken, note.title, note.body, env.FRONTEND_URL);
      } catch (err) {
        if (isStalePushTokenError(err)) {
          await clearStudentPushToken(String(s._id));
        }
        logger.warn({ studentId: s._id, err }, "Push delivery failed");
      }
    }
  }
  note.sentAt = new Date();
  await note.save();
}

export async function listStaffAlerts(userId: string) {
  return AdminAlertReceipt.find({ user: userId })
    .populate("alert")
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
}

export async function staffAlertUnreadCount(userId: string) {
  return AdminAlertReceipt.countDocuments({ user: userId, readAt: { $exists: false } });
}

export async function markStaffAlertRead(userId: string, receiptId: string) {
  await AdminAlertReceipt.updateOne({ _id: receiptId, user: userId }, { readAt: new Date() });
  return { read: true };
}

export function localizedTitle(title: unknown) {
  if (title && typeof title === "object" && "en" in (title as object)) {
    return String((title as { en?: string }).en || "");
  }
  return String(title ?? "");
}

export async function notifyStudyMaterial(row: { title?: string; chapter?: string; course?: unknown; published?: boolean }) {
  if (!row.published) return;
  await notifyStudents({
    type: "general",
    title: `New study material: ${row.title || "Notes"}`,
    body: `${row.chapter || "Course notes"} — open Notes in your student portal.`,
    audience: "COURSE",
    course: String(row.course),
  });
}

export async function notifyNotice(row: {
  title?: unknown;
  published?: boolean;
  audience?: "ALL" | "COURSE" | "BATCH";
  course?: unknown;
  batch?: unknown;
}) {
  if (!row.published) return;
  const title = localizedTitle(row.title) || "Institute notice";
  await notifyStudents({
    type: "notice",
    title: `Notice: ${title}`,
    body: "Open Notifications in your student portal to read the full notice.",
    audience: row.audience || "ALL",
    course: row.course ? String(row.course) : undefined,
    batch: row.batch ? String(row.batch) : undefined,
  });
}

export async function notifyJob(row: {
  title?: string;
  employer?: string;
  course?: unknown;
  published?: boolean;
}) {
  if (!row.published) return;
  await notifyStudents({
    type: "general",
    title: `Job opening: ${row.title || "New opportunity"}`,
    body: `${row.employer || "Employer"} — check Jobs in your student portal.`,
    audience: row.course ? "COURSE" : "ALL",
    course: row.course ? String(row.course) : undefined,
  });
}

export async function notifyLiveNow(row: { title?: string; course?: unknown; batch?: unknown }) {
  await notifyStudents({
    type: "live_class",
    title: `Live now: ${row.title || "Class"}`,
    body: "Your class is live. Open Live classes in your student portal to join.",
    audience: row.batch ? "BATCH" : "COURSE",
    course: row.course ? String(row.course) : undefined,
    batch: row.batch ? String(row.batch) : undefined,
  });
}

export async function notifyCertificateIssued(studentId: string, courseTitle: string) {
  await notifyStudents({
    type: "general",
    title: "Certificate issued",
    body: `Your certificate for ${courseTitle} is ready. Download it from Certificates in your portal.`,
    audience: "STUDENT",
    student: studentId,
  });
}

export async function notifyPaymentReceived(studentId: string, amount: number, courseTitle?: string) {
  await notifyStudents({
    type: "fee_due",
    title: "Fee Payment Received",
    body: `Payment of ₹${Number(amount).toLocaleString("en-IN")} has been recorded${courseTitle ? ` for ${courseTitle}` : ""}. Check Fees in your student portal.`,
    audience: "STUDENT",
    student: studentId,
  });
}

export async function notifyNewQuiz(row: { title?: string; course?: unknown; open?: boolean }) {
  if (row.open === false) return;
  await notifyStudents({
    type: "exam",
    title: `New Quiz: ${row.title || "Assessment"}`,
    body: "A new quiz is now available. Open Quizzes in your student portal to attempt it.",
    audience: row.course ? "COURSE" : "ALL",
    course: row.course ? String(row.course) : undefined,
  });
}

