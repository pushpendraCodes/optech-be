import type { NextFunction, Request, Response } from "express";
import { z, type ZodType } from "zod";
import { ValidationError } from "../utils/errors.ts";

export function validate(schema: {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schema.body) req.body = schema.body.parse(req.body);
      if (schema.query) req.query = schema.query.parse(req.query) as Request["query"];
      if (schema.params) req.params = schema.params.parse(req.params) as Request["params"];
      next();
    } catch (err) {
      if (err instanceof z.ZodError) {
        next(
          new ValidationError(
            "Validation failed",
            err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
          ),
        );
        return;
      }
      next(err);
    }
  };
}
