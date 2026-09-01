import { nanoid } from "nanoid";
import {
  Coupon,
  Course,
  Enrollment,
  Installment,
  Payment,
  ScholarshipResult,
  Setting,
  Student,
} from "../../models/index.ts";
import { applyCoupon, installmentPlan, preventSelfReferral } from "../../services/pricing.service.ts";
import { computeStudentFees } from "../../services/installment.service.ts";
import {
  claimWebhookEvent,
  createOrder,
  verifyCheckoutSignature,
  verifyWebhookSignature,
} from "../../services/razorpay.service.ts";
import { BadRequestError, NotFoundError } from "../../utils/errors.ts";
import { buildInvoicePdf } from "../../services/pdf.service.ts";
import { getWebsiteSettings } from "../../services/website-settings.service.ts";
import { notifyStaffAlert } from "../../services/notification.service.ts";
import { sendEmail } from "../../services/messaging.service.ts";
import { logger } from "../../config/logger.ts";
import {
  extractPaymentDiscount,
  normalizePhone,
  paymentPhone,
} from "../../services/payment-discount.service.ts";

async function feeSettings() {
  const row = await Setting.findOne({ key: "installments" }).lean();
  return {
    parts: Number((row?.value as { parts?: number })?.parts ?? 3),
    minFeeForEmi: Number((row?.value as { minFeeForEmi?: number })?.minFeeForEmi ?? 8000),
  };
}

async function assertCouponNotAlreadyUsed(couponCode: string, phone?: string) {
  const code = couponCode.trim().toUpperCase();
  const coupon = await Coupon.findOne({ code, active: true }).lean();
  if (!coupon) return;

  if (coupon.maxRedemptions != null && coupon.used >= coupon.maxRedemptions) {
    throw new BadRequestError("This coupon has already been used.");
  }

  const scholarship = await ScholarshipResult.findOne({ couponCode: code }).lean();
  if (scholarship?.redeemedAt) {
    throw new BadRequestError("This scholarship coupon has already been redeemed.");
  }

  if (!phone?.trim()) return;

  const targetPhone = normalizePhone(phone);
  const paidWithCoupon = await Payment.find({ status: "paid", couponCode: code })
    .select("payerPhone notes")
    .lean();

  for (const row of paidWithCoupon) {
    const rowPhone = paymentPhone(row);
    if (rowPhone && normalizePhone(rowPhone) === targetPhone) {
      throw new BadRequestError("This coupon was already used with this mobile number.");
    }
  }

  const legacyPaid = await Payment.find({
    status: "paid",
    couponCode: { $exists: false },
    notes: { $regex: `"coupon"\\s*:\\s*"${code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"` },
  })
    .select("payerPhone notes")
    .lean();

  for (const row of legacyPaid) {
    const rowPhone = paymentPhone(row);
    if (rowPhone && normalizePhone(rowPhone) === targetPhone) {
      throw new BadRequestError("This coupon was already used with this mobile number.");
    }
  }
}

async function assertScholarshipCouponEligible(couponCode: string, phone?: string, email?: string) {
  const code = couponCode.trim().toUpperCase();
  const result = await ScholarshipResult.findOne({ couponCode: code }).lean();
  if (!result) return;

  if (!phone?.trim()) {
    throw new BadRequestError(
      "Enter the same mobile number you used for the scholarship exam to apply this coupon.",
    );
  }

  if (normalizePhone(result.phone) !== normalizePhone(phone)) {
    throw new BadRequestError(
      "This scholarship coupon is linked to a different mobile number. Use the same phone you registered with for the exam.",
    );
  }

  const examEmail = result.email?.trim().toLowerCase();
  if (examEmail) {
    const checkoutEmail = email?.trim().toLowerCase();
    if (!checkoutEmail) {
      throw new BadRequestError(
        "Enter the same email you used for the scholarship exam to apply this coupon.",
      );
    }
    if (examEmail !== checkoutEmail) {
      throw new BadRequestError(
        "This scholarship coupon is linked to a different email. Use the same email you registered with for the exam.",
      );
    }
  }
}

export async function quote(
  courseId: string,
  couponCode?: string,
  parts = 1,
  opts?: { phone?: string; email?: string },
) {
  if (couponCode) {
    await assertScholarshipCouponEligible(couponCode, opts?.phone, opts?.email);
    await assertCouponNotAlreadyUsed(couponCode, opts?.phone);
  }
  const course = await Course.findById(courseId).lean();
  if (!course || !course.active) throw new NotFoundError("Course not found");
  const coupon = couponCode ? await Coupon.findOne({ code: couponCode.toUpperCase(), active: true }) : null;
  const priced = applyCoupon(course.fee, coupon);
  const settings = await feeSettings();
  const plan = installmentPlan(priced.total, parts, settings.minFeeForEmi);
  return { course: { id: course._id, title: course.title, fee: course.fee }, coupon, ...priced, plan };
}

async function assertReferralCodeValid(referralCode: string, phone?: string) {
  const code = referralCode.trim().toUpperCase();
  const referrer = await Student.findOne({ referralCode: code })
    .populate<{ user: { phone?: string; name?: string } }>("user", "phone name")
    .lean();
  if (!referrer) throw new BadRequestError("Invalid referral code.");
  if (phone?.trim() && preventSelfReferral(code, undefined, referrer.user?.phone, phone)) {
    throw new BadRequestError("You cannot use your own referral code.");
  }
  return referrer;
}

export async function validateEnrollmentCode(input: {
  courseId: string;
  code: string;
  phone?: string;
  email?: string;
}) {
  const code = input.code.trim().toUpperCase();
  if (!code) throw new BadRequestError("Enter a code.");

  const [couponRow, scholarshipRow] = await Promise.all([
    Coupon.findOne({ code }).lean(),
    ScholarshipResult.findOne({ couponCode: code }).lean(),
  ]);

  if (couponRow || scholarshipRow) {
    const q = await quote(input.courseId, code, 1, { phone: input.phone, email: input.email });
    if (q.discount <= 0) {
      throw new BadRequestError("Invalid code.");
    }
    return {
      kind: scholarshipRow ? ("scholarship" as const) : ("coupon" as const),
      code,
      fee: q.fee,
      discount: q.discount,
      total: q.total,
      coupon: q.coupon,
      message: scholarshipRow
        ? `Scholarship coupon applied — ${q.discount} off`
        : `Coupon applied — ${q.discount} off`,
    };
  }

  const referrer = await Student.findOne({ referralCode: code })
    .populate<{ user: { name?: string; phone?: string } }>("user", "name phone")
    .lean();

  if (referrer) {
    if (input.phone?.trim() && preventSelfReferral(code, undefined, referrer.user?.phone, input.phone)) {
      throw new BadRequestError("You cannot use your own referral code.");
    }
    const course = await Course.findById(input.courseId).lean();
    if (!course || !course.active) throw new NotFoundError("Course not found");
    return {
      kind: "referral" as const,
      code,
      fee: course.fee,
      discount: 0,
      total: course.fee,
      referrerName: referrer.user?.name,
      message: "Referral code applied. Admin will process referrer benefits after your enrollment.",
    };
  }

  throw new BadRequestError("Invalid code.");
}

export async function startCheckout(input: {
  name: string;
  email: string;
  phone: string;
  courseId: string;
  batchId?: string;
  coupon?: string;
  parts: number;
  referralCode?: string;
}) {
  if (input.referralCode?.trim()) {
    await assertReferralCodeValid(input.referralCode, input.phone);
  }
  const q = await quote(input.courseId, input.coupon, 1, { phone: input.phone, email: input.email });
  const amountPaise = q.total * 100;
  const receipt = `enr_${nanoid(10)}`;
  const order = await createOrder(amountPaise, receipt, {
    courseId: input.courseId,
    phone: input.phone,
    email: input.email,
  });
  const payment = await Payment.create({
    course: input.courseId,
    amount: q.total,
    listFee: q.fee,
    discount: q.discount,
    couponCode: q.coupon?.code,
    status: "created",
    mode: "razorpay",
    razorpayOrderId: order.id,
    payerName: input.name.trim(),
    payerEmail: input.email.trim(),
    payerPhone: input.phone.trim(),
    notes: JSON.stringify({
      ...input,
      parts: 1,
      coupon: q.coupon?.code,
      fee: q.fee,
      discount: q.discount,
      total: q.total,
    }),
  });
  return { order, paymentId: payment._id, quote: q };
}

async function redeemCouponOnPayment(payment: InstanceType<typeof Payment>) {
  const meta = extractPaymentDiscount(payment);
  if (!meta.couponCode) return;

  payment.listFee = meta.listFee;
  payment.discount = meta.discount;
  payment.couponCode = meta.couponCode;

  const scholarship = await ScholarshipResult.findOne({ couponCode: meta.couponCode }).lean();
  if (scholarship?.redeemedAt) return;

  await Coupon.updateOne({ code: meta.couponCode }, { $inc: { used: 1 } });
  await ScholarshipResult.updateOne(
    { couponCode: meta.couponCode, redeemedAt: { $exists: false } },
    { redeemedAt: new Date(), paymentId: payment._id },
  );
}

async function sendPaymentReceiptEmail(payment: InstanceType<typeof Payment>) {
  const email = payment.payerEmail?.trim();
  if (!email || !payment.razorpayOrderId) return;

  try {
    const { pdf, invoice } = await buildPaymentInvoicePdf(String(payment._id), payment.razorpayOrderId);
    const site = await getWebsiteSettings();
    await sendEmail(
      email,
      `Payment receipt — ${invoice.invoiceNumber}`,
      [
        `Dear ${invoice.payerName},`,
        ``,
        `Thank you for your payment at ${site.name}.`,
        ``,
        `Course: ${invoice.course}`,
        `Amount paid: ₹${Number(invoice.total).toLocaleString("en-IN")}`,
        `Invoice: ${invoice.invoiceNumber}`,
        `Date: ${invoice.date}`,
        ``,
        `Your payment receipt is attached as a PDF.`,
        ``,
        `Our team will confirm your admission shortly.`,
        ``,
        site.name,
      ].join("\n"),
      [{ filename: `${invoice.invoiceNumber}.pdf`, content: Buffer.from(pdf) }],
    );
  } catch (err) {
    logger.warn({ err, paymentId: payment._id }, "Payment receipt email failed");
  }
}

async function notifyAdminOnlinePayment(payment: InstanceType<typeof Payment>, courseTitle: string) {
  const meta = extractPaymentDiscount(payment);
  try {
    await notifyStaffAlert({
      type: "payment",
      title: "New online payment",
      body: `${payment.payerName || "Student"} paid ₹${Number(meta.total).toLocaleString("en-IN")} for ${courseTitle}. Review in Enrollments.`,
      link: "/enrollments",
    });
  } catch (err) {
    logger.warn({ err, paymentId: payment._id }, "Admin payment alert failed");
  }
}

async function fulfillPaidPayment(payment: InstanceType<typeof Payment>, meta: Record<string, string>) {
  if (payment.status === "paid") return payment;
  const notes = JSON.parse(payment.notes || "{}") as {
    name?: string;
    email?: string;
    phone?: string;
    courseId?: string;
  };
  const course = await Course.findById(notes.courseId || payment.course);
  if (!course) throw new NotFoundError("Course not found");

  payment.status = "paid";
  payment.course = course._id;
  payment.payerName = payment.payerName || notes.name;
  payment.payerEmail = payment.payerEmail || notes.email;
  payment.payerPhone = payment.payerPhone || notes.phone;
  await redeemCouponOnPayment(payment);
  await payment.save();

  const courseTitle =
    course.title && typeof course.title === "object" && "en" in course.title
      ? String((course.title as { en?: string }).en)
      : "Course";

  void meta;
  void sendPaymentReceiptEmail(payment);
  void notifyAdminOnlinePayment(payment, courseTitle);
  return payment;
}

export function invoiceNumberFor(paymentId: string) {
  return `INV-${String(paymentId).slice(-8).toUpperCase()}`;
}

export async function invoicePayload(payment: {
  _id: unknown;
  amount: number;
  listFee?: number;
  discount?: number;
  couponCode?: string;
  course?: unknown;
  notes?: string;
  payerName?: string;
  payerEmail?: string;
  payerPhone?: string;
  razorpayPaymentId?: string;
  razorpayOrderId?: string;
  mode?: string;
  createdAt?: Date;
  updatedAt?: Date;
}) {
  const meta = extractPaymentDiscount(payment);
  const course = payment.course as { title?: { en?: string } } | null | undefined;
  const courseTitle =
    course && typeof course === "object" && course.title?.en
      ? course.title.en
      : "Course fee";
  return {
    paymentId: String(payment._id),
    invoiceNumber: invoiceNumberFor(String(payment._id)),
    date: new Date(payment.updatedAt || payment.createdAt || Date.now()).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }),
    payerName: payment.payerName || "Student",
    payerEmail: payment.payerEmail || "",
    payerPhone: payment.payerPhone || "",
    course: courseTitle,
    fee: meta.listFee,
    discount: meta.discount,
    total: meta.total,
    coupon: meta.couponCode || "",
    paymentRef: payment.razorpayPaymentId || "",
    orderId: payment.razorpayOrderId || "",
    mode: payment.mode || "razorpay",
  };
}

export async function buildPaymentInvoicePdf(paymentId: string, orderId: string) {
  const payment = await Payment.findOne({
    _id: paymentId,
    razorpayOrderId: orderId,
    status: "paid",
  }).populate("course", "title");
  if (!payment) throw new NotFoundError("Invoice not found");
  const invoice = await invoicePayload(payment);
  const site = await getWebsiteSettings();
  const pdf = await buildInvoicePdf({
    instituteName: site.name,
    instituteEmail: site.email,
    institutePhone: site.mobile,
    instituteAddress: site.address,
    invoiceNumber: invoice.invoiceNumber,
    date: invoice.date,
    payerName: invoice.payerName,
    payerEmail: invoice.payerEmail,
    payerPhone: invoice.payerPhone,
    course: invoice.course,
    fee: invoice.fee,
    discount: invoice.discount,
    total: invoice.total,
    paymentId: invoice.paymentRef,
    orderId: invoice.orderId,
    mode: invoice.mode,
  });
  return { pdf, invoice };
}

export async function verifyCheckout(orderId: string, paymentId: string, signature: string) {
  verifyCheckoutSignature(orderId, paymentId, signature);
  const payment = await Payment.findOne({ razorpayOrderId: orderId });
  if (!payment) throw new NotFoundError("Payment not found");
  payment.razorpayPaymentId = paymentId;
  payment.razorpaySignature = signature;
  await fulfillPaidPayment(payment, {});
  const fresh = await Payment.findById(payment._id).populate("course", "title");
  return invoicePayload(fresh ?? payment);
}

export async function handleWebhook(rawBody: string, signature: string) {
  verifyWebhookSignature(rawBody, signature);
  const event = JSON.parse(rawBody) as {
    event: string;
    payload?: { payment?: { entity?: { id: string; order_id: string } } };
    id?: string;
  };
  const eventId = event.id || `${event.event}:${event.payload?.payment?.entity?.id}`;
  const claimed = await claimWebhookEvent(eventId);
  if (!claimed) return { duplicate: true };
  if (event.event === "payment.captured") {
    const entity = event.payload?.payment?.entity;
    if (!entity) return { ignored: true };
    const payment = await Payment.findOne({ razorpayOrderId: entity.order_id });
    if (!payment) return { ignored: true };
    payment.razorpayPaymentId = entity.id;
    payment.webhookEventId = eventId;
    await fulfillPaidPayment(payment, {});
  }
  return { ok: true };
}

export async function studentFees(studentId: string) {
  const snapshot = await computeStudentFees(studentId);
  const { installments, fees } = snapshot;

  const [enrollments, payments] = await Promise.all([
    Enrollment.find({ student: studentId, status: { $in: ["active", "completed"] } })
      .populate("course", "title slug fee")
      .sort({ createdAt: -1 })
      .lean(),
    Payment.find({ student: studentId, status: "paid" })
      .populate("course", "title slug")
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  function refId(value: unknown) {
    if (!value) return "";
    if (typeof value === "object" && value !== null && "_id" in value) {
      return String((value as { _id: unknown })._id);
    }
    return String(value);
  }

  const courses = enrollments.map((en) => {
    const course = en.course as { _id?: unknown; title?: unknown; slug?: string; fee?: number };
    const enId = String(en._id);
    const courseId = refId(course?._id ?? en.course);
    const fullItem = fees.fullFeeItems.find((f) => f.enrollmentId === enId);

    const enInstallments = installments
      .filter((i) => refId(i.enrollment) === enId)
      .map((i) => ({
        id: String(i._id),
        sequence: Number(i.sequence ?? 0),
        amount: Number(i.amount ?? 0),
        dueDate: i.dueDate,
        status: String(i.status ?? "due"),
      }))
      .sort((a, b) => a.sequence - b.sequence);

    const enPayments = payments.filter(
      (p) => refId(p.enrollment) === enId || refId(p.course) === courseId,
    );

    if (fullItem) {
      return {
        enrollmentId: enId,
        course: { title: course?.title, slug: course?.slug },
        feePlan: en.feePlan ?? "full",
        listFee: fullItem.listFee,
        discount: fullItem.discount,
        couponCode: fullItem.couponCode,
        agreedFee: fullItem.agreedFee,
        paid: fullItem.paid,
        due: fullItem.due,
        installments: enInstallments,
      };
    }

    const agreedFee =
      en.agreedFee != null
        ? Number(en.agreedFee)
        : enInstallments.length
          ? enInstallments.reduce((s, i) => s + i.amount, 0)
          : Number(course?.fee ?? 0);

    const paid = enPayments.reduce((s, p) => s + Number(p.amount ?? 0), 0);
    const due = enInstallments
      .filter((i) => i.status === "due" || i.status === "overdue")
      .reduce((s, i) => s + i.amount, 0);

    return {
      enrollmentId: enId,
      course: { title: course?.title, slug: course?.slug },
      feePlan: en.feePlan ?? "installment",
      listFee: Number(en.listFee ?? course?.fee ?? agreedFee),
      discount: Number(en.discount ?? 0),
      couponCode: en.couponCode,
      agreedFee,
      paid,
      due,
      installments: enInstallments,
    };
  });

  const paymentRows = payments.map((p) => {
    const meta = extractPaymentDiscount(p);
    return {
      id: String(p._id),
      amount: meta.total,
      listFee: meta.listFee,
      discount: meta.discount,
      couponCode: meta.couponCode,
      mode: String(p.mode ?? "online"),
      createdAt: p.createdAt,
      course: p.course,
      enrollment: p.enrollment,
    };
  });

  return {
    summary: {
      totalPaid: fees.totalPaid,
      totalDue: fees.totalDue,
      totalOverdue: fees.totalOverdue,
      installmentDue: fees.installmentDue,
      fullFeeDue: fees.fullFeeDue,
      nextDueDate: fees.nextDueDate,
      nextDueAmount: fees.nextDueAmount,
      nextDueKind: fees.nextDueKind,
    },
    courses,
    payments: paymentRows,
    remaining: fees.totalDue,
  };
}
