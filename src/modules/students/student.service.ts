import {
  Admission,
  Attendance,
  DigitalIdCard,
  Enrollment,
  LiveClass,
  Notice,
  NotificationReceipt,
  Payment,
  Quiz,
  QuizAttempt,
  Student,
  StudyMaterial,
  TypingAttempt,
  TypingParagraph,
  User,
} from "../../models/index.ts";
import { ForbiddenError, NotFoundError } from "../../utils/errors.ts";
import { hashPassword } from "../auth/auth.service.ts";
import { gradeQuiz, gradeTyping } from "../../services/grading.service.ts";
import { buildIdCardPdf } from "../../services/pdf.service.ts";
import { computeStudentFees, studentIdsWithOutstandingFees } from "../../services/installment.service.ts";
import { certificatesForEnrollments } from "../../services/certificate.service.ts";
import { paginationMeta } from "../../utils/pagination.ts";
import { saveStudentPushTokenIfEmpty } from "../../utils/push-token.ts";
import type { PaginationQuery } from "../../utils/pagination.ts";

export async function dashboard(studentId: string) {
  const student = await Student.findById(studentId).populate("user").lean();
  if (!student) throw new NotFoundError("Student not found");
  const enrollments = await Enrollment.find({ student: studentId, status: "active" })
    .populate("course", "title slug")
    .populate("batch", "label timing")
    .lean();
  const att = await Attendance.aggregate([
    { $match: { student: student._id } },
    { $group: { _id: "$status", n: { $sum: 1 } } },
  ]);
  const present = att.find((a) => a._id === "present")?.n ?? 0;
  const total = att.reduce((s, a) => s + a.n, 0);
  const unread = await NotificationReceipt.countDocuments({ student: studentId, readAt: { $exists: false } });
  return {
    student,
    enrollments,
    attendancePercent: total ? Math.round((present / total) * 100) : 0,
    unread,
  };
}

export async function myProfile(studentId: string) {
  const student = await Student.findById(studentId)
    .populate("user", "-passwordHash -refreshTokenHash")
    .populate("batch", "label timing")
    .lean();
  if (!student) throw new NotFoundError("Student not found");
  return student;
}

export async function adminDetail(studentId: string) {
  const student = await Student.findById(studentId)
    .populate("user", "-passwordHash -refreshTokenHash")
    .populate("batch", "label timing seats start active")
    .lean();
  if (!student) throw new NotFoundError("Student not found");

  const [admission, enrollments, feeSnapshot, payments, attendanceRows, attSummary] = await Promise.all([
    Admission.findOne({ student: studentId }).populate("course", "title slug fee").populate("batch", "label timing").lean(),
    Enrollment.find({ student: studentId })
      .populate("course", "title slug fee duration durationMonths mode discount active")
      .populate("batch", "label timing seats start active")
      .sort({ createdAt: -1 })
      .lean(),
    computeStudentFees(studentId),
    Payment.find({ student: studentId }).populate("course", "title slug").sort({ createdAt: -1 }).limit(50).lean(),
    Attendance.find({ student: studentId }).populate("course", "title slug").sort({ date: -1 }).limit(15).lean(),
    Attendance.aggregate([
      { $match: { student: student._id } },
      { $group: { _id: "$status", n: { $sum: 1 } } },
    ]),
  ]);

  const installments = feeSnapshot.installments;
  const fees = feeSnapshot.fees;

  const present = attSummary.find((a) => a._id === "present")?.n ?? 0;
  const absent = attSummary.find((a) => a._id === "absent")?.n ?? 0;
  const late = attSummary.find((a) => a._id === "late")?.n ?? 0;
  const attTotal = present + absent + late;

  const certificates = await certificatesForEnrollments(enrollments.map((e) => String(e._id)));

  return {
    student,
    admission,
    enrollments,
    certificates,
    installments,
    payments,
    attendance: {
      present,
      absent,
      late,
      total: attTotal,
      percent: attTotal ? Math.round((present / attTotal) * 100) : 0,
      recent: attendanceRows,
    },
    fees,
  };
}

export async function adminUpdateStudent(studentId: string, body: Record<string, unknown>) {
  const student = await Student.findById(studentId);
  if (!student) throw new NotFoundError("Student not found");

  const userUpdate: Record<string, unknown> = {};
  if (typeof body.name === "string") userUpdate.name = body.name;
  if (typeof body.email === "string") userUpdate.email = body.email || undefined;
  if (typeof body.phone === "string") userUpdate.phone = body.phone;

  const studentUpdate: Record<string, unknown> = {};
  if (typeof body.parentPhone === "string") studentUpdate.parentPhone = body.parentPhone;
  if (typeof body.address === "string") studentUpdate.address = body.address;
  if (body.dob) studentUpdate.dob = body.dob;
  if (typeof body.rollNumber === "string") studentUpdate.rollNumber = body.rollNumber;
  if (body.validTill) studentUpdate.validTill = body.validTill;
  if (body.batch !== undefined) studentUpdate.batch = body.batch || undefined;
  if (body.photo && typeof body.photo === "object") studentUpdate.photo = body.photo;

  if (Object.keys(userUpdate).length) {
    await User.findByIdAndUpdate(student.user, userUpdate);
  }
  await Student.findByIdAndUpdate(studentId, studentUpdate);
  return adminDetail(studentId);
}

export async function adminResetPassword(studentId: string) {
  const student = await Student.findById(studentId);
  if (!student) throw new NotFoundError("Student not found");
  const user = await User.findById(student.user).select("+passwordHash +refreshTokenHash");
  if (!user) throw new NotFoundError("User not found");
  const password = Math.random().toString(36).slice(2, 12) + "A1";
  user.passwordHash = await hashPassword(password);
  user.passwordChangedAt = new Date();
  user.refreshTokenHash = undefined;
  await user.save();
  return { studentCode: student.studentCode, password };
}

export async function myAttendance(studentId: string, month?: string) {
  const q: Record<string, unknown> = { student: studentId };
  if (month) {
    const [y, m] = month.split("-").map(Number);
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 1);
    q.date = { $gte: start, $lt: end };
  }
  return Attendance.find(q).sort({ date: -1 }).populate("course", "title slug").lean();
}

export async function myNotes(studentId: string) {
  const ens = await Enrollment.find({ student: studentId, status: "active" }).select("course");
  const ids = ens.map((e) => e.course);
  return StudyMaterial.find({ course: { $in: ids }, published: true })
    .populate("course", "title slug")
    .sort({ chapter: 1, title: 1 })
    .lean();
}

export async function myQuizzes(studentId: string) {
  const ens = await Enrollment.find({ student: studentId, status: "active" }).select("course");
  const rows = await Quiz.find({ course: { $in: ens.map((e) => e.course) }, open: true })
    .populate("course", "title slug")
    .select("title description course subject minutes passing negative open scheduledAt questions")
    .sort({ scheduledAt: -1, title: 1 })
    .lean();
  return rows.map((q) => ({
    ...q,
    questionCount: q.questions?.length ?? 0,
    totalMarks: (q.questions ?? []).reduce((s, x) => s + (x.marks ?? 1), 0),
    questions: undefined,
  }));
}

export async function myQuizAttempts(studentId: string) {
  return QuizAttempt.find({ student: studentId, status: { $ne: "in_progress" } })
    .populate("quiz", "title passing")
    .sort({ submittedAt: -1 })
    .lean();
}

export async function myNotifications(studentId: string, q: PaginationQuery) {
  const page = q.page ?? 1;
  const limit = q.limit ?? 20;
  const filter = { student: studentId };
  const [items, total] = await Promise.all([
    NotificationReceipt.find(filter)
      .populate("notification")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    NotificationReceipt.countDocuments(filter),
  ]);
  return { items, meta: paginationMeta(total, page, limit) };
}

export async function markAllNotificationsRead(studentId: string) {
  await NotificationReceipt.updateMany(
    { student: studentId, readAt: { $exists: false } },
    { readAt: new Date() },
  );
  return { read: true };
}

export async function trackNoteView(id: string, studentId: string) {
  const ens = await Enrollment.find({ student: studentId, status: "active" }).select("course");
  const note = await StudyMaterial.findById(id);
  if (!note) throw new NotFoundError("Material not found");
  if (!ens.some((e) => String(e.course) === String(note.course))) {
    throw new ForbiddenError("Not enrolled");
  }
  note.views += 1;
  await note.save();
  return note;
}

export async function startQuiz(quizId: string, studentId: string) {
  const quiz = await Quiz.findById(quizId);
  if (!quiz || !quiz.open) throw new NotFoundError("Quiz not available");
  const existing = await QuizAttempt.findOne({ quiz: quizId, student: studentId, status: "in_progress" });
  if (existing) return { attempt: existing, quiz: publicQuiz(quiz) };
  const attempt = await QuizAttempt.create({
    quiz: quizId,
    student: studentId,
    startedAt: new Date(),
    answers: [],
    status: "in_progress",
  });
  return { attempt, quiz: publicQuiz(quiz) };
}

function publicQuiz(quiz: InstanceType<typeof Quiz>) {
  const totalMarks = quiz.questions.reduce((s, q) => s + (q.marks ?? 1), 0);
  return {
    id: quiz._id,
    title: quiz.title,
    description: quiz.description,
    minutes: quiz.minutes,
    passing: quiz.passing,
    negative: quiz.negative,
    negativeValue: quiz.negativeValue,
    questionCount: quiz.questions.length,
    totalMarks,
    questions: quiz.questions.map((q, i) => ({
      id: String(i),
      type: q.type,
      prompt: q.prompt,
      options: q.options,
      marks: q.marks,
    })),
  };
}

export async function submitQuiz(attemptId: string, studentId: string, answers: { index: number; value: string | number }[]) {
  const attempt = await QuizAttempt.findOne({ _id: attemptId, student: studentId });
  if (!attempt) throw new NotFoundError("Attempt not found");
  if (attempt.status !== "in_progress") throw new ForbiddenError("Already submitted");
  const quiz = await Quiz.findById(attempt.quiz);
  if (!quiz) throw new NotFoundError("Quiz not found");
  const elapsedMs = Date.now() - attempt.startedAt.getTime();
  const elapsed = elapsedMs / 60000;
  const auto = elapsed > quiz.minutes + 0.5;
  const result = gradeQuiz(quiz.questions, answers, quiz.negative, quiz.negativeValue);
  attempt.answers = answers.map((a) => ({ questionId: String(a.index), value: a.value }));
  attempt.score = result.score;
  attempt.percent = result.percent;
  attempt.correct = result.correct;
  attempt.wrong = result.wrong;
  attempt.skipped = result.skipped;
  attempt.timeTakenSeconds = Math.round(elapsedMs / 1000);
  attempt.submittedAt = new Date();
  attempt.status = auto ? "auto_submitted" : "submitted";
  await attempt.save();
  return {
    ...result,
    passing: quiz.passing,
    passed: result.percent >= quiz.passing,
    timeTakenSeconds: attempt.timeTakenSeconds,
    negative: quiz.negative,
    negativeValue: quiz.negativeValue,
  };
}

export async function listTypingParagraphs() {
  return TypingParagraph.find({ active: true })
    .select("_id language text createdAt")
    .sort({ language: 1, createdAt: -1 })
    .lean();
}

export async function myTypingAttempts(studentId: string) {
  return TypingAttempt.find({ student: studentId }).sort({ createdAt: -1 }).limit(50).lean();
}

export async function startTyping(
  studentId: string,
  language: "en" | "hi",
  minutes: number,
  paragraphId?: string,
) {
  let para;
  if (paragraphId) {
    para = await TypingParagraph.findOne({ _id: paragraphId, language, active: true });
    if (!para) throw new NotFoundError("Paragraph not found");
  } else {
    const pool = await TypingParagraph.find({ language, active: true });
    para = pool[Math.floor(Math.random() * Math.max(pool.length, 1))];
  }
  if (!para) throw new NotFoundError("No paragraph available");
  return { paragraph: para, minutes, studentId };
}

export async function submitTyping(
  studentId: string,
  language: "en" | "hi",
  minutes: number,
  source: string,
  typed: string,
) {
  const result = gradeTyping(source, typed, minutes);
  const row = await TypingAttempt.create({ student: studentId, language, minutes, typed, source, ...result });
  return row;
}

export async function idCard(studentId: string) {
  const student = await Student.findById(studentId).populate("user");
  if (!student) throw new NotFoundError("Student not found");
  const user = student.user as unknown as { name: string; phone?: string; email?: string };
  const ens = await Enrollment.findOne({ student: studentId, status: "active" }).populate("course");
  const courseTitle = (ens?.course as { title?: { en?: string } } | undefined)?.title?.en ?? "Optech";
  const pdf = await buildIdCardPdf({
    name: user.name,
    studentCode: student.studentCode,
    course: courseTitle,
    roll: student.rollNumber ?? student.studentCode,
    validTill: student.validTill ? student.validTill.toDateString() : "Jul 2027",
    mobile: user.phone ?? student.parentPhone,
    email: user.email,
    address: student.address,
    photoUrl: student.photo?.url,
  });
  await DigitalIdCard.findOneAndUpdate(
    { student: studentId },
    { qrPayload: `optech://verify/${student.studentCode}` },
    { upsert: true },
  );
  return {
    pdf: Buffer.from(pdf).toString("base64"),
    studentCode: student.studentCode,
    name: user.name,
    roll: student.rollNumber ?? student.studentCode,
    course: courseTitle,
    validTill: student.validTill ? student.validTill.toDateString() : "Jul 2027",
    mobile: user.phone ?? student.parentPhone,
    address: student.address,
    photoUrl: student.photo?.url,
  };
}

export async function myNotices() {
  return Notice.find({
    published: true,
    $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }],
  })
    .sort({ pinned: -1, createdAt: -1 })
    .lean();
}

export async function studentLiveClasses(studentId: string) {
  const ens = await Enrollment.find({ student: studentId, status: "active" }).select("course batch").lean();
  if (!ens.length) return [];

  const courseIds = [...new Set(ens.map((e) => String(e.course)))];
  const batchIds = [...new Set(ens.map((e) => e.batch).filter(Boolean).map(String))];

  const rows = await LiveClass.find({
    endsAt: { $exists: false },
    $or: [
      ...(batchIds.length ? [{ batch: { $in: batchIds } }] : []),
      { course: { $in: courseIds }, $or: [{ batch: { $exists: false } }, { batch: null }] },
    ],
  })
    .sort({ isLive: -1, startsAt: 1 })
    .populate("course", "title slug")
    .populate("batch", "label timing")
    .lean();

  return rows.map((row) => ({
    ...row,
    status: row.isLive ? "live" : "scheduled",
  }));
}

export async function savePushToken(studentId: string, token: string) {
  return saveStudentPushTokenIfEmpty(studentId, token);
}

export async function markNotificationRead(studentId: string, id: string) {
  await NotificationReceipt.updateOne({ _id: id, student: studentId }, { readAt: new Date() });
}

type AdminStudentsQuery = PaginationQuery & {
  batch?: string;
  course?: string;
  status?: "" | "active" | "blocked";
  feesDue?: string;
};

export async function adminListStudents(q: AdminStudentsQuery) {
  const filter: Record<string, unknown> = {};
  const term = String(q.search ?? "").trim();

  if (term) {
    const users = await User.find({
      kind: "student",
      $or: [
        { name: { $regex: term, $options: "i" } },
        { phone: { $regex: term, $options: "i" } },
        { email: { $regex: term, $options: "i" } },
        { studentCode: { $regex: term, $options: "i" } },
      ],
    })
      .select("_id")
      .lean();
    const userIds = users.map((u) => u._id);
    filter.$or = [
      { studentCode: { $regex: term, $options: "i" } },
      { rollNumber: { $regex: term, $options: "i" } },
      ...(userIds.length ? [{ user: { $in: userIds } }] : []),
    ];
  }

  if (q.status === "blocked") filter.blocked = true;
  if (q.status === "active") filter.blocked = false;

  if (q.course) {
    const enFilter: Record<string, unknown> = { course: q.course };
    if (q.batch) enFilter.batch = q.batch;
    const enrollments = await Enrollment.find(enFilter).select("student").lean();
    const ids = [...new Set(enrollments.map((e) => String(e.student)))];
    filter._id = { $in: ids.length ? ids : ["000000000000000000000000"] };
  } else if (q.batch) {
    filter.batch = q.batch;
  }

  const feesDueFilter = q.feesDue === "1" || q.feesDue === "true";
  if (feesDueFilter) {
    const dueIds = await studentIdsWithOutstandingFees();
    const existing = filter._id as { $in?: string[] } | undefined;
    if (existing?.$in) {
      const allowed = new Set(existing.$in.map(String));
      filter._id = { $in: dueIds.filter((id) => allowed.has(id)) };
    } else {
      filter._id = { $in: dueIds.length ? dueIds : ["000000000000000000000000"] };
    }
  }

  const [items, total] = await Promise.all([
    Student.find(filter)
      .populate("user", "name email phone status")
      .populate("batch", "label timing")
      .sort({ createdAt: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean(),
    Student.countDocuments(filter),
  ]);

  const enriched = await Promise.all(
    items.map(async (student) => {
      const feeSnapshot = await computeStudentFees(String(student._id));
      const fees = feeSnapshot.fees;
      return {
        ...student,
        feesSummary: {
          totalDue: fees.totalDue,
          totalOverdue: fees.totalOverdue,
          nextDueDate: fees.nextDueDate,
          nextDueAmount: fees.nextDueAmount,
          nextDueKind: fees.nextDueKind,
        },
      };
    }),
  );

  return {
    items: enriched,
    meta: paginationMeta(total, q.page, q.limit),
  };
}
