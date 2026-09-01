import { z } from "zod";
import { NotFoundError, ValidationError } from "../../utils/errors.ts";
import { paginationQuery } from "../../utils/pagination.ts";
import { GalleryAlbum, GalleryMedia } from "../../models/index.ts";
import type { CloudinaryAsset } from "../../types/common.ts";
import { cache } from "../../services/cache.service.ts";
import { CACHE_KEYS } from "../../constants/cache.ts";

export function parseYoutubeUrl(url: string): string | null {
  try {
    const raw = url.trim();
    if (!raw) return null;
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = u.pathname.split("/").filter(Boolean)[0];
      return id && id.length >= 6 ? id : null;
    }
    if (host === "youtube.com" || host === "m.youtube.com") {
      const v = u.searchParams.get("v");
      if (v && v.length >= 6) return v;
      const fromPath = u.pathname.match(/\/(?:live|embed|shorts)\/([^/?]+)/);
      if (fromPath?.[1]) return fromPath[1];
    }
    return null;
  } catch {
    return null;
  }
}

const assetSchema = z.object({
  publicId: z.string().optional(),
  url: z.string().url(),
  resourceType: z.string().optional(),
  format: z.string().optional(),
});

const albumBodySchema = z.object({
  title: z.string().min(2),
  kind: z.enum(["photo", "video"]),
  category: z.string().optional(),
  youtubeUrl: z.string().optional(),
  cover: assetSchema.optional(),
  photos: z.array(assetSchema).optional(),
  published: z.boolean().optional(),
  sortOrder: z.coerce.number().optional(),
});

export const galleryListQuery = paginationQuery.extend({
  kind: z.enum(["photo", "video"]).optional(),
});

export async function listAlbums(query: z.infer<typeof galleryListQuery>) {
  const page = Number(query.page || 1);
  const limit = Math.min(100, Number(query.limit || 20));
  const filter: Record<string, unknown> = {};
  if (query.kind === "photo") filter.$or = [{ kind: "photo" }, { kind: { $exists: false } }];
  else if (query.kind === "video") filter.kind = "video";
  if (query.search) filter.title = { $regex: query.search, $options: "i" };

  const [items, total] = await Promise.all([
    GalleryAlbum.find(filter).sort({ sortOrder: 1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    GalleryAlbum.countDocuments(filter),
  ]);

  const photoIds = items.filter((a) => a.kind !== "video").map((a) => a._id);
  const media = photoIds.length
    ? await GalleryMedia.find({ album: { $in: photoIds } }).lean()
    : [];

  const enriched = items.map((item) => {
    if (item.kind === "video") {
      return { ...item, youtubeId: item.youtubeUrl ? parseYoutubeUrl(item.youtubeUrl) : null };
    }
    const photos = media.filter((m) => String(m.album) === String(item._id));
    return { ...item, photos, photoCount: photos.length };
  });

  return {
    items: enriched,
    meta: { currentPage: page, totalItems: total, limit, totalPages: Math.ceil(total / limit) || 1 },
  };
}

export async function getAlbum(id: string) {
  const album = await GalleryAlbum.findById(id).lean();
  if (!album) throw new NotFoundError("Gallery item not found");
  if (album.kind === "video") {
    return { ...album, youtubeId: album.youtubeUrl ? parseYoutubeUrl(album.youtubeUrl) : null };
  }
  const photos = await GalleryMedia.find({ album: id }).lean();
  return { ...album, photos, photoCount: photos.length };
}

async function syncPhotos(albumId: string, photos: CloudinaryAsset[]) {
  await GalleryMedia.deleteMany({ album: albumId });
  if (!photos.length) return;
  await GalleryMedia.insertMany(
    photos.map((asset) => ({ album: albumId, asset, caption: "" })),
  );
}

async function bumpCache() {
  await cache.del(CACHE_KEYS.gallery);
}

function validateBody(parsed: z.infer<typeof albumBodySchema>) {
  if (parsed.kind === "video") {
    const url = (parsed.youtubeUrl ?? "").trim();
    if (!url) throw new ValidationError("YouTube link is required for video items");
    if (!parseYoutubeUrl(url)) throw new ValidationError("Enter a valid YouTube video link (youtube.com or youtu.be)");
    return { ...parsed, youtubeUrl: url, cover: undefined, photos: [] as CloudinaryAsset[] };
  }
  if (!parsed.cover?.url) throw new ValidationError("Cover photo is required for photo albums");
  return parsed;
}

export async function createAlbum(body: unknown) {
  const parsed = validateBody(albumBodySchema.parse(body));
  const album = await GalleryAlbum.create({
    title: parsed.title,
    kind: parsed.kind,
    category: parsed.category,
    youtubeUrl: parsed.youtubeUrl,
    cover: parsed.kind === "photo" ? parsed.cover : undefined,
    published: parsed.published ?? true,
    sortOrder: parsed.sortOrder ?? 0,
  });
  if (parsed.kind === "photo" && parsed.photos?.length) {
    await syncPhotos(String(album._id), parsed.photos as CloudinaryAsset[]);
  }
  await bumpCache();
  return getAlbum(String(album._id));
}

export async function updateAlbum(id: string, body: unknown) {
  const existing = await GalleryAlbum.findById(id);
  if (!existing) throw new NotFoundError("Gallery item not found");
  const parsed = validateBody(
    albumBodySchema.parse({ ...existing.toObject(), ...(body as Record<string, unknown>) }),
  );
  existing.title = parsed.title;
  existing.kind = parsed.kind;
  existing.category = parsed.category;
  existing.youtubeUrl = parsed.kind === "video" ? parsed.youtubeUrl : undefined;
  existing.cover = parsed.kind === "photo" ? (parsed.cover as CloudinaryAsset) : undefined;
  existing.published = parsed.published ?? existing.published;
  if (parsed.sortOrder != null) existing.sortOrder = parsed.sortOrder;
  await existing.save();
  if (parsed.kind === "photo") {
    await syncPhotos(id, (parsed.photos ?? []) as CloudinaryAsset[]);
  } else {
    await GalleryMedia.deleteMany({ album: id });
  }
  await bumpCache();
  return getAlbum(id);
}

export async function deleteAlbum(id: string) {
  const album = await GalleryAlbum.findByIdAndDelete(id);
  if (!album) throw new NotFoundError("Gallery item not found");
  await GalleryMedia.deleteMany({ album: id });
  await bumpCache();
  return { deleted: true };
}

export async function publicGalleryItems() {
  const albums = await GalleryAlbum.find({ published: true }).sort({ sortOrder: 1 }).lean();
  const photoIds = albums.filter((a) => a.kind !== "video").map((a) => a._id);
  const media = photoIds.length
    ? await GalleryMedia.find({ album: { $in: photoIds } }).lean()
    : [];

  return albums.map((item) => {
    if (item.kind === "video") {
      return {
        ...item,
        kind: "video" as const,
        youtubeId: item.youtubeUrl ? parseYoutubeUrl(item.youtubeUrl) : null,
      };
    }
    return {
      ...item,
      kind: "photo" as const,
      photos: media.filter((m) => String(m.album) === String(item._id)),
    };
  });
}
