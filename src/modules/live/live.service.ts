import { z } from "zod";
import { LiveClass, Notification } from "../../models/index.ts";
import { ValidationError, NotFoundError, ForbiddenError } from "../../utils/errors.ts";
import { extractYoutubeId } from "../../services/youtube.service.ts";
import { enqueueBroadcast, notifyLiveNow } from "../../services/notification.service.ts";
import { cache } from "../../services/cache.service.ts";
import { CACHE_KEYS } from "../../constants/cache.ts";
import * as attendance from "../attendance/attendance.service.ts";

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

const CLASSROOM_COLORS = [
  { color: "#D4A22F", accentColor: "#E8C35A" },
  { color: "#3B82F6", accentColor: "#60A5FA" },
  { color: "#8B5CF6", accentColor: "#A78BFA" },
  { color: "#10B981", accentColor: "#34D399" },
  { color: "#F43F5E", accentColor: "#FB7185" },
];

function locTitle(title: unknown): string {
  if (!title) return "";
  if (typeof title === "string") return title;
  if (typeof title === "object" && title && "en" in title) {
    return String((title as { en?: string }).en ?? "");
  }
  return String(title);
}

function avatarFallback(name: string) {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=1a1a2e&color=d4a22f&size=128`;
}

async function rosterForBatch(batchId: string) {
  const { Enrollment, Student } = await import("../../models/index.ts");

  const [enrollments, directStudents] = await Promise.all([
    Enrollment.find({ status: "active", batch: batchId })
      .select("student createdAt")
      .populate({
        path: "student",
        select: "photo studentCode",
        populate: { path: "user", select: "name" },
      })
      .limit(48)
      .lean(),
    Student.find({ batch: batchId, blocked: { $ne: true } })
      .select("photo studentCode createdAt")
      .populate({ path: "user", select: "name" })
      .limit(48)
      .lean(),
  ]);

  const byId = new Map<
    string,
    {
      id: string;
      name: string;
      photo: string;
      status: "active";
      joinedDate: string;
    }
  >();

  const pushStudent = (
    student:
      | { _id?: unknown; photo?: { url?: string }; user?: { name?: string }; createdAt?: Date }
      | null
      | undefined,
    joinedAt?: Date | null,
  ) => {
    if (!student || typeof student !== "object") return;
    const id = String(student._id ?? "");
    if (!id || byId.has(id)) return;
    const name = String(student.user?.name ?? "Student").trim() || "Student";
    const joined = joinedAt ?? (student.createdAt ? new Date(student.createdAt) : null);
    byId.set(id, {
      id,
      name,
      photo: student.photo?.url ? String(student.photo.url) : avatarFallback(name),
      status: "active",
      joinedDate: joined
        ? joined.toLocaleDateString("en-IN", { month: "short", year: "numeric" })
        : "",
    });
  };

  for (const row of enrollments) {
    pushStudent(
      row.student as {
        _id?: unknown;
        photo?: { url?: string };
        user?: { name?: string };
        createdAt?: Date;
      } | null,
      row.createdAt ? new Date(row.createdAt as Date) : null,
    );
  }
  for (const student of directStudents) {
    pushStudent(
      student as {
        _id?: unknown;
        photo?: { url?: string };
        user?: { name?: string };
        createdAt?: Date;
      },
      student.createdAt ? new Date(student.createdAt as Date) : null,
    );
  }

  return [...byId.values()].slice(0, 48);
}

type BatchRow = {
  _id: unknown;
  label?: string;
  timing?: string;
  start?: Date;
  course?: { _id?: unknown; title?: unknown; slug?: string } | null;
  teachers?: { name?: string }[];
};

/** Public 3D classroom: all batches scheduled for today's weekday (India time). */
export async function publicClassroomLive() {
  // Always refresh — matching depends on the current clock
  await cache.del(CACHE_KEYS.live);
  return cache.remember(CACHE_KEYS.live, 5, async () => {
    const { Batch, User } = await import("../../models/index.ts");
    const { parseBatchTiming, indiaNowParts, isTimingActiveNow } = await import(
      "../../utils/batch-timing.ts"
    );

    const nowParts = indiaNowParts();

    const batches = (await Batch.find({ active: true })
      .populate("course", "title slug")
      .populate({ path: "teachers", select: "name", model: User })
      .lean()) as unknown as BatchRow[];

    type Ranked = {
      batch: BatchRow;
      parsed: NonNullable<ReturnType<typeof parseBatchTiming>>;
      isLive: boolean;
    };

    const today: Ranked[] = [];
    for (const batch of batches) {
      const parsed = parseBatchTiming(String(batch.timing ?? ""));
      if (!parsed) continue;
      // Include every batch that runs on today's weekday — ignore course start date
      // and include empty rosters so the schedule still lists them.
      if (!parsed.days.includes(nowParts.day)) continue;
      today.push({
        batch,
        parsed,
        isLive: isTimingActiveNow(parsed, nowParts),
      });
    }

    today.sort((a, b) => {
      if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
      return a.parsed.startMinutes - b.parsed.startMinutes;
    });

    const mapped = await Promise.all(
      today.map(async (item, index) => {
        const { batch, parsed, isLive } = item;
        const course = batch.course;
        const courseTitle = locTitle(course?.title) || "Course";
        const batchLabel = batch.label || "Batch";
        const teacherName =
          batch.teachers?.map((t) => t.name).filter(Boolean).join(", ") || "Faculty";
        const palette = CLASSROOM_COLORS[index % CLASSROOM_COLORS.length];
        // Always load roster (may be empty) — empty batches still appear
        const students = await rosterForBatch(String(batch._id));
        const marks = await attendance.todayMarksForBatch(
          String(batch._id),
          students.map((s) => s.id),
        );

        return {
          id: String(batch._id),
          name: batchLabel,
          title: `${courseTitle} · ${batchLabel}`,
          course: courseTitle,
          courseSlug: course?.slug ?? "",
          instructor: teacherName,
          instructorPhoto: "",
          startTime: parsed.startTime,
          endTime: parsed.endTime,
          room: String(batch.timing ?? "Campus lab"),
          color: palette.color,
          accentColor: palette.accentColor,
          isLive,
          timing: String(batch.timing ?? ""),
          students: students.map((s) => {
            const mark = marks.get(s.id);
            return {
              ...s,
              course: courseTitle,
              batch: batchLabel,
              loggedIn: Boolean(mark?.loggedIn),
              loggedOut: Boolean(mark?.loggedOut),
            };
          }),
        };
      }),
    );

    return mapped;
  });
}
