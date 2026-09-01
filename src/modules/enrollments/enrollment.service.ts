import { nanoid } from "nanoid";
import {
  Admission,
  Course,
  Enrollment,
  Notification,
  Payment,
  Student,
  User,
} from "../../models/index.ts";
import { applyPaymentToInstallments, createEnrollmentInstallments } from "../../services/installment.service.ts";
import { extractPaymentDiscount } from "../../services/payment-discount.service.ts";
import { enqueueBroadcast } from "../../services/notification.service.ts";
import { BadRequestError, NotFoundError } from "../../utils/errors.ts";
import { hashPassword, makeReferralCode, makeStudentCode } from "../auth/auth.service.ts";
import { recordReferralFromAdmission } from "../admissions/admission.service.ts";

function parseNotes(raw?: string) {
  try {
    return JSON.parse(raw || "{}") as {
      name?: string;
      email?: string;
      phone?: string;
      courseId?: string;
      batchId?: string;
      parts?: number;
      coupon?: string;
      referralCode?: string;
    };
  } catch {
    return {};
  }
}

export function payerFromPayment(payment: {
  payerName?: string;
  payerEmail?: string;
  payerPhone?: string;
  notes?: string;
}) {
  const notes = parseNotes(payment.notes);
  return {
    name: payment.payerName || notes.name || "",
    email: payment.payerEmail || notes.email || "",
    phone: payment.payerPhone || notes.phone || "",
    parts: notes.parts ?? 1,
    referralCode: notes.referralCode || "",
    batchId: notes.batchId || "",
    coupon: notes.coupon || "",
    courseId: notes.courseId || "",
  };
}

async function uniqueReferralCode(name: string) {
  for (let i = 0; i < 8; i++) {
    const code = makeReferralCode(name);
    const exists = await Student.exists({ referralCode: code });
    if (!exists) return code;
  }
  return makeReferralCode(`${name}${nanoid(4)}`);
}

export async function listWebsiteEnrollments(query: Record<string, unknown>) {
  const page = Number(query.page || 1);
  const limit = Math.min(100, Number(query.limit || 20));
  const search = String(query.search || "").trim();
  const status = String(query.status || "");

  const and: Record<string, unknown>[] = [{ status: "paid" }, { mode: "razorpay" }];

  if (status === "pending") and.push({ $or: [{ student: { $exists: false } }, { student: null }] });
  else if (status === "admitted") and.push({ student: { $exists: true, $ne: null } });

  if (search) {
    and.push({
      $or: [
        { payerName: { $regex: search, $options: "i" } },
        { payerPhone: { $regex: search, $options: "i" } },
        { payerEmail: { $regex: search, $options: "i" } },
        { notes: { $regex: search, $options: "i" } },
      ],
    });
  }

  const filter = { $and: and };

  const [items, total] = await Promise.all([
    Payment.find(filter)
      .populate({ path: "student", populate: { path: "user", select: "name phone email status" } })
      .populate("course", "title slug fee")
      .populate("enrollment", "status feePlan batch")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Payment.countDocuments(filter),
  ]);

  return {
    items: items.map((row) => {
      const payer = payerFromPayment(row);
      const admitted = Boolean(row.student);
      return {
        ...row,
        payer,
        application: {
          name: payer.name,
          email: payer.email,
          phone: payer.phone,
          courseId: String((row.course as { _id?: unknown })?._id ?? row.course ?? payer.courseId ?? ""),
          batchId: payer.batchId,
          coupon: payer.coupon,
          referralCode: payer.referralCode,
        },
        admissionStatus: admitted ? "admitted" : "pending",
        feePlan: (row.enrollment as { feePlan?: string } | undefined)?.feePlan ?? (payer.parts > 1 ? "installment" : "full"),
        payment: row,
      };
    }),
    meta: {
      currentPage: page,
      totalItems: total,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

export async function admitWebsiteEnrollment(
  paymentId: string,
  body: {
    name?: string;
    email?: string;
    phone?: string;
    course?: string;
    batch?: string;
    parentPhone?: string;
    address?: string;
    dob?: string;
    photo?: Record<string, unknown>;
    referrerCode?: string;
  },
) {
  const payment = await Payment.findById(paymentId);
  if (!payment) throw new NotFoundError("Payment not found");
  if (payment.status !== "paid") throw new BadRequestError("Only paid website payments can be admitted");

  if (payment.student && payment.enrollment) {
    const student = await Student.findById(payment.student).lean();
    return {
      studentCode: student?.studentCode,
      alreadyAdmitted: true as const,
    };
  }

  const payer = payerFromPayment(payment);
  const name = body.name?.trim() || payer.name;
  const email = body.email?.trim() || payer.email;
  const phone = body.phone?.trim() || payer.phone;
  if (!name || !phone) throw new BadRequestError("Website payment is missing name or phone");

  const course = await Course.findById(body.course || payment.course);
  if (!course) throw new NotFoundError("Course not found");

  const studentCode = makeStudentCode();
  const password = Math.random().toString(36).slice(2, 12) + "A1";
  const referralCode = await uniqueReferralCode(name);

  const user = await User.create({
    kind: "student",
    name,
    email: email || undefined,
    phone,
    studentCode,
    passwordHash: await hashPassword(password),
    status: "active",
  });

  const student = await Student.create({
    user: user._id,
    studentCode,
    batch: body.batch || undefined,
    parentPhone: body.parentPhone,
    address: body.address,
    dob: body.dob ? new Date(body.dob) : undefined,
    referralCode,
    photo: body.photo,
  });

  const feePlan = payer.parts > 1 ? "installment" : "full";
  const feeMeta = extractPaymentDiscount(payment);
  const enrollment = await Enrollment.create({
    student: student._id,
    course: course._id,
    batch: body.batch || undefined,
    status: "active",
    source: "online",
    feePlan,
    agreedFee: feeMeta.total,
    listFee: feeMeta.listFee,
    discount: feeMeta.discount,
    couponCode: feeMeta.couponCode,
  });

  await Payment.findByIdAndUpdate(payment._id, {
    student: student._id,
    enrollment: enrollment._id,
    course: course._id,
    payerName: name,
    payerEmail: email || payment.payerEmail,
    payerPhone: phone,
    listFee: feeMeta.listFee,
    discount: feeMeta.discount,
    couponCode: feeMeta.couponCode,
  });

  if (feePlan === "installment") {
    await createEnrollmentInstallments(String(enrollment._id), String(student._id), Number(payment.amount));
    await applyPaymentToInstallments(String(student._id), Number(payment.amount), payment._id, {
      enrollmentId: String(enrollment._id),
    });
  }

  const referrerCode = body.referrerCode?.trim() || payer.referralCode?.trim();
  if (referrerCode) {
    await recordReferralFromAdmission(referrerCode, phone, String(student._id));
  }

  await Admission.create({
    student: student._id,
    name,
    phone,
    email: email || undefined,
    address: body.address,
    dob: body.dob ? new Date(body.dob) : undefined,
    parentPhone: body.parentPhone,
    course: course._id,
    batch: body.batch || undefined,
    status: "confirmed",
    feePlan,
    paymentMode: "online",
    photo: body.photo,
    referrerCode,
  });

  const note = await Notification.create({
    type: "admission",
    title: "Admission confirmed",
    body: `ID ${studentCode} / password ${password}`,
    audience: "STUDENT",
    student: student._id,
  });
  await enqueueBroadcast(String(note._id));

  return {
    enrollment,
    studentCode,
    password,
    alreadyAdmitted: false as const,
  };
}
