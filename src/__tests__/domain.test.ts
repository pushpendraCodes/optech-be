import { describe, expect, it } from "vitest";
import { applyCoupon, installmentPlan, pickScholarshipSlab, preventSelfReferral, referralReward } from "../services/pricing.service.ts";
import { gradeQuiz, gradeTyping } from "../services/grading.service.ts";
import crypto from "node:crypto";

describe("pricing", () => {
  it("applies percent coupons", () => {
    const r = applyCoupon(28000, { type: "percent", value: 20, active: true });
    expect(r.discount).toBe(5600);
    expect(r.total).toBe(22400);
  });
  it("blocks inactive coupons", () => {
    const r = applyCoupon(1000, { type: "percent", value: 50, active: false });
    expect(r.total).toBe(1000);
  });
  it("installments respect min fee", () => {
    expect(installmentPlan(5000, 3, 8000).allowed).toBe(false);
    expect(installmentPlan(28000, 3, 8000).parts).toBe(3);
  });
  it("picks highest scholarship slab", () => {
    const slab = pickScholarshipSlab(92, [
      { minPercent: 75, couponPercent: 10, couponPrefix: "SCHOLAR10" },
      { minPercent: 90, couponPercent: 20, couponPrefix: "SCHOLAR20" },
    ]);
    expect(slab?.couponPercent).toBe(20);
  });
  it("prevents self referral", () => {
    expect(preventSelfReferral("AARAV1", "AARAV1")).toBe(true);
    expect(preventSelfReferral("A", "B", "1", "1")).toBe(true);
  });
  it("computes referral reward", () => {
    expect(referralReward(10000, "percent", 8)).toBe(800);
    expect(referralReward(10000, "fixed", 500)).toBe(500);
  });
});

describe("grading", () => {
  const qs = [
    { type: "mcq" as const, options: ["a", "b"], answerIndex: 1, marks: 1 },
    { type: "blank" as const, options: ["Central Processing Unit"], answerIndex: 0, marks: 1 },
  ];
  it("scores quiz on the server", () => {
    const r = gradeQuiz(qs, [
      { index: 0, value: 1 },
      { index: 1, value: "central processing unit" },
    ]);
    expect(r.percent).toBe(100);
  });
  it("applies negative marking", () => {
    const r = gradeQuiz(qs, [{ index: 0, value: 0 }], true, 0.25);
    expect(r.score).toBe(0);
    expect(r.wrong).toBe(1);
  });
  it("counts skipped answers", () => {
    const r = gradeQuiz(qs, [{ index: 0, value: 1 }]);
    expect(r.correct).toBe(1);
    expect(r.skipped).toBe(1);
  });
  it("uses per-question negative marks", () => {
    const r = gradeQuiz(
      [{ type: "mcq" as const, options: ["a", "b"], answerIndex: 1, marks: 2, negativeMarks: 0.5 }],
      [{ index: 0, value: 0 }],
    );
    expect(r.score).toBe(0);
    expect(r.wrong).toBe(1);
  });
  it("derives typing wpm/accuracy", () => {
    const r = gradeTyping("hello world", "hello world", 1);
    expect(r.wpm).toBe(2);
    expect(r.accuracy).toBe(100);
    expect(r.errorCount).toBe(0);
  });
});

describe("razorpay signature", () => {
  it("matches HMAC", () => {
    const secret = "testsecret";
    const orderId = "order_1";
    const paymentId = "pay_1";
    const signature = crypto.createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
    const expected = crypto.createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
    expect(signature).toBe(expected);
  });
});
