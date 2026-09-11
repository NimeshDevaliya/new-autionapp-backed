import { z } from "zod";

export const objectId = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, "Must be a valid id");

export const idParam = z.object({ id: objectId });

/** Shared list-query shape: pagination, search, sorting. */
export const listQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().trim().optional(),
  sortBy: z.string().trim().optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
});

export type ListQuery = z.infer<typeof listQuery>;

/** Builds a Mongo sort object from query params, falling back to a default. */
export function buildSort(
  sortBy: string | undefined,
  sortOrder: string | undefined,
  allowed: string[],
  fallback: Record<string, 1 | -1> = { createdAt: -1 }
): Record<string, 1 | -1> {
  if (!sortBy || !allowed.includes(sortBy)) return fallback;
  return { [sortBy]: sortOrder === "asc" ? 1 : -1 };
}
