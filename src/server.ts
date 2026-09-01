import { createApp } from "./app.js";
import { connectDb } from "./config/db.js";
import { connectRedis } from "./config/redis.js";
import { env } from "./config/env.js";
import { firebaseApp } from "./config/firebase.js";
import { logger } from "./config/logger.js";
import { startWorkers } from "./jobs/worker.js";

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
  const app = createApp();
  app.listen(env.PORT, () => {
    logger.info(`Listening on :${env.PORT}`);
  });
}

main().catch((err) => {
  logger.fatal({ err }, "Failed to start");
  process.exit(1);
});
