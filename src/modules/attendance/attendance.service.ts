import { Attendance } from "../../models/index.ts";
import { writeAudit } from "../../services/audit.service.ts";
import { ConflictError } from "../../utils/errors.ts";
import type { Types } from "mongoose";

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
