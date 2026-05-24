import { z } from "zod";
import { paginationQuerySchema } from "../../utils/pagination.js";

export const phoneNumberStatusSchema = z.enum(["active", "inactive", "released"]);

export const createPhoneNumberSchema = z.object({
  e164: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{1,14}$/),
  label: z.string().trim().max(120).optional(),
  aiAgentId: z.string().uuid().optional(),
  providerNumberSid: z.string().trim().min(1).max(80).optional(),
  status: phoneNumberStatusSchema.default("active")
});

export const searchAvailablePhoneNumbersQuerySchema = z.object({
  countryCode: z
    .string()
    .trim()
    .length(2)
    .regex(/^[A-Za-z]{2}$/)
    .default("US"),
  areaCode: z
    .string()
    .trim()
    .regex(/^\d{3,6}$/)
    .optional(),
  contains: z
    .string()
    .trim()
    .regex(/^[0-9A-Za-z*]{2,16}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(20).default(10)
});

export const provisionPhoneNumberSchema = z.object({
  e164: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{1,14}$/),
  label: z.string().trim().max(120).optional(),
  aiAgentId: z.string().uuid().optional()
});

export const updatePhoneNumberSchema = createPhoneNumberSchema
  .omit({ e164: true, providerNumberSid: true })
  .partial()
  .extend({
    aiAgentId: z.string().uuid().nullable().optional()
  });

export const listPhoneNumbersQuerySchema = paginationQuerySchema.extend({
  status: phoneNumberStatusSchema.optional()
});
