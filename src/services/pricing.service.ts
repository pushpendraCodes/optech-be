export type CouponLike = {
  type: "percent" | "fixed";
  value: number;
  active?: boolean;
  startsAt?: Date | null;
  endsAt?: Date | null;
};

export type CalculatorInput = {
  fee: number;
  coupon?: CouponLike | null;
  installmentParts?: number;
  minFeeForEmi?: number;
};

export function applyCoupon(fee: number, coupon?: CouponLike | null) {
  if (!coupon) return { fee, discount: 0, total: fee };
  const now = new Date();
  if (coupon.active === false) return { fee, discount: 0, total: fee };
  if (coupon.startsAt && now < coupon.startsAt) return { fee, discount: 0, total: fee };
  if (coupon.endsAt && now > coupon.endsAt) return { fee, discount: 0, total: fee };
  const discount =
    coupon.type === "fixed" ? Math.min(fee, coupon.value) : Math.round((fee * coupon.value) / 100);
  return { fee, discount, total: Math.max(0, fee - discount) };
}

export function installmentPlan(total: number, parts: number, minFeeForEmi = 8000) {
  if (parts <= 1 || total < minFeeForEmi) {
    return { parts: 1, perInstallment: total, allowed: false };
  }
  const per = Math.ceil(total / parts);
  return { parts, perInstallment: per, allowed: true };
}

export function pickScholarshipSlab(
  percent: number,
  slabs: { minPercent: number; couponPercent: number; couponPrefix: string }[],
) {
  return [...slabs].sort((a, b) => b.minPercent - a.minPercent).find((s) => percent >= s.minPercent) ?? null;
}

export function referralReward(courseFee: number, type: "fixed" | "percent", value: number) {
  if (type === "fixed") return value;
  return Math.round((courseFee * value) / 100);
}

export function preventSelfReferral(referrerCode: string, refereeCode?: string, referrerPhone?: string, refereePhone?: string) {
  if (refereeCode && referrerCode === refereeCode) return true;
  if (referrerPhone && refereePhone && referrerPhone === refereePhone) return true;
  return false;
}
