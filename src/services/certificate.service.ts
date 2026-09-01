import { CourseCertificate, Enrollment, Student } from "../models/index.js";
import { NotFoundError } from "../utils/errors.js";
import { buildCertificatePdf } from "./pdf.service.js";
import { getWebsiteSettings } from "./website-settings.service.js";
import { notifyCertificateIssued } from "./notification.service.js";

function courseTitle(course: unknown) {
  if (!course || typeof course !== "object") return "Course";
  const title = (course as { title?: { en?: string; hi?: string } | string }).title;
  if (typeof title === "string") return title;
  return title?.en || title?.hi || "Course";
}

function formatIssueDate(date: Date) {
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
}

async function nextCertificateNumber() {
  const year = new Date().getFullYear();
  const start = new Date(`${year}-01-01T00:00:00.000Z`);
  const count = await CourseCertificate.countDocuments({ issuedAt: { $gte: start } });
  return `OPT-${year}-${String(count + 1).padStart(4, "0")}`;
}

async function loadEnrollmentContext(enrollmentId: string) {
  const enrollment = await Enrollment.findById(enrollmentId)
    .populate("course", "title slug duration")
    .populate({
      path: "student",
      populate: { path: "user", select: "name phone email" },
    })
    .lean();
  if (!enrollment) throw new NotFoundError("Enrollment not found");
  const student = enrollment.student as
    | {
        _id: unknown;
        studentCode?: string;
        user?: { name?: string };
      }
    | undefined;
  if (!student) throw new NotFoundError("Student not found");
  return { enrollment, student };
}

export async function issueCertificate(enrollmentId: string, issuedBy?: string) {
  const { enrollment, student } = await loadEnrollmentContext(enrollmentId);
  const existing = await CourseCertificate.findOne({ enrollment: enrollmentId, status: "issued" }).lean();
  if (existing) return existing;

  const certificateNumber = await nextCertificateNumber();
  const cert = await CourseCertificate.create({
    enrollment: enrollmentId,
    student: student._id,
    course: enrollment.course,
    certificateNumber,
    issuedAt: new Date(),
    issuedBy: issuedBy || undefined,
    status: "issued",
  });

  if (enrollment.status === "active" && Number(enrollment.progress ?? 0) < 100) {
    await Enrollment.findByIdAndUpdate(enrollmentId, { progress: 100, status: "completed" });
  } else if (enrollment.status === "active") {
    await Enrollment.findByIdAndUpdate(enrollmentId, { status: "completed" });
  }

  await notifyCertificateIssued(String(student._id), courseTitle(enrollment.course));

  return cert.toObject();
}

export async function buildCertificatePdfForEnrollment(enrollmentId: string) {
  const cert = await CourseCertificate.findOne({ enrollment: enrollmentId, status: "issued" }).lean();
  if (!cert) throw new NotFoundError("Certificate not issued");

  const { enrollment, student } = await loadEnrollmentContext(enrollmentId);
  const site = await getWebsiteSettings();
  const user = student.user;
  const issuedAt = cert.issuedAt ? new Date(cert.issuedAt) : new Date();

  return buildCertificatePdf({
    instituteName: site.name,
    studentName: user?.name ?? "Student",
    courseTitle: courseTitle(enrollment.course),
    certificateNumber: cert.certificateNumber,
    issuedDate: formatIssueDate(issuedAt),
    studentCode: student.studentCode,
  });
}

export async function listStudentCertificates(studentId: string) {
  return CourseCertificate.find({ student: studentId, status: "issued" })
    .populate("course", "title slug duration")
    .sort({ issuedAt: -1 })
    .lean();
}

export async function studentCertificatePdf(studentId: string, enrollmentId: string) {
  const cert = await CourseCertificate.findOne({
    student: studentId,
    enrollment: enrollmentId,
    status: "issued",
  })
    .populate("course", "title slug")
    .lean();
  if (!cert) throw new NotFoundError("Certificate not found");

  const pdf = await buildCertificatePdfForEnrollment(enrollmentId);
  const student = await Student.findById(studentId).lean();

  return {
    ...cert,
    pdf: Buffer.from(pdf).toString("base64"),
    studentCode: student?.studentCode,
  };
}

export async function certificatesForEnrollments(enrollmentIds: string[]) {
  if (!enrollmentIds.length) return [];
  return CourseCertificate.find({ enrollment: { $in: enrollmentIds }, status: "issued" })
    .select("enrollment certificateNumber issuedAt status")
    .lean();
}
