import { z } from "zod";
import { Alumni } from "../../models/index.js";
import { cache } from "../../services/cache.service.js";
import { CACHE_KEYS } from "../../constants/cache.js";
import { NotFoundError, ValidationError } from "../../utils/errors.js";
import type { CloudinaryAsset } from "../../types/common.js";

const assetSchema = z.object({
  publicId: z.string().optional(),
  url: z.string().url(),
  resourceType: z.string().optional(),
  format: z.string().optional(),
});

const alumniBodySchema = z.object({
  name: z.string().min(2),
  batchYear: z.string().min(2),
  role: z.string().optional(),
  story: z.string().optional(),
  photo: assetSchema.optional().nullable(),
  featured: z.boolean().optional(),
  published: z.boolean().optional(),
});

function parseBody(body: unknown) {
  const parsed = alumniBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid alumni profile", parsed.error.issues);
  }
  return parsed.data;
}

async function bumpCache() {
  await cache.del(CACHE_KEYS.alumni);
}

export async function createAlumni(body: unknown) {
  const parsed = parseBody(body);
  if (!parsed.photo?.url) throw new ValidationError("Upload an alumni photo");
  const row = await Alumni.create({
    ...parsed,
    photo: parsed.photo as CloudinaryAsset,
    featured: parsed.featured ?? false,
    published: parsed.published ?? true,
  });
  await bumpCache();
  return row;
}

export async function updateAlumni(id: string, body: unknown) {
  const existing = await Alumni.findById(id);
  if (!existing) throw new NotFoundError("Alumni not found");
  const parsed = parseBody({
    name: existing.name,
    batchYear: existing.batchYear,
    role: existing.role,
    story: existing.story,
    photo: existing.photo,
    featured: existing.featured,
    published: existing.published,
    ...(body as Record<string, unknown>),
  });
  if (!parsed.photo?.url) throw new ValidationError("Upload an alumni photo");
  existing.name = parsed.name;
  existing.batchYear = parsed.batchYear;
  existing.role = parsed.role;
  existing.story = parsed.story;
  existing.photo = parsed.photo as CloudinaryAsset;
  existing.featured = parsed.featured ?? existing.featured;
  existing.published = parsed.published ?? existing.published;
  await existing.save();
  await bumpCache();
  return existing;
}

export async function deleteAlumni(id: string) {
  const row = await Alumni.findByIdAndDelete(id);
  if (!row) throw new NotFoundError("Alumni not found");
  await bumpCache();
  return { deleted: true };
}
