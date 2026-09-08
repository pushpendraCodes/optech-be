import { runMongoBackup } from "../services/backup.service.ts";
import { logger } from "../config/logger.ts";

async function main() {
  const result = await runMongoBackup();
  logger.info(result, "Manual Mongo backup completed");
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, "Manual Mongo backup failed");
  process.exit(1);
});
