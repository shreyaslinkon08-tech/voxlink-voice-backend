import { z } from "zod";
import { paginationQuerySchema } from "../../utils/pagination.js";

export const listAuditEventsQuerySchema = paginationQuerySchema.extend({
  companyId: z.union([z.string().uuid(), z.literal("all")]).optional(),
  resourceType: z.string().trim().min(1).max(80).optional(),
  action: z.string().trim().min(1).max(160).optional(),
  search: z.string().trim().min(1).max(120).optional()
});
