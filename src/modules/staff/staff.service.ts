import { z } from "zod";
import { Staff } from "../../models/index.ts";
import { cache } from "../../services/cache.service.ts";
import { CACHE_KEYS } from "../../constants/cache.ts";
import { NotFoundError, ValidationError } from "../../utils/errors.ts";
import type { CloudinaryAsset } from "../../types/common.ts";

const assetSchema = z.object({
  publicId: z.string().optional(),
  url: z.string().url(),
  resourceType: z.string().optional(),
  format: z.string().optional(),
});

const optionalUrl = z.preprocess(
  (v) => (typeof v === "string" && (!v.trim() || v.trim() === "#") ? undefined : v),
  z.string().url("Enter a full URL starting with https://").optional(),
);

const staffBodySchema = z.object({
  name: z.string().min(2),
  role: z.string().min(1),
  focus: z.string().optional(),
  bio: z.string().optional(),
  photo: assetSchema.optional().nullable(),
  linkedin: optionalUrl,
  twitter: optionalUrl,
  website: optionalUrl,
  published: z.boolean().optional(),
  sortOrder: z.coerce.number().optional(),
});

function parseBody(body: unknown) {
  const parsed = staffBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid staff profile", parsed.error.issues);
  }
  return parsed.data;
}

async function bumpCache() {
  await cache.del(CACHE_KEYS.staff);
}

export async function createStaff(body: unknown) {
  const parsed = parseBody(body);
  if (!parsed.photo?.url) throw new ValidationError("Upload a staff photo");
  const row = await Staff.create({
    ...parsed,
    photo: parsed.photo as CloudinaryAsset,
    published: parsed.published ?? true,
    sortOrder: parsed.sortOrder ?? 0,
  });
  await bumpCache();
  return row;
}

export async function updateStaff(id: string, body: unknown) {
  const existing = await Staff.findById(id);
  if (!existing) throw new NotFoundError("Staff not found");
  const parsed = parseBody({
    name: existing.name,
    role: existing.role,
    focus: existing.focus,
    bio: existing.bio,
    photo: existing.photo,
    linkedin: existing.linkedin,
    twitter: existing.twitter,
    website: existing.website,
    published: existing.published,
    sortOrder: existing.sortOrder,
    ...(body as Record<string, unknown>),
  });
  if (!parsed.photo?.url) throw new ValidationError("Upload a staff photo");
  existing.name = parsed.name;
  existing.role = parsed.role;
  existing.focus = parsed.focus;
  existing.bio = parsed.bio;
  existing.photo = parsed.photo as CloudinaryAsset;
  existing.linkedin = parsed.linkedin;
  existing.twitter = parsed.twitter;
  existing.website = parsed.website;
  existing.published = parsed.published ?? existing.published;
  if (parsed.sortOrder != null) existing.sortOrder = parsed.sortOrder;
  await existing.save();
  await bumpCache();
  return existing;
}

export async function deleteStaff(id: string) {
  const row = await Staff.findByIdAndDelete(id);
  if (!row) throw new NotFoundError("Staff not found");
  await bumpCache();
  return { deleted: true };
}
