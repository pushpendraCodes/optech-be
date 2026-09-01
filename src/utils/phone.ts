import { z } from "zod";

export function digitsOnlyPhone(value: string) {
  return value.replace(/\D/g, "").slice(0, 10);
}

export function isValidIndianMobile(phone: string) {
  return /^[6-9]\d{9}$/.test(digitsOnlyPhone(phone));
}

export function indianMobileMessage(phone: string) {
  const digits = digitsOnlyPhone(phone);
  if (!digits) return "Enter your mobile number.";
  if (digits.length !== 10) return "Mobile number must be exactly 10 digits.";
  if (!/^[6-9]/.test(digits)) return "Enter a valid 10-digit mobile number starting with 6–9.";
  return null;
}

export const indianMobileSchema = z
  .string()
  .min(1, "Enter your mobile number.")
  .transform((value) => digitsOnlyPhone(value))
  .refine((value) => value.length === 10, "Mobile number must be exactly 10 digits.")
  .refine((value) => /^[6-9]/.test(value), "Enter a valid 10-digit mobile number starting with 6–9.");

export const optionalIndianMobileSchema = z
  .string()
  .optional()
  .superRefine((value, ctx) => {
    if (!value?.trim()) return;
    const message = indianMobileMessage(value);
    if (message) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  })
  .transform((value) => (value?.trim() ? digitsOnlyPhone(value) : undefined));
