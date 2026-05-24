import type { FastifyRequest } from "fastify";
import type { Permission } from "@voxlink/shared";
import { hasPermission } from "@voxlink/shared";
import { AppError } from "../errors/app-error.js";
import { requireTenantContext } from "./tenant-context.js";

export function requirePermission(request: FastifyRequest, permission: Permission): void {
  const tenant = requireTenantContext(request);

  if (!hasPermission(tenant.role, permission)) {
    throw AppError.forbidden();
  }
}
