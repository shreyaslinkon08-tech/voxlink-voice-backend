import { z } from "zod";
import { paginationQuerySchema } from "../../utils/pagination.js";

export const callStatusSchema = z.enum([
  "initiated",
  "ringing",
  "connected",
  "listening",
  "processing",
  "responding",
  "transferring",
  "ended",
  "failed"
]);

export const listCallsQuerySchema = paginationQuerySchema.extend({
  status: callStatusSchema.optional(),
  search: z.string().trim().max(80).optional()
});

export const updateCallStatusSchema = z.object({
  status: callStatusSchema,
  failureReason: z.string().trim().max(2_000).optional()
});

export const createTranscriptChunkSchema = z.object({
  speakerRole: z.enum(["caller", "assistant", "operator", "system"]),
  text: z.string().trim().min(1).max(20_000),
  startedAtMs: z.number().int().min(0).optional(),
  endedAtMs: z.number().int().min(0).optional(),
  confidence: z.number().min(0).max(1).optional(),
  metadata: z.record(z.string(), z.unknown()).default({})
});

export const requestCallHandoffSchema = z.object({
  reason: z.string().trim().min(1).max(2_000).optional()
});

export const acceptCallHandoffSchema = z.object({
  notes: z.string().trim().min(1).max(2_000).optional()
});

export const resolveCallHandoffSchema = z.object({
  notes: z.string().trim().min(1).max(2_000).optional()
});
