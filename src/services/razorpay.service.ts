import crypto from "node:crypto";
import Razorpay from "razorpay";
import { env } from "../config/env.ts";
import { redis } from "../config/redis.ts";
import { BadRequestError } from "../utils/errors.ts";

export const razorpay = new Razorpay({
  key_id: env.RAZORPAY_KEY_ID,
  key_secret: env.RAZORPAY_KEY_SECRET,
});

export function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string) {
  const expected = crypto
    .createHmac("sha256", env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  if (!ok) throw new BadRequestError("Invalid Razorpay signature");
}

export function verifyWebhookSignature(rawBody: string, signature: string) {
  const expected = crypto
    .createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");
  const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  if (!ok) throw new BadRequestError("Invalid webhook signature");
}

export async function claimWebhookEvent(eventId: string) {
  const key = `razorpay:webhook:${eventId}`;
  const set = await redis.set(key, "1", "EX", 60 * 60 * 24 * 7, "NX");
  return set === "OK";
}

export async function createOrder(amountPaise: number, receipt: string, notes: Record<string, string>) {
  return razorpay.orders.create({
    amount: amountPaise,
    currency: "INR",
    receipt,
    notes,
  });
}
