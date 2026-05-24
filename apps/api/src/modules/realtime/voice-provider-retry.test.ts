import { describe, expect, it } from "vitest";
import { ProviderRequestError } from "@altrion/shared";
import { shouldRetryProviderError, withVoiceProviderRetries } from "./voice-provider-retry.js";

describe("voice provider retry policy", () => {
  it("retries retryable provider failures", async () => {
    let attempts = 0;

    const result = await withVoiceProviderRetries(
      {
        operationName: "llm.complete",
        maxAttempts: 2,
        initialDelayMs: 0
      },
      () => {
        attempts += 1;

        if (attempts === 1) {
          throw new ProviderRequestError({
            providerKind: "llm",
            providerName: "groq",
            code: "rate_limited",
            message: "rate limited",
            retryable: true
          });
        }

        return Promise.resolve("ok");
      }
    );

    expect(result).toBe("ok");
    expect(attempts).toBe(2);
  });

  it("does not retry non-retryable provider failures", () => {
    const error = new ProviderRequestError({
      providerKind: "tts",
      providerName: "groq",
      code: "invalid_request",
      message: "bad request",
      retryable: false
    });

    expect(shouldRetryProviderError(error, 1, 2)).toBe(false);
  });
});
