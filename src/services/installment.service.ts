import { Types } from "mongoose";
import { Course, Enrollment, Installment, Payment, Setting, Student } from "../models/index.ts";
import { NotFoundError } from "../utils/errors.ts";
import { installmentPlan } from "./pricing.service.ts";
import { extractPaymentDiscount } from "./payment-discount.service.ts";
import { notifyStudents } from "./notification.service.ts";

export async function getInstallmentSettings() {
  const row = await Setting.findOne({ key: "installments" }).lean();
  return {
    parts: Number((row?.value as { parts?: number })?.parts ?? 3),
    minFeeForEmi: Number((row?.value as { minFeeForEmi?: number })?.minFeeForEmi ?? 8000),
  };
}

export function buildInstallmentSchedule(total: number, parts: number, startDate = new Date()) {
  const per = Math.ceil(total / parts);
  return Array.from({ length: parts }, (_, i) => {
    const dueDate = new Date(startDate);
    dueDate.setMonth(dueDate.getMonth() + i);
    return { sequence: i + 1, amount: per, dueDate };
  });
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function markOverdueInstallments(studentId?: string) {
  const filter: Record<string, unknown> = {
    status: "due",
    dueDate: { $lt: startOfToday() },
  };
  if (studentId) filter.student = studentId;
  await Installment.updateMany(filter, { status: "overdue" });
}

export async function previewCourseInstallments(courseId: string) {
  const course = await Course.findById(courseId).lean();
  if (!course) throw new NotFoundError("Course not found");
  const settings = await getInstallmentSettings();
  const plan = installmentPlan(course.fee, settings.parts, settings.minFeeForEmi);
  const schedule = plan.allowed ? buildInstallmentSchedule(course.fee, settings.parts) : [];
  return {
    courseFee: course.fee,
    parts: settings.parts,
    minFeeForEmi: settings.minFeeForEmi,
    perInstallment: plan.perInstallment,
    allowed: plan.allowed,
    schedule,
  };
}

export async function createEnrollmentInstallments(
  enrollmentId: string,
  studentId: string,
  totalFee: number,
  options?: { parts?: number; markFirstPaid?: boolean; paymentId?: string; startDate?: Date },
) {
  const settings = await getInstallmentSettings();
  const parts = options?.parts ?? settings.parts;
  const plan = installmentPlan(totalFee, parts, settings.minFeeForEmi);
  if (!plan.allowed) return [];

  const schedule = buildInstallmentSchedule(totalFee, parts, options?.startDate ?? new Date());
  for (const row of schedule) {
    const isFirst = row.sequence === 1;
    const paid = options?.markFirstPaid && isFirst;
    await Installment.updateOne(
      { enrollment: enrollmentId, sequence: row.sequence },
      {
        enrollment: enrollmentId,
        student: studentId,
        amount: row.amount,
        dueDate: row.dueDate,
        status: paid ? "paid" : "due",
        payment: paid ? options?.paymentId : undefined,
        sequence: row.sequence,
      },
      { upsert: true },
    );
  }
  return schedule;
}

export async function applyPaymentToInstallments(
  studentId: string,
  amount: number,
  paymentId: string | Types.ObjectId,
  options?: { startInstallmentId?: string; enrollmentId?: string },
) {
  await markOverdueInstallments(studentId);

  const filter: Record<string, unknown> = {
    student: studentId,
    status: { $in: ["due", "overdue"] },
  };
  if (options?.enrollmentId) filter.enrollment = options.enrollmentId;

  let pending = await Installment.find(filter).sort({ dueDate: 1, sequence: 1 });

  if (options?.startInstallmentId) {
    const idx = pending.findIndex((row) => String(row._id) === options.startInstallmentId);
    if (idx >= 0) pending = pending.slice(idx);
  }

  let remaining = amount;
  const installmentIds: string[] = [];
  let partsPaid = 0;

  for (const inst of pending) {
    if (remaining <= 0) break;
    const owed = Number(inst.amount ?? 0);
    if (remaining >= owed) {
      inst.status = "paid";
      inst.payment = paymentId as never;
      remaining -= owed;
      partsPaid += 1;
    } else if (remaining > 0) {
      inst.amount = owed - remaining;
      inst.status = inst.dueDate < startOfToday() ? "overdue" : "due";
      remaining = 0;
    }
    await inst.save();
    installmentIds.push(String(inst._id));
  }

  return {
    applied: amount - remaining,
    remainingCredit: remaining,
    partsPaid,
    installmentIds,
  };
}

function refId(value: unknown) {
  if (!value) return "";
  if (typeof value === "object" && value !== null && "_id" in value) return String((value as { _id: unknown })._id);
  return String(value);
}

function paymentsForEnrollment(
  enrollmentId: string,
  courseId: string,
  paidPayments: { enrollment?: unknown; course?: unknown; amount?: number; listFee?: number; discount?: number; couponCode?: string; notes?: string }[],
  singleEnrollment: boolean,
) {
  return paidPayments.filter((p) => {
    const pEn = refId(p.enrollment);
    const pCourse = refId(p.course);
    if (pEn && pEn === enrollmentId) return true;
    if (pCourse && pCourse === courseId) return true;
    if (!pEn && !pCourse && singleEnrollment) return true;
    return false;
  });
}

function enrollmentFeeMeta(
  en: { agreedFee?: number; listFee?: number; discount?: number; couponCode?: string },
  courseFee: number,
  enPayments: { amount?: number; listFee?: number; discount?: number; couponCode?: string; notes?: string }[],
) {
  if (en.agreedFee != null) {
    return {
      listFee: Number(en.listFee ?? courseFee),
      discount: Number(en.discount ?? 0),
      couponCode: en.couponCode || undefined,
      agreedFee: Number(en.agreedFee),
    };
  }

  for (const payment of enPayments) {
    const meta = extractPaymentDiscount(payment);
    if (meta.discount > 0 || meta.couponCode) {
      return {
        listFee: meta.listFee,
        discount: meta.discount,
        couponCode: meta.couponCode,
        agreedFee: meta.total,
      };
    }
  }

  return {
    listFee: courseFee,
    discount: 0,
    couponCode: undefined as string | undefined,
    agreedFee: courseFee,
  };
}

export async function attachWebsitePaymentsToStudent(studentId: string) {
  const student = await Student.findById(studentId).populate("user", "phone email").lean();
  if (!student) return;
  const user = student.user as { phone?: string; email?: string } | undefined;
  const enrollment = await Enrollment.findOne({ student: studentId, status: "active" }).sort({ createdAt: -1 }).lean();

  const matchers: Record<string, unknown>[] = [];
  if (user?.phone) {
    matchers.push({ payerPhone: user.phone });
    matchers.push({ notes: { $regex: user.phone.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } });
  }
  if (user?.email) matchers.push({ payerEmail: user.email });

  const unlinkedFilter: Record<string, unknown> = {
    status: "paid",
    $or: [{ student: { $exists: false } }, { student: null }],
  };
  if (matchers.length) unlinkedFilter.$and = [{ $or: matchers }];
  else return;

  const unlinked = await Payment.find(unlinkedFilter);
  if (!unlinked.length && enrollment) {
    await Payment.updateMany(
      { student: studentId, $or: [{ enrollment: { $exists: false } }, { enrollment: null }] },
      { enrollment: enrollment._id, course: enrollment.course },
    );
    return;
  }

  for (const payment of unlinked) {
    payment.student = student._id as never;
    if (enrollment) {
      if (!payment.enrollment) payment.enrollment = enrollment._id as never;
      if (!payment.course) payment.course = enrollment.course as never;
    }
    await payment.save();
  }
}

export async function computeStudentFees(studentId: string) {
  await attachWebsitePaymentsToStudent(studentId);
  await markOverdueInstallments(studentId);

  const [installments, paidPayments, enrollments] = await Promise.all([
    Installment.find({ student: studentId })
      .sort({ dueDate: 1, sequence: 1 })
      .populate("payment", "amount createdAt mode status")
      .lean(),
    Payment.find({ student: studentId, status: "paid" }).lean(),
    Enrollment.find({ student: studentId, status: "active" }).populate("course", "title fee").lean(),
  ]);

  const totalPaid = paidPayments.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
  const dueRows = installments.filter((row) => row.status === "due" || row.status === "overdue");
  const installmentDue = dueRows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
  const totalOverdue = installments
    .filter((row) => row.status === "overdue")
    .reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
  const nextInstallment = dueRows.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())[0];

  let fullFeeDue = 0;
  const fullFeeItems: {
    enrollmentId: string;
    course: { title?: unknown; fee?: number };
    courseFee: number;
    listFee: number;
    discount: number;
    couponCode?: string;
    agreedFee: number;
    paid: number;
    due: number;
  }[] = [];

  for (const en of enrollments) {
    if (en.feePlan !== "full") continue;
    const course = en.course as { _id?: unknown; title?: unknown; fee?: number };
    const courseFee = Number(course?.fee ?? 0);
    const enId = String(en._id);
    const courseId = refId(course?._id ?? en.course);
    const enPayments = paymentsForEnrollment(enId, courseId, paidPayments, enrollments.length === 1);
    const feeMeta = enrollmentFeeMeta(en, courseFee, enPayments);
    const paidForEn = enPayments.reduce((sum, p) => sum + Number(p.amount ?? 0), 0);
    const due = Math.max(0, feeMeta.agreedFee - paidForEn);
    fullFeeItems.push({
      enrollmentId: enId,
      course: { title: course?.title, fee: courseFee },
      courseFee,
      listFee: feeMeta.listFee,
      discount: feeMeta.discount,
      couponCode: feeMeta.couponCode,
      agreedFee: feeMeta.agreedFee,
      paid: paidForEn,
      due,
    });
    if (due > 0) fullFeeDue += due;
  }

  const totalDue = installmentDue + fullFeeDue;

  return {
    installments,
    fees: {
      totalPaid,
      totalDue,
      installmentDue,
      fullFeeDue,
      totalOverdue,
      nextDueDate: nextInstallment?.dueDate,
      nextDueAmount: nextInstallment?.amount ?? (fullFeeDue > 0 ? fullFeeItems[0]?.due : undefined),
      nextDueKind: nextInstallment ? ("installment" as const) : fullFeeDue > 0 ? ("full" as const) : undefined,
      fullFeeItems,
    },
  };
}

export async function studentIdsWithOutstandingFees() {
  const ids = new Set<string>();

  const installmentStudentIds = await Installment.distinct("student", {
    status: { $in: ["due", "overdue"] },
  });
  for (const id of installmentStudentIds) ids.add(String(id));

  const fullEnrollments = await Enrollment.find({
    status: { $in: ["active", "completed", "pending"] },
    feePlan: "full",
  })
    .populate("course", "fee")
    .lean();

  if (!fullEnrollments.length) return [...ids];

  const studentIds = [...new Set(fullEnrollments.map((e) => String(e.student)))];
  const paidPayments = await Payment.find({ student: { $in: studentIds }, status: "paid" }).lean();

  for (const en of fullEnrollments) {
    const course = en.course as { _id?: unknown; fee?: number };
    const courseFee = Number(course?.fee ?? 0);
    const enId = String(en._id);
    const courseId = refId(course?._id ?? en.course);
    const studentId = String(en.student);
    const singleEnrollment = fullEnrollments.filter((e) => String(e.student) === studentId).length === 1;
    const enPayments = paymentsForEnrollment(enId, courseId, paidPayments, singleEnrollment);
    const feeMeta = enrollmentFeeMeta(en, courseFee, enPayments);
    const paid = enPayments.reduce((sum, p) => sum + Number(p.amount ?? 0), 0);
    if (paid < feeMeta.agreedFee) ids.add(studentId);
  }

  return [...ids];
}

export async function recordManualPayment(body: {
  student: string;
  amount: number;
  mode?: string;
  notes?: string;
  course?: string;
  installment?: string;
  createdBy?: string;
}) {
  let startInstallment = body.installment ? await Installment.findById(body.installment) : null;
  if (body.installment && !startInstallment) throw new NotFoundError("Installment not found");

  let courseId = body.course;
  let enrollmentId: string | undefined;
  if (startInstallment) {
    enrollmentId = String(startInstallment.enrollment);
    if (!courseId) {
      const en = await Enrollment.findById(startInstallment.enrollment).lean();
      if (en) courseId = String(en.course);
    }
  } else {
    const en = await Enrollment.findOne({ student: body.student, status: "active" }).sort({ createdAt: -1 }).lean();
    if (en) {
      enrollmentId = String(en._id);
      if (!courseId) courseId = String(en.course);
    }
  }

  const payment = await Payment.create({
    student: body.student,
    course: courseId,
    enrollment: enrollmentId,
    amount: body.amount,
    mode: body.mode ?? "cash",
    status: "paid",
    notes: body.notes,
    createdBy: body.createdBy,
  });

  const allocation = await applyPaymentToInstallments(body.student, body.amount, payment._id, {
    startInstallmentId: body.installment,
    enrollmentId,
  });

  try {
    const fees = await computeStudentFees(body.student);
    await notifyStudents({
      type: "general",
      title: "Payment received",
      body: `₹${Number(body.amount).toLocaleString("en-IN")} recorded (${body.mode ?? "cash"}). Outstanding: ₹${Number(fees.fees.totalDue).toLocaleString("en-IN")}.`,
      audience: "STUDENT",
      student: body.student,
      createdBy: body.createdBy,
    });
  } catch {
    /* notification optional */
  }

  return { payment, allocation };
}
