import {
  ApiKeyRing,
  ProviderHealthTracker,
  ProviderRequestError,
  isAbortError,
  isRetryableProviderCode,
  providerCodeFromHttpStatus,
  redactProviderSecrets,
  safeReadResponseText,
  type ProviderExecutionContext,
  type ProviderHealthSnapshot,
  type TtsModelId,
  type TtsProviderPort,
  type TtsSynthesisRequest
} from "@voxlink/shared";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface GroqTtsProviderConfig {
  readonly apiKeys: readonly string[];
  readonly baseUrl?: string;
  readonly defaultModel?: TtsModelId;
  readonly fetchImpl?: FetchLike;
  readonly requestTimeoutMs?: number;
  readonly maxInputCharacters?: number;
}

export class GroqTtsProvider implements TtsProviderPort {
  readonly providerKind = "tts" as const;
  readonly providerName = "groq";

  private readonly baseUrl: string;
  private readonly defaultModel: TtsModelId;
  private readonly fetchImpl: FetchLike;
  private readonly keyRing: ApiKeyRing;
  private readonly requestTimeoutMs: number;
  private readonly maxInputCharacters: number;
  private readonly healthTracker = new ProviderHealthTracker({
    providerKind: this.providerKind,
    providerName: this.providerName
  });

  constructor(config: GroqTtsProviderConfig) {
    this.baseUrl = config.baseUrl ?? "https://api.groq.com/openai/v1";
    this.defaultModel = config.defaultModel ?? "canopylabs/orpheus-v1-english";
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.keyRing = new ApiKeyRing({
      providerKind: this.providerKind,
      providerName: this.providerName,
      apiKeys: config.apiKeys
    });
    this.requestTimeoutMs = config.requestTimeoutMs ?? 20_000;
    this.maxInputCharacters = config.maxInputCharacters ?? 200;
  }

  health(): Promise<ProviderHealthSnapshot> {
    return Promise.resolve(this.healthTracker.snapshot());
  }

  async *synthesize(
    request: TtsSynthesisRequest,
    context: ProviderExecutionContext
  ): AsyncIterable<Uint8Array> {
    if (request.outputFormat !== "wav") {
      throw new ProviderRequestError({
        providerKind: this.providerKind,
        providerName: this.providerName,
        code: "invalid_request",
        message: "Groq Orpheus TTS currently supports wav output only",
        retryable: false
      });
    }

    const textChunks = chunkText(request.text, this.maxInputCharacters);

    for (const text of textChunks) {
      const response = await this.synthesizeOnce({ ...request, text }, context);

      for await (const audioChunk of streamResponseBody(response)) {
        yield audioChunk;
      }
    }
  }

  private async synthesizeOnce(
    request: TtsSynthesisRequest,
    context: ProviderExecutionContext
  ): Promise<Response> {
    const timeoutMs = context.timeoutPolicy?.requestTimeoutMs ?? this.requestTimeoutMs;
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), timeoutMs);

    try {
      this.healthTracker.assertCanRequest(context.circuitBreakerPolicy);
      const response = await this.fetchImpl(this.endpoint("audio/speech"), {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.keyRing.next()}`,
          "content-type": "application/json",
          "x-request-id": context.requestId,
          ...(context.companyId ? { "x-voxlink-company-id": context.companyId } : {})
        },
        body: JSON.stringify({
          model: request.model ?? this.defaultModel,
          input: request.text,
          voice: request.voiceId,
          response_format: "wav"
        }),
        signal: abortController.signal
      });

      if (!response.ok) {
        throw await this.errorFromResponse(response);
      }

      this.healthTracker.recordSuccess();
      return response;
    } catch (error) {
      const providerError = this.normalizeError(error);
      this.healthTracker.recordFailure(providerError, context.circuitBreakerPolicy);
      throw providerError;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async errorFromResponse(response: Response): Promise<ProviderRequestError> {
    const body = await safeReadResponseText(response);
    const statusCode = response.status;
    const code = providerCodeFromHttpStatus(statusCode, body);

    return new ProviderRequestError({
      providerKind: this.providerKind,
      providerName: this.providerName,
      code,
      message: `Groq TTS request failed with HTTP ${statusCode}`,
      retryable: isRetryableProviderCode(code),
      cause: { statusCode, body: redactProviderSecrets(body) }
    });
  }

  private endpoint(path: string): URL {
    return new URL(`${this.baseUrl.replace(/\/$/, "")}/${path}`);
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
        message: "Groq TTS request timed out",
        retryable: true,
        cause: error
      });
    }

    return new ProviderRequestError({
      providerKind: this.providerKind,
      providerName: this.providerName,
      code: "transient_network",
      message: "Groq TTS request failed before a response was received",
      retryable: true,
      cause: error
    });
  }
}

function chunkText(text: string, maxCharacters: number): readonly string[] {
  const normalized = text.trim().replace(/\s+/g, " ");

  if (!normalized) {
    throw new ProviderRequestError({
      providerKind: "tts",
      providerName: "groq",
      code: "invalid_request",
      message: "TTS synthesis requires non-empty text",
      retryable: false
    });
  }

  const chunks: string[] = [];
  let current = "";

  for (const word of normalized.split(" ")) {
    if (word.length > maxCharacters) {
      if (current) {
        chunks.push(current);
        current = "";
      }

      for (let offset = 0; offset < word.length; offset += maxCharacters) {
        chunks.push(word.slice(offset, offset + maxCharacters));
      }

      continue;
    }

    const next = current ? `${current} ${word}` : word;

    if (next.length > maxCharacters) {
      chunks.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

async function* streamResponseBody(response: Response): AsyncIterable<Uint8Array> {
  if (!response.body) {
    yield new Uint8Array(await response.arrayBuffer());
    return;
  }

  const reader = response.body.getReader();

  try {
    while (true) {
      const read = await reader.read();

      if (read.done) {
        return;
      }

      yield read.value;
    }
  } finally {
    reader.releaseLock();
  }
}
