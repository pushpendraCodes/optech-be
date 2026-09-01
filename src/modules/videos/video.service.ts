import { z } from "zod";
import { Video } from "../../models/index.ts";
import { cache } from "../../services/cache.service.ts";
import { CACHE_KEYS } from "../../constants/cache.ts";
import { NotFoundError, ValidationError } from "../../utils/errors.ts";
import { parseYoutubeUrl } from "../gallery/gallery.service.ts";

const boolField = z.preprocess((value) => {
  if (value === "true" || value === "on" || value === 1 || value === "1") return true;
  if (value === "false" || value === "off" || value === 0 || value === "0") return false;
  return value;
}, z.boolean().optional());

const videoBodySchema = z.object({
  title: z.string().min(2),
  description: z.string().optional(),
  youtubeUrl: z.string().url(),
  category: z.string().optional(),
  featured: boolField,
  published: boolField,
  sortOrder: z.coerce.number().optional(),
});

function parseBody(body: unknown) {
  const parsed = videoBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid video", parsed.error.issues);
  }
  const youtubeId = parseYoutubeUrl(parsed.data.youtubeUrl);
  if (!youtubeId) {
    throw new ValidationError("Enter a valid YouTube video link (youtube.com or youtu.be)");
  }
  return { ...parsed.data, youtubeId };
}

async function bumpCache() {
  await cache.del(CACHE_KEYS.videos);
}

export async function createVideo(body: unknown) {
  const parsed = parseBody(body);
  const row = await Video.create({
    ...parsed,
    featured: parsed.featured ?? false,
    published: parsed.published ?? true,
    sortOrder: parsed.sortOrder ?? 0,
  });
  await bumpCache();
  return row;
}

export async function updateVideo(id: string, body: unknown) {
  const existing = await Video.findById(id);
  if (!existing) throw new NotFoundError("Video not found");
  const parsed = parseBody({
    title: existing.title,
    description: existing.description,
    youtubeUrl: existing.youtubeUrl,
    category: existing.category,
    featured: existing.featured,
    published: existing.published,
    sortOrder: existing.sortOrder,
    ...(body as Record<string, unknown>),
  });
  existing.title = parsed.title;
  existing.description = parsed.description;
  existing.youtubeUrl = parsed.youtubeUrl;
  existing.youtubeId = parsed.youtubeId;
  existing.category = parsed.category;
  existing.featured = parsed.featured !== undefined ? parsed.featured : existing.featured;
  existing.published = parsed.published !== undefined ? parsed.published : existing.published;
  existing.sortOrder = parsed.sortOrder ?? existing.sortOrder;
  await existing.save();
  await bumpCache();
  return existing;
}

export async function deleteVideo(id: string) {
  const row = await Video.findByIdAndDelete(id);
  if (!row) throw new NotFoundError("Video not found");
  await bumpCache();
  return { deleted: true };
}

export async function publicVideos() {
  return cache.remember(CACHE_KEYS.videos, 60, () =>
    Video.find({ published: true }).sort({ featured: -1, sortOrder: 1, createdAt: -1 }).lean(),
  );
}
