import {
  ApiKeyRing,
  ProviderHealthTracker,
  ProviderRequestError,
  isAbortError,
  isRetryableProviderCode,
  providerCodeFromHttpStatus,
  redactProviderSecrets,
  safeReadResponseText,
  type ChatMessage,
  type LlmCompletionRequest,
  type LlmCompletionResponse,
  type LlmModelProfile,
  type LlmProviderPort,
  type ProviderExecutionContext,
  type ProviderHealthSnapshot
} from "@altrion/shared";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

interface GroqChatCompletionResponse {
  readonly id?: string;
  readonly choices?: readonly {
    readonly message?: {
      readonly content?: string;
    };
  }[];
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
  };
}

export interface GroqLlmProviderConfig {
  readonly apiKeys: readonly string[];
  readonly baseUrl?: string;
  readonly defaultProfile?: LlmModelProfile;
  readonly models?: Partial<Record<LlmModelProfile, string>>;
  readonly fetchImpl?: FetchLike;
  readonly requestTimeoutMs?: number;
}

const defaultModels: Partial<Record<LlmModelProfile, string>> = {
  llama: "llama-3.3-70b-versatile",
  gemma: "gemma2-9b-it",
  gpt: "openai/gpt-oss-120b"
};

export class GroqLlmProvider implements LlmProviderPort {
  readonly providerKind = "llm" as const;
  readonly providerName = "groq";

  private readonly baseUrl: string;
  private readonly defaultProfile: LlmModelProfile;
  private readonly fetchImpl: FetchLike;
  private readonly keyRing: ApiKeyRing;
  private readonly models: Partial<Record<LlmModelProfile, string>>;
  private readonly requestTimeoutMs: number;
  private readonly healthTracker = new ProviderHealthTracker({
    providerKind: this.providerKind,
    providerName: this.providerName
  });

  constructor(config: GroqLlmProviderConfig) {
    this.baseUrl = config.baseUrl ?? "https://api.groq.com/openai/v1";
    this.defaultProfile = config.defaultProfile ?? "llama";
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.keyRing = new ApiKeyRing({
      providerKind: this.providerKind,
      providerName: this.providerName,
      apiKeys: config.apiKeys
    });
    this.models = { ...defaultModels, ...config.models };
    this.requestTimeoutMs = config.requestTimeoutMs ?? 10_000;
  }

  health(): Promise<ProviderHealthSnapshot> {
    return Promise.resolve(this.healthTracker.snapshot());
  }

  async complete(
    request: LlmCompletionRequest,
    context: ProviderExecutionContext
  ): Promise<LlmCompletionResponse> {
    const timeoutMs = context.timeoutPolicy?.requestTimeoutMs ?? this.requestTimeoutMs;
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), timeoutMs);

    try {
      this.healthTracker.assertCanRequest(context.circuitBreakerPolicy);
      const response = await this.fetchImpl(this.endpoint("chat/completions"), {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.keyRing.next()}`,
          "content-type": "application/json",
          "x-request-id": context.requestId,
          ...(context.companyId ? { "x-altrion-company-id": context.companyId } : {})
        },
        body: JSON.stringify(this.toGroqPayload(request)),
        signal: abortController.signal
      });

      if (!response.ok) {
        throw await this.errorFromResponse(response);
      }

      const payload = (await response.json()) as GroqChatCompletionResponse;
      const text = payload.choices?.[0]?.message?.content?.trim();

      if (!text) {
        throw new ProviderRequestError({
          providerKind: this.providerKind,
          providerName: this.providerName,
          code: "internal_provider_error",
          message: "Groq returned an empty LLM response",
          retryable: true
        });
      }

      this.healthTracker.recordSuccess();

      return {
        text,
        providerRequestId:
          response.headers.get("x-request-id") ?? response.headers.get("x-groq-id") ?? payload.id,
        tokenUsage:
          payload.usage?.prompt_tokens !== undefined &&
          payload.usage.completion_tokens !== undefined
            ? {
                inputTokens: payload.usage.prompt_tokens,
                outputTokens: payload.usage.completion_tokens
              }
            : undefined
      };
    } catch (error) {
      const providerError = this.normalizeError(error);
      this.healthTracker.recordFailure(providerError, context.circuitBreakerPolicy);
      throw providerError;
    } finally {
      clearTimeout(timeout);
    }
  }

  private toGroqPayload(request: LlmCompletionRequest): Record<string, unknown> {
    if (request.messages.length === 0) {
      throw new ProviderRequestError({
        providerKind: this.providerKind,
        providerName: this.providerName,
        code: "invalid_request",
        message: "LLM completion requires at least one message",
        retryable: false
      });
    }

    const profile = request.modelProfile ?? this.defaultProfile;
    const model = this.models[profile];

    if (!model) {
      throw new ProviderRequestError({
        providerKind: this.providerKind,
        providerName: this.providerName,
        code: "invalid_request",
        message: `No Groq model configured for LLM profile "${profile}"`,
        retryable: false
      });
    }

    return {
      model,
      messages: this.withRetrievedContext(request.messages, request.retrievedContext),
      temperature: request.temperature ?? 0.3,
      max_tokens: request.maxTokens
    };
  }

  private endpoint(path: string): URL {
    return new URL(`${this.baseUrl.replace(/\/$/, "")}/${path}`);
  }

  private withRetrievedContext(
    messages: readonly ChatMessage[],
    retrievedContext?: readonly string[]
  ): readonly ChatMessage[] {
    const contextText = retrievedContext
      ?.map((chunk) => chunk.trim())
      .filter(Boolean)
      .join("\n\n---\n\n");

    if (!contextText) {
      return messages;
    }

    return [
      {
        role: "system",
        content:
          "Use this retrieved company knowledge when it is relevant. Do not reveal internal retrieval details.\n\n" +
          contextText
      },
      ...messages
    ];
  }

  private async errorFromResponse(response: Response): Promise<ProviderRequestError> {
    const body = await safeReadResponseText(response);
    const statusCode = response.status;
    const code = providerCodeFromHttpStatus(statusCode, body);

    return new ProviderRequestError({
      providerKind: this.providerKind,
      providerName: this.providerName,
      code,
      message: `Groq LLM request failed with HTTP ${statusCode}`,
      retryable: isRetryableProviderCode(code),
      cause: { statusCode, body: redactProviderSecrets(body) }
    });
  }

  private normalizeError(error: unknown): ProviderRequestError {
    if (error instanceof ProviderRequestError) {
      return error;
    }

    if (isAbortError(error)) {
      return new ProviderRequestError({
        providerKind: this.providerKind,
        providerName: this.providerName,
        code: "timeout",
        message: "Groq LLM request timed out",
        retryable: true,
        cause: error
      });
    }

    return new ProviderRequestError({
      providerKind: this.providerKind,
      providerName: this.providerName,
      code: "transient_network",
      message: "Groq LLM request failed before a response was received",
      retryable: true,
      cause: error
    });
  }
}
