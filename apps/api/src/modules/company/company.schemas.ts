import { z } from "zod";

export const companyMemberRoleSchema = z.enum(["company_admin", "operator"]);

export const updateCurrentCompanySchema = z.object({
  name: z.string().trim().min(2).max(160)
});

export const createCompanySchema = z.object({
  name: z.string().trim().min(2).max(160)
});

export const inviteCompanyMemberSchema = z.object({
  email: z
    .string()
    .email()
    .max(255)
    .transform((value) => value.toLowerCase()),
  role: companyMemberRoleSchema
});

export const updateCompanyMemberRoleSchema = z.object({
  role: companyMemberRoleSchema
});

export type UpdateCurrentCompanyInput = z.infer<typeof updateCurrentCompanySchema>;
export type CreateCompanyInput = z.infer<typeof createCompanySchema>;
export type InviteCompanyMemberInput = z.infer<typeof inviteCompanyMemberSchema>;
export type UpdateCompanyMemberRoleInput = z.infer<typeof updateCompanyMemberRoleSchema>;
