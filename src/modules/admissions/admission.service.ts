import { nanoid } from "nanoid";
import {
  Admission,
  Course,
  Enrollment,
  Installment,
  Notification,
  Referral,
  Student,
  User,
} from "../../models/index.js";
import { createEnrollmentInstallments } from "../../services/installment.service.js";
import { enqueueBroadcast } from "../../services/notification.service.js";
import { preventSelfReferral } from "../../services/pricing.service.js";
import { BadRequestError, NotFoundError } from "../../utils/errors.js";
import { hashPassword, makeReferralCode, makeStudentCode } from "../auth/auth.service.js";

async function uniqueReferralCode(name: string) {
  for (let i = 0; i < 8; i++) {
    const code = makeReferralCode(name);
    const exists = await Student.exists({ referralCode: code });
    if (!exists) return code;
  }
  return makeReferralCode(`${name}${nanoid(4)}`);
}

async function ensureEnrollmentInstallments(
  enrollmentId: string,
  studentId: string,
  courseId: string,
  feePlan: "full" | "installment",
) {
  if (feePlan !== "installment") return;
  const course = await Course.findById(courseId).lean();
  if (!course) return;
  const count = await Installment.countDocuments({ enrollment: enrollmentId });
  if (count === 0) {
    await createEnrollmentInstallments(enrollmentId, studentId, course.fee);
  }
}

export async function recordReferralFromAdmission(referrerCode: string, refereePhone: string, refereeStudentId: string) {
  const code = referrerCode.trim().toUpperCase();
  if (!code) return;

  const referrer = await Student.findOne({ referralCode: code }).populate<{ user: { phone?: string } }>("user", "phone").lean();
  if (!referrer) throw new BadRequestError("Referral code not found");

  if (preventSelfReferral(code, undefined, referrer.user?.phone, refereePhone)) {
    throw new BadRequestError("Self-referral is not allowed");
  }

  await Referral.findOneAndUpdate(
    { referrer: referrer._id, refereePhone },
    {
      referrer: referrer._id,
      code: referrer.referralCode,
      refereePhone,
      refereeStudent: refereeStudentId,
      status: "successful",
      payoutStatus: "pending",
    },
    { upsert: true, new: true },
  );
}

export async function confirmAdmission(adId: string) {
  const ad = await Admission.findById(adId);
  if (!ad) throw new NotFoundError("Admission not found");

  if (ad.status === "confirmed" && ad.student) {
    const student = await Student.findById(ad.student).lean();
    if (!student) throw new NotFoundError("Linked student not found");
    return {
      admission: ad,
      studentCode: student.studentCode,
      alreadyConfirmed: true as const,
    };
  }

  if (ad.status === "cancelled") {
    throw new BadRequestError("Cancelled admission cannot be confirmed");
  }

  const studentCode = makeStudentCode();
  const password = Math.random().toString(36).slice(2, 12) + "A1";
  const referralCode = await uniqueReferralCode(ad.name);

  const user = await User.create({
    kind: "student",
    name: ad.name,
    email: ad.email,
    phone: ad.phone,
    studentCode,
    passwordHash: await hashPassword(password),
    status: "active",
  });

  const student = await Student.create({
    user: user._id,
    studentCode,
    batch: ad.batch,
    parentPhone: ad.parentPhone,
    address: ad.address,
    dob: ad.dob,
    referralCode,
    photo: ad.photo,
    idProof: ad.idProof,
  });

  const enrollment = await Enrollment.create({
    student: student._id,
    course: ad.course,
    batch: ad.batch,
    status: "active",
    source: "offline",
    feePlan: ad.feePlan,
  });

  await ensureEnrollmentInstallments(String(enrollment._id), String(student._id), String(ad.course), ad.feePlan);

  if (ad.referrerCode?.trim()) {
    await recordReferralFromAdmission(ad.referrerCode, ad.phone, String(student._id));
  }

  ad.status = "confirmed";
  ad.student = student._id;
  await ad.save();

  const note = await Notification.create({
    type: "admission",
    title: "Admission confirmed",
    body: `ID ${studentCode} / password ${password}`,
    audience: "STUDENT",
    student: student._id,
  });
  await enqueueBroadcast(String(note._id));

  return {
    admission: ad,
    studentCode,
    password,
  };
}
