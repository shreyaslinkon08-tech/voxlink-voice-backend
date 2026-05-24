import {
  ProviderRequestError,
  type CircuitBreakerPolicy,
  type CircuitBreakerState,
  type ProviderFailure,
  type ProviderHealthSnapshot,
  type ProviderKind
} from "./provider-failure.js";

export interface ApiKeyRingOptions {
  readonly providerKind: ProviderKind;
  readonly providerName: string;
  readonly apiKeys: readonly string[];
}

export class ApiKeyRing {
  private readonly apiKeys: readonly string[];
  private nextIndex = 0;

  constructor(private readonly options: ApiKeyRingOptions) {
    this.apiKeys = options.apiKeys.map((key) => key.trim()).filter(Boolean);
  }

  get size(): number {
    return this.apiKeys.length;
  }

  next(): string {
    if (this.apiKeys.length === 0) {
      throw new ProviderRequestError({
        providerKind: this.options.providerKind,
        providerName: this.options.providerName,
        code: "authentication_failed",
        message: `${this.options.providerName} has no API keys configured`,
        retryable: false
      });
    }

    const key = this.apiKeys[this.nextIndex] as string;
    this.nextIndex = (this.nextIndex + 1) % this.apiKeys.length;

    return key;
  }
}

export interface ProviderHealthTrackerOptions {
  readonly providerKind: ProviderKind;
  readonly providerName: string;
}

export class ProviderHealthTracker {
  private circuitState: CircuitBreakerState = "closed";
  private consecutiveFailures = 0;
  private lastFailure: ProviderFailure | undefined;
  private openedAtMs: number | undefined;

  constructor(private readonly options: ProviderHealthTrackerOptions) {}

  assertCanRequest(policy?: CircuitBreakerPolicy): void {
    if (this.circuitState !== "open") {
      return;
    }

    const openedAtMs = this.openedAtMs ?? Date.now();
    const halfOpenAfterMs = policy?.halfOpenAfterMs ?? 30_000;

    if (Date.now() - openedAtMs >= halfOpenAfterMs) {
      this.circuitState = "half_open";
      return;
    }

    throw new ProviderRequestError({
      providerKind: this.options.providerKind,
      providerName: this.options.providerName,
      code: "provider_unavailable",
      message: `${this.options.providerName} circuit breaker is open`,
      retryable: true
    });
  }

  recordSuccess(): void {
    this.circuitState = "closed";
    this.consecutiveFailures = 0;
    this.openedAtMs = undefined;
  }

  recordFailure(failure: ProviderFailure, policy?: CircuitBreakerPolicy): void {
    this.lastFailure = failure;
    this.consecutiveFailures += 1;

    const failureThreshold = policy?.failureThreshold ?? 5;

    if (this.consecutiveFailures >= failureThreshold) {
      this.circuitState = "open";
      this.openedAtMs = Date.now();
    }
  }

  snapshot(): ProviderHealthSnapshot {
    return {
      providerKind: this.options.providerKind,
      providerName: this.options.providerName,
      circuitState: this.circuitState,
      consecutiveFailures: this.consecutiveFailures,
      lastFailure: this.lastFailure
    };
  }
}
