import { z } from "zod";
import { paginationQuerySchema } from "../../utils/pagination.js";

export const knowledgeBaseStatusSchema = z.enum(["pending", "processing", "ready", "failed"]);

export const listKnowledgeBaseQuerySchema = paginationQuerySchema.extend({
  status: knowledgeBaseStatusSchema.optional()
});

export const createTextKnowledgeBaseSchema = z.object({
  title: z.string().trim().min(1).max(160),
  content: z.string().trim().min(1).max(500_000),
  metadata: z.record(z.string(), z.unknown()).default({})
});

export const registerWebsiteKnowledgeBaseSchema = z.object({
  title: z.string().trim().min(1).max(160),
  sourceUri: z
    .string()
    .trim()
    .url()
    .refine((value) => ["http:", "https:"].includes(new URL(value).protocol), {
      message: "Website URL must use HTTP or HTTPS"
    }),
  metadata: z.record(z.string(), z.unknown()).default({})
});
