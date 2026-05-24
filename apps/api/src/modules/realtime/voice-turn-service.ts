import {
  CallStatus,
  TranscriptSpeakerRole,
  UsageMetric,
  type Prisma,
  type PrismaClient
} from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import {
  type ChatMessage,
  type LlmProviderPort,
  type LlmCompletionResponse,
  type ProviderExecutionContext,
  type SttProviderPort,
  type SttTranscriptionChunk,
  type TtsProviderPort
} from "@voxlink/shared";
import { AppError } from "../../errors/app-error.js";
import type { ProviderRegistry } from "../../providers/provider-registry.js";
import {
  assertAndIncrementUsage,
  assertUsageWithinLimit,
  incrementUsage
} from "../billing/usage-limits.js";
import type { TwilioOutboundMessage } from "./twilio-media-stream.js";
import {
  audioFramesToMulawBytes,
  collectAudioBytes,
  wavToTwilioMulawPayloads
} from "./twilio-audio-codec.js";
import type { VoiceAudioFrame, VoiceSessionSnapshot } from "./voice-session-store.js";
import { resolveCallStatusPath } from "./voice-pipeline.js";
import { withVoiceProviderRetries } from "./voice-provider-retry.js";

export interface VoiceTurnServiceOptions {
  readonly prisma: PrismaClient;
  readonly providers: ProviderRegistry;
  readonly log: FastifyBaseLogger;
  readonly defaultVoiceId?: string;
}

export interface ProcessTwilioBufferedTurnInput {
  readonly session: VoiceSessionSnapshot;
  readonly frames: readonly VoiceAudioFrame[];
  readonly requestId: string;
}

export interface ProcessTwilioBufferedTurnResult {
  readonly outboundMessages: readonly TwilioOutboundMessage[];
  readonly callerText: string;
  readonly assistantText?: string;
}

interface CallContext {
  readonly id: string;
  readonly companyId: string;
  readonly status: CallStatus;
  readonly aiAgent: {
    readonly id: string;
    readonly systemPrompt: string;
    readonly personality: string | null;
    readonly voiceSettings: Prisma.JsonValue;
  } | null;
}

export class VoiceTurnService {
  private readonly defaultVoiceId: string;

  constructor(private readonly options: VoiceTurnServiceOptions) {
    this.defaultVoiceId = options.defaultVoiceId ?? "autumn";
  }

  async processTwilioBufferedTurn(
    input: ProcessTwilioBufferedTurnInput
  ): Promise<ProcessTwilioBufferedTurnResult> {
    if (input.frames.length === 0) {
      return { outboundMessages: [], callerText: "" };
    }

    const call = await this.loadCallContext(input.session.callId, input.session.companyId);

    if (call.status === CallStatus.transferring) {
      this.options.log.info({ callId: call.id }, "Skipping AI turn for operator handoff call");
      return { outboundMessages: [], callerText: "" };
    }

    if (call.status === CallStatus.ended || call.status === CallStatus.failed) {
      return { outboundMessages: [], callerText: "" };
    }

    if (!call.aiAgent) {
      throw AppError.badRequest("Call has no AI agent assigned");
    }

    const providerContext = this.providerContext(input);

    try {
      await this.transitionCall(call.id, CallStatus.processing);
      const transcriptionChunks = await this.transcribeCaller(input, providerContext);
      const callerText = transcriptionChunks
        .map((chunk) => chunk.text)
        .join(" ")
        .trim();

      if (!callerText) {
        await this.transitionCall(call.id, CallStatus.listening);
        return { outboundMessages: [], callerText: "" };
      }

      await this.writeCallerTranscript(call, transcriptionChunks);

      const retrievedContext = await this.retrieveKnowledgeContext(call.companyId, callerText);
      const llmResponse = await this.completeAssistantResponse({
        call,
        callerText,
        retrievedContext,
        providerContext
      });

      await this.writeAssistantTranscript(call, llmResponse.text, llmResponse.providerRequestId);
      await this.incrementUsage(call.companyId, UsageMetric.llm_tokens, llmTokenUsage(llmResponse));

      await this.transitionCall(call.id, CallStatus.responding);
      const outboundMessages = await this.synthesizeTwilioOutboundAudio({
        call,
        text: llmResponse.text,
        streamSid: input.session.streamSid,
        providerContext
      });

      await this.transitionCall(call.id, CallStatus.listening);

      return {
        outboundMessages,
        callerText,
        assistantText: llmResponse.text
      };
    } catch (error) {
      this.options.log.error({ error, callId: call.id }, "Voice turn processing failed");
      await this.writeSystemTranscript(call, providerFailureMessage(error), "voice_turn_failed");
      await this.transitionCall(call.id, CallStatus.failed, providerFailureMessage(error));
      throw error;
    }
  }

  private async loadCallContext(callId: string, companyId: string): Promise<CallContext> {
    const call = await this.options.prisma.call.findFirst({
      where: { id: callId, companyId },
      select: {
        id: true,
        companyId: true,
        status: true,
        aiAgent: {
          select: {
            id: true,
            systemPrompt: true,
            personality: true,
            voiceSettings: true
          }
        }
      }
    });

    if (!call) {
      throw AppError.notFound("Call not found for voice turn");
    }

    return call;
  }

  private async transcribeCaller(
    input: ProcessTwilioBufferedTurnInput,
    providerContext: ProviderExecutionContext
  ): Promise<readonly SttTranscriptionChunk[]> {
    const stt = this.options.providers.get<SttProviderPort>("stt", "groq");

    if (!stt) {
      throw AppError.badRequest("No STT provider is configured");
    }

    const audio = audioFramesToMulawBytes(input.frames);

    return withVoiceProviderRetries(
      {
        operationName: "stt.transcribe",
        maxAttempts: 2,
        initialDelayMs: 120,
        log: this.options.log
      },
      async () => {
        const chunks: SttTranscriptionChunk[] = [];

        for await (const chunk of stt.transcribe(
          {
            callId: input.session.callId,
            audioFormat: "mulaw_8khz",
            audio: singleChunkAudio(audio)
          },
          providerContext
        )) {
          if (chunk.text.trim()) {
            chunks.push(chunk);
          }
        }

        return chunks;
      }
    );
  }

  private async completeAssistantResponse(input: {
    readonly call: CallContext;
    readonly callerText: string;
    readonly retrievedContext: readonly string[];
    readonly providerContext: ProviderExecutionContext;
  }) {
    const llm = this.options.providers.get<LlmProviderPort>("llm", "groq");

    if (!llm) {
      throw AppError.badRequest("No LLM provider is configured");
    }

    await assertUsageWithinLimit(
      this.options.prisma,
      input.call.companyId,
      UsageMetric.llm_tokens,
      1
    );

    const messages = await this.buildMessages(input.call, input.callerText);

    return withVoiceProviderRetries<LlmCompletionResponse>(
      {
        operationName: "llm.complete",
        maxAttempts: 2,
        initialDelayMs: 150,
        log: this.options.log
      },
      () =>
        llm.complete(
          {
            agentId: input.call.aiAgent?.id ?? input.call.id,
            messages,
            retrievedContext: input.retrievedContext,
            maxTokens: 180,
            temperature: 0.2
          },
          input.providerContext
        )
    );
  }

  private async synthesizeTwilioOutboundAudio(input: {
    readonly call: CallContext;
    readonly text: string;
    readonly streamSid: string;
    readonly providerContext: ProviderExecutionContext;
  }): Promise<readonly TwilioOutboundMessage[]> {
    const tts = this.options.providers.get<TtsProviderPort>("tts", "groq");

    if (!tts) {
      throw AppError.badRequest("No TTS provider is configured");
    }

    const wavBytes = await withVoiceProviderRetries(
      {
        operationName: "tts.synthesize",
        maxAttempts: 2,
        initialDelayMs: 150,
        log: this.options.log
      },
      () =>
        collectAudioBytes(
          tts.synthesize(
            {
              callId: input.call.id,
              text: input.text,
              voiceId: voiceIdFromSettings(input.call.aiAgent?.voiceSettings, this.defaultVoiceId),
              outputFormat: "wav"
            },
            input.providerContext
          )
        )
    );
    const payloads = wavToTwilioMulawPayloads(wavBytes);

    return [
      ...payloads.map((payload) => ({
        event: "media" as const,
        streamSid: input.streamSid,
        media: { payload }
      })),
      {
        event: "mark",
        streamSid: input.streamSid,
        mark: { name: `assistant-response-${Date.now()}` }
      } satisfies TwilioOutboundMessage
    ];
  }

  private async buildMessages(
    call: CallContext,
    callerText: string
  ): Promise<readonly ChatMessage[]> {
    const recentTranscript = await this.options.prisma.transcriptChunk.findMany({
      where: { callId: call.id, companyId: call.companyId },
      orderBy: { sequence: "desc" },
      take: 10,
      select: {
        speakerRole: true,
        text: true
      }
    });

    return [
      {
        role: "system",
        content: buildSystemPrompt(call.aiAgent?.systemPrompt, call.aiAgent?.personality)
      },
      ...recentTranscript.reverse().map((chunk) => ({
        role: transcriptRoleToChatRole(chunk.speakerRole),
        content: chunk.text
      })),
      {
        role: "user",
        content: callerText
      }
    ];
  }

  private async writeCallerTranscript(
    call: CallContext,
    chunks: readonly SttTranscriptionChunk[]
  ): Promise<void> {
    if (chunks.length === 0) {
      return;
    }

    await this.options.prisma.$transaction(async (tx) => {
      const sequence = await nextTranscriptSequence(tx, call.id);
      await assertAndIncrementUsage(
        tx,
        call.companyId,
        UsageMetric.transcript_chunks,
        chunks.length
      );

      await tx.transcriptChunk.createMany({
        data: chunks.map((chunk, index) => ({
          companyId: call.companyId,
          callId: call.id,
          sequence: sequence + index,
          speakerRole: TranscriptSpeakerRole.caller,
          text: chunk.text,
          startedAtMs: chunk.startedAtMs,
          endedAtMs: chunk.endedAtMs,
          confidence: chunk.confidence,
          metadata: {
            source: "groq_stt"
          }
        }))
      });

    });
  }

  private async writeAssistantTranscript(
    call: CallContext,
    text: string,
    providerRequestId: string | undefined
  ): Promise<void> {
    await this.options.prisma.$transaction(async (tx) => {
      const sequence = await nextTranscriptSequence(tx, call.id);
      await assertAndIncrementUsage(tx, call.companyId, UsageMetric.transcript_chunks, 1);

      await tx.transcriptChunk.create({
        data: {
          companyId: call.companyId,
          callId: call.id,
          sequence,
          speakerRole: TranscriptSpeakerRole.assistant,
          text,
          metadata: {
            source: "groq_llm",
            providerRequestId
          }
        }
      });

    });
  }

  private async writeSystemTranscript(
    call: CallContext,
    message: string,
    reason: string
  ): Promise<void> {
    await this.options.prisma.$transaction(async (tx) => {
      const sequence = await nextTranscriptSequence(tx, call.id);

      await tx.transcriptChunk.create({
        data: {
          companyId: call.companyId,
          callId: call.id,
          sequence,
          speakerRole: TranscriptSpeakerRole.system,
          text: message,
          metadata: {
            reason
          }
        }
      });

      await incrementUsage(tx, call.companyId, UsageMetric.transcript_chunks, 1);
    });
  }

  private async retrieveKnowledgeContext(
    companyId: string,
    query: string
  ): Promise<readonly string[]> {
    const terms = query
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((term) => term.trim())
      .filter((term) => term.length >= 3)
      .slice(0, 8);

    if (terms.length === 0) {
      return [];
    }

    const chunks = await this.options.prisma.embedding.findMany({
      where: {
        companyId,
        OR: terms.map((term) => ({
          chunkText: {
            contains: term,
            mode: "insensitive" as const
          }
        }))
      },
      select: {
        chunkText: true
      },
      take: 24
    });

    return chunks
      .map((chunk) => ({
        text: chunk.chunkText,
        score: terms.reduce(
          (score, term) => score + (chunk.chunkText.toLowerCase().includes(term) ? 1 : 0),
          0
        )
      }))
      .filter((chunk) => chunk.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 4)
      .map((chunk) => chunk.text);
  }

  private async transitionCall(
    callId: string,
    targetStatus: CallStatus,
    failureReason?: string
  ): Promise<void> {
    const call = await this.options.prisma.call.findUnique({
      where: { id: callId },
      select: { status: true }
    });

    if (!call) {
      return;
    }

    for (const nextStatus of resolveCallStatusPath(call.status, targetStatus)) {
      await this.options.prisma.call.update({
        where: { id: callId },
        data: {
          status: nextStatus,
          endedAt:
            nextStatus === CallStatus.ended || nextStatus === CallStatus.failed
              ? new Date()
              : undefined,
          failureReason: nextStatus === CallStatus.failed ? failureReason : undefined
        }
      });
    }
  }

  private providerContext(input: ProcessTwilioBufferedTurnInput): ProviderExecutionContext {
    return {
      requestId: input.requestId,
      companyId: input.session.companyId,
      timeoutPolicy: {
        connectTimeoutMs: 2_000,
        requestTimeoutMs: 20_000,
        streamIdleTimeoutMs: 8_000
      },
      circuitBreakerPolicy: {
        failureThreshold: 4,
        halfOpenAfterMs: 30_000,
        rollingWindowMs: 60_000
      }
    };
  }

  private async incrementUsage(
    companyId: string,
    metric: UsageMetric,
    amount: number
  ): Promise<void> {
    if (amount <= 0) {
      return;
    }

    await this.options.prisma.$transaction((tx) => incrementUsage(tx, companyId, metric, amount));
  }
}

function buildSystemPrompt(
  systemPrompt: string | undefined,
  personality: string | null | undefined
): string {
  return [
    systemPrompt?.trim() || "You are a helpful AI phone assistant for this company.",
    personality?.trim() ? `Personality: ${personality.trim()}` : "",
    "Keep phone replies concise, natural, and easy to understand. Ask one clear follow-up question when needed."
  ]
    .filter(Boolean)
    .join("\n\n");
}

function transcriptRoleToChatRole(role: TranscriptSpeakerRole): ChatMessage["role"] {
  switch (role) {
    case TranscriptSpeakerRole.assistant:
      return "assistant";
    case TranscriptSpeakerRole.system:
      return "system";
    case TranscriptSpeakerRole.caller:
    case TranscriptSpeakerRole.operator:
      return "user";
  }
}

function voiceIdFromSettings(settings: Prisma.JsonValue | undefined, fallback: string): string {
  if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
    return fallback;
  }

  const voiceId = (settings as { readonly voiceId?: unknown }).voiceId;
  return typeof voiceId === "string" && voiceId.trim() ? voiceId.trim() : fallback;
}

async function nextTranscriptSequence(
  tx: Prisma.TransactionClient,
  callId: string
): Promise<number> {
  const aggregate = await tx.transcriptChunk.aggregate({
    where: { callId },
    _max: {
      sequence: true
    }
  });

  return (aggregate._max.sequence ?? 0) + 1;
}

async function* singleChunkAudio(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  await Promise.resolve();
  yield bytes;
}

function llmTokenUsage(response: {
  readonly tokenUsage?: { readonly inputTokens: number; readonly outputTokens: number };
}): number {
  return (response.tokenUsage?.inputTokens ?? 0) + (response.tokenUsage?.outputTokens ?? 0);
}

function providerFailureMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Voice provider failure";
}
