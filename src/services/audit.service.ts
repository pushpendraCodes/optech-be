import { AuditLog } from "../models/index.ts";
import type { Types } from "mongoose";

const SENSITIVE = /password|token|secret|authorization/i;

function scrub(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE.test(k) ? "[redacted]" : v;
  }
  return out;
}

export async function writeAudit(input: {
  user?: Types.ObjectId;
  action: string;
  module: string;
  resourceId?: string;
  oldValue?: unknown;
  newValue?: unknown;
  ip?: string;
  userAgent?: string;
}) {
  await AuditLog.create({
    ...input,
    oldValue: scrub(input.oldValue),
    newValue: scrub(input.newValue),
  });
}
