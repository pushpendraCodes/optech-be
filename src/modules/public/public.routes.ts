import { Router } from "express";
import { z } from "zod";
import { validate } from "../../middleware/validate.ts";
import { asyncHandler } from "../../utils/async-handler.ts";
import { ok } from "../../utils/api-response.ts";
import * as courses from "../courses/course.service.ts";
import * as cms from "../cms/cms.service.ts";
import * as payments from "../payments/payment.service.ts";
import * as scholarship from "../scholarships/scholarship.service.ts";
import * as enquiries from "../enquiries/enquiry.service.ts";
import * as videoSvc from "../videos/video.service.ts";
import * as siteSettings from "../../services/website-settings.service.ts";
import { objectId } from "../../utils/pagination.ts";
import { env } from "../../config/env.ts";
import { indianMobileSchema, optionalIndianMobileSchema } from "../../utils/phone.ts";

const router = Router();

router.get(
  "/courses",
  validate({
    query: z.object({
      search: z.string().optional(),
      category: z.string().optional(),
      mode: z.enum(["offline", "online"]).optional(),
      tag: z.string().optional(),
    }),
  }),
  asyncHandler(async (req, res) => ok(res, await courses.listPublicCourses(req.query as never))),
);

router.get(
  "/courses/:slug",
  asyncHandler(async (req, res) => ok(res, await courses.getPublicCourse(req.params.slug))),
);

router.get("/categories", asyncHandler(async (_req, res) => ok(res, await courses.listCategories())));
router.get("/staff", asyncHandler(async (_req, res) => ok(res, await courses.listStaffPublic())));
router.get("/notices", asyncHandler(async (_req, res) => ok(res, await cms.publicNotices())));
router.get("/gallery", asyncHandler(async (_req, res) => ok(res, await cms.publicGallery())));
router.get("/alumni", asyncHandler(async (_req, res) => ok(res, await cms.publicAlumni())));
router.get("/jobs", asyncHandler(async (_req, res) => ok(res, await cms.publicJobs())));
router.get("/videos", asyncHandler(async (_req, res) => ok(res, await videoSvc.publicVideos())));
router.get("/marquee", asyncHandler(async (_req, res) => ok(res, await cms.publicCms("marquee"))));
router.get("/ads", asyncHandler(async (_req, res) => ok(res, await cms.publicCms("ad"))));
router.get("/popups", asyncHandler(async (_req, res) => ok(res, await cms.publicCms("popup"))));
router.get("/links", asyncHandler(async (_req, res) => ok(res, await cms.publicCms("link"))));
router.get("/live", asyncHandler(async (_req, res) => ok(res, await cms.publicLive())));

router.post(
  "/calculator",
  validate({
    body: z.object({
      courseId: objectId,
      coupon: z.string().optional(),
      parts: z.coerce.number().int().min(1).max(12).default(1),
      phone: optionalIndianMobileSchema,
      email: z.string().email().optional(),
    }),
  }),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await payments.quote(req.body.courseId, req.body.coupon, req.body.parts, {
        phone: req.body.phone,
        email: req.body.email,
      }),
    ),
  ),
);

router.post(
  "/enroll/validate-code",
  validate({
    body: z.object({
      courseId: objectId,
      code: z.string().min(2),
      phone: optionalIndianMobileSchema,
      email: z.string().email().optional(),
    }),
  }),
  asyncHandler(async (req, res) => ok(res, await payments.validateEnrollmentCode(req.body))),
);

router.post(
  "/enroll/checkout",
  validate({
    body: z.object({
      name: z.string().min(2),
      email: z.string().email(),
      phone: indianMobileSchema,
      courseId: objectId,
      batchId: objectId.optional(),
      coupon: z.string().optional(),
      parts: z.coerce.number().int().min(1).max(12).default(1),
      referralCode: z.string().optional(),
    }),
  }),
  asyncHandler(async (req, res) => ok(res, await payments.startCheckout(req.body))),
);

router.post(
  "/enroll/verify",
  validate({
    body: z.object({
      razorpay_order_id: z.string(),
      razorpay_payment_id: z.string(),
      razorpay_signature: z.string(),
    }),
  }),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await payments.verifyCheckout(
        req.body.razorpay_order_id,
        req.body.razorpay_payment_id,
        req.body.razorpay_signature,
      ),
      "Payment verified",
    ),
  ),
);

router.get(
  "/enroll/invoice/:id",
  validate({ query: z.object({ order: z.string().min(4) }) }),
  asyncHandler(async (req, res) => {
    const { pdf, invoice } = await payments.buildPaymentInvoicePdf(req.params.id, String(req.query.order));
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${invoice.invoiceNumber}.pdf"`);
    return res.send(Buffer.from(pdf));
  }),
);

router.get("/scholarship", asyncHandler(async (_req, res) => ok(res, await scholarship.publicExam())));
router.post(
  "/scholarship/submit",
  validate({
    body: z.object({
      examId: objectId,
      name: z.string().min(2),
      phone: indianMobileSchema,
      email: z.union([z.string().email(), z.literal("")]).optional(),
      studentCode: z.string().optional(),
      timeTakenSeconds: z.number().optional(),
      answers: z.array(z.object({ index: z.number(), value: z.union([z.string(), z.number()]) })),
    }),
  }),
  asyncHandler(async (req, res) => ok(res, await scholarship.submitExam(req.body))),
);

router.post(
  "/enquiry",
  validate({
    body: z.object({
      name: z.string().min(2).max(120),
      email: z.string().email().max(160),
      phone: indianMobileSchema,
      course: z.string().min(1).max(160),
      message: z.string().max(500).optional(),
    }),
  }),
  asyncHandler(async (req, res) => ok(res, await enquiries.createEnquiry(req.body), "Enquiry submitted")),
);

router.get("/config", (_req, res) => ok(res, { razorpayKeyId: env.RAZORPAY_KEY_ID }));
router.get("/settings/website", asyncHandler(async (_req, res) => ok(res, await siteSettings.getWebsiteSettings())));
router.get("/health", (_req, res) => ok(res, { ok: true }));

export default router;
