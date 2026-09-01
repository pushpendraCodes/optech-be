export type GradeQuestion = {
  type: "mcq" | "tf" | "blank";
  options: string[];
  answerIndex: number;
  marks: number;
  negativeMarks?: number;
};

export type GradeAnswer = { questionId?: string; index?: number; value: string | number };

export function gradeQuiz(
  questions: GradeQuestion[],
  answers: GradeAnswer[],
  negative = false,
  negativeValue = 0.25,
) {
  let score = 0;
  let max = 0;
  let correct = 0;
  let wrong = 0;
  let skipped = 0;

  questions.forEach((q, i) => {
    max += q.marks;
    const ans = answers.find((a) => a.index === i || a.questionId === String(i));
    const empty =
      ans == null ||
      ans.value === "" ||
      ans.value === -1 ||
      (typeof ans.value === "number" && Number.isNaN(ans.value));
    if (empty) {
      skipped += 1;
      return;
    }
    const isCorrect =
      q.type === "blank"
        ? String(ans.value).trim().toLowerCase() === String(q.options[q.answerIndex] ?? "").trim().toLowerCase()
        : Number(ans.value) === q.answerIndex;
    if (isCorrect) {
      score += q.marks;
      correct += 1;
    } else {
      wrong += 1;
      const neg = q.negativeMarks != null && q.negativeMarks > 0 ? q.negativeMarks : negative ? negativeValue : 0;
      if (neg > 0) score -= neg;
    }
  });

  score = Math.max(0, score);
  const percent = max ? Math.round((score / max) * 100) : 0;
  return { score, max, percent, correct, wrong, skipped };
}

export function gradeTyping(source: string, typed: string, minutes: number) {
  const src = source.trim();
  const out = typed;
  let errors = 0;
  const len = Math.max(src.length, out.length);
  for (let i = 0; i < len; i++) {
    if (src[i] !== out[i]) errors++;
  }
  const correct = Math.max(0, out.length - errors);
  const words = out.trim().split(/\s+/).filter(Boolean).length;
  const wpm = minutes > 0 ? Math.round(words / minutes) : 0;
  const accuracy = out.length ? Math.round((correct / out.length) * 100) : 0;
  return { wpm, accuracy, errorCount: errors };
}
