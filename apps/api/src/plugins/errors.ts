import { ZodError } from "zod";
import type { FastifyInstance } from "fastify";
import { ProviderRequestError } from "@altrion/shared";
import { AppError } from "../errors/app-error.js";

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      void reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          requestId: request.id,
          issues: error.issues
        }
      });
      return;
    }

    if (error instanceof AppError) {
      void reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.expose ? error.message : "Internal server error",
          requestId: request.id
        }
      });
      return;
    }

    if (error instanceof ProviderRequestError) {
      const statusCode = providerStatusCode(error.code);
      request.log.warn(
        {
          providerKind: error.providerKind,
          providerName: error.providerName,
          providerCode: error.code,
          retryable: error.retryable,
          statusCode
        },
        "Provider request failed"
      );
      void reply.status(statusCode).send({
        error: {
          code: "PROVIDER_REQUEST_FAILED",
          message: error.message,
          requestId: request.id
        }
      });
      return;
    }

    request.log.error({ error }, "Unhandled API error");
    void reply.status(500).send({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Internal server error",
        requestId: request.id
      }
    });
  });
}

function providerStatusCode(code: ProviderRequestError["code"]): number {
  switch (code) {
    case "authentication_failed":
    case "invalid_request":
      return 400;
    case "rate_limited":
    case "quota_exceeded":
      return 429;
    case "timeout":
      return 504;
    case "provider_unavailable":
    case "transient_network":
    case "internal_provider_error":
    case "unknown":
      return 502;
  }
}
