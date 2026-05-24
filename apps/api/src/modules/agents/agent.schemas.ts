import { z } from "zod";
import { paginationQuerySchema } from "../../utils/pagination.js";

const jsonObjectSchema = z.record(z.string(), z.unknown());

export const agentStatusSchema = z.enum(["draft", "active", "disabled"]);

export const createAgentSchema = z.object({
  name: z.string().trim().min(1).max(120),
  status: agentStatusSchema.default("draft"),
  systemPrompt: z.string().trim().min(10).max(12_000),
  personality: z.string().trim().max(4_000).optional(),
  voiceSettings: jsonObjectSchema.default({}),
  businessHours: jsonObjectSchema.default({}),
  escalationRules: jsonObjectSchema.default({})
});

export const updateAgentSchema = createAgentSchema.partial();

export const listAgentsQuerySchema = paginationQuerySchema.extend({
  status: agentStatusSchema.optional()
});
