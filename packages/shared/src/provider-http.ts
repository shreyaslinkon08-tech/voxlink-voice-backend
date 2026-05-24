import type { ProviderErrorCode } from "./provider-failure.js";

export function providerCodeFromHttpStatus(statusCode: number, body = ""): ProviderErrorCode {
  if (statusCode === 401 || statusCode === 403) {
    return "authentication_failed";
  }

  if (statusCode === 408 || statusCode === 504) {
    return "timeout";
  }

  if (statusCode === 429) {
    return body.toLowerCase().includes("quota") ? "quota_exceeded" : "rate_limited";
  }

  if (statusCode >= 500) {
    return "provider_unavailable";
  }

  if (statusCode >= 400) {
    return "invalid_request";
  }

  return "unknown";
}

export function isRetryableProviderCode(code: ProviderErrorCode): boolean {
  return [
    "timeout",
    "rate_limited",
    "quota_exceeded",
    "provider_unavailable",
    "transient_network",
    "internal_provider_error"
  ].includes(code);
}

export function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { readonly name?: unknown }).name === "AbortError"
  );
}

export async function safeReadResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

export function redactProviderSecrets(value: string): string {
  return value.replace(/gsk_[A-Za-z0-9]+/g, "[redacted-groq-key]").slice(0, 1_000);
}
