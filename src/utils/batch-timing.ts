/** Parse freeform batch timing strings like "Mon–Sat · 9:00–11:00 AM". */

const DAY_ALIAS: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};

export type ParsedBatchTiming = {
  days: number[];
  startMinutes: number;
  endMinutes: number;
  startTime: string; // HH:MM 24h
  endTime: string;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function minutesToHhmm(total: number) {
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

function toMinutes(hour: number, minute: number, meridiem?: string | null) {
  let h = hour;
  if (meridiem) {
    const mer = meridiem.toUpperCase();
    if (mer === "AM") {
      if (h === 12) h = 0;
    } else if (mer === "PM") {
      if (h !== 12) h += 12;
    }
  }
  return h * 60 + minute;
}

function expandDayRange(from: number, to: number): number[] {
  const days: number[] = [];
  let d = from;
  for (let i = 0; i < 7; i++) {
    days.push(d);
    if (d === to) break;
    d = (d + 1) % 7;
  }
  return days;
}

function parseDays(raw: string): number[] {
  const text = raw.toLowerCase().replace(/[–—]/g, "-");
  const found = new Set<number>();

  const range = text.match(
    /\b(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s*-\s*(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/,
  );
  if (range) {
    const from = DAY_ALIAS[range[1]];
    const to = DAY_ALIAS[range[2]];
    if (from !== undefined && to !== undefined) {
      for (const d of expandDayRange(from, to)) found.add(d);
    }
  }

  const tokenRe =
    /\b(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(text))) {
    const idx = DAY_ALIAS[m[1]];
    if (idx !== undefined) found.add(idx);
  }

  if (found.size === 0) {
    // No weekday info → every day
    return [0, 1, 2, 3, 4, 5, 6];
  }
  return [...found].sort((a, b) => a - b);
}

function parseTimeRange(raw: string): { startMinutes: number; endMinutes: number } | null {
  // Normalize unicode dashes/dots/spaces so admin-entered timings still parse.
  const text = raw
    .replace(/[–—−]/g, "-")
    .replace(/[.\u00B7]/g, (ch) => (ch === "." ? ":" : " "))
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ");

  const match = text.match(
    /(\d{1,2})\s*[:.]\s*(\d{2})\s*(am|pm)?\s*-\s*(\d{1,2})\s*[:.]\s*(\d{2})\s*(am|pm)?/i,
  );
  if (!match) return null;

  const startH = Number(match[1]);
  const startM = Number(match[2]);
  const endH = Number(match[4]);
  const endM = Number(match[5]);
  let startMer = match[3] ?? null;
  let endMer = match[6] ?? null;

  // Trailing shared meridiem: "7:30–10:30 PM" or "9:00–11:00 AM"
  if (!startMer && endMer) {
    startMer = endMer;
    // Ambiguous noon-crossing: "10:00–12:00 PM" means 10 AM–12 PM, not 10 PM–12 PM.
    const trialStart = toMinutes(startH, startM, startMer);
    const trialEnd = toMinutes(endH, endM, endMer);
    if (trialEnd <= trialStart && endMer.toUpperCase() === "PM") {
      startMer = "AM";
      endMer = "PM";
    }
  } else if (startMer && !endMer) {
    endMer = startMer;
  }

  let startMinutes = toMinutes(startH, startM, startMer);
  let endMinutes = toMinutes(endH, endM, endMer);

  // Explicit "10:00 AM–1:00" missing end meridiem → bump end to PM when needed
  if (startMer?.toUpperCase() === "AM" && !match[6] && endMinutes <= startMinutes) {
    endMinutes = toMinutes(endH, endM, "PM");
  }

  if (endMinutes <= startMinutes) {
    endMinutes += 24 * 60;
  }

  return { startMinutes, endMinutes };
}

export function parseBatchTiming(timing: string): ParsedBatchTiming | null {
  if (!timing?.trim()) return null;
  const times = parseTimeRange(timing);
  if (!times) return null;
  const days = parseDays(timing);
  return {
    days,
    startMinutes: times.startMinutes % (24 * 60),
    endMinutes: times.endMinutes,
    startTime: minutesToHhmm(times.startMinutes % (24 * 60)),
    endTime: minutesToHhmm(times.endMinutes % (24 * 60)),
  };
}

export function indiaNowParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";

  const weekday = get("weekday").toLowerCase().slice(0, 3);
  const day = DAY_ALIAS[weekday] ?? 0;
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  return { day, minutes: hour * 60 + minute };
}

export function isTimingActiveNow(
  parsed: ParsedBatchTiming,
  now = indiaNowParts(),
): boolean {
  if (!parsed.days.includes(now.day)) return false;
  const start = parsed.startMinutes;
  let end = parsed.endMinutes;
  // overnight: end was stored as > 24h in parse, then normalized — recompute span
  if (end <= start) end += 24 * 60;
  const cur = now.minutes;
  if (end > 24 * 60) {
    return cur >= start || cur < end % (24 * 60);
  }
  return cur >= start && cur < end;
}

/** Minutes until today's start, or null if not today / already started. */
export function minutesUntilStartToday(
  parsed: ParsedBatchTiming,
  now = indiaNowParts(),
): number | null {
  if (!parsed.days.includes(now.day)) return null;
  if (now.minutes >= parsed.startMinutes) return null;
  return parsed.startMinutes - now.minutes;
}
