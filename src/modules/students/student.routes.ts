import { Router } from "express";
import { z } from "zod";
import { authenticate, requireStudent } from "../../middleware/auth.ts";
import { validate } from "../../middleware/validate.ts";
import { asyncHandler } from "../../utils/async-handler.ts";
import { ok } from "../../utils/api-response.ts";
import * as students from "../students/student.service.ts";
import * as payments from "../payments/payment.service.ts";
import * as certificateSvc from "../../services/certificate.service.ts";
import { objectId } from "../../utils/pagination.ts";
import { Referral, Enrollment } from "../../models/index.ts";
import { preventSelfReferral, referralReward } from "../../services/pricing.service.ts";
import { Setting } from "../../models/index.ts";
import { BadRequestError } from "../../utils/errors.ts";

const router = Router();
router.use(authenticate, requireStudent);

router.get("/dashboard", asyncHandler(async (req, res) => ok(res, await students.dashboard(req.auth!.studentId!))));
router.get("/profile", asyncHandler(async (req, res) => ok(res, await students.myProfile(req.auth!.studentId!))));
router.get("/attendance", asyncHandler(async (req, res) =>
  ok(res, await students.myAttendance(req.auth!.studentId!, String(req.query.month || ""))),
));
router.get("/notes", asyncHandler(async (req, res) => ok(res, await students.myNotes(req.auth!.studentId!))));
router.get("/quizzes", asyncHandler(async (req, res) => ok(res, await students.myQuizzes(req.auth!.studentId!))));
router.get("/quiz-attempts", asyncHandler(async (req, res) => ok(res, await students.myQuizAttempts(req.auth!.studentId!))));

// Notifications — paginated, polled by frontend every 5s
router.get(
  "/notifications",
  validate({
    query: z.object({
      page: z.coerce.number().int().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const data = await students.myNotifications(req.auth!.studentId!, req.query as never);
    return ok(res, data.items, "OK", data.meta);
  }),
);

// Mark all notifications read at once
router.patch(
  "/notifications/read-all",
  asyncHandler(async (req, res) => ok(res, await students.markAllNotificationsRead(req.auth!.studentId!))),
);

// Mark single notification read
router.patch(
  "/notifications/:id/read",
  asyncHandler(async (req, res) => ok(res, await students.markNotificationRead(req.auth!.studentId!, req.params.id))),
);

router.post(
  "/notes/:id/view",
  asyncHandler(async (req, res) => ok(res, await students.trackNoteView(req.params.id, req.auth!.studentId!))),
);
router.get("/fees", asyncHandler(async (req, res) => ok(res, await payments.studentFees(req.auth!.studentId!))));
router.get("/notices", asyncHandler(async (_req, res) => ok(res, await students.myNotices())));
router.get("/live", asyncHandler(async (req, res) => ok(res, await students.studentLiveClasses(req.auth!.studentId!))));
router.post(
  "/push-token",
  validate({ body: z.object({ token: z.string().min(1) }) }),
  asyncHandler(async (req, res) => ok(res, await students.savePushToken(req.auth!.studentId!, req.body.token))),
);
router.get("/id-card", asyncHandler(async (req, res) => ok(res, await students.idCard(req.auth!.studentId!))));

router.get("/certificates", asyncHandler(async (req, res) =>
  ok(res, await certificateSvc.listStudentCertificates(req.auth!.studentId!)),
));
router.get("/certificates/:enrollmentId/pdf", asyncHandler(async (req, res) =>
  ok(res, await certificateSvc.studentCertificatePdf(req.auth!.studentId!, req.params.enrollmentId)),
));

router.post(
  "/quizzes/:id/start",
  asyncHandler(async (req, res) => ok(res, await students.startQuiz(req.params.id, req.auth!.studentId!))),
);
router.post(
  "/quizzes/attempts/:id/submit",
  validate({
    body: z.object({
      answers: z.array(z.object({ index: z.number(), value: z.union([z.string(), z.number()]) })),
    }),
  }),
  asyncHandler(async (req, res) =>
    ok(res, await students.submitQuiz(req.params.id, req.auth!.studentId!, req.body.answers)),
  ),
);

router.get("/typing/paragraphs", asyncHandler(async (req, res) => ok(res, await students.listTypingParagraphs())));
router.get("/typing/attempts", asyncHandler(async (req, res) => ok(res, await students.myTypingAttempts(req.auth!.studentId!))));

router.post(
  "/typing/start",
  validate({
    body: z.object({
      language: z.enum(["en", "hi"]),
      minutes: z.number().refine((n) => [1, 3, 5, 10].includes(n)),
      paragraphId: objectId.optional(),
    }),
  }),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await students.startTyping(
        req.auth!.studentId!,
        req.body.language,
        req.body.minutes,
        req.body.paragraphId,
      ),
    ),
  ),
);
router.post(
  "/typing/submit",
  validate({
    body: z.object({
      language: z.enum(["en", "hi"]),
      minutes: z.number(),
      source: z.string().min(1),
      typed: z.string(),
    }),
  }),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await students.submitTyping(
        req.auth!.studentId!,
        req.body.language,
        req.body.minutes,
        req.body.source,
        req.body.typed,
      ),
    ),
  ),
);

router.get("/referrals", asyncHandler(async (req, res) => {
  const rows = await Referral.find({ referrer: req.auth!.studentId })
    .populate({
      path: "refereeStudent",
      select: "studentCode",
      populate: { path: "user", select: "name phone" },
    })
    .sort({ createdAt: -1 })
    .lean();
  return ok(res, rows);
}));

router.post(
  "/referrals",
  validate({ body: z.object({ refereePhone: z.string().min(8) }) }),
  asyncHandler(async (req, res) => {
    const { Student } = await import("../../models/index.ts");
    const me = await Student.findById(req.auth!.studentId);
    if (!me) throw new BadRequestError("Student missing");
    if (preventSelfReferral(me.referralCode, undefined, undefined, req.body.refereePhone)) {
      throw new BadRequestError("Self-referral is not allowed");
    }
    const rule = await Setting.findOne({ key: "referral" }).lean();
    const value = (rule?.value as { type?: "fixed" | "percent"; value?: number }) ?? { type: "percent", value: 8 };
    const row = await Referral.create({
      referrer: me._id,
      code: me.referralCode,
      refereePhone: req.body.refereePhone,
      status: "pending",
      rewardType: value.type ?? "percent",
      rewardValue: value.value ?? 8,
    });
    void Enrollment;
    void objectId;
    void referralReward;
    return ok(res, row, "Referral recorded");
  }),
);

export default router;
