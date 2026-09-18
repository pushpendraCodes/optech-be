import cron from "node-cron";
import { env } from "../config/env.ts";
import { logger } from "../config/logger.ts";
import { pruneOldAttendancePhotos } from "../modules/attendance/attendance.service.ts";

/** Delete live-class login/logout photos older than 30 days. */
export function startAttendancePhotoCron() {
  cron.schedule(
    "20 3 * * *",
    async () => {
      try {
        const result = await pruneOldAttendancePhotos(30);
        logger.info(result, "Attendance photo cleanup finished");
      } catch (err) {
        logger.error({ err }, "Attendance photo cleanup failed");
      }
    },
    {
      name: "attendance-photo-cleanup",
      timezone: env.BACKUP_TIMEZONE || "Asia/Kolkata",
      noOverlap: true,
    },
  );
  logger.info("Attendance photo cleanup cron scheduled (03:20 Asia/Kolkata, keep 30 days)");
  setTimeout(() => {
    pruneOldAttendancePhotos(30)
      .then((result) => logger.info(result, "Attendance photo startup cleanup finished"))
      .catch((err) => logger.error({ err }, "Attendance photo startup cleanup failed"));
  }, 12_000);
}
