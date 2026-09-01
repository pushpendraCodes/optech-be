import { z } from "zod";
import { nanoid } from "nanoid";
import { Coupon, ScholarshipExam, ScholarshipResult, Student, type QuizQuestion } from "../../models/index.js";
import { gradeQuiz } from "../../services/grading.service.js";
import { pickScholarshipSlab } from "../../services/pricing.service.js";
import { NotFoundError, ValidationError } from "../../utils/errors.js";
import { objectId, paginationQuery } from "../../utils/pagination.js";
import { questionInputSchema, validateImportRows, type ImportRow } from "../quizzes/quiz.service.js";

const slabSchema = z.object({
  minPercent: z.number().min(0).max(100),
  couponPercent: z.number().min(0).max(100),
  couponPrefix: z.string().min(1).default("SCH"),
});

const examBodySchema = z.object({
  title: z.string().min(2),
  description: z.string().optional(),
  minutes: z.number().min(1),
  slabs: z.array(slabSchema).min(1),
  active: z.boolean().optional(),
  questions: z.array(questionInputSchema).optional(),
});

export const scholarshipListQuery = paginationQuery.extend({
  active: z.enum(["true", "false"]).optional(),
});

function normalizeQuestion(raw: z.infer<typeof questionInputSchema>): QuizQuestion {
  const answerIndex = Math.min(raw.answerIndex, raw.options.length - 1);
  return {
    type: raw.type,
    prompt: raw.prompt.trim(),
    options: raw.options.map((o) => o.trim()),
    answerIndex,
    marks: raw.marks,
    negativeMarks: raw.negativeMarks,
    difficulty: raw.difficulty,
    explanation: raw.explanation?.trim(),
    topic: raw.topic?.trim(),
    tags: raw.tags?.map((t) => t.trim()).filter(Boolean),
  };
}

function examMeta(exam: { questions?: QuizQuestion[] }) {
  const questions = exam.questions ?? [];
  return {
    questionCount: questions.length,
    totalMarks: questions.reduce((s, q) => s + (q.marks ?? 1), 0),
  };
}

export async function listExams(query: z.infer<typeof scholarshipListQuery>) {
  const page = Number(query.page || 1);
  const limit = Math.min(100, Number(query.limit || 20));
  const filter: Record<string, unknown> = {};
  if (query.active === "true") filter.active = true;
  if (query.active === "false") filter.active = false;
  if (query.search) filter.title = { $regex: query.search, $options: "i" };

  const [items, total] = await Promise.all([
    ScholarshipExam.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    ScholarshipExam.countDocuments(filter),
  ]);

  return {
    items: items.map((e) => ({ ...e, ...examMeta(e) })),
    meta: { currentPage: page, totalItems: total, limit, totalPages: Math.ceil(total / limit) || 1 },
  };
}

export async function getExam(id: string) {
  const exam = await ScholarshipExam.findById(id).lean();
  if (!exam) throw new NotFoundError("Exam not found");
  return { ...exam, ...examMeta(exam) };
}

export async function createExam(body: unknown) {
  const parsed = examBodySchema.parse(body);
  const questions = (parsed.questions ?? []).map((q) => normalizeQuestion(questionInputSchema.parse(q)));
  if (!questions.length) throw new ValidationError("Add at least one question");
  return ScholarshipExam.create({ ...parsed, active: parsed.active ?? false, questions });
}

export async function updateExam(id: string, body: unknown) {
  const parsed = examBodySchema.partial().parse(body);
  const update: Record<string, unknown> = { ...parsed };
  if (parsed.questions) {
    if (!parsed.questions.length) throw new ValidationError("Exam must have at least one question");
    update.questions = parsed.questions.map((q) => normalizeQuestion(questionInputSchema.parse(q)));
  }
  const exam = await ScholarshipExam.findByIdAndUpdate(id, update, { new: true }).lean();
  if (!exam) throw new NotFoundError("Exam not found");
  return { ...exam, ...examMeta(exam) };
}

export async function deleteExam(id: string) {
  const exam = await ScholarshipExam.findByIdAndDelete(id);
  if (!exam) throw new NotFoundError("Exam not found");
  return { deleted: true };
}

export async function setExamActive(id: string, active: boolean) {
  if (active) {
    await ScholarshipExam.updateMany({ _id: { $ne: id } }, { active: false });
  }
  const exam = await ScholarshipExam.findByIdAndUpdate(id, { active }, { new: true }).lean();
  if (!exam) throw new NotFoundError("Exam not found");
  return { ...exam, ...examMeta(exam) };
}

export async function listResults(examId: string, query: z.infer<typeof paginationQuery>) {
  const page = Number(query.page || 1);
  const limit = Math.min(100, Number(query.limit || 20));
  const filter = { exam: examId };
  const [items, total] = await Promise.all([
    ScholarshipResult.find(filter)
      .populate("student", "studentCode")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    ScholarshipResult.countDocuments(filter),
  ]);
  return {
    items,
    meta: { currentPage: page, totalItems: total, limit, totalPages: Math.ceil(total / limit) || 1 },
  };
}

export async function listAllResults(query: z.infer<typeof paginationQuery>) {
  const page = Number(query.page || 1);
  const limit = Math.min(100, Number(query.limit || 20));
  const [items, total] = await Promise.all([
    ScholarshipResult.find({})
      .populate("exam", "title slabs")
      .populate("student", "studentCode")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    ScholarshipResult.countDocuments({}),
  ]);
  return {
    items,
    meta: { currentPage: page, totalItems: total, limit, totalPages: Math.ceil(total / limit) || 1 },
  };
}

export { validateImportRows, type ImportRow };

export async function publicExam() {
  const exam = await ScholarshipExam.findOne({ active: true }).lean();
  if (!exam) throw new NotFoundError("No active scholarship exam");
  return publicExamShape(exam);
}

function publicExamShape(exam: {
  _id: unknown;
  title: string;
  minutes: number;
  questions: QuizQuestion[];
}) {
  const totalMarks = exam.questions.reduce((s, q) => s + (q.marks ?? 1), 0);
  return {
    id: exam._id,
    title: exam.title,
    minutes: exam.minutes,
    questionCount: exam.questions.length,
    totalMarks,
    questions: exam.questions.map((q, i) => ({
      id: String(i),
      type: q.type,
      prompt: q.prompt,
      options: q.options,
      marks: q.marks,
    })),
  };
}

export async function submitExam(input: {
  examId: string;
  name: string;
  phone: string;
  email?: string;
  studentCode?: string;
  answers: { index: number; value: string | number }[];
  timeTakenSeconds?: number;
}) {
  const exam = await ScholarshipExam.findById(input.examId);
  if (!exam || !exam.active) throw new NotFoundError("Exam not found");
  const result = gradeQuiz(exam.questions, input.answers, false);
  const slab = pickScholarshipSlab(result.percent, exam.slabs);
  let couponCode: string | undefined;
  if (slab) {
    couponCode = `${slab.couponPrefix}${nanoid(4).toUpperCase()}`;
    await Coupon.create({
      code: couponCode,
      label: `Scholarship ${result.percent}%`,
      type: "percent",
      value: slab.couponPercent,
      active: true,
      maxRedemptions: 1,
    });
  }

  let studentId;
  if (input.studentCode) {
    const student = await Student.findOne({ studentCode: input.studentCode.trim() });
    if (student) studentId = student._id;
  }

  const saved = await ScholarshipResult.create({
    exam: exam._id,
    student: studentId,
    name: input.name.trim(),
    phone: input.phone.trim(),
    email: input.email?.trim(),
    score: result.score,
    percent: result.percent,
    correct: result.correct,
    wrong: result.wrong,
    skipped: result.skipped,
    timeTakenSeconds: input.timeTakenSeconds,
    couponCode,
  });

  return {
    ...result,
    couponCode,
    slab,
    passed: Boolean(slab),
    resultId: saved._id,
    timeTakenSeconds: input.timeTakenSeconds,
  };
}
