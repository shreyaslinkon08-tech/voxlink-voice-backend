import { z } from "zod";

export const providerKindValues = ["telephony", "llm", "stt", "tts", "rag"] as const;
export const providerKindSchema = z.enum(providerKindValues);
export type ProviderKind = z.infer<typeof providerKindSchema>;

export const providerErrorCodeValues = [
  "timeout",
  "rate_limited",
  "authentication_failed",
  "provider_unavailable",
  "invalid_request",
  "quota_exceeded",
  "transient_network",
  "internal_provider_error",
  "unknown"
] as const;

export const providerErrorCodeSchema = z.enum(providerErrorCodeValues);
export type ProviderErrorCode = z.infer<typeof providerErrorCodeSchema>;

export interface ProviderFailure {
  readonly providerKind: ProviderKind;
  readonly providerName: string;
  readonly code: ProviderErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly cause?: unknown;
  readonly occurredAt: Date;
}

export interface TimeoutPolicy {
  readonly connectTimeoutMs: number;
  readonly requestTimeoutMs: number;
  readonly streamIdleTimeoutMs?: number;
}

export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  readonly backoffMultiplier: number;
  readonly retryableCodes: readonly ProviderErrorCode[];
}

export interface CircuitBreakerPolicy {
  readonly failureThreshold: number;
  readonly halfOpenAfterMs: number;
  readonly rollingWindowMs: number;
}

export type CircuitBreakerState = "closed" | "open" | "half_open";

export interface ProviderHealthSnapshot {
  readonly providerKind: ProviderKind;
  readonly providerName: string;
  readonly circuitState: CircuitBreakerState;
  readonly consecutiveFailures: number;
  readonly lastFailure?: ProviderFailure;
}

export interface ProviderExecutionContext {
  readonly requestId: string;
  readonly companyId?: string;
  readonly timeoutPolicy?: TimeoutPolicy;
  readonly retryPolicy?: RetryPolicy;
  readonly circuitBreakerPolicy?: CircuitBreakerPolicy;
  readonly fallbackProviderNames?: readonly string[];
}

export interface ProviderPort {
  readonly providerKind: ProviderKind;
  readonly providerName: string;
  health(): Promise<ProviderHealthSnapshot>;
}

export class ProviderRequestError extends Error implements ProviderFailure {
  readonly providerKind: ProviderKind;
  readonly providerName: string;
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;
  override readonly cause?: unknown;
  readonly occurredAt: Date;

  constructor(failure: Omit<ProviderFailure, "occurredAt"> & { readonly occurredAt?: Date }) {
    super(failure.message);
    this.name = "ProviderRequestError";
    this.providerKind = failure.providerKind;
    this.providerName = failure.providerName;
    this.code = failure.code;
    this.retryable = failure.retryable;
    this.cause = failure.cause;
    this.occurredAt = failure.occurredAt ?? new Date();
  }
}
