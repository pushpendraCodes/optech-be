import mongoose from "mongoose";
import { env } from "./env.js";
import { logger } from "./logger.js";

async function dropLegacyUserUniqueIndexes() {
  try {
    const coll = mongoose.connection.collection("users");
    const indexes = await coll.indexes();
    for (const idx of indexes) {
      const key = idx.key as Record<string, number> | undefined;
      if (!idx.unique || !key) continue;
      if ("phone" in key || "email" in key) {
        await coll.dropIndex(idx.name!);
        logger.info({ index: idx.name }, "Dropped legacy unique user index");
      }
    }
  } catch (err) {
    logger.warn({ err }, "Could not drop legacy user unique indexes");
  }
}

export async function connectDb() {
  mongoose.set("strictQuery", true);
  await mongoose.connect(env.MONGO_URI);
  await dropLegacyUserUniqueIndexes();
  logger.info("MongoDB connected");
}
