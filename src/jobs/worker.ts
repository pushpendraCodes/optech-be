import { Worker } from "bullmq";
import { redis } from "../config/redis.ts";
import { QUEUE_NAMES } from "../constants/cache.ts";
import { deliverNotification } from "../services/notification.service.ts";
import { logger } from "../config/logger.ts";

export function startWorkers() {
  const notifications = new Worker(
    QUEUE_NAMES.notifications,
    async (job) => {
      await deliverNotification(job.data.notificationId);
    },
    { connection: redis, prefix: "optech" },
  );
  notifications.on("failed", (job, err) =>
    logger.error({ job: job?.id, err: err.message }, "Notification job failed"),
  );
  return { notifications };
}
