import { Role, User } from "../../models/index.ts";
import { ROLE_KEYS, type RoleKey } from "../../constants/rbac.ts";
import { BadRequestError, NotFoundError } from "../../utils/errors.ts";
import { hashPassword } from "../auth/auth.service.ts";

const ASSIGNABLE_ROLES: RoleKey[] = ["ADMIN", "STAFF", "TEACHER"];

export async function listStaffUsers() {
  return User.find({ kind: "staff" })
    .populate("roles", "key name permissions")
    .select("-passwordHash -refreshTokenHash")
    .sort({ createdAt: -1 })
    .lean();
}

export async function createStaffUser(body: {
  name: string;
  email: string;
  password: string;
  roleKey: RoleKey;
}) {
  if (!ASSIGNABLE_ROLES.includes(body.roleKey)) {
    throw new BadRequestError("Role must be ADMIN, STAFF, or TEACHER");
  }
  const role = await Role.findOne({ key: body.roleKey });
  if (!role) throw new NotFoundError("Role not found");

  const existing = await User.findOne({ email: body.email.toLowerCase(), kind: "staff" });
  if (existing) throw new BadRequestError("A staff account with this email already exists");

  const user = await User.create({
    kind: "staff",
    name: body.name.trim(),
    email: body.email.toLowerCase().trim(),
    passwordHash: await hashPassword(body.password),
    roles: [role._id],
    status: "active",
  });

  return User.findById(user._id).populate("roles", "key name permissions").select("-passwordHash -refreshTokenHash").lean();
}

export async function updateStaffUser(
  id: string,
  body: { name?: string; email?: string; roleKey?: RoleKey; status?: "active" | "blocked" },
) {
  const user = await User.findById(id);
  if (!user || user.kind !== "staff") throw new NotFoundError("Staff user not found");

  const roles = await Role.find({ _id: { $in: user.roles } }).lean();
  if (roles.some((r) => r.key === "SUPER_ADMIN")) {
    throw new BadRequestError("Super admin account cannot be edited here");
  }

  if (typeof body.name === "string") user.name = body.name.trim();
  if (typeof body.email === "string") user.email = body.email.toLowerCase().trim();
  if (body.status) user.status = body.status;

  if (body.roleKey) {
    if (!ASSIGNABLE_ROLES.includes(body.roleKey)) {
      throw new BadRequestError("Role must be ADMIN, STAFF, or TEACHER");
    }
    const role = await Role.findOne({ key: body.roleKey });
    if (!role) throw new NotFoundError("Role not found");
    user.roles = [role._id];
  }

  await user.save();
  return User.findById(user._id).populate("roles", "key name permissions").select("-passwordHash -refreshTokenHash").lean();
}

export async function resetStaffPassword(id: string) {
  const user = await User.findById(id).select("+passwordHash +refreshTokenHash");
  if (!user || user.kind !== "staff") throw new NotFoundError("Staff user not found");

  const roles = await Role.find({ _id: { $in: user.roles } }).lean();
  if (roles.some((r) => r.key === "SUPER_ADMIN")) {
    throw new BadRequestError("Super admin password cannot be reset here");
  }

  const password = Math.random().toString(36).slice(2, 12) + "A1";
  user.passwordHash = await hashPassword(password);
  user.passwordChangedAt = new Date();
  user.refreshTokenHash = undefined;
  await user.save();

  return { email: user.email, name: user.name, password };
}
