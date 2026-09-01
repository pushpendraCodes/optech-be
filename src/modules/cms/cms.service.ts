import { CmsItem, Alumni, Job, Notice } from "../../models/index.ts";
import * as gallery from "../gallery/gallery.service.ts";
import { cache } from "../../services/cache.service.ts";
import { CACHE_KEYS } from "../../constants/cache.ts";

const TTL = 60;

function activeNow() {
  const now = new Date();
  return {
    active: true,
    $and: [
      { $or: [{ startsAt: { $exists: false } }, { startsAt: { $lte: now } }] },
      { $or: [{ endsAt: { $exists: false } }, { endsAt: { $gte: now } }] },
    ],
  };
}

async function bumpCmsCache() {
  await cache.del([CACHE_KEYS.marquee, CACHE_KEYS.banners, CACHE_KEYS.popups, CACHE_KEYS.links]);
}

/** Only one main popup can be active at a time. */
async function ensureSingleActivePopup(exceptId?: string) {
  const filter: Record<string, unknown> = { kind: "popup", active: true };
  if (exceptId) filter._id = { $ne: exceptId };
  await CmsItem.updateMany(filter, { $set: { active: false } });
}

export async function publicCms(kind: "marquee" | "ad" | "popup" | "link") {
  const key =
    kind === "marquee"
      ? CACHE_KEYS.marquee
      : kind === "ad"
        ? CACHE_KEYS.banners
        : kind === "popup"
          ? CACHE_KEYS.popups
          : CACHE_KEYS.links;

  return cache.remember(key, TTL, async () => {
    if (kind === "popup") {
      return CmsItem.find({ kind, ...activeNow() }).sort({ sortOrder: 1, updatedAt: -1 }).limit(1).lean();
    }
    return CmsItem.find({ kind, ...activeNow() }).sort({ sortOrder: 1 }).lean();
  });
}

export async function publicNotices() {
  return cache.remember(CACHE_KEYS.notices, TTL, () =>
    Notice.find({
      published: true,
      $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }],
    })
      .sort({ pinned: -1, createdAt: -1 })
      .lean(),
  );
}

export async function publicGallery() {
  return cache.remember(CACHE_KEYS.gallery, TTL, () => gallery.publicGalleryItems());
}

export async function publicAlumni() {
  return cache.remember(CACHE_KEYS.alumni, TTL, () =>
    Alumni.find({ published: true }).sort({ featured: -1, createdAt: -1 }).lean(),
  );
}

export async function publicJobs() {
  return cache.remember(CACHE_KEYS.jobs, TTL, () =>
    Job.find({ published: true }).populate("course", "title slug").sort({ createdAt: -1 }).lean(),
  );
}

export async function publicLive() {
  return [];
}

export async function saveCms(body: Record<string, unknown>) {
  const kind = String(body.kind ?? "");
  const makingActive = body.active !== false;

  if (kind === "popup" && makingActive) {
    await ensureSingleActivePopup(body.id ? String(body.id) : undefined);
  }

  const doc = body.id
    ? await CmsItem.findByIdAndUpdate(String(body.id), body, { new: true })
    : await CmsItem.create(body);
  await bumpCmsCache();
  return doc;
}

export async function updateCms(id: string, body: Record<string, unknown>) {
  const existing = await CmsItem.findById(id).lean();
  const kind = String(body.kind ?? existing?.kind ?? "");
  const nextActive = body.active !== undefined ? Boolean(body.active) : Boolean(existing?.active);

  if (kind === "popup" && nextActive) {
    await ensureSingleActivePopup(id);
  }

  const doc = await CmsItem.findByIdAndUpdate(id, body, { new: true });
  await bumpCmsCache();
  return doc;
}

export async function deleteCms(id: string) {
  await CmsItem.findByIdAndDelete(id);
  await bumpCmsCache();
  return { deleted: true };
}
