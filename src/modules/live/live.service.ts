import { z } from "zod";
import { LiveClass, Notification } from "../../models/index.ts";
import { ValidationError, NotFoundError, ForbiddenError } from "../../utils/errors.ts";
import { extractYoutubeId } from "../../services/youtube.service.ts";
import { enqueueBroadcast, notifyLiveNow } from "../../services/notification.service.ts";
import { cache } from "../../services/cache.service.ts";
import { CACHE_KEYS } from "../../constants/cache.ts";

const createBodySchema = z.object({
  title: z.string().min(2),
  course: z.string().min(1),
  batch: z.string().optional(),
  youtubeUrl: z.string().url(),
  startsAt: z.coerce.date(),
});

const patchBodySchema = z.object({
  action: z.enum(["go_live", "end"]).optional(),
  isLive: z.boolean().optional(),
});

export type LiveStatus = "scheduled" | "live" | "closed";

export function liveStatus(row: { isLive?: boolean; endsAt?: Date | string | null }): LiveStatus {
  if (row.endsAt) return "closed";
  if (row.isLive) return "live";
  return "scheduled";
}

function enrich(row: Record<string, unknown>) {
  return { ...row, status: liveStatus(row as { isLive?: boolean; endsAt?: Date | string | null }) };
}

async function bumpCache() {
  await cache.del(CACHE_KEYS.live);
}

async function notifyScheduled(
  live: { _id: unknown; title: string; course: unknown; batch?: unknown; startsAt: Date },
  createdBy: string,
) {
  const when = live.startsAt.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  const audience = live.batch ? "BATCH" : "COURSE";
  const note = await Notification.create({
    type: "live_class",
    title: `Live class: ${live.title}`,
    body: `Scheduled for ${when}. Open the student panel → Live classes to join when it starts.`,
    audience,
    course: live.course,
    batch: live.batch || undefined,
    createdBy,
  });
  await enqueueBroadcast(String(note._id));
}

export async function createLiveClass(body: unknown, createdBy: string) {
  const parsed = createBodySchema.parse(body);
  const youtubeId = extractYoutubeId(parsed.youtubeUrl);
  if (!youtubeId) throw new ValidationError("Enter a valid YouTube URL");

  const row = await LiveClass.create({
    title: parsed.title,
    course: parsed.course,
    batch: parsed.batch || undefined,
    youtubeUrl: parsed.youtubeUrl,
    youtubeId,
    startsAt: parsed.startsAt,
    isLive: false,
  });

  await notifyScheduled(row, createdBy);
  await bumpCache();
  return enrich(row.toObject() as unknown as Record<string, unknown>);
}

export async function updateLiveClass(id: string, body: unknown) {
  const parsed = patchBodySchema.parse(body);
  const row = await LiveClass.findById(id);
  if (!row) throw new NotFoundError("Live class not found");

  const action =
    parsed.action ?? (parsed.isLive === true ? "go_live" : parsed.isLive === false ? "end" : undefined);

  if (action === "go_live") {
    if (row.endsAt) throw new ForbiddenError("This class is closed and cannot go live again");
    row.isLive = true;
    await notifyLiveNow({
      title: row.title,
      course: row.course,
      batch: row.batch,
    });
  } else if (action === "end") {
    if (!row.isLive && row.endsAt) throw new ForbiddenError("This class is already closed");
    row.isLive = false;
    row.endsAt = new Date();
  } else {
    throw new ValidationError("Unknown update");
  }

  await row.save();
  await bumpCache();
  return enrich(row.toObject() as unknown as Record<string, unknown>);
}

export async function listLiveClasses() {
  const rows = await LiveClass.find({}).sort({ startsAt: -1 }).lean();
  return rows.map((r) => enrich(r as Record<string, unknown>));
}
