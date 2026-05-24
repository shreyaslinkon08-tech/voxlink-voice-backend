import { createHash } from "node:crypto";
import type { FastifyPluginCallback } from "fastify";
import type { Multipart, MultipartFields } from "@fastify/multipart";
import { UsageMetric, type Prisma } from "@prisma/client";
import { AppError } from "../../errors/app-error.js";
import { requirePermission } from "../../security/rbac.js";
import { requireTenantContext } from "../../security/tenant-context.js";
import { assertAndIncrementUsage } from "../billing/usage-limits.js";
import { chunkKnowledgeText } from "./chunk-text.js";
import {
  createTextKnowledgeBaseSchema,
  listKnowledgeBaseQuerySchema,
  registerWebsiteKnowledgeBaseSchema
} from "./knowledge-base.schemas.js";
import { extractKnowledgeFileText } from "./file-ingestion.js";
import { fetchWebsiteKnowledgeText } from "./website-ingestion.js";

const knowledgeBaseSelect = {
  id: true,
  title: true,
  sourceType: true,
  status: true,
  originalFileName: true,
  sourceUri: true,
  mimeType: true,
  contentSha256: true,
  metadata: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: {
      embeddings: true
    }
  }
} satisfies Prisma.KnowledgeBaseSelect;

export const knowledgeBaseRoutes: FastifyPluginCallback = (app, _options, done) => {
  app.get("/", { preHandler: async (request) => app.authenticate(request) }, async (request) => {
    requirePermission(request, "knowledge_base:read");
    const tenant = requireTenantContext(request);
    const query = listKnowledgeBaseQuerySchema.parse(request.query);
    const where = {
      companyId: tenant.companyId,
      ...(query.status ? { status: query.status } : {})
    } satisfies Prisma.KnowledgeBaseWhereInput;

    const [knowledgeBase, total] = await Promise.all([
      app.prisma.knowledgeBase.findMany({
        where,
        orderBy: { createdAt: "desc" },
        select: knowledgeBaseSelect,
        take: query.limit,
        skip: query.offset
      }),
      app.prisma.knowledgeBase.count({ where })
    ]);

    return { knowledgeBase, total, limit: query.limit, offset: query.offset };
  });

  app.post(
    "/text",
    { preHandler: async (request) => app.authenticate(request) },
    async (request, reply) => {
      requirePermission(request, "knowledge_base:write");
      const tenant = requireTenantContext(request);
      const input = createTextKnowledgeBaseSchema.parse(request.body);
      const chunks = chunkKnowledgeText(input.content);

      if (chunks.length === 0) {
        throw AppError.badRequest("Knowledge content did not produce any chunks");
      }

      const contentSha256 = createHash("sha256").update(input.content).digest("hex");
      const knowledgeBase = await app.prisma.$transaction(async (tx) => {
        const created = await tx.knowledgeBase.create({
          data: {
            companyId: tenant.companyId,
            title: input.title,
            sourceType: "text",
            status: "ready",
            contentSha256,
            metadata: {
              ...input.metadata,
              embeddingStatus: "not_generated"
            },
            embeddings: {
              createMany: {
                data: chunks.map((chunk) => ({
                  companyId: tenant.companyId,
                  chunkIndex: chunk.chunkIndex,
                  chunkText: chunk.chunkText,
                  metadata: {
                    embeddingStatus: "not_generated"
                  }
                }))
              }
            }
          },
          select: knowledgeBaseSelect
        });

        await assertAndIncrementUsage(tx, tenant.companyId, UsageMetric.knowledge_items, 1);
        return created;
      });

      reply.status(201);
      return { knowledgeBase };
    }
  );

  app.post(
    "/files",
    { preHandler: async (request) => app.authenticate(request) },
    async (request, reply) => {
      requirePermission(request, "knowledge_base:write");
      const tenant = requireTenantContext(request);
      const file = await request.file();

      if (!file) {
        throw AppError.badRequest("Knowledge file is required");
      }

      const buffer = await file.toBuffer();
      const extracted = await extractKnowledgeFileText({
        filename: file.filename,
        mimeType: file.mimetype,
        buffer
      });
      const title = multipartFieldValue(file.fields, "title") ?? titleFromFilename(file.filename);
      const chunks = chunkKnowledgeText(extracted.content);

      if (chunks.length === 0) {
        throw AppError.badRequest("Uploaded file did not produce any chunks");
      }

      const knowledgeBase = await app.prisma.$transaction(async (tx) => {
        const created = await tx.knowledgeBase.create({
          data: {
            companyId: tenant.companyId,
            title,
            sourceType: "file",
            status: "ready",
            originalFileName: file.filename,
            mimeType: extracted.mimeType,
            contentSha256: extracted.contentSha256,
            metadata: {
              ...extracted.metadata,
              embeddingStatus: "not_generated"
            },
            embeddings: {
              createMany: {
                data: chunks.map((chunk) => ({
                  companyId: tenant.companyId,
                  chunkIndex: chunk.chunkIndex,
                  chunkText: chunk.chunkText,
                  metadata: {
                    embeddingStatus: "not_generated",
                    source: "file_ingestion"
                  }
                }))
              }
            }
          },
          select: knowledgeBaseSelect
        });

        await assertAndIncrementUsage(tx, tenant.companyId, UsageMetric.knowledge_items, 1);
        return created;
      });

      reply.status(201);
      return { knowledgeBase };
    }
  );

  app.post(
    "/websites",
    { preHandler: async (request) => app.authenticate(request) },
    async (request, reply) => {
      requirePermission(request, "knowledge_base:write");
      const tenant = requireTenantContext(request);
      const input = registerWebsiteKnowledgeBaseSchema.parse(request.body);
      const website = await fetchWebsiteKnowledgeText(input.sourceUri);
      const chunks = chunkKnowledgeText(website.content);

      if (chunks.length === 0) {
        throw AppError.badRequest("Website content did not produce any chunks");
      }

      const knowledgeBase = await app.prisma.$transaction(async (tx) => {
        const created = await tx.knowledgeBase.create({
          data: {
            companyId: tenant.companyId,
            title: input.title,
            sourceType: "website",
            status: "ready",
            sourceUri: input.sourceUri,
            mimeType: website.contentType,
            contentSha256: website.contentSha256,
            metadata: {
              ...input.metadata,
              extractionTitle: website.title,
              finalUrl: website.finalUrl,
              fetchedAt: website.fetchedAt,
              embeddingStatus: "not_generated"
            },
            embeddings: {
              createMany: {
                data: chunks.map((chunk) => ({
                  companyId: tenant.companyId,
                  chunkIndex: chunk.chunkIndex,
                  chunkText: chunk.chunkText,
                  metadata: {
                    embeddingStatus: "not_generated",
                    source: "website_ingestion"
                  }
                }))
              }
            }
          },
          select: knowledgeBaseSelect
        });

        await assertAndIncrementUsage(tx, tenant.companyId, UsageMetric.knowledge_items, 1);
        return created;
      });

      reply.status(201);
      return { knowledgeBase };
    }
  );

  app.get(
    "/:knowledgeBaseId/chunks",
    { preHandler: async (request) => app.authenticate(request) },
    async (request) => {
      requirePermission(request, "knowledge_base:read");
      const tenant = requireTenantContext(request);
      const { knowledgeBaseId } = request.params as { readonly knowledgeBaseId: string };

      const source = await app.prisma.knowledgeBase.findFirst({
        where: { id: knowledgeBaseId, companyId: tenant.companyId },
        select: { id: true }
      });

      if (!source) {
        throw AppError.notFound("Knowledge source not found");
      }

      const chunks = await app.prisma.embedding.findMany({
        where: {
          companyId: tenant.companyId,
          knowledgeBaseId
        },
        orderBy: { chunkIndex: "asc" },
        select: {
          id: true,
          chunkIndex: true,
          chunkText: true,
          metadata: true,
          createdAt: true
        },
        take: 100
      });

      return { chunks };
    }
  );

  done();
};

function multipartFieldValue(fields: MultipartFields, name: string): string | undefined {
  const field = fields[name];
  const firstField = Array.isArray(field) ? field[0] : field;

  if (isMultipartValue(firstField) && typeof firstField.value === "string") {
    const value = firstField.value.trim();
    return value.length > 0 ? value : undefined;
  }

  return undefined;
}

function isMultipartValue(value: Multipart | undefined): value is Extract<Multipart, { type: "field" }> {
  return value?.type === "field";
}

function titleFromFilename(filename: string): string {
  const withoutExtension = filename.replace(/\.[^.]+$/, "").trim();
  return withoutExtension || "Knowledge file";
}
