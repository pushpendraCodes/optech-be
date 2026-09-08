import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env.ts";
import { authenticate } from "../../middleware/auth.ts";
import { validate } from "../../middleware/validate.ts";
import { asyncHandler } from "../../utils/async-handler.ts";
import { ok } from "../../utils/api-response.ts";
import * as auth from "./auth.service.ts";

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

router.get(
  "/me",
  authenticate,
  asyncHandler(async (req, res) => {
    const data = await auth.getMe(req.auth!.sub);
    return ok(res, data);
  }),
);

router.patch(
  "/account",
  authenticate,
  validate({
    body: z
      .object({
        currentPassword: z.string().min(4),
        email: z.string().email().optional(),
        newPassword: z.string().min(8).optional(),
      })
      .refine((v) => Boolean(v.email || v.newPassword), {
        message: "Provide a new email and/or new password",
      }),
  }),
  asyncHandler(async (req, res) => {
    const data = await auth.updateAccount(req.auth!.sub, req.body);
    return ok(res, data, data.passwordChanged ? "Account updated — sign in again" : "Account updated");
  }),
);

export default router;
