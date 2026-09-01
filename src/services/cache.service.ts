import { redis } from "../config/redis.js";

function ready() {
  return redis.status === "ready";
}

export const cache = {
  async get<T>(key: string): Promise<T | null> {
    if (!ready()) return null;
    try {
      const raw = await redis.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
  async set(key: string, value: unknown, ttlSeconds?: number) {
    if (!ready()) return;
    try {
      const payload = JSON.stringify(value);
      if (ttlSeconds) await redis.set(key, payload, "EX", ttlSeconds);
      else await redis.set(key, payload);
    } catch {
      /* cache is optional */
    }
  },
  async del(key: string | string[]) {
    if (!ready()) return;
    try {
      const keys = Array.isArray(key) ? key : [key];
      if (keys.length) await redis.del(...keys);
    } catch {
      /* cache is optional */
    }
  },
  async delByPrefix(prefix: string) {
    if (!ready()) return;
    try {
      const keys = await redis.keys(`${prefix}*`);
      if (keys.length) await redis.del(...keys);
    } catch {
      /* cache is optional */
    }
  },
  async setWithTTL(key: string, value: unknown, ttlSeconds: number) {
    await this.set(key, value, ttlSeconds);
  },
  async remember<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
    const hit = await this.get<T>(key);
    if (hit) return hit;
    const value = await fn();
    await this.set(key, value, ttlSeconds);
    return value;
  },
};
