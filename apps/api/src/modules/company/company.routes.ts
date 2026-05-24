import type { FastifyInstance, FastifyPluginCallback } from "fastify";
import type { Prisma, UserRole } from "@prisma/client";
import { createOpaqueToken, hashToken } from "../../utils/token.js";
import { addSlugSuffix, slugify } from "../../utils/slug.js";
import { AppError } from "../../errors/app-error.js";
import { requirePermission } from "../../security/rbac.js";
import { requireTenantContext } from "../../security/tenant-context.js";
import {
  createCompanySchema,
  inviteCompanyMemberSchema,
  updateCompanyMemberRoleSchema,
  updateCurrentCompanySchema
} from "./company.schemas.js";

const invitationTtlMs = 7 * 24 * 60 * 60 * 1000;

async function createCompanySlug(app: FastifyInstance, name: string) {
  const baseSlug = slugify(name);
  const existing = await app.prisma.company.findUnique({
    where: { slug: baseSlug },
    select: { id: true }
  });

  return existing ? addSlugSuffix(baseSlug, createOpaqueToken(4)) : baseSlug;
}

const memberSelect = {
  id: true,
  role: true,
  createdAt: true,
  updatedAt: true,
  user: {
    select: {
      id: true,
      email: true,
      name: true,
      emailVerifiedAt: true,
      createdAt: true
    }
  }
} satisfies Prisma.CompanyMembershipSelect;

const invitationSelect = {
  id: true,
  email: true,
  role: true,
  expiresAt: true,
  acceptedAt: true,
  createdAt: true,
  invitedBy: {
    select: {
      id: true,
      name: true,
      email: true
    }
  }
} satisfies Prisma.CompanyInvitationSelect;

export const companyRoutes: FastifyPluginCallback = (app, _options, done) => {
  app.get(
    "/current",
    { preHandler: async (request) => app.authenticate(request) },
    async (request) => {
      requirePermission(request, "company:read");
      const tenant = requireTenantContext(request);

      const company = await app.prisma.company.findUnique({
        where: { id: tenant.companyId },
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          createdAt: true,
          updatedAt: true
        }
      });

      if (!company) {
        throw AppError.notFound("Company not found");
      }

      return { company };
    }
  );

  app.get(
    "/current/members",
    { preHandler: async (request) => app.authenticate(request) },
    async (request) => {
      requirePermission(request, "company:update");
      const tenant = requireTenantContext(request);

      const [members, invitations] = await Promise.all([
        app.prisma.companyMembership.findMany({
          where: { companyId: tenant.companyId },
          orderBy: [{ role: "asc" }, { createdAt: "asc" }],
          select: memberSelect
        }),
        app.prisma.companyInvitation.findMany({
          where: {
            companyId: tenant.companyId,
            acceptedAt: null,
            expiresAt: { gt: new Date() }
          },
          orderBy: { createdAt: "desc" },
          select: invitationSelect
        })
      ]);

      return { members, invitations };
    }
  );

  app.post(
    "/current/invitations",
    { preHandler: async (request) => app.authenticate(request) },
    async (request, reply) => {
      requirePermission(request, "company:update");
      const tenant = requireTenantContext(request);
      const input = inviteCompanyMemberSchema.parse(request.body);
      const token = createOpaqueToken();
      const tokenHash = hashToken(token);

      const result = await app.prisma.$transaction(async (tx) => {
        const [company, inviter, existingUser] = await Promise.all([
          tx.company.findUnique({
            where: { id: tenant.companyId },
            select: { id: true, name: true }
          }),
          tx.user.findUnique({
            where: { id: tenant.userId },
            select: { id: true, name: true }
          }),
          tx.user.findUnique({
            where: { email: input.email },
            select: {
              id: true,
              memberships: {
                where: { companyId: tenant.companyId },
                select: { id: true }
              }
            }
          })
        ]);

        if (!company || !inviter) {
          throw AppError.notFound("Company or inviter not found");
        }

        if (existingUser?.memberships.length) {
          throw AppError.conflict("User is already a member of this company");
        }

        if (existingUser) {
          const member = await tx.companyMembership.create({
            data: {
              companyId: tenant.companyId,
              userId: existingUser.id,
              role: input.role
            },
            select: memberSelect
          });

          return {
            company,
            inviter,
            member,
            invitation: null,
            invitationUrl: `${app.config.WEB_PUBLIC_URL}/login`
          };
        }

        await tx.companyInvitation.updateMany({
          where: {
            companyId: tenant.companyId,
            email: input.email,
            acceptedAt: null
          },
          data: {
            acceptedAt: new Date()
          }
        });

        const invitation = await tx.companyInvitation.create({
          data: {
            companyId: tenant.companyId,
            email: input.email,
            role: input.role,
            tokenHash,
            invitedByUserId: tenant.userId,
            expiresAt: new Date(Date.now() + invitationTtlMs)
          },
          select: invitationSelect
        });

        return {
          company,
          inviter,
          member: null,
          invitation,
          invitationUrl: `${app.config.WEB_PUBLIC_URL}/signup?invite=${token}`
        };
      });

      await app.emailJobs.enqueueTeamInvitationEmail({
        email: input.email,
        companyName: result.company.name,
        invitedByName: result.inviter.name,
        role: input.role,
        invitationUrl: result.invitationUrl
      });

      reply.status(result.member ? 200 : 201);
      return result.member ? { member: result.member } : { invitation: result.invitation };
    }
  );

  app.patch(
    "/current/members/:membershipId",
    { preHandler: async (request) => app.authenticate(request) },
    async (request) => {
      requirePermission(request, "company:update");
      const tenant = requireTenantContext(request);
      const { membershipId } = request.params as { readonly membershipId: string };
      const input = updateCompanyMemberRoleSchema.parse(request.body);

      const member = await app.prisma.$transaction(async (tx) => {
        const existing = await tx.companyMembership.findFirst({
          where: { id: membershipId, companyId: tenant.companyId },
          select: { id: true, role: true }
        });

        if (!existing) {
          throw AppError.notFound("Team member not found");
        }

        if (isAdminRole(existing.role) && !isAdminRole(input.role)) {
          await assertCompanyKeepsAdmin(tx, tenant.companyId, existing.id);
        }

        return tx.companyMembership.update({
          where: { id: membershipId },
          data: { role: input.role },
          select: memberSelect
        });
      });

      return { member };
    }
  );

  app.delete(
    "/current/members/:membershipId",
    { preHandler: async (request) => app.authenticate(request) },
    async (request, reply) => {
      requirePermission(request, "company:update");
      const tenant = requireTenantContext(request);
      const { membershipId } = request.params as { readonly membershipId: string };

      await app.prisma.$transaction(async (tx) => {
        const existing = await tx.companyMembership.findFirst({
          where: { id: membershipId, companyId: tenant.companyId },
          select: { id: true, role: true }
        });

        if (!existing) {
          throw AppError.notFound("Team member not found");
        }

        if (isAdminRole(existing.role)) {
          await assertCompanyKeepsAdmin(tx, tenant.companyId, existing.id);
        }

        await tx.companyMembership.delete({
          where: { id: membershipId }
        });
      });

      reply.status(204);
    }
  );

  app.patch(
    "/current",
    { preHandler: async (request) => app.authenticate(request) },
    async (request) => {
      requirePermission(request, "company:update");
      const tenant = requireTenantContext(request);
      const input = updateCurrentCompanySchema.parse(request.body);

      const company = await app.prisma.company.update({
        where: { id: tenant.companyId },
        data: { name: input.name },
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          updatedAt: true
        }
      });

      return { company };
    }
  );

  app.get("/", { preHandler: async (request) => app.authenticate(request) }, async (request) => {
    const tenant = requireTenantContext(request);

    if (tenant.role !== "super_admin") {
      throw AppError.forbidden();
    }

    const companies = await app.prisma.company.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        createdAt: true
      },
      take: 100
    });

    return { companies };
  });

  app.post(
    "/",
    { preHandler: async (request) => app.authenticate(request) },
    async (request, reply) => {
      const tenant = requireTenantContext(request);

      if (tenant.role !== "super_admin") {
        throw AppError.forbidden();
      }

      const input = createCompanySchema.parse(request.body);
      const company = await app.prisma.company.create({
        data: {
          name: input.name,
          slug: await createCompanySlug(app, input.name)
        },
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          createdAt: true
        }
      });

      reply.status(201);
      return { company };
    }
  );

  done();
};

function isAdminRole(role: UserRole): boolean {
  return role === "company_admin" || role === "super_admin";
}

async function assertCompanyKeepsAdmin(
  tx: Prisma.TransactionClient,
  companyId: string,
  changedMembershipId: string
): Promise<void> {
  const remainingAdmins = await tx.companyMembership.count({
    where: {
      companyId,
      id: { not: changedMembershipId },
      role: { in: ["company_admin", "super_admin"] }
    }
  });

  if (remainingAdmins === 0) {
    throw AppError.badRequest("A company must keep at least one admin member");
  }
}
