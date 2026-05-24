import type { FastifyRequest } from "fastify";
import type { TenantContext } from "@altrion/shared";
import { AppError } from "../errors/app-error.js";

export function getTenantContext(request: FastifyRequest): TenantContext | null {
  return request.tenantContext ?? null;
}

export function requireTenantContext(request: FastifyRequest): TenantContext {
  const tenant = getTenantContext(request);

  if (!tenant) {
    throw AppError.unauthorized("A tenant context is required");
  }

  return tenant;
}
