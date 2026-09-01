import { z } from "zod";
import { Types } from "mongoose";
import { NotFoundError, ValidationError } from "../../utils/errors.js";
import { objectId, paginationQuery } from "../../utils/pagination.js";
import { Course, QuestionBank, Quiz, type QuizQuestion } from "../../models/index.js";
import { notifyStudents } from "../../services/notification.service.js";

export const questionBankQuery = paginationQuery.extend({
  course: objectId.optional(),
  subject: z.string().trim().optional(),
  topic: z.string().trim().optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
});

export const quizListQuery = paginationQuery.extend({
  course: objectId.optional(),
  open: z.enum(["true", "false"]).optional(),
});

const difficultyEnum = z.enum(["easy", "medium", "hard"]);

export const questionInputSchema = z.object({
  type: z.enum(["mcq", "tf", "blank"]).default("mcq"),
  prompt: z.string().min(1, "Question is required"),
  options: z.array(z.string().min(1)).min(2, "At least 2 options required").max(6),
  answerIndex: z.number().int().min(0),
  marks: z.number().min(0).default(1),
  negativeMarks: z.number().min(0).default(0),
  difficulty: difficultyEnum.default("medium"),
  explanation: z.string().optional(),
  topic: z.string().optional(),
  tags: z.array(z.string()).optional(),
  bankId: objectId.optional(),
});

const quizBodySchema = z.object({
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

export type ImportRow = {
  row: number;
  question?: string;
  option_a?: string;
  option_b?: string;
  option_c?: string;
  option_d?: string;
  correct_answer?: string;
  marks?: string | number;
  negative_marks?: string | number;
  difficulty?: string;
  explanation?: string;
  topic?: string;
  tags?: string;
};

export type ValidatedImportRow = {
  row: number;
  valid: boolean;
  errors: string[];
  data?: z.infer<typeof questionInputSchema> & { topic?: string; tags?: string[] };
};

const CORRECT_MAP: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, "0": 0, "1": 1, "2": 2, "3": 3 };

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

function quizMeta(quiz: { questions?: QuizQuestion[] }) {
  const questions = quiz.questions ?? [];
  return {
    questionCount: questions.length,
    totalMarks: questions.reduce((s, q) => s + (q.marks ?? 1), 0),
  };
}

export function parseCorrectAnswer(raw: string | undefined, optionCount: number): number | null {
  if (raw == null || String(raw).trim() === "") return null;
  const key = String(raw).trim().toUpperCase();
  if (key in CORRECT_MAP) {
    const idx = CORRECT_MAP[key];
    return idx < optionCount ? idx : null;
  }
  const n = Number(raw);
  if (Number.isInteger(n) && n >= 0 && n < optionCount) return n;
  return null;
}

export function validateImportRow(row: ImportRow): ValidatedImportRow {
  const errors: string[] = [];
  const prompt = String(row.question ?? "").trim();
  if (!prompt) errors.push("question is required");

  const options = [
    String(row.option_a ?? "").trim(),
    String(row.option_b ?? "").trim(),
    String(row.option_c ?? "").trim(),
    String(row.option_d ?? "").trim(),
  ].filter(Boolean);

  if (options.length < 2) errors.push("At least option_a and option_b are required");

  const answerIndex = parseCorrectAnswer(row.correct_answer, options.length);
  if (answerIndex == null) errors.push("correct_answer must be A, B, C, D or 0–3");

  const marks = row.marks === "" || row.marks == null ? 1 : Number(row.marks);
  if (!Number.isFinite(marks) || marks < 0) errors.push("marks must be a non-negative number");

  const negativeMarks =
    row.negative_marks === "" || row.negative_marks == null ? 0 : Number(row.negative_marks);
  if (!Number.isFinite(negativeMarks) || negativeMarks < 0) errors.push("negative_marks must be a non-negative number");

  const diffRaw = String(row.difficulty ?? "medium").trim().toLowerCase();
  const difficulty = diffRaw === "easy" || diffRaw === "medium" || diffRaw === "hard" ? diffRaw : null;
  if (!difficulty) errors.push("difficulty must be Easy, Medium, or Hard");

  const tags = String(row.tags ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  if (errors.length) return { row: row.row, valid: false, errors };

  const parsed = questionInputSchema.safeParse({
    type: "mcq",
    prompt,
    options,
    answerIndex: answerIndex!,
    marks,
    negativeMarks,
    difficulty,
    explanation: String(row.explanation ?? "").trim() || undefined,
    topic: String(row.topic ?? "").trim() || undefined,
    tags,
  });

  if (!parsed.success) {
    return { row: row.row, valid: false, errors: parsed.error.issues.map((i) => i.message) };
  }

  return {
    row: row.row,
    valid: true,
    errors: [],
    data: { ...parsed.data, topic: parsed.data.topic, tags: parsed.data.tags },
  };
}

export function validateImportRows(rows: ImportRow[]) {
  const results = rows.map(validateImportRow);
  return {
    valid: results.filter((r) => r.valid),
    invalid: results.filter((r) => !r.valid),
    summary: { total: results.length, validCount: results.filter((r) => r.valid).length, invalidCount: results.filter((r) => !r.valid).length },
  };
}

export async function listQuizzes(query: z.infer<typeof paginationQuery> & { course?: string; open?: string }) {
  const page = Number(query.page || 1);
  const limit = Math.min(100, Number(query.limit || 20));
  const filter: Record<string, unknown> = {};
  if (query.course) filter.course = query.course;
  if (query.open === "true") filter.open = true;
  if (query.open === "false") filter.open = false;
  if (query.search) filter.title = { $regex: query.search, $options: "i" };

  const [items, total] = await Promise.all([
    Quiz.find(filter)
      .populate("course", "title slug")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Quiz.countDocuments(filter),
  ]);

  const enriched = items.map((q) => ({ ...q, ...quizMeta(q) }));
  return {
    items: enriched,
    meta: { currentPage: page, totalItems: total, limit, totalPages: Math.ceil(total / limit) || 1 },
  };
}

export async function getQuiz(id: string) {
  const quiz = await Quiz.findById(id).populate("course", "title slug").lean();
  if (!quiz) throw new NotFoundError("Quiz not found");
  return { ...quiz, ...quizMeta(quiz) };
}

export async function createQuiz(body: unknown) {
  const parsed = quizBodySchema.parse(body);
  const questions = (parsed.questions ?? []).map((q) => normalizeQuestion(questionInputSchema.parse(q)));
  const quiz = await Quiz.create({ ...parsed, open: parsed.open ?? false, questions });
  if (quiz.open) {
    await notifyStudents({
      type: "exam",
      title: `New quiz: ${quiz.title}`,
      body: quiz.description || "Open Quizzes in your student portal to start.",
      audience: "COURSE",
      course: String(quiz.course),
    });
  }
  return quiz;
}

export async function updateQuiz(id: string, body: unknown) {
  const parsed = quizBodySchema.partial().parse(body);
  const update: Record<string, unknown> = { ...parsed };
  if (parsed.questions) {
    update.questions = parsed.questions.map((q) => normalizeQuestion(questionInputSchema.parse(q)));
  }
  const quiz = await Quiz.findByIdAndUpdate(id, update, { new: true }).populate("course", "title slug").lean();
  if (!quiz) throw new NotFoundError("Quiz not found");
  return { ...quiz, ...quizMeta(quiz) };
}

export async function deleteQuiz(id: string) {
  const quiz = await Quiz.findByIdAndDelete(id);
  if (!quiz) throw new NotFoundError("Quiz not found");
  return { deleted: true };
}

export async function setQuizPublished(id: string, open: boolean) {
  const quiz = await Quiz.findByIdAndUpdate(id, { open }, { new: true }).populate("course", "title slug").lean();
  if (!quiz) throw new NotFoundError("Quiz not found");
  if (open) {
    await notifyStudents({
      type: "exam",
      title: `New quiz: ${quiz.title}`,
      body: quiz.description || "Open Quizzes in your student portal to start.",
      audience: "COURSE",
      course: String(quiz.course),
    });
  }
  return { ...quiz, ...quizMeta(quiz) };
}

export async function addQuestionsFromBank(quizId: string, bankIds: string[]) {
  if (!bankIds.length) throw new ValidationError("Select at least one question");
  const [quiz, bankRows] = await Promise.all([
    Quiz.findById(quizId),
    QuestionBank.find({ _id: { $in: bankIds }, active: true }),
  ]);
  if (!quiz) throw new NotFoundError("Quiz not found");
  if (!bankRows.length) throw new ValidationError("No valid questions found in bank");

  const newQuestions: QuizQuestion[] = bankRows.map((b) => ({
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
  }));

  quiz.questions.push(...newQuestions);
  await quiz.save();
  const lean = quiz.toObject();
  return { ...lean, ...quizMeta(lean) };
}

const bankBodySchema = questionInputSchema.extend({
  course: objectId.optional(),
  subject: z.string().optional(),
  active: z.boolean().optional(),
});

export async function listQuestionBank(
  query: z.infer<typeof paginationQuery> & { course?: string; subject?: string; topic?: string; difficulty?: string },
) {
  const page = Number(query.page || 1);
  const limit = Math.min(100, Number(query.limit || 20));
  const filter: Record<string, unknown> = { active: true };
  if (query.course) filter.course = query.course;
  if (query.subject) filter.subject = { $regex: query.subject, $options: "i" };
  if (query.topic) filter.topic = { $regex: query.topic, $options: "i" };
  if (query.difficulty) filter.difficulty = query.difficulty;
  if (query.search) {
    filter.$or = [
      { prompt: { $regex: query.search, $options: "i" } },
      { topic: { $regex: query.search, $options: "i" } },
      { tags: { $regex: query.search, $options: "i" } },
    ];
  }

  const [items, total] = await Promise.all([
    QuestionBank.find(filter)
      .populate("course", "title slug")
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    QuestionBank.countDocuments(filter),
  ]);

  return {
    items,
    meta: { currentPage: page, totalItems: total, limit, totalPages: Math.ceil(total / limit) || 1 },
  };
}

export async function createBankQuestion(body: unknown) {
  const parsed = bankBodySchema.parse(body);
  const q = normalizeQuestion(parsed);
  return QuestionBank.create({
    course: parsed.course,
    subject: parsed.subject,
    topic: q.topic,
    tags: q.tags ?? [],
    type: q.type,
    prompt: q.prompt,
    options: q.options,
    answerIndex: q.answerIndex,
    marks: q.marks,
    negativeMarks: q.negativeMarks ?? 0,
    difficulty: q.difficulty ?? "medium",
    explanation: q.explanation,
    active: parsed.active ?? true,
  });
}

export async function updateBankQuestion(id: string, body: unknown) {
  const parsed = bankBodySchema.partial().parse(body);
  const update: Record<string, unknown> = { ...parsed };
  if (parsed.prompt || parsed.options || parsed.answerIndex != null) {
    const merged = questionInputSchema.parse({ type: "mcq", marks: 1, negativeMarks: 0, difficulty: "medium", options: ["", ""], answerIndex: 0, ...parsed });
    const q = normalizeQuestion(merged);
    Object.assign(update, {
      type: q.type,
      prompt: q.prompt,
      options: q.options,
      answerIndex: q.answerIndex,
      marks: q.marks,
      negativeMarks: q.negativeMarks,
      difficulty: q.difficulty,
      explanation: q.explanation,
      topic: q.topic,
      tags: q.tags,
    });
  }
  const row = await QuestionBank.findByIdAndUpdate(id, update, { new: true });
  if (!row) throw new NotFoundError("Question not found");
  return row;
}

export async function deleteBankQuestion(id: string) {
  const row = await QuestionBank.findByIdAndUpdate(id, { active: false }, { new: true });
  if (!row) throw new NotFoundError("Question not found");
  return { deleted: true };
}

export async function confirmImportToBank(
  rows: ValidatedImportRow[],
  meta: { course?: string; subject?: string },
) {
  const validRows = rows.filter((r) => r.valid && r.data);
  if (!validRows.length) throw new ValidationError("No valid rows to import");

  if (meta.course) {
    const course = await Course.findById(meta.course);
    if (!course) throw new ValidationError("Invalid course");
  }

  const docs = validRows.map((r) => {
    const q = normalizeQuestion(r.data!);
    return {
      course: meta.course,
      subject: meta.subject,
      topic: q.topic,
      tags: q.tags ?? [],
      type: q.type,
      prompt: q.prompt,
      options: q.options,
      answerIndex: q.answerIndex,
      marks: q.marks,
      negativeMarks: q.negativeMarks ?? 0,
      difficulty: q.difficulty ?? "medium",
      explanation: q.explanation,
      active: true,
    };
  });

  const inserted = await QuestionBank.insertMany(docs);
  return { imported: inserted.length };
}
