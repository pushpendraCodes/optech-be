import { createApp } from "./app.ts";
import { connectDb } from "./config/db.ts";
import { connectRedis } from "./config/redis.ts";
import { env } from "./config/env.ts";
import { firebaseApp } from "./config/firebase.ts";
import { logger } from "./config/logger.ts";
import { startBackupCron } from "./jobs/backup-cron.ts";
import { startAttendancePhotoCron } from "./jobs/attendance-photo-cron.ts";
import { startWorkers } from "./jobs/worker.ts";

function muteQueueNoise() {
  const original = console.error;
  console.error = (...args: unknown[]) => {
    const text = args.map(String).join(" ");
    if (text.includes("Eviction policy")) return;
    original.apply(console, args);
  };
}

async function main() {
  await connectDb();
  await connectRedis();
  if (firebaseApp) logger.info("Firebase ready");
  muteQueueNoise();
  try {
    startWorkers();
  } catch {
    logger.warn("Workers skipped");
  }
  try {
    startBackupCron();
  } catch (err) {
    logger.warn({ err }, "Backup cron skipped");
  }
  try {
    startAttendancePhotoCron();
  } catch (err) {
    logger.warn({ err }, "Attendance photo cron skipped");
  }
  const app = createApp();
  app.listen(env.PORT, () => {
    logger.info(`Listening on :${env.PORT}`);
  });
}

main().catch((err) => {
  logger.fatal({ err }, "Failed to start");
  process.exit(1);
});
