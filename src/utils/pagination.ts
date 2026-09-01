import { z } from "zod";

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().optional().default(""),
  sortBy: z.string().optional().default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
});

export type PaginationQuery = z.infer<typeof paginationQuery>;

export function paginationMeta(total: number, page: number, limit: number) {
  return {
    currentPage: page,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    totalItems: total,
    limit,
  };
}

export function skipLimit(page: number, limit: number) {
  return { skip: (page - 1) * limit, limit };
}
