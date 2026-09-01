import express from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import mongoSanitize from "express-mongo-sanitize";
import pinoHttp from "pino-http";
import swaggerUi from "swagger-ui-express";
import { env, corsOrigins } from "./config/env.js";
import { logger } from "./config/logger.js";
import { requestId } from "./middleware/request-id.js";
import { errorHandler } from "./middleware/error-handler.js";
import { asyncHandler } from "./utils/async-handler.js";
import { ok } from "./utils/api-response.js";
import authRoutes from "./modules/auth/auth.routes.js";
import publicRoutes from "./modules/public/public.routes.js";
import studentRoutes from "./modules/students/student.routes.js";
import adminRoutes from "./modules/admin/admin.routes.js";
import { handleWebhook } from "./modules/payments/payment.service.js";
import { openapiSpec } from "./docs/openapi.js";

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return "error";
        if (res.statusCode >= 400) return "warn";
        return "silent";
      },
    }),
  );
  app.use(helmet());
  app.use(
    cors({
      origin: corsOrigins,
      credentials: true,
    }),
  );
  app.use(compression());
  app.use(cookieParser());

  app.post(
    `${env.API_PREFIX}/webhooks/razorpay`,
    express.raw({ type: "application/json" }),
    asyncHandler(async (req, res) => {
      const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body ?? "");
      const signature = String(req.headers["x-razorpay-signature"] || "");
      const result = await handleWebhook(raw, signature);
      return ok(res, result, "Webhook processed");
    }),
  );

  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));
  app.use(mongoSanitize());

  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 400, standardHeaders: true, legacyHeaders: false });
  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
  app.use(limiter);

  app.get("/health", (_req, res) => ok(res, { status: "up" }));
  app.use(`${env.API_PREFIX}/docs`, swaggerUi.serve, swaggerUi.setup(openapiSpec));
  app.use(`${env.API_PREFIX}/auth`, authLimiter, authRoutes);
  app.use(`${env.API_PREFIX}/public`, publicRoutes);
  app.use(`${env.API_PREFIX}/student`, studentRoutes);
  app.use(`${env.API_PREFIX}/admin`, adminRoutes);

  app.use(errorHandler);
  return app;
}
