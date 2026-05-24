import type { ProviderExecutionContext, ProviderPort } from "./provider-failure.js";

export type ChatMessageRole = "system" | "user" | "assistant" | "tool";

export type LlmModelProfile = "llama" | "gemma" | "mixtral" | "gpt";

export type SttModelId = "whisper-large-v3" | "whisper-large-v3-turbo";

export type TtsModelId = "canopylabs/orpheus-v1-english" | "canopylabs/orpheus-arabic-saudi";

export interface ChatMessage {
  readonly role: ChatMessageRole;
  readonly content: string;
}

export interface LlmCompletionRequest {
  readonly agentId: string;
  readonly messages: readonly ChatMessage[];
  readonly modelProfile?: LlmModelProfile;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly retrievedContext?: readonly string[];
}

export interface LlmCompletionResponse {
  readonly text: string;
  readonly providerRequestId?: string;
  readonly tokenUsage?: {
    readonly inputTokens: number;
    readonly outputTokens: number;
  };
}

export interface LlmProviderPort extends ProviderPort {
  readonly providerKind: "llm";
  complete(
    request: LlmCompletionRequest,
    context: ProviderExecutionContext
  ): Promise<LlmCompletionResponse>;
}

export interface SttTranscriptionRequest {
  readonly callId: string;
  readonly model?: SttModelId;
  readonly audioFormat: "mulaw_8khz" | "pcm_16khz" | "wav";
  readonly audio: AsyncIterable<Uint8Array>;
  readonly language?: string;
  readonly prompt?: string;
}

export interface SttTranscriptionChunk {
  readonly text: string;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly confidence?: number;
}

export interface SttProviderPort extends ProviderPort {
  readonly providerKind: "stt";
  transcribe(
    request: SttTranscriptionRequest,
    context: ProviderExecutionContext
  ): AsyncIterable<SttTranscriptionChunk>;
}

export interface TtsSynthesisRequest {
  readonly callId: string;
  readonly model?: TtsModelId;
  readonly text: string;
  readonly voiceId: string;
  readonly outputFormat: "wav" | "mp3" | "flac" | "ogg";
}

export interface TtsProviderPort extends ProviderPort {
  readonly providerKind: "tts";
  synthesize(
    request: TtsSynthesisRequest,
    context: ProviderExecutionContext
  ): AsyncIterable<Uint8Array>;
}

export interface TelephonyInboundCall {
  readonly providerCallId: string;
  readonly to: string;
  readonly from: string;
  readonly providerAccountId?: string;
}

export interface TelephonyNumberCapabilities {
  readonly voice: boolean;
  readonly sms: boolean;
  readonly mms: boolean;
}

export interface TelephonyAvailableNumberSearchRequest {
  readonly countryCode: string;
  readonly areaCode?: string;
  readonly contains?: string;
  readonly limit?: number;
  readonly voiceEnabled?: boolean;
}

export interface TelephonyAvailablePhoneNumber {
  readonly e164: string;
  readonly friendlyName?: string;
  readonly locality?: string;
  readonly region?: string;
  readonly countryCode?: string;
  readonly capabilities: TelephonyNumberCapabilities;
  readonly providerMetadata?: Record<string, unknown>;
}

export interface TelephonyProvisionNumberRequest {
  readonly e164: string;
  readonly label?: string;
  readonly voiceWebhookUrl: string;
  readonly statusCallbackUrl: string;
}

export interface TelephonyProvisionNumberResponse {
  readonly e164: string;
  readonly providerNumberSid: string;
  readonly providerAccountId?: string;
  readonly friendlyName?: string;
  readonly capabilities?: TelephonyNumberCapabilities;
  readonly providerMetadata?: Record<string, unknown>;
}

export interface TelephonyUpdateNumberRoutingRequest {
  readonly providerNumberSid: string;
  readonly voiceWebhookUrl: string;
  readonly statusCallbackUrl: string;
}

export interface TelephonyReleaseNumberRequest {
  readonly providerNumberSid: string;
}

export interface TelephonyProviderPort extends ProviderPort {
  readonly providerKind: "telephony";
  verifyWebhookSignature(rawUrl: string, rawBody: string, signature: string): Promise<boolean>;
  parseInboundCall(rawBody: string): Promise<TelephonyInboundCall>;
  searchAvailablePhoneNumbers(
    request: TelephonyAvailableNumberSearchRequest,
    context: ProviderExecutionContext
  ): Promise<readonly TelephonyAvailablePhoneNumber[]>;
  provisionPhoneNumber(
    request: TelephonyProvisionNumberRequest,
    context: ProviderExecutionContext
  ): Promise<TelephonyProvisionNumberResponse>;
  updatePhoneNumberRouting(
    request: TelephonyUpdateNumberRoutingRequest,
    context: ProviderExecutionContext
  ): Promise<void>;
  releasePhoneNumber(
    request: TelephonyReleaseNumberRequest,
    context: ProviderExecutionContext
  ): Promise<void>;
}

export interface RagQueryRequest {
  readonly companyId: string;
  readonly query: string;
  readonly maxChunks: number;
}

export interface RagChunk {
  readonly knowledgeBaseId: string;
  readonly chunkId: string;
  readonly text: string;
  readonly score: number;
}

export interface RagProviderPort extends ProviderPort {
  readonly providerKind: "rag";
  retrieve(
    request: RagQueryRequest,
    context: ProviderExecutionContext
  ): Promise<readonly RagChunk[]>;
}
