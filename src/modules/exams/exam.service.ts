import { z } from "zod";
import { Types } from "mongoose";
import { NotFoundError, ValidationError } from "../../utils/errors.ts";
import { objectId, paginationQuery } from "../../utils/pagination.ts";
import { Exam, QuestionBank, type QuizQuestion } from "../../models/index.ts";
import { notifyStudents } from "../../services/notification.service.ts";
import { questionInputSchema } from "../quizzes/quiz.service.ts";

export const examListQuery = paginationQuery.extend({
  course: objectId.optional(),
  open: z.enum(["true", "false"]).optional(),
});

const examBodySchema = z.object({
  title: z.string().min(2),
  description: z.string().optional(),
  course: objectId,
  subject: z.string().optional(),
  minutes: z.number().min(1),
  passing: z.number().min(0).max(100),
  negative: z.boolean().optional(),
  negativeValue: z.number().min(0).optional(),
  scheduledAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
  open: z.boolean().optional(),
  questions: z.array(questionInputSchema).optional(),
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
    bankId: raw.bankId ? new Types.ObjectId(raw.bankId) : undefined,
  };
}

function examMeta(exam: { questions?: QuizQuestion[] }) {
  const questions = exam.questions ?? [];
  return {
    questionCount: questions.length,
    totalMarks: questions.reduce((s, q) => s + (q.marks ?? 1), 0),
  };
}

export async function listExams(query: z.infer<typeof paginationQuery> & { course?: string; open?: string }) {
  const page = Number(query.page || 1);
  const limit = Math.min(100, Number(query.limit || 20));
  const filter: Record<string, unknown> = {};
  if (query.course) filter.course = query.course;
  if (query.open === "true") filter.open = true;
  if (query.open === "false") filter.open = false;
  if (query.search) filter.title = { $regex: query.search, $options: "i" };

  const [items, total] = await Promise.all([
    Exam.find(filter)
      .populate("course", "title slug")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Exam.countDocuments(filter),
  ]);

  return {
    items: items.map((q) => ({ ...q, ...examMeta(q) })),
    meta: { currentPage: page, totalItems: total, limit, totalPages: Math.ceil(total / limit) || 1 },
  };
}

export async function getExam(id: string) {
  const exam = await Exam.findById(id).populate("course", "title slug").lean();
  if (!exam) throw new NotFoundError("Exam not found");
  return { ...exam, ...examMeta(exam) };
}

export async function createExam(body: unknown) {
  const parsed = examBodySchema.parse(body);
  const questions = (parsed.questions ?? []).map((q) => normalizeQuestion(questionInputSchema.parse(q)));
  const exam = await Exam.create({ ...parsed, open: parsed.open ?? false, questions });
  if (exam.open) {
    await notifyStudents({
      type: "exam",
      title: `New exam: ${exam.title}`,
      body: exam.description || "Open Exams in your student portal to start.",
      audience: "COURSE",
      course: String(exam.course),
    });
  }
  return exam;
}

export async function updateExam(id: string, body: unknown) {
  const parsed = examBodySchema.partial().parse(body);
  const update: Record<string, unknown> = { ...parsed };
  if (parsed.questions) {
    update.questions = parsed.questions.map((q) => normalizeQuestion(questionInputSchema.parse(q)));
  }
  const exam = await Exam.findByIdAndUpdate(id, update, { new: true }).populate("course", "title slug").lean();
  if (!exam) throw new NotFoundError("Exam not found");
  return { ...exam, ...examMeta(exam) };
}

export async function deleteExam(id: string) {
  const exam = await Exam.findByIdAndDelete(id);
  if (!exam) throw new NotFoundError("Exam not found");
  return { deleted: true };
}

export async function setExamPublished(id: string, open: boolean) {
  const exam = await Exam.findByIdAndUpdate(id, { open }, { new: true }).populate("course", "title slug").lean();
  if (!exam) throw new NotFoundError("Exam not found");
  if (open) {
    await notifyStudents({
      type: "exam",
      title: `New exam: ${exam.title}`,
      body: exam.description || "Open Exams in your student portal to start.",
      audience: "COURSE",
      course: String(exam.course),
    });
  }
  return { ...exam, ...examMeta(exam) };
}

export async function addQuestionsFromBank(examId: string, bankIds: string[]) {
  if (!bankIds.length) throw new ValidationError("Select at least one question");
  const [exam, bankRows] = await Promise.all([
    Exam.findById(examId),
    QuestionBank.find({ _id: { $in: bankIds }, active: true }),
  ]);
  if (!exam) throw new NotFoundError("Exam not found");
  if (!bankRows.length) throw new ValidationError("No valid questions found in bank");

  exam.questions.push(
    ...bankRows.map((b) => ({
      type: b.type,
      prompt: b.prompt,
      options: b.options,
      answerIndex: b.answerIndex,
      marks: b.marks,
      negativeMarks: b.negativeMarks,
      difficulty: b.difficulty,
      explanation: b.explanation,
      topic: b.topic,
      tags: b.tags,
      bankId: b._id,
    })),
  );
  await exam.save();
  const lean = exam.toObject();
  return { ...lean, ...examMeta(lean) };
}
