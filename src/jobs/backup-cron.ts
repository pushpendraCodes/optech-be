import cron from "node-cron";
import { env } from "../config/env.ts";
import { logger } from "../config/logger.ts";
import { runMongoBackup } from "../services/backup.service.ts";

/** Schedule daily mongodump → Cloudinary when BACKUP_CRON_ENABLED=true. */
export function startBackupCron() {
  if (!env.BACKUP_CRON_ENABLED) {
    logger.info("Mongo backup cron disabled (set BACKUP_CRON_ENABLED=true to enable)");
    return;
  }

  if (!cron.validate(env.BACKUP_CRON)) {
    logger.error({ expression: env.BACKUP_CRON }, "Invalid BACKUP_CRON expression — cron not started");
    return;
  }

  cron.schedule(
    env.BACKUP_CRON,
    async () => {
      try {
        await runMongoBackup();
      } catch (err) {
        logger.error({ err }, "Mongo backup cron failed");
      }
    },
    {
      name: "mongo-backup",
      timezone: env.BACKUP_TIMEZONE,
      noOverlap: true,
    },
  );

  logger.info(
    {
      expression: env.BACKUP_CRON,
      timezone: env.BACKUP_TIMEZONE,
      folder: env.BACKUP_FOLDER,
      retentionDays: env.BACKUP_RETENTION_DAYS,
    },
    "Mongo backup cron scheduled",
  );
}
