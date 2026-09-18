import { Attendance, Batch, Enrollment, Student } from "../../models/index.ts";
import { writeAudit } from "../../services/audit.service.ts";
import { destroyAsset, uploadBuffer } from "../../services/cloudinary.service.ts";
import { cache } from "../../services/cache.service.ts";
import { CACHE_KEYS } from "../../constants/cache.ts";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../utils/errors.ts";
import { logger } from "../../config/logger.ts";
import type { Types } from "mongoose";
import type { CloudinaryAsset } from "../../types/common.ts";

const PHOTO_FOLDER = "optech/attendance";
const PHOTO_RETENTION_DAYS = 30;

function normalizeCode(value: string) {
  return value.trim().replace(/\s+/g, "").toUpperCase();
}

/** Calendar date in Asia/Kolkata as UTC midnight of that Y-M-D. */
export function attendanceDateIST(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
}

export async function markBulk(
  batchId: string,
  courseId: string,
  date: Date,
  session: string,
  marks: { studentId: string; status: "present" | "absent" | "late" }[],
  userId: string,
) {
  const ops = marks.map((m) => ({
    updateOne: {
      filter: { student: m.studentId, date, session },
      update: {
        $set: {
          student: m.studentId,
          batch: batchId,
          course: courseId,
          date,
          session,
          status: m.status,
          markedBy: userId,
        },
      },
      upsert: true,
    },
  }));
  await Attendance.bulkWrite(ops as never);
  await writeAudit({
    user: userId as unknown as Types.ObjectId,
    action: "attendance.bulk",
    module: "attendance",
    resourceId: batchId,
    newValue: { date, count: marks.length },
  });
}

export async function updateOne(id: string, status: "present" | "absent" | "late", userId: string) {
  const prev = await Attendance.findById(id);
  if (!prev) throw new ConflictError("Attendance not found");
  prev.status = status;
  await prev.save();
  await writeAudit({
    user: userId as unknown as Types.ObjectId,
    action: "attendance.update",
    module: "attendance",
    resourceId: id,
    oldValue: { status: prev.status },
    newValue: { status },
  });
  return prev;
}

export async function monthlyReport(batchId: string, year: number, month: number) {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);
  return Attendance.aggregate([
    { $match: { batch: batchId, date: { $gte: start, $lt: end } } },
    { $group: { _id: { student: "$student", status: "$status" }, n: { $sum: 1 } } },
  ]);
}

export function percent(present: number, total: number) {
  return total ? Math.round((present / total) * 100) : 0;
}

export async function todayMarksForBatch(batchId: string, studentIds: string[]) {
  if (!studentIds.length) return new Map<string, { loggedIn: boolean; loggedOut: boolean }>();
  const date = attendanceDateIST();
  const rows = await Attendance.find({
    batch: batchId,
    date,
    session: batchId,
    student: { $in: studentIds },
  })
    .select("student loginAt logoutAt")
    .lean();
  const map = new Map<string, { loggedIn: boolean; loggedOut: boolean }>();
  for (const row of rows) {
    map.set(String(row.student), {
      loggedIn: Boolean(row.loginAt),
      loggedOut: Boolean(row.logoutAt),
    });
  }
  return map;
}

export async function markLiveSelfie(input: {
  studentId: string;
  batchId: string;
  studentCode?: string;
  action: "login" | "logout";
  file: { buffer: Buffer; mimetype: string; originalname: string };
}) {
  const student = await Student.findById(input.studentId).lean();
  if (!student || student.blocked) throw new NotFoundError("Student not found");
  if (input.studentCode?.trim() && normalizeCode(String(student.studentCode ?? "")) !== normalizeCode(input.studentCode)) {
    throw new ForbiddenError("Student ID does not match this card");
  }

  const batch = await Batch.findById(input.batchId).select("course active").lean();
  if (!batch || batch.active === false) throw new NotFoundError("Batch not found");

  const enrolled = await Enrollment.exists({
    student: student._id,
    batch: batch._id,
    status: "active",
  });
  const assigned = String(student.batch ?? "") === String(batch._id);
  if (!enrolled && !assigned) throw new ForbiddenError("Student is not in this batch");

  const date = attendanceDateIST();
  const session = String(batch._id);
  const courseId = String(batch.course);
  let row = await Attendance.findOne({ student: student._id, date, session });

  if (input.action === "login" && row?.loginAt) {
    throw new ConflictError("Login attendance already marked for today");
  }
  if (input.action === "logout") {
    if (!row?.loginAt) throw new BadRequestError("Mark login attendance first");
    if (row.logoutAt) throw new ConflictError("Logout attendance already marked for today");
  }

  const photo = await uploadBuffer(
    input.file.buffer,
    PHOTO_FOLDER,
    input.file.mimetype,
    input.file.originalname || `${input.action}.jpg`,
  );
  const now = new Date();

  if (!row) {
    row = await Attendance.create({
      student: student._id,
      batch: batch._id,
      course: courseId,
      date,
      session,
      status: "present",
      loginAt: input.action === "login" ? now : undefined,
      logoutAt: input.action === "logout" ? now : undefined,
      loginPhoto: input.action === "login" ? photo : undefined,
      logoutPhoto: input.action === "logout" ? photo : undefined,
    });
  } else {
    if (input.action === "login") {
      row.loginAt = now;
      row.loginPhoto = photo as CloudinaryAsset;
      row.status = "present";
    } else {
      row.logoutAt = now;
      row.logoutPhoto = photo as CloudinaryAsset;
    }
    await row.save();
  }

  await cache.del([CACHE_KEYS.live]);
  return {
    action: input.action,
    loginAt: row.loginAt,
    logoutAt: row.logoutAt,
    loginPhoto: row.loginPhoto,
    logoutPhoto: row.logoutPhoto,
    status: row.status,
  };
}

export async function pruneOldAttendancePhotos(retentionDays = PHOTO_RETENTION_DAYS) {
  const cutoff = attendanceDateIST();
  cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);
  const photoFilter = {
    date: { $lt: cutoff },
    $or: [
      { "loginPhoto.publicId": { $type: "string", $ne: "" } },
      { "logoutPhoto.publicId": { $type: "string", $ne: "" } },
    ],
  };

  let scanned = 0;
  let deleted = 0;
  for (let pass = 0; pass < 20; pass += 1) {
    const rows = await Attendance.find(photoFilter).limit(250);
    if (!rows.length) break;
    scanned += rows.length;
    for (const row of rows) {
      const unset: Record<string, 1> = {};
      if (row.loginPhoto?.publicId) {
        try {
          await destroyAsset(row.loginPhoto.publicId, row.loginPhoto.resourceType || "image");
        } catch (err) {
          logger.warn({ err, publicId: row.loginPhoto.publicId }, "Failed to delete login attendance photo");
        }
        unset.loginPhoto = 1;
        deleted += 1;
      }
      if (row.logoutPhoto?.publicId) {
        try {
          await destroyAsset(row.logoutPhoto.publicId, row.logoutPhoto.resourceType || "image");
        } catch (err) {
          logger.warn({ err, publicId: row.logoutPhoto.publicId }, "Failed to delete logout attendance photo");
        }
        unset.logoutPhoto = 1;
        deleted += 1;
      }
      if (Object.keys(unset).length) {
        await Attendance.updateOne({ _id: row._id }, { $unset: unset });
      }
    }
    if (rows.length < 250) break;
  }

  return { scanned, deleted, cutoff };
}
