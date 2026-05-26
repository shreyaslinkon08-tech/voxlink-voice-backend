import { ZodError } from "zod";
import type { FastifyInstance } from "fastify";
import { ProviderRequestError, providerErrorCodeValues } from "@voxlink/shared";
import { AppError } from "../errors/app-error.js";

interface ProviderRequestErrorShape {
  readonly providerKind: string;
  readonly providerName: string;
  readonly code: ProviderRequestError["code"];
  readonly retryable: boolean;
  readonly message: string;
}

const providerErrorCodes = new Set<string>(providerErrorCodeValues);

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

    const providerError = normalizeProviderRequestError(error);

    if (providerError) {
      const statusCode = providerStatusCode(providerError.code);
      request.log.warn(
        {
          providerKind: providerError.providerKind,
          providerName: providerError.providerName,
          providerCode: providerError.code,
          retryable: providerError.retryable,
          statusCode
        },
        "Provider request failed"
      );
      void reply.status(statusCode).send({
        error: {
          code: "PROVIDER_REQUEST_FAILED",
          message: providerError.message,
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

function normalizeProviderRequestError(error: unknown): ProviderRequestErrorShape | null {
  if (error instanceof ProviderRequestError) {
    return error;
  }

  if (
    typeof error !== "object" ||
    error === null ||
    !("providerKind" in error) ||
    !("providerName" in error) ||
    !("code" in error) ||
    !("retryable" in error) ||
    !("message" in error)
  ) {
    return null;
  }

  const candidate = error as {
    readonly providerKind?: unknown;
    readonly providerName?: unknown;
    readonly code?: unknown;
    readonly retryable?: unknown;
    readonly message?: unknown;
  };

  if (
    typeof candidate.providerKind !== "string" ||
    typeof candidate.providerName !== "string" ||
    typeof candidate.retryable !== "boolean" ||
    typeof candidate.message !== "string" ||
    !isProviderErrorCode(candidate.code)
  ) {
    return null;
  }

  return {
    providerKind: candidate.providerKind,
    providerName: candidate.providerName,
    code: candidate.code,
    retryable: candidate.retryable,
    message: candidate.message
  };
}

function isProviderErrorCode(value: unknown): value is ProviderRequestError["code"] {
  return typeof value === "string" && providerErrorCodes.has(value);
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
