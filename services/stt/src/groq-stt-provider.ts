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
  type SttModelId,
  type SttProviderPort,
  type SttTranscriptionChunk,
  type SttTranscriptionRequest
} from "@altrion/shared";
import { prepareAudioFile } from "./audio-file.js";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

interface GroqTranscriptionSegment {
  readonly text?: string;
  readonly start?: number;
  readonly end?: number;
  readonly avg_logprob?: number;
}

interface GroqTranscriptionResponse {
  readonly text?: string;
  readonly segments?: readonly GroqTranscriptionSegment[];
}

export interface GroqSttProviderConfig {
  readonly apiKeys: readonly string[];
  readonly baseUrl?: string;
  readonly defaultModel?: SttModelId;
  readonly fetchImpl?: FetchLike;
  readonly requestTimeoutMs?: number;
}

export class GroqSttProvider implements SttProviderPort {
  readonly providerKind = "stt" as const;
  readonly providerName = "groq";

  private readonly baseUrl: string;
  private readonly defaultModel: SttModelId;
  private readonly fetchImpl: FetchLike;
  private readonly keyRing: ApiKeyRing;
  private readonly requestTimeoutMs: number;
  private readonly healthTracker = new ProviderHealthTracker({
    providerKind: this.providerKind,
    providerName: this.providerName
  });

  constructor(config: GroqSttProviderConfig) {
    this.baseUrl = config.baseUrl ?? "https://api.groq.com/openai/v1";
    this.defaultModel = config.defaultModel ?? "whisper-large-v3-turbo";
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.keyRing = new ApiKeyRing({
      providerKind: this.providerKind,
      providerName: this.providerName,
      apiKeys: config.apiKeys
    });
    this.requestTimeoutMs = config.requestTimeoutMs ?? 20_000;
  }

  health(): Promise<ProviderHealthSnapshot> {
    return Promise.resolve(this.healthTracker.snapshot());
  }

  async *transcribe(
    request: SttTranscriptionRequest,
    context: ProviderExecutionContext
  ): AsyncIterable<SttTranscriptionChunk> {
    const response = await this.transcribeOnce(request, context);
    const chunks = toTranscriptChunks(response);

    for (const chunk of chunks) {
      yield chunk;
    }
  }

  private async transcribeOnce(
    request: SttTranscriptionRequest,
    context: ProviderExecutionContext
  ): Promise<GroqTranscriptionResponse> {
    const timeoutMs = context.timeoutPolicy?.requestTimeoutMs ?? this.requestTimeoutMs;
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), timeoutMs);

    try {
      this.healthTracker.assertCanRequest(context.circuitBreakerPolicy);
      const audioFile = await prepareAudioFile(request);
      const formData = new FormData();
      formData.set("model", request.model ?? this.defaultModel);
      formData.set("file", audioFile.blob, audioFile.filename);
      formData.set("response_format", "verbose_json");

      if (request.language) {
        formData.set("language", request.language);
      }

      if (request.prompt) {
        formData.set("prompt", request.prompt);
      }

      const response = await this.fetchImpl(this.endpoint("audio/transcriptions"), {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.keyRing.next()}`,
          "x-request-id": context.requestId,
          ...(context.companyId ? { "x-altrion-company-id": context.companyId } : {})
        },
        body: formData,
        signal: abortController.signal
      });

      if (!response.ok) {
        throw await this.errorFromResponse(response);
      }

      const payload = (await response.json()) as GroqTranscriptionResponse;

      if (!payload.text && (!payload.segments || payload.segments.length === 0)) {
        throw new ProviderRequestError({
          providerKind: this.providerKind,
          providerName: this.providerName,
          code: "internal_provider_error",
          message: "Groq returned an empty transcription response",
          retryable: true
        });
      }

      this.healthTracker.recordSuccess();
      return payload;
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
      message: `Groq STT request failed with HTTP ${statusCode}`,
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
        message: "Groq STT request timed out",
        retryable: true,
        cause: error
      });
    }

    return new ProviderRequestError({
      providerKind: this.providerKind,
      providerName: this.providerName,
      code: "transient_network",
      message: "Groq STT request failed before a response was received",
      retryable: true,
      cause: error
    });
  }
}

function toTranscriptChunks(response: GroqTranscriptionResponse): readonly SttTranscriptionChunk[] {
  if (response.segments && response.segments.length > 0) {
    return response.segments
      .filter((segment) => Boolean(segment.text?.trim()))
      .map((segment) => ({
        text: segment.text?.trim() ?? "",
        startedAtMs: Math.round((segment.start ?? 0) * 1_000),
        endedAtMs: Math.round((segment.end ?? segment.start ?? 0) * 1_000),
        confidence: confidenceFromLogProbability(segment.avg_logprob)
      }));
  }

  return [
    {
      text: response.text?.trim() ?? "",
      startedAtMs: 0,
      endedAtMs: 0
    }
  ];
}

function confidenceFromLogProbability(logProbability: number | undefined): number | undefined {
  if (logProbability === undefined) {
    return undefined;
  }

  return Math.max(0, Math.min(1, Math.exp(logProbability)));
}
