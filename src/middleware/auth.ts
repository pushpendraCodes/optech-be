import type { NextFunction, Request, Response } from "express";
import { verifyAccess, type AccessPayload } from "../utils/tokens.js";
import { ForbiddenError, UnauthorizedError } from "../utils/errors.js";
import type { Permission } from "../constants/rbac.js";

declare global {
  namespace Express {
    interface Request {
      auth?: AccessPayload;
      requestId?: string;
    }
  }
}

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : req.cookies?.accessToken;
  if (!token) return next(new UnauthorizedError("Missing access token"));
  try {
    req.auth = verifyAccess(token);
    next();
  } catch {
    next(new UnauthorizedError("Invalid or expired token"));
  }
}

export function requireStudent(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth || req.auth.kind !== "student" || !req.auth.studentId) {
    return next(new ForbiddenError("Student access required"));
  }
  next();
}

export function requireStaff(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth || req.auth.kind !== "staff") {
    return next(new ForbiddenError("Staff access required"));
  }
  next();
}

export function requirePermission(...needed: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(new UnauthorizedError());
    if (req.auth.roles.includes("SUPER_ADMIN")) return next();
    const set = new Set(req.auth.permissions);
    const ok = needed.every((p) => set.has(p));
    if (!ok) return next(new ForbiddenError("Insufficient permission"));
    next();
  };
}

export function requireAnyPermission(...needed: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(new UnauthorizedError());
    if (req.auth.roles.includes("SUPER_ADMIN")) return next();
    const set = new Set(req.auth.permissions);
    if (needed.some((p) => set.has(p))) return next();
    next(new ForbiddenError("Insufficient permission"));
  };
}
