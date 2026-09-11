import { NextFunction, Request, Response } from "express";
import { ZodSchema, ZodError } from "zod";
import { ApiError } from "../utils/ApiError";

type Source = "body" | "query" | "params";

function formatZodError(error: ZodError): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    errors[key] = [...(errors[key] ?? []), issue.message];
  }
  return errors;
}

/** Validates and replaces req[source] with the parsed, typed result. */
export function validate(schema: ZodSchema, source: Source = "body") {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return next(
        ApiError.unprocessable("Validation failed", formatZodError(result.error))
      );
    }
    // query/params are getter-only in Express 5; assign defensively
    if (source === "body") {
      req.body = result.data;
    } else {
      Object.defineProperty(req, source, {
        value: result.data,
        writable: true,
        configurable: true,
      });
    }
    next();
  };
}
