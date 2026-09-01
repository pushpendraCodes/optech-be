export type PaymentDiscountMeta = {
  listFee: number;
  discount: number;
  couponCode?: string;
  total: number;
};

export function parsePaymentNotes(raw?: string) {
  try {
    return JSON.parse(raw || "{}") as {
      name?: string;
      email?: string;
      phone?: string;
      fee?: number;
      discount?: number;
      total?: number;
      coupon?: string;
    };
  } catch {
    return {};
  }
}

export function extractPaymentDiscount(payment: {
  amount?: number;
  listFee?: number;
  discount?: number;
  couponCode?: string;
  notes?: string;
}): PaymentDiscountMeta {
  const notes = parsePaymentNotes(payment.notes);
  const listFee = Number(payment.listFee ?? notes.fee ?? payment.amount ?? 0);
  const discount = Number(payment.discount ?? notes.discount ?? 0);
  const couponCode = payment.couponCode || notes.coupon || undefined;
  const total = Number(payment.amount ?? notes.total ?? Math.max(0, listFee - discount));
  return { listFee, discount, couponCode, total };
}

export function normalizePhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export function paymentPhone(payment: { payerPhone?: string; notes?: string }) {
  if (payment.payerPhone?.trim()) return payment.payerPhone.trim();
  return parsePaymentNotes(payment.notes).phone?.trim() ?? "";
}
