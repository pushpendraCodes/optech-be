import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { authenticate, requirePermission, requireAnyPermission, requireStaff } from "../../middleware/auth.ts";
import { validate } from "../../middleware/validate.ts";
import { asyncHandler } from "../../utils/async-handler.ts";
import { created, ok } from "../../utils/api-response.ts";
import { NotFoundError } from "../../utils/errors.ts";
import { objectId, paginationQuery } from "../../utils/pagination.ts";
import { saveUserPushTokenIfEmpty } from "../../utils/push-token.ts";
import * as courses from "../courses/course.service.ts";
import * as attendance from "../attendance/attendance.service.ts";
import * as students from "../students/student.service.ts";
import * as cms from "../cms/cms.service.ts";
import * as gallery from "../gallery/gallery.service.ts";
import * as live from "../live/live.service.ts";
import * as scholarship from "../scholarships/scholarship.service.ts";
import * as quizzes from "../quizzes/quiz.service.ts";
import * as staff from "../staff/staff.service.ts";
import * as alumni from "../alumni/alumni.service.ts";
import * as admissionSvc from "../admissions/admission.service.ts";
import * as enrollmentSvc from "../enrollments/enrollment.service.ts";
import * as enquiries from "../enquiries/enquiry.service.ts";
import * as adminUsers from "./admin-user.service.ts";
import { uploadBuffer } from "../../services/cloudinary.service.ts";
import {
  enqueueBroadcast,
  listStaffAlerts,
  markStaffAlertRead,
  notifyJob,
  notifyNotice,
  notifyPaymentReceived,
  notifyStudyMaterial,
  staffAlertUnreadCount,
} from "../../services/notification.service.ts";
import { writeAudit } from "../../services/audit.service.ts";
import {
  Admission,
  Alumni,
  Attendance,
  Batch,
  CmsItem,
  Coupon,
  Course,
  CourseCategory,
  Job,
  LiveClass,
  Notice,
  Notification,
  Quiz,
  Setting,
  Staff,
  StudyMaterial,
  Translation,
  TypingParagraph,
  AuditLog,
  User,
  Student,
  Role,
  DigitalIdCard,
  Enrollment,
  Installment,
  Payment,
  QuizAttempt,
  Referral,
  TypingAttempt,
} from "../../models/index.ts";
import { buildIdCardPdf } from "../../services/pdf.service.ts";
import * as certificateSvc from "../../services/certificate.service.ts";
import * as installmentSvc from "../../services/installment.service.ts";
import * as siteSettings from "../../services/website-settings.service.ts";
import type { Permission } from "../../constants/rbac.ts";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const router = Router();
router.use(authenticate, requireStaff);

router.post(
  "/push-token",
  validate({ body: z.object({ token: z.string().min(1) }) }),
  asyncHandler(async (req, res) => {
    return ok(res, await saveUserPushTokenIfEmpty(req.auth!.sub, req.body.token));
  }),
);

const loc = z.object({ en: z.string(), hi: z.string().optional(), mr: z.string().optional() });

router.get(
  "/courses",
  requirePermission("course:read"),
  validate({ query: paginationQuery }),
  asyncHandler(async (req, res) => {
    const data = await courses.adminListCourses(req.query as never);
    return ok(res, data.items, "OK", data.meta);
  }),
);
router.post(
  "/courses",
  requirePermission("course:create"),
  asyncHandler(async (req, res) => created(res, await courses.createCourse(req.body, req.auth!.sub))),
);
router.patch(
  "/courses/:id",
  requirePermission("course:update"),
  asyncHandler(async (req, res) => ok(res, await courses.updateCourse(req.params.id, req.body, req.auth!.sub))),
);
router.delete(
  "/courses/:id",
  requirePermission("course:delete"),
  asyncHandler(async (req, res) => ok(res, await courses.deleteCourse(req.params.id))),
);
router.post(
  "/courses/:id/batches",
  requirePermission("course:update"),
  asyncHandler(async (req, res) => ok(res, await courses.upsertBatch(req.params.id, req.body))),
);

router.get("/categories", requirePermission("course:read"), asyncHandler(async (_req, res) => ok(res, await CourseCategory.find().lean())));
router.post("/categories", requirePermission("course:create"), asyncHandler(async (req, res) => created(res, await CourseCategory.create(req.body))));

router.get("/students", requirePermission("student:read"), validate({
  query: paginationQuery.extend({
    batch: objectId.optional(),
    course: objectId.optional(),
    status: z.enum(["active", "blocked", ""]).optional(),
    feesDue: z.enum(["", "0", "1", "true", "false"]).optional(),
  }),
}), asyncHandler(async (req, res) => {
  const q = req.query as unknown as z.infer<typeof paginationQuery> & {
    batch?: string;
    course?: string;
    status?: "" | "active" | "blocked";
    feesDue?: string;
  };
  const { items, meta } = await students.adminListStudents(q);
  return ok(res, items, "OK", meta);
}));

router.post(
  "/students/:id/block",
  requirePermission("student:block"),
  asyncHandler(async (req, res) => {
    const student = await Student.findByIdAndUpdate(req.params.id, { blocked: true }, { new: true });
    if (student) await User.findByIdAndUpdate(student.user, { status: "blocked" });
    await writeAudit({ user: req.auth!.sub as never, action: "student.block", module: "student", resourceId: req.params.id });
    return ok(res, student);
  }),
);

router.post(
  "/admissions",
  requirePermission("admission:write"),
  asyncHandler(async (req, res) => created(res, await Admission.create({ ...req.body, createdBy: req.auth!.sub }))),
);
router.patch("/admissions/:id", requirePermission("admission:write"), asyncHandler(async (req, res) => ok(res, await Admission.findByIdAndUpdate(req.params.id, req.body, { new: true }))));
router.post(
  "/admissions/:id/confirm",
  requirePermission("admission:write"),
  asyncHandler(async (req, res) => {
    const result = await admissionSvc.confirmAdmission(req.params.id);
    await writeAudit({
      user: req.auth!.sub as never,
      action: "admission.confirm",
      module: "admission",
      resourceId: String(result.admission._id),
    });
    return ok(res, result);
  }),
);

router.post(
  "/attendance/bulk",
  requirePermission("attendance:write"),
  validate({
    body: z.object({
      batchId: objectId,
      courseId: objectId,
      date: z.coerce.date(),
      session: z.string().default("default"),
      marks: z.array(z.object({ studentId: objectId, status: z.enum(["present", "absent", "late"]) })),
    }),
  }),
  asyncHandler(async (req, res) => {
    await attendance.markBulk(req.body.batchId, req.body.courseId, req.body.date, req.body.session, req.body.marks, req.auth!.sub);
    return ok(res, {}, "Attendance saved");
  }),
);

router.post(
  "/payments/manual",
  requirePermission("payment:write"),
  asyncHandler(async (req, res) => {
    const row = await installmentSvc.recordManualPayment({ ...req.body, createdBy: req.auth!.sub });
    await writeAudit({ user: req.auth!.sub as never, action: "payment.manual", module: "payment", resourceId: String(row.payment._id), newValue: { amount: row.payment.amount } });
    // Notify the student (push + in-app) that their payment was recorded
    void notifyPaymentReceived(String(req.body.student), Number(req.body.amount));
    return created(res, row);
  }),
);

router.get(
  "/fees/installment-preview",
  requireAnyPermission("admission:read", "admission:write", "payment:read", "payment:write"),
  validate({ query: z.object({ courseId: objectId }) }),
  asyncHandler(async (req, res) => ok(res, await installmentSvc.previewCourseInstallments(String(req.query.courseId)))),
);

router.post("/quizzes", requirePermission("quiz:write"), asyncHandler(async (req, res) => created(res, await quizzes.createQuiz(req.body))));
router.post("/notes", requirePermission("notes:write"), asyncHandler(async (req, res) => {
  const row = await StudyMaterial.create(req.body);
  void notifyStudyMaterial(row.toObject());
  return created(res, row);
}));
router.post("/notices", requirePermission("notice:write"), asyncHandler(async (req, res) => {
  const row = await Notice.create(req.body);
  const { cache } = await import("../../services/cache.service.ts");
  const { CACHE_KEYS } = await import("../../constants/cache.ts");
  await cache.del(CACHE_KEYS.notices);
  void notifyNotice(row.toObject());
  return created(res, row);
}));
router.post("/staff", requirePermission("staff:write"), asyncHandler(async (req, res) => created(res, await staff.createStaff(req.body))));
router.post("/gallery/albums", requirePermission("gallery:write"), asyncHandler(async (req, res) => created(res, await gallery.createAlbum(req.body))));
router.get("/gallery/albums", requirePermission("gallery:write"), validate({ query: gallery.galleryListQuery }), asyncHandler(async (req, res) => {
  const data = await gallery.listAlbums(req.query as never);
  return ok(res, data.items, "OK", data.meta);
}));
router.get("/gallery/albums/:id", requirePermission("gallery:write"), asyncHandler(async (req, res) => ok(res, await gallery.getAlbum(req.params.id))));
router.patch("/gallery/albums/:id", requirePermission("gallery:write"), asyncHandler(async (req, res) => ok(res, await gallery.updateAlbum(req.params.id, req.body))));
router.delete("/gallery/albums/:id", requirePermission("gallery:write"), asyncHandler(async (req, res) => ok(res, await gallery.deleteAlbum(req.params.id))));
router.post("/alumni", requirePermission("cms:write"), asyncHandler(async (req, res) => created(res, await alumni.createAlumni(req.body))));
router.post("/jobs", requirePermission("job:write"), asyncHandler(async (req, res) => {
  const row = await Job.create(req.body);
  void notifyJob(row.toObject());
  return created(res, row);
}));
router.post("/live", requirePermission("live:write"), asyncHandler(async (req, res) => created(res, await live.createLiveClass(req.body, req.auth!.sub))));
router.post("/coupons", requirePermission("coupon:write"), asyncHandler(async (req, res) => created(res, await Coupon.create(req.body))));
router.post("/cms", requirePermission("cms:write"), asyncHandler(async (req, res) => ok(res, await cms.saveCms(req.body))));
router.post("/translations", requirePermission("translation:write"), asyncHandler(async (req, res) => created(res, await Translation.create(req.body))));
router.post("/typing-paragraphs", requirePermission("quiz:write"), asyncHandler(async (req, res) => created(res, await TypingParagraph.create(req.body))));
router.post("/settings", requirePermission("admin:manage"), asyncHandler(async (req, res) => ok(res, await Setting.findOneAndUpdate({ key: req.body.key }, req.body, { upsert: true, new: true }))));

router.post(
  "/notifications",
  requirePermission("notification:create"),
  asyncHandler(async (req, res) => {
    const row = await Notification.create({ ...req.body, createdBy: req.auth!.sub });
    if (req.body.broadcast) await enqueueBroadcast(String(row._id));
    return created(res, row);
  }),
);
router.post(
  "/notifications/:id/broadcast",
  requirePermission("notification:broadcast"),
  asyncHandler(async (req, res) => {
    await enqueueBroadcast(req.params.id);
    return ok(res, {}, "Queued");
  }),
);

router.post(
  "/uploads",
  requireStaff,
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) return ok(res, null, "No file");
    const folder = String(req.body.folder || "optech/misc");
    const asset = await uploadBuffer(req.file.buffer, folder, req.file.mimetype, req.file.originalname);
    return created(res, asset);
  }),
);

router.get("/audit", requirePermission("audit:read"), asyncHandler(async (req, res) => {
  const items = await AuditLog.find().sort({ createdAt: -1 }).limit(100).lean();
  return ok(res, items);
}));

router.get("/roles", requirePermission("role:manage"), asyncHandler(async (_req, res) => ok(res, await Role.find().lean())));

router.get("/users", requirePermission("role:manage"), asyncHandler(async (_req, res) => ok(res, await adminUsers.listStaffUsers())));

router.post(
  "/users",
  requirePermission("role:manage"),
  validate({
    body: z.object({
      name: z.string().min(2),
      email: z.string().email(),
      password: z.string().min(8),
      roleKey: z.enum(["ADMIN", "STAFF", "TEACHER"]),
    }),
  }),
  asyncHandler(async (req, res) => {
    const row = await adminUsers.createStaffUser(req.body);
    await writeAudit({ user: req.auth!.sub as never, action: "user.create", module: "role", resourceId: String(row?._id) });
    return created(res, row);
  }),
);

router.patch(
  "/users/:id",
  requirePermission("role:manage"),
  validate({
    body: z.object({
      name: z.string().min(2).optional(),
      email: z.string().email().optional(),
      roleKey: z.enum(["ADMIN", "STAFF", "TEACHER"]).optional(),
      status: z.enum(["active", "blocked"]).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const row = await adminUsers.updateStaffUser(req.params.id, req.body);
    await writeAudit({ user: req.auth!.sub as never, action: "user.update", module: "role", resourceId: String(row?._id) });
    return ok(res, row);
  }),
);

router.post(
  "/users/:id/reset-password",
  requirePermission("role:manage"),
  asyncHandler(async (req, res) => {
    const row = await adminUsers.resetStaffPassword(req.params.id);
    await writeAudit({ user: req.auth!.sub as never, action: "user.reset_password", module: "role", resourceId: req.params.id });
    return ok(res, row);
  }),
);
router.get(
  "/batches",
  requirePermission("course:read"),
  validate({ query: z.object({ course: objectId.optional() }) }),
  asyncHandler(async (req, res) => {
    const filter: Record<string, unknown> = {};
    if (req.query.course) filter.course = req.query.course;
    return ok(res, await Batch.find(filter).populate("course", "title slug").sort({ start: -1 }).lean());
  }),
);
router.patch(
  "/batches/:id",
  requirePermission("course:update"),
  asyncHandler(async (req, res) => ok(res, await courses.updateBatch(req.params.id, req.body))),
);
router.delete(
  "/batches/:id",
  requirePermission("course:update"),
  asyncHandler(async (req, res) => ok(res, await courses.deleteBatch(req.params.id))),
);

router.get("/dashboard", requirePermission("course:read"), asyncHandler(async (_req, res) => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const [
    totalStudents,
    activeStudents,
    totalCourses,
    activeBatches,
    totalAdmissions,
    todayAdmissions,
    pendingFees,
    revenue,
    pendingPayments,
    liveUpcoming,
  ] = await Promise.all([
    Student.countDocuments(),
    Student.countDocuments({ blocked: false }),
    Course.countDocuments({ active: true, deletedAt: { $exists: false } }),
    Batch.countDocuments({ active: true }),
    Admission.countDocuments(),
    Admission.countDocuments({ createdAt: { $gte: start } }),
    Payment.countDocuments({ status: { $in: ["pending", "created"] } }),
    Payment.aggregate([{ $match: { status: "paid" } }, { $group: { _id: null, sum: { $sum: "$amount" } } }]),
    Payment.countDocuments({ status: { $in: ["pending", "failed"] } }),
    LiveClass.countDocuments({ startsAt: { $gte: new Date() } }),
  ]);
  return ok(res, {
    totalStudents,
    activeStudents,
    totalCourses,
    activeBatches,
    totalAdmissions,
    todayAdmissions,
    pendingFees,
    revenue: revenue[0]?.sum ?? 0,
    pendingPayments,
    upcomingLive: liveUpcoming,
  });
}));

async function paged(model: { find: Function; countDocuments: Function }, req: { query: Record<string, unknown> }, extra: Record<string, unknown> = {}) {
  const page = Number(req.query.page || 1);
  const limit = Math.min(100, Number(req.query.limit || 20));
  const search = String(req.query.search || "");
  const filter = { ...extra };
  if (search) filter.$or = [{ title: { $regex: search, $options: "i" } }, { name: { $regex: search, $options: "i" } }];
  const items = await model.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean();
  const total = await model.countDocuments(filter);
  return { items, meta: { currentPage: page, totalItems: total, limit, totalPages: Math.ceil(total / limit) || 1 } };
}

router.get("/admissions", requirePermission("admission:read"), asyncHandler(async (req, res) => {
  const data = await paged(Admission, req, req.query.status ? { status: req.query.status } : {});
  return ok(res, data.items, "OK", data.meta);
}));
router.get("/payments", requirePermission("payment:read"), validate({
  query: paginationQuery.extend({
    status: z.enum(["paid", "pending", "failed", "refunded", "created", ""]).optional(),
    studentId: objectId.optional(),
    courseId: objectId.optional(),
    mode: z.enum(["cash", "upi", "razorpay", ""]).optional(),
  }),
}), asyncHandler(async (req, res) => {
  const q = req.query as unknown as z.infer<typeof paginationQuery>;
  const filter: Record<string, unknown> = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.studentId) filter.student = req.query.studentId;
  if (req.query.courseId) filter.course = req.query.courseId;
  if (req.query.mode) filter.mode = req.query.mode;
  const page = Number(q.page || 1);
  const limit = Math.min(100, Number(q.limit || 20));
  const [items, total] = await Promise.all([
    Payment.find(filter)
      .populate({ path: "student", select: "studentCode photo", populate: { path: "user", select: "name" } })
      .populate("course", "title slug")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Payment.countDocuments(filter),
  ]);
  return ok(res, items, "OK", { currentPage: page, totalItems: total, limit, totalPages: Math.ceil(total / limit) || 1 });
}));
router.get("/quizzes", requirePermission("quiz:read"), validate({ query: quizzes.quizListQuery }), asyncHandler(async (req, res) => {
  const data = await quizzes.listQuizzes(req.query as never);
  return ok(res, data.items, "OK", data.meta);
}));
router.get("/quizzes/:id", requirePermission("quiz:read"), asyncHandler(async (req, res) => ok(res, await quizzes.getQuiz(req.params.id))));
router.delete("/quizzes/:id", requirePermission("quiz:write"), asyncHandler(async (req, res) => ok(res, await quizzes.deleteQuiz(req.params.id))));
router.post("/quizzes/:id/publish", requirePermission("quiz:write"), asyncHandler(async (req, res) => ok(res, await quizzes.setQuizPublished(req.params.id, true))));
router.post("/quizzes/:id/unpublish", requirePermission("quiz:write"), asyncHandler(async (req, res) => ok(res, await quizzes.setQuizPublished(req.params.id, false))));
router.post(
  "/quizzes/:id/questions/from-bank",
  requirePermission("quiz:write"),
  validate({ body: z.object({ bankIds: z.array(objectId).min(1) }) }),
  asyncHandler(async (req, res) => ok(res, await quizzes.addQuestionsFromBank(req.params.id, req.body.bankIds))),
);

router.get("/question-bank", requirePermission("quiz:read"), validate({ query: quizzes.questionBankQuery }), asyncHandler(async (req, res) => {
  const data = await quizzes.listQuestionBank(req.query as never);
  return ok(res, data.items, "OK", data.meta);
}));
router.post("/question-bank", requirePermission("quiz:write"), asyncHandler(async (req, res) => created(res, await quizzes.createBankQuestion(req.body))));
router.patch("/question-bank/:id", requirePermission("quiz:write"), asyncHandler(async (req, res) => ok(res, await quizzes.updateBankQuestion(req.params.id, req.body))));
router.delete("/question-bank/:id", requirePermission("quiz:write"), asyncHandler(async (req, res) => ok(res, await quizzes.deleteBankQuestion(req.params.id))));
router.post(
  "/question-bank/import/validate",
  requirePermission("quiz:write"),
  validate({ body: z.object({ rows: z.array(z.record(z.union([z.string(), z.number()]))) }) }),
  asyncHandler(async (req, res) => {
    const rows = (req.body.rows as Record<string, string | number>[]).map((r, i) => ({
      row: i + 2,
      question: r.question != null ? String(r.question) : undefined,
      option_a: r.option_a != null ? String(r.option_a) : undefined,
      option_b: r.option_b != null ? String(r.option_b) : undefined,
      option_c: r.option_c != null ? String(r.option_c) : undefined,
      option_d: r.option_d != null ? String(r.option_d) : undefined,
      correct_answer: r.correct_answer != null ? String(r.correct_answer) : undefined,
      marks: r.marks,
      negative_marks: r.negative_marks,
      difficulty: r.difficulty != null ? String(r.difficulty) : undefined,
      explanation: r.explanation != null ? String(r.explanation) : undefined,
      topic: r.topic != null ? String(r.topic) : undefined,
      tags: r.tags != null ? String(r.tags) : undefined,
    }));
    return ok(res, quizzes.validateImportRows(rows));
  }),
);
router.post(
  "/question-bank/import/confirm",
  requirePermission("quiz:write"),
  validate({
    body: z.object({
      rows: z.array(z.object({ row: z.number(), valid: z.boolean(), errors: z.array(z.string()), data: z.record(z.unknown()).optional() })),
      course: objectId.optional(),
      subject: z.string().optional(),
    }),
  }),
  asyncHandler(async (req, res) => ok(res, await quizzes.confirmImportToBank(req.body.rows as never, { course: req.body.course, subject: req.body.subject }))),
);
router.get("/notes", requirePermission("course:read"), asyncHandler(async (req, res) => {
  const q = req.query as Record<string, unknown>;
  const page = Number(q.page || 1);
  const limit = Math.min(100, Number(q.limit || 20));
  const filter: Record<string, unknown> = {};
  if (q.course) filter.course = q.course;
  if (q.search) {
    filter.$or = [
      { title: { $regex: q.search, $options: "i" } },
      { chapter: { $regex: q.search, $options: "i" } },
    ];
  }
  const [items, total] = await Promise.all([
    StudyMaterial.find(filter)
      .populate("course", "title slug")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    StudyMaterial.countDocuments(filter),
  ]);
  return ok(res, items, "OK", { currentPage: page, totalItems: total, limit, totalPages: Math.ceil(total / limit) || 1 });
}));
router.get("/notices", requirePermission("notice:write"), asyncHandler(async (req, res) => {
  const data = await paged(Notice, req);
  return ok(res, data.items, "OK", data.meta);
}));
router.get("/staff", requireAnyPermission("staff:write", "course:read", "course:create", "course:update"), asyncHandler(async (req, res) => {
  const data = await paged(Staff, req);
  return ok(res, data.items, "OK", data.meta);
}));
router.get("/alumni", requirePermission("cms:write"), asyncHandler(async (req, res) => {
  const data = await paged(Alumni, req);
  return ok(res, data.items, "OK", data.meta);
}));
router.get("/jobs", requirePermission("job:write"), asyncHandler(async (req, res) => {
  const data = await paged(Job, req);
  return ok(res, data.items, "OK", data.meta);
}));
router.get("/live", requirePermission("live:write"), asyncHandler(async (_req, res) => ok(res, await live.listLiveClasses())));
router.get("/coupons", requirePermission("coupon:write"), asyncHandler(async (req, res) => {
  const data = await paged(Coupon, req);
  return ok(res, data.items, "OK", data.meta);
}));
router.get("/cms", requirePermission("cms:write"), asyncHandler(async (req, res) => {
  const kind = req.query.kind ? { kind: req.query.kind } : {};
  const data = await paged(CmsItem, req, kind);
  return ok(res, data.items, "OK", data.meta);
}));
router.get("/notifications", requirePermission("notification:create"), asyncHandler(async (req, res) => {
  const data = await paged(Notification, req);
  return ok(res, data.items, "OK", data.meta);
}));
router.get("/alerts", requireStaff, asyncHandler(async (req, res) => ok(res, await listStaffAlerts(req.auth!.sub))));
router.get("/alerts/unread-count", requireStaff, asyncHandler(async (req, res) =>
  ok(res, { count: await staffAlertUnreadCount(req.auth!.sub) }),
));
router.patch("/alerts/:id/read", requireStaff, asyncHandler(async (req, res) =>
  ok(res, await markStaffAlertRead(req.auth!.sub, req.params.id)),
));
router.get("/typing-paragraphs", requirePermission("quiz:read"), asyncHandler(async (req, res) => {
  const data = await paged(TypingParagraph, req);
  return ok(res, data.items, "OK", data.meta);
}));
router.get("/settings/website", requirePermission("admin:manage"), asyncHandler(async (_req, res) => ok(res, await siteSettings.getWebsiteSettings())));
router.post(
  "/settings/website",
  requirePermission("admin:manage"),
  validate({
    body: z.object({
      name: z.string().min(2),
      email: z.string().email(),
      mobile: z.string().min(8),
      address: z.string().min(5),
      logo: z.record(z.unknown()).nullable().optional(),
    }),
  }),
  asyncHandler(async (req, res) => ok(res, await siteSettings.saveWebsiteSettings(req.body))),
);
router.get("/settings", requirePermission("admin:manage"), asyncHandler(async (_req, res) => ok(res, await Setting.find().lean())));
router.get("/students/:id", requirePermission("student:read"), asyncHandler(async (req, res) => ok(res, await students.adminDetail(req.params.id))));
router.patch("/students/:id/unblock", requirePermission("student:block"), asyncHandler(async (req, res) => {
  const student = await Student.findByIdAndUpdate(req.params.id, { blocked: false }, { new: true });
  if (student) await User.findByIdAndUpdate(student.user, { status: "active" });
  return ok(res, student);
}));
router.get("/attendance", requirePermission("attendance:read"), asyncHandler(async (req, res) => {
  const filter: Record<string, unknown> = {};
  if (req.query.batchId) filter.batch = req.query.batchId;
  if (req.query.studentId) filter.student = req.query.studentId;
  if (req.query.courseId) filter.course = req.query.courseId;
  if (req.query.month) {
    const [y, m] = String(req.query.month).split("-").map(Number);
    if (y && m) {
      const start = new Date(y, m - 1, 1);
      const end = new Date(y, m, 1);
      filter.date = { $gte: start, $lt: end };
    }
  } else if (req.query.date) {
    const d = new Date(String(req.query.date));
    const next = new Date(d);
    next.setDate(d.getDate() + 1);
    filter.date = { $gte: d, $lt: next };
  }
  return ok(
    res,
    await Attendance.find(filter)
      .populate("course", "title slug")
      .populate({ path: "student", select: "studentCode photo", populate: { path: "user", select: "name" } })
      .sort({ date: 1 })
      .lean(),
  );
}));

router.patch(
  "/attendance/:id",
  requirePermission("attendance:write"),
  validate({ body: z.object({ status: z.enum(["present", "absent", "late"]) }) }),
  asyncHandler(async (req, res) => ok(res, await attendance.updateOne(req.params.id, req.body.status, req.auth!.sub))),
);

router.get("/enrollments", requirePermission("student:read"), asyncHandler(async (req, res) => {
  const data = await enrollmentSvc.listWebsiteEnrollments(req.query as Record<string, unknown>);
  return ok(res, data.items, "OK", data.meta);
}));
router.get(
  "/enquiries",
  requirePermission("admission:read"),
  validate({ query: paginationQuery.extend({ status: z.enum(["new", "contacted", "closed"]).optional() }) }),
  asyncHandler(async (req, res) => {
    const data = await enquiries.adminListEnquiries(req.query as never);
    return ok(res, data.items, "OK", data.meta);
  }),
);
router.patch(
  "/enquiries/:id",
  requirePermission("admission:write"),
  validate({ body: z.object({ status: z.enum(["new", "contacted", "closed"]) }) }),
  asyncHandler(async (req, res) => ok(res, await enquiries.adminUpdateEnquiry(req.params.id, req.body))),
);
router.post(
  "/enrollments/:id/admit",
  requirePermission("admission:write"),
  validate({
    body: z.object({
      name: z.string().min(2).optional(),
      email: z.string().email().optional().or(z.literal("")),
      phone: z.string().min(8).optional(),
      course: z.union([objectId, z.literal("")]).optional(),
      batch: z.union([objectId, z.literal("")]).optional(),
      parentPhone: z.string().optional(),
      address: z.string().optional(),
      dob: z.string().optional(),
      photo: z.record(z.unknown()).optional(),
      referrerCode: z.string().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const result = await enrollmentSvc.admitWebsiteEnrollment(req.params.id, {
      ...req.body,
      batch: req.body.batch || undefined,
    });
    await writeAudit({
      user: req.auth!.sub as never,
      action: "enrollment.admit",
      module: "enrollment",
      resourceId: req.params.id,
    });
    return ok(res, result);
  }),
);
router.get("/referrals", requirePermission("payment:read"), asyncHandler(async (req, res) => {
  const page = Number(req.query.page || 1);
  const limit = Math.min(100, Number(req.query.limit || 20));
  const search = String(req.query.search || "");
  const filter: Record<string, unknown> = {};
  if (req.query.status) filter.status = req.query.status;
  if (search) {
    filter.$or = [
      { code: { $regex: search, $options: "i" } },
      { refereePhone: { $regex: search, $options: "i" } },
    ];
  }
  const [items, total] = await Promise.all([
    Referral.find(filter)
      .populate({ path: "referrer", populate: { path: "user", select: "name phone" } })
      .populate({ path: "refereeStudent", populate: { path: "user", select: "name phone" } })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Referral.countDocuments(filter),
  ]);
  return ok(res, items, "OK", {
    currentPage: page,
    totalItems: total,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  });
}));
router.post(
  "/referrals/:id/mark-paid",
  requirePermission("payment:write"),
  asyncHandler(async (req, res) => {
    const row = await Referral.findByIdAndUpdate(
      req.params.id,
      { payoutStatus: "paid" },
      { new: true },
    );
    if (!row) throw new NotFoundError("Referral not found");
    await writeAudit({
      user: req.auth!.sub as never,
      action: "referral.mark_paid",
      module: "referral",
      resourceId: String(row._id),
    });
    return ok(res, row, "Referral reward marked paid");
  }),
);
router.get("/scholarships", requirePermission("scholarship:write"), validate({ query: scholarship.scholarshipListQuery }), asyncHandler(async (req, res) => {
  const data = await scholarship.listExams(req.query as never);
  return ok(res, data.items, "OK", data.meta);
}));
router.get("/scholarships/:id", requirePermission("scholarship:write"), asyncHandler(async (req, res) => ok(res, await scholarship.getExam(req.params.id))));
router.post("/scholarships", requirePermission("scholarship:write"), asyncHandler(async (req, res) => created(res, await scholarship.createExam(req.body))));
router.patch("/scholarships/:id", requirePermission("scholarship:write"), asyncHandler(async (req, res) => ok(res, await scholarship.updateExam(req.params.id, req.body))));
router.delete("/scholarships/:id", requirePermission("scholarship:write"), asyncHandler(async (req, res) => ok(res, await scholarship.deleteExam(req.params.id))));
router.post("/scholarships/:id/activate", requirePermission("scholarship:write"), asyncHandler(async (req, res) => ok(res, await scholarship.setExamActive(req.params.id, true))));
router.post("/scholarships/:id/deactivate", requirePermission("scholarship:write"), asyncHandler(async (req, res) => ok(res, await scholarship.setExamActive(req.params.id, false))));
router.get("/scholarships/:id/results", requirePermission("scholarship:write"), validate({ query: paginationQuery }), asyncHandler(async (req, res) => {
  const data = await scholarship.listResults(req.params.id, req.query as never);
  return ok(res, data.items, "OK", data.meta);
}));
router.get("/scholarship-results", requirePermission("scholarship:write"), validate({ query: paginationQuery }), asyncHandler(async (req, res) => {
  const data = await scholarship.listAllResults(req.query as never);
  return ok(res, data.items, "OK", data.meta);
}));
router.post(
  "/scholarships/import/validate",
  requirePermission("scholarship:write"),
  validate({ body: z.object({ rows: z.array(z.record(z.union([z.string(), z.number()]))) }) }),
  asyncHandler(async (req, res) => {
    const rows = (req.body.rows as Record<string, string | number>[]).map((r, i) => ({
      row: i + 2,
      question: r.question != null ? String(r.question) : undefined,
      option_a: r.option_a != null ? String(r.option_a) : undefined,
      option_b: r.option_b != null ? String(r.option_b) : undefined,
      option_c: r.option_c != null ? String(r.option_c) : undefined,
      option_d: r.option_d != null ? String(r.option_d) : undefined,
      correct_answer: r.correct_answer != null ? String(r.correct_answer) : undefined,
      marks: r.marks,
      negative_marks: r.negative_marks,
      difficulty: r.difficulty != null ? String(r.difficulty) : undefined,
      explanation: r.explanation != null ? String(r.explanation) : undefined,
      topic: r.topic != null ? String(r.topic) : undefined,
      tags: r.tags != null ? String(r.tags) : undefined,
    }));
    return ok(res, scholarship.validateImportRows(rows));
  }),
);
router.get("/installments", requirePermission("payment:read"), asyncHandler(async (req, res) => {
  const extra: Record<string, unknown> = {};
  if (req.query.status) extra.status = req.query.status;
  if (req.query.studentId) extra.student = req.query.studentId;
  const data = await paged(Installment, req, extra);
  return ok(res, data.items, "OK", data.meta);
}));
router.get("/quiz-attempts", requirePermission("quiz:read"), validate({
  query: paginationQuery.extend({
    quizId: objectId.optional(),
    studentId: objectId.optional(),
    status: z.string().trim().optional(),
  }),
}), asyncHandler(async (req, res) => {
  const q = req.query as unknown as z.infer<typeof paginationQuery> & {
    quizId?: string;
    studentId?: string;
    status?: string;
  };
  const page = Number(q.page || 1);
  const limit = Math.min(100, Number(q.limit || 20));
  const filter: Record<string, unknown> = {};
  if (q.quizId) filter.quiz = q.quizId;
  if (q.studentId) filter.student = q.studentId;
  if (q.status) filter.status = q.status;

  const [items, total] = await Promise.all([
    QuizAttempt.find(filter)
      .populate({
        path: "student",
        select: "studentCode rollNumber batch",
        populate: [
          { path: "user", select: "name email phone" },
          { path: "batch", select: "label timing" },
        ],
      })
      .populate({
        path: "quiz",
        select: "title passing minutes negative negativeValue course subject questions",
        populate: { path: "course", select: "title slug" },
      })
      .sort({ submittedAt: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    QuizAttempt.countDocuments(filter),
  ]);

  const mapped = items.map((row) => {
    const quiz = row.quiz as { questions?: { marks?: number }[] } | null | undefined;
    const totalMarks = (quiz?.questions ?? []).reduce((sum, item) => sum + (item.marks ?? 1), 0);
    if (quiz && typeof quiz === "object") {
      return {
        ...row,
        quiz: { ...quiz, totalMarks, questions: undefined },
      };
    }
    return row;
  });

  return ok(res, mapped, "OK", {
    currentPage: page,
    totalItems: total,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  });
}));
router.get("/typing-attempts", requirePermission("quiz:read"), validate({
  query: paginationQuery.extend({
    language: z.enum(["en", "hi", ""]).optional(),
    studentId: objectId.optional(),
  }),
}), asyncHandler(async (req, res) => {
  const q = req.query as unknown as z.infer<typeof paginationQuery> & {
    language?: "" | "en" | "hi";
    studentId?: string;
  };
  const page = Number(q.page || 1);
  const limit = Math.min(100, Number(q.limit || 20));
  const filter: Record<string, unknown> = {};
  if (q.language) filter.language = q.language;
  if (q.studentId) filter.student = q.studentId;

  const [items, total] = await Promise.all([
    TypingAttempt.find(filter)
      .populate({
        path: "student",
        select: "studentCode rollNumber batch",
        populate: [
          { path: "user", select: "name email phone" },
          { path: "batch", select: "label timing" },
        ],
      })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    TypingAttempt.countDocuments(filter),
  ]);

  return ok(res, items, "OK", {
    currentPage: page,
    totalItems: total,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  });
}));
router.patch(
  "/roles/:id",
  requirePermission("role:manage"),
  asyncHandler(async (req, res) => {
    const role = await Role.findById(req.params.id);
    if (!role) return ok(res, null, "Missing");
    if (role.key === "SUPER_ADMIN") {
      return ok(res, role, "Super admin permissions cannot be reduced from the console");
    }
    const permissions = Array.isArray(req.body.permissions) ? req.body.permissions : role.permissions;
    role.permissions = permissions;
    if (typeof req.body.name === "string") role.name = req.body.name;
    await role.save();
    await writeAudit({ user: req.auth!.sub as never, action: "role.update", module: "role", resourceId: String(role._id) });
    return ok(res, role);
  }),
);
router.patch("/live/:id", requirePermission("live:write"), asyncHandler(async (req, res) => ok(res, await live.updateLiveClass(req.params.id, req.body))));
router.patch("/quizzes/:id", requirePermission("quiz:write"), asyncHandler(async (req, res) => ok(res, await quizzes.updateQuiz(req.params.id, req.body))));
router.patch("/students/:id", requirePermission("student:update"), asyncHandler(async (req, res) => ok(res, await students.adminUpdateStudent(req.params.id, req.body))));
router.post(
  "/students/:id/reset-password",
  requirePermission("student:update"),
  asyncHandler(async (req, res) => ok(res, await students.adminResetPassword(req.params.id))),
);
router.post(
  "/courses/:id/duplicate",
  requirePermission("course:create"),
  asyncHandler(async (req, res) => {
    const src = await Course.findById(req.params.id).lean();
    if (!src) return ok(res, null, "Missing");
    const { _id, slug, ...rest } = src as typeof src & { _id: unknown; slug: string };
    const copy = await Course.create({
      ...rest,
      title: { ...(rest.title as object), en: `${(rest.title as { en?: string }).en ?? "Course"} copy` },
      slug: `${slug}-copy-${Date.now().toString(36)}`,
      active: false,
      createdBy: req.auth!.sub,
    });
    return created(res, copy);
  }),
);
router.get("/id-cards/:studentId/pdf", requirePermission("student:read"), asyncHandler(async (req, res) => {
  const student = await Student.findById(req.params.studentId).populate("user").lean();
  if (!student) return ok(res, null, "Missing");
  const user = student.user as { name?: string; phone?: string; email?: string } | null;
  const bytes = await buildIdCardPdf({
    name: user?.name ?? "Student",
    studentCode: student.studentCode,
    course: "Optech",
    roll: student.rollNumber ?? "—",
    validTill: student.validTill ? new Date(student.validTill).toISOString().slice(0, 10) : "session",
    mobile: user?.phone ?? student.parentPhone,
    email: user?.email,
    address: student.address,
    photoUrl: student.photo?.url,
  });
  await DigitalIdCard.findOneAndUpdate(
    { student: student._id },
    { student: student._id, qrPayload: student.studentCode },
    { upsert: true },
  );
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${student.studentCode}-id.pdf"`);
  return res.send(Buffer.from(bytes));
}));

router.post(
  "/certificates",
  requirePermission("student:update"),
  validate({ body: z.object({ enrollmentId: objectId }) }),
  asyncHandler(async (req, res) => {
    // issueCertificate already calls notifyCertificateIssued internally
    const cert = await certificateSvc.issueCertificate(String(req.body.enrollmentId), req.auth!.sub);
    return ok(res, cert, "Certificate issued");
  }),
);

router.get("/certificates/:enrollmentId/pdf", requirePermission("student:read"), asyncHandler(async (req, res) => {
  const bytes = await certificateSvc.buildCertificatePdfForEnrollment(req.params.enrollmentId);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="certificate-${req.params.enrollmentId}.pdf"`);
  return res.send(Buffer.from(bytes));
}));

router.patch("/staff/:id", requirePermission("staff:write"), asyncHandler(async (req, res) => ok(res, await staff.updateStaff(req.params.id, req.body))));
router.delete("/staff/:id", requirePermission("staff:write"), asyncHandler(async (req, res) => ok(res, await staff.deleteStaff(req.params.id))));
router.patch("/alumni/:id", requirePermission("cms:write"), asyncHandler(async (req, res) => ok(res, await alumni.updateAlumni(req.params.id, req.body))));
router.delete("/alumni/:id", requirePermission("cms:write"), asyncHandler(async (req, res) => ok(res, await alumni.deleteAlumni(req.params.id))));
router.patch("/cms/:id", requirePermission("cms:write"), asyncHandler(async (req, res) => ok(res, await cms.updateCms(req.params.id, req.body))));
router.delete("/cms/:id", requirePermission("cms:write"), asyncHandler(async (req, res) => ok(res, await cms.deleteCms(req.params.id))));

const writable: Array<{ path: string; perm: Permission; model: { findByIdAndUpdate: Function; findByIdAndDelete: Function } }> = [
  { path: "notices", perm: "notice:write", model: Notice },
  { path: "jobs", perm: "job:write", model: Job },
  { path: "coupons", perm: "coupon:write", model: Coupon },
  { path: "notes", perm: "notes:write", model: StudyMaterial },
  { path: "typing-paragraphs", perm: "quiz:write", model: TypingParagraph },
  { path: "categories", perm: "course:update", model: CourseCategory },
];

for (const item of writable) {
  router.patch(
    `/${item.path}/:id`,
    requirePermission(item.perm),
    asyncHandler(async (req, res) => {
      const row = await item.model.findByIdAndUpdate(req.params.id, req.body, { new: true });
      if (row && item.path === "notes") void notifyStudyMaterial(row.toObject());
      if (row && item.path === "notices") void notifyNotice(row.toObject());
      if (row && item.path === "jobs") void notifyJob(row.toObject());
      return ok(res, row);
    }),
  );
  router.delete(
    `/${item.path}/:id`,
    requirePermission(item.perm),
    asyncHandler(async (req, res) => {
      await item.model.findByIdAndDelete(req.params.id);
      return ok(res, { deleted: true });
    }),
  );
}

void loc;
export default router;
