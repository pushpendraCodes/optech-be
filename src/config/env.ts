import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.example", override: false });

function clean(value: unknown) {
  if (typeof value !== "string") return value;
  let s = value.trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1);
  }
  return s.replace(/\\n/g, "\n");
}

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  APP_NAME: z.string().default("Optech API"),
  API_PREFIX: z.string().default("/api/v1"),
  MONGO_URI: z.string().min(1),
  REDIS_HOST: z.string().min(1),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_USERNAME: z.string().optional().default("default"),
  REDIS_PASSWORD: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES: z.string().default("15m"),
  JWT_REFRESH_EXPIRES: z.string().default("30d"),
  FRONTEND_URL: z.string().url(),
  ADMIN_URL: z.string().url(),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  COOKIE_DOMAIN: z.string().optional(),
  RAZORPAY_KEY_ID: z.string().min(1),
  RAZORPAY_KEY_SECRET: z.string().min(1),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1),
  CLOUDINARY_CLOUD_NAME: z.string().min(1),
  CLOUDINARY_API_KEY: z.string().min(1),
  CLOUDINARY_API_SECRET: z.string().min(1),
  YOUTUBE_API_KEY: z.string().optional().default(""),
  FIREBASE_PROJECT_ID: z.string().optional().default(""),
  FIREBASE_CLIENT_EMAIL: z.string().optional().default(""),
  FIREBASE_PRIVATE_KEY: z.string().optional().default(""),
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().optional().default(""),
  SMTP_HOST: z.string().optional().default(""),
  SMTP_PORT: z.coerce.number().optional().default(587),
  SMTP_USER: z.string().optional().default(""),
  SMTP_PASS: z.string().optional().default(""),
  EMAIL_FROM: z.string().optional().default("Optech Deori <noreply@optech-deori.edu.in>"),
  /** Daily mongodump → Cloudinary (requires MongoDB Database Tools on PATH). */
  BACKUP_CRON_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  /** Cron expression (default: 02:00 daily). */
  BACKUP_CRON: z.string().default("0 2 * * *"),
  BACKUP_TIMEZONE: z.string().default("Asia/Kolkata"),
  BACKUP_FOLDER: z.string().default("optech/db-backups"),
  /** Delete Cloudinary backups older than N days (0 = keep forever). */
  BACKUP_RETENTION_DAYS: z.coerce.number().int().min(0).default(14),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const raw = Object.fromEntries(
    Object.entries(process.env).map(([key, value]) => [key.trim(), clean(value)]),
  );
  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    console.error("Invalid environment variables", parsed.error.flatten().fieldErrors);
    throw new Error("Environment validation failed");
  }
  return parsed.data;
}

export const env = loadEnv();
export const isProd = env.NODE_ENV === "production";
export const corsOrigins = env.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
