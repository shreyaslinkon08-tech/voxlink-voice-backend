import type { FastifyBaseLogger } from "fastify";
import { ProviderRequestError } from "@voxlink/shared";

export interface VoiceProviderRetryOptions {
  readonly operationName: string;
  readonly maxAttempts?: number;
  readonly initialDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly backoffMultiplier?: number;
  readonly log?: FastifyBaseLogger;
}

export async function withVoiceProviderRetries<T>(
  options: VoiceProviderRetryOptions,
  operation: () => Promise<T>
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 2;
  const initialDelayMs = options.initialDelayMs ?? 150;
  const maxDelayMs = options.maxDelayMs ?? 1_000;
  const backoffMultiplier = options.backoffMultiplier ?? 2;
  let attempt = 1;
  let delayMs = initialDelayMs;

  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (!shouldRetryProviderError(error, attempt, maxAttempts)) {
        throw error;
      }

      options.log?.warn(
        {
          operationName: options.operationName,
          attempt,
          nextAttempt: attempt + 1,
          delayMs,
          providerCode: error.code,
          providerName: error.providerName,
          providerKind: error.providerKind
        },
        "Retrying voice provider operation"
      );

      await sleep(delayMs);
      attempt += 1;
      delayMs = Math.min(maxDelayMs, Math.round(delayMs * backoffMultiplier));
    }
  }
}

export function shouldRetryProviderError(
  error: unknown,
  attempt: number,
  maxAttempts: number
): error is ProviderRequestError {
  return error instanceof ProviderRequestError && error.retryable && attempt < maxAttempts;
}

function sleep(delayMs: number): Promise<void> {
  if (delayMs <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
