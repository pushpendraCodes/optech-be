import type { ErrorRequestHandler } from "express";
import mongoose from "mongoose";
import { isProd } from "../config/env.js";
import { logger } from "../config/logger.js";
import { AppError } from "../utils/errors.js";

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  logger.error({ err, requestId: req.requestId, path: req.path }, err.message);

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      errors: err.errors ?? [],
      code: err.code,
    });
  }

  if (err instanceof mongoose.Error.ValidationError) {
    return res.status(422).json({
      success: false,
      message: "Validation failed",
      errors: Object.values(err.errors).map((e) => e.message),
      code: "MONGO_VALIDATION",
    });
  }

  if (err instanceof mongoose.Error.CastError) {
    return res.status(400).json({
      success: false,
      message: "Invalid identifier",
      errors: [],
      code: "CAST_ERROR",
    });
  }

  const dup = err as { code?: number };
  if (dup.code === 11000) {
    const key = Object.keys((err as { keyPattern?: Record<string, unknown> }).keyPattern ?? {})[0];
    const hint =
      key === "phone"
        ? "Phone number is already registered"
        : key === "email"
          ? "Email is already registered"
          : key === "studentCode"
            ? "Student ID already exists — retry confirm"
            : key
              ? `${key} already exists`
              : "Duplicate record";
    return res.status(409).json({
      success: false,
      message: hint,
      errors: [],
      code: "DUPLICATE",
    });
  }

  return res.status(500).json({
    success: false,
    message: isProd ? "Internal server error" : err.message,
    errors: [],
    code: "INTERNAL_ERROR",
  });
};
