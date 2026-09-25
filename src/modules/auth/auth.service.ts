import crypto from "node:crypto";
import argon2 from "argon2";
import { nanoid } from "nanoid";
import { Role, Student, User } from "../../models/index.ts";
import { env } from "../../config/env.ts";
import { sendEmail } from "../../services/messaging.service.ts";
import { ForbiddenError, UnauthorizedError, BadRequestError } from "../../utils/errors.ts";
import { saveStudentPushToken, saveStudentPushTokenIfEmpty, saveUserPushToken } from "../../utils/push-token.ts";
import { hashToken, newJti, signAccess, signRefresh, verifyRefresh } from "../../utils/tokens.ts";
import type { RoleKey } from "../../constants/rbac.ts";

async function permissionsForUser(user: { roles: unknown[] }) {
  const roles = await Role.find({ _id: { $in: user.roles } }).lean();
  const keys = roles.map((r) => r.key);
  const perms = new Set<string>();
  for (const r of roles) {
    if (r.key === "SUPER_ADMIN") return { keys, permissions: ["*"] };
    r.permissions.forEach((p) => perms.add(p));
  }
  return { keys, permissions: [...perms] };
}

export async function loginStudent(studentCode: string, password: string, pushToken?: string) {
  const user = await User.findOne({ studentCode, kind: "student" }).select("+passwordHash +refreshTokenHash");
  if (!user) throw new UnauthorizedError("Invalid student ID or password");
  if (user.status === "blocked") throw new ForbiddenError("Account is blocked");
  if (user.status === "pending") throw new ForbiddenError("Admission is pending. Visit campus after website payment.");
  const ok = await argon2.verify(user.passwordHash, password);
  if (!ok) throw new UnauthorizedError("Invalid student ID or password");
  const student = await Student.findOne({ user: user._id });
  if (!student || student.blocked) throw new ForbiddenError("Student account unavailable");
  if (pushToken?.trim()) await saveStudentPushToken(String(student._id), pushToken);
  return issueTokens(user, "student", String(student._id));
}

export async function loginStaff(email: string, password: string, pushToken?: string) {
  const user = await User.findOne({ email: email.toLowerCase(), kind: "staff" }).select(
    "+passwordHash +refreshTokenHash",
  );
  if (!user) throw new UnauthorizedError("Invalid email or password");
  if (user.status === "blocked") throw new ForbiddenError("Account is blocked");
  const ok = await argon2.verify(user.passwordHash, password);
  if (!ok) throw new UnauthorizedError("Invalid email or password");
  if (pushToken?.trim()) await saveUserPushToken(String(user._id), pushToken);
  return issueTokens(user, "staff");
}

async function issueTokens(user: InstanceType<typeof User>, kind: "student" | "staff", studentId?: string) {
  const { keys, permissions } = await permissionsForUser(user);
  const accessToken = signAccess({
    sub: String(user._id),
    kind,
    studentId,
    permissions: permissions.includes("*") ? ["*"] : permissions,
    roles: keys,
  });
  const jti = newJti();
  const refreshToken = signRefresh({ sub: String(user._id), jti });
  user.refreshTokenHash = hashToken(refreshToken);
  user.lastLoginAt = new Date();
  await user.save();
  return {
    accessToken,
    refreshToken,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      kind,
      studentCode: user.studentCode,
      roles: keys,
    },
  };
}

export async function rotateRefresh(token: string) {
  let payload: { sub: string; jti: string };
  try {
    payload = verifyRefresh(token);
  } catch {
    throw new UnauthorizedError("Invalid refresh token");
  }
  const user = await User.findById(payload.sub).select("+refreshTokenHash +passwordHash");
  if (!user?.refreshTokenHash) throw new UnauthorizedError("Refresh token revoked");
  if (user.refreshTokenHash !== hashToken(token)) throw new UnauthorizedError("Refresh token reused");
  const student = user.kind === "student" ? await Student.findOne({ user: user._id }) : null;
  return issueTokens(user, user.kind, student ? String(student._id) : undefined);
}

export async function logout(userId: string) {
  await User.findByIdAndUpdate(userId, { $unset: { refreshTokenHash: 1 } });
}

export async function changePassword(userId: string, current: string, next: string) {
  const user = await User.findById(userId).select("+passwordHash");
  if (!user) throw new UnauthorizedError();
  const ok = await argon2.verify(user.passwordHash, current);
  if (!ok) throw new UnauthorizedError("Current password is incorrect");
  user.passwordHash = await argon2.hash(next);
  user.passwordChangedAt = new Date();
  user.refreshTokenHash = undefined;
  await user.save();
}

export async function getMe(userId: string) {
  const user = await User.findById(userId);
  if (!user) throw new UnauthorizedError();
  const roles = await Role.find({ _id: { $in: user.roles } }).lean();
  return {
    id: String(user._id),
    name: user.name,
    email: user.email ?? "",
    kind: user.kind,
    roles: roles.map((r) => r.key),
  };
}

export async function updateAccount(
  userId: string,
  body: { currentPassword: string; email?: string; newPassword?: string },
) {
  const user = await User.findById(userId).select("+passwordHash +refreshTokenHash");
  if (!user) throw new UnauthorizedError();
  if (user.kind !== "staff") throw new ForbiddenError("Only staff accounts can use this endpoint");

  const ok = await argon2.verify(user.passwordHash, body.currentPassword);
  if (!ok) throw new UnauthorizedError("Current password is incorrect");

  const nextEmail = body.email?.trim().toLowerCase();
  const nextPassword = body.newPassword?.trim();
  if (!nextEmail && !nextPassword) {
    throw new BadRequestError("Provide a new email and/or new password");
  }

  if (nextEmail && nextEmail !== (user.email ?? "").toLowerCase()) {
    const taken = await User.findOne({
      _id: { $ne: user._id },
      email: nextEmail,
      kind: "staff",
    }).lean();
    if (taken) throw new BadRequestError("That email is already in use by another staff account");
    user.email = nextEmail;
  }

  let passwordChanged = false;
  if (nextPassword) {
    if (nextPassword.length < 8) throw new BadRequestError("New password must be at least 8 characters");
    user.passwordHash = await argon2.hash(nextPassword);
    user.passwordChangedAt = new Date();
    user.refreshTokenHash = undefined;
    passwordChanged = true;
  }

  await user.save();
  const roles = await Role.find({ _id: { $in: user.roles } }).lean();
  return {
    passwordChanged,
    user: {
      id: String(user._id),
      name: user.name,
      email: user.email ?? "",
      kind: user.kind,
      roles: roles.map((r) => r.key),
    },
  };
}

const RESET_TTL_MS = 30 * 60 * 1000;

export async function requestStaffPasswordReset(email: string) {
  const user = await User.findOne({ email: email.toLowerCase(), kind: "staff" }).select(
    "+passwordResetTokenHash",
  );
  if (!user || user.status === "blocked" || !user.email) return;

  const token = crypto.randomBytes(32).toString("hex");
  user.passwordResetTokenHash = hashToken(token);
  user.passwordResetExpires = new Date(Date.now() + RESET_TTL_MS);
  await user.save();

  const link = `${env.ADMIN_URL.replace(/\/$/, "")}/reset-password?token=${token}`;
  await sendEmail(
    user.email,
    "Reset your Optech admin password",
    [
      `Hello ${user.name},`,
      ``,
      `A password reset was requested for your admin account.`,
      `This link expires in 30 minutes:`,
      link,
      ``,
      `If you did not ask for this, you can ignore the email.`,
    ].join("\n"),
  );
}

export async function resetStaffPasswordWithToken(token: string, newPassword: string) {
  const user = await User.findOne({
    kind: "staff",
    passwordResetTokenHash: hashToken(token),
    passwordResetExpires: { $gt: new Date() },
  }).select("+passwordHash +passwordResetTokenHash +refreshTokenHash");
  if (!user || user.status === "blocked") throw new BadRequestError("This reset link is invalid or has expired");

  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        passwordHash: await argon2.hash(newPassword),
        passwordChangedAt: new Date(),
      },
      $unset: {
        refreshTokenHash: 1,
        passwordResetTokenHash: 1,
        passwordResetExpires: 1,
      },
    },
  );
}

export async function hashPassword(plain: string) {
  return argon2.hash(plain);
}

export function makeStudentCode() {
  return `OPT-${new Date().getFullYear()}-${nanoid(6).toUpperCase()}`;
}

export function makeReferralCode(name: string) {
  return `${name.replace(/\s+/g, "").slice(0, 8).toUpperCase()}${nanoid(4).toUpperCase()}`;
}

export async function getRole(key: RoleKey) {
  return Role.findOne({ key });
}
