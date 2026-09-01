import Redis from "ioredis";
import { env } from "./env.js";
import { logger } from "./logger.js";

const remote = !["localhost", "127.0.0.1"].includes(env.REDIS_HOST);

export const redis = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  username: env.REDIS_USERNAME,
  password: env.REDIS_PASSWORD,
  maxRetriesPerRequest: null,
  lazyConnect: true,
  retryStrategy: (times) => (times > 8 ? null : Math.min(times * 200, 2000)),
  showFriendlyErrorStack: false,
});

redis.on("error", () => undefined);

async function tryConnect() {
  if (redis.status === "ready") return;
  if (redis.status === "wait" || redis.status === "end") await redis.connect();
}

export async function connectRedis() {
  try {
    await tryConnect();
    logger.info("Redis connected");
    return;
  } catch {
    /* plaintext failed */
  }

  if (!remote) {
    logger.warn("Redis unavailable");
    return;
  }

  try {
    await redis.disconnect();
    redis.options.tls = { servername: env.REDIS_HOST };
    await redis.connect();
    logger.info("Redis connected");
  } catch {
    logger.warn("Redis unavailable — running without cache");
  }
}
