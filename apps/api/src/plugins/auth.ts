import jwt from "@fastify/jwt";
import fp from "fastify-plugin";
import type { FastifyRequest } from "fastify";
import { accessCookieName } from "../modules/auth/cookies.js";
import type { AccessTokenPayload } from "../modules/auth/auth.types.js";
import { AppError } from "../errors/app-error.js";

function readBearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    return null;
  }

  return header.slice("Bearer ".length);
}

export const authPlugin = fp(async (app) => {
  await app.register(jwt, {
    secret: app.config.JWT_ACCESS_SECRET
  });

  app.decorate("authenticate", async (request: FastifyRequest) => {
    const token = request.cookies[accessCookieName] ?? readBearerToken(request);

    if (!token) {
      throw AppError.unauthorized();
    }

    let payload: AccessTokenPayload;

    try {
      payload = app.jwt.verify<AccessTokenPayload>(token);
    } catch {
      throw AppError.unauthorized("Invalid or expired session");
    }

    const membership = await app.prisma.companyMembership.findUnique({
      where: {
        userId_companyId: {
          userId: payload.sub,
          companyId: payload.companyId
        }
      },
      include: {
        user: {
          select: {
            email: true,
            emailVerifiedAt: true
          }
        },
        company: {
          select: {
            status: true
          }
        }
      }
    });

    if (!membership || membership.role !== payload.role) {
      throw AppError.unauthorized("Session tenant membership is no longer valid");
    }

    if (!membership.user.emailVerifiedAt) {
      throw AppError.forbidden("Email verification is required");
    }

    if (membership.company.status !== "active") {
      throw AppError.forbidden("Company is not active");
    }

    request.tenantContext = {
      requestId: request.id,
      userId: payload.sub,
      companyId: payload.companyId,
      role: membership.role
    };
  });
});
