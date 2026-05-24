import { z } from "zod";
import { planCodeValues } from "@altrion/shared";
import { paginationQuerySchema } from "../../utils/pagination.js";

export const adminCompanyStatusSchema = z.enum(["active", "suspended", "archived"]);
export const adminSubscriptionStatusSchema = z.enum(["trialing", "active", "past_due", "canceled"]);

export const listAdminCompaniesQuerySchema = paginationQuerySchema.extend({
  status: adminCompanyStatusSchema.optional(),
  search: z.string().trim().max(80).optional()
});

export const updateAdminCompanyStatusSchema = z.object({
  status: adminCompanyStatusSchema
});

export const updateAdminSubscriptionSchema = z.object({
  planCode: z.enum(planCodeValues),
  status: adminSubscriptionStatusSchema.default("active"),
  providerCustomerId: z.string().trim().max(160).optional(),
  providerSubscriptionId: z.string().trim().max(160).optional()
});
