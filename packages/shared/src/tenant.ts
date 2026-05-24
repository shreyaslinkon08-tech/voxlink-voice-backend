import { z } from "zod";
import { userRoleSchema } from "./rbac.js";

export const tenantContextSchema = z.object({
  requestId: z.string().min(1),
  userId: z.string().uuid(),
  companyId: z.string().uuid(),
  role: userRoleSchema
});

export type TenantContext = z.infer<typeof tenantContextSchema>;

export const principalSchema = z.object({
  requestId: z.string().min(1),
  userId: z.string().uuid(),
  memberships: z.array(
    z.object({
      companyId: z.string().uuid(),
      role: userRoleSchema
    })
  )
});

export type Principal = z.infer<typeof principalSchema>;

export function resolveTenantContext(
  principal: Principal,
  requestedCompanyId: string
): TenantContext | null {
  const membership = principal.memberships.find((item) => item.companyId === requestedCompanyId);

  if (!membership) {
    return null;
  }

  return {
    requestId: principal.requestId,
    userId: principal.userId,
    companyId: membership.companyId,
    role: membership.role
  };
}
