import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env.js";
import { authenticate } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { ok } from "../../utils/api-response.js";
import * as auth from "./auth.service.js";

const router = Router();

const cookieOpts = {
  httpOnly: true,
  secure: Boolean(env.COOKIE_SECURE),
  sameSite: "lax" as const,
  path: "/",
};

router.post(
  "/student/login",
  validate({
    body: z.object({
      studentId: z.string().min(3),
      password: z.string().min(4),
      pushToken: z.string().min(1).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const data = await auth.loginStudent(req.body.studentId, req.body.password, req.body.pushToken);
    res.cookie("refreshToken", data.refreshToken, { ...cookieOpts, maxAge: 30 * 24 * 3600 * 1000 });
    return ok(res, data, "Logged in");
  }),
);

router.post(
  "/admin/login",
  validate({
    body: z.object({
      email: z.string().email(),
      password: z.string().min(8),
      pushToken: z.string().min(1).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const data = await auth.loginStaff(req.body.email, req.body.password, req.body.pushToken);
    res.cookie("refreshToken", data.refreshToken, { ...cookieOpts, maxAge: 30 * 24 * 3600 * 1000 });
    return ok(res, data, "Logged in");
  }),
);

router.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const token = req.body?.refreshToken || req.cookies?.refreshToken;
    const data = await auth.rotateRefresh(token);
    res.cookie("refreshToken", data.refreshToken, { ...cookieOpts, maxAge: 30 * 24 * 3600 * 1000 });
    return ok(res, data, "Token rotated");
  }),
);

router.post(
  "/logout",
  authenticate,
  asyncHandler(async (req, res) => {
    await auth.logout(req.auth!.sub);
    res.clearCookie("refreshToken", cookieOpts);
    return ok(res, {}, "Logged out");
  }),
);

router.post(
  "/password",
  authenticate,
  validate({
    body: z.object({
      currentPassword: z.string().min(4),
      newPassword: z.string().min(8),
    }),
  }),
  asyncHandler(async (req, res) => {
    await auth.changePassword(req.auth!.sub, req.body.currentPassword, req.body.newPassword);
    return ok(res, {}, "Password changed");
  }),
);

export default router;
