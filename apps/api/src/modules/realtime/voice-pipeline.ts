import { CallStatus, type PrismaClient } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import { assertValidCallTransition } from "@voxlink/shared";
import { AppError } from "../../errors/app-error.js";
import type {
  TwilioMediaStreamEvent,
  TwilioOutboundMessage,
  TwilioMediaEvent,
  TwilioMediaStartEvent,
  TwilioMediaStopEvent
} from "./twilio-media-stream.js";
import { createTwilioClearMessage } from "./twilio-media-stream.js";
import type { RedisVoiceSessionStore } from "./voice-session-store.js";
import type { VoiceTurnService } from "./voice-turn-service.js";

export interface VoicePipelineServiceOptions {
  readonly prisma: PrismaClient;
  readonly sessions: RedisVoiceSessionStore;
  readonly turns: VoiceTurnService;
  readonly log: FastifyBaseLogger;
  readonly framesPerTurn?: number;
}

export interface HandleTwilioStartInput {
  readonly event: TwilioMediaStartEvent;
  readonly callId: string;
  readonly requestId: string;
}

export interface HandleTwilioMediaInput {
  readonly event: TwilioMediaEvent;
}

export interface HandleTwilioStopInput {
  readonly event: TwilioMediaStopEvent;
}

export interface HandleTwilioMarkInput {
  readonly event: Extract<TwilioMediaStreamEvent, { event: "mark" }>;
}

export class VoicePipelineService {
  private readonly framesPerTurn: number;

  constructor(private readonly options: VoicePipelineServiceOptions) {
    this.framesPerTurn = options.framesPerTurn ?? 120;
  }

  async handleTwilioStart(input: HandleTwilioStartInput) {
    const call = await this.options.prisma.call.findUnique({
      where: { id: input.callId },
      select: {
        id: true,
        companyId: true,
        providerCallId: true,
        status: true
      }
    });

    if (!call) {
      throw AppError.notFound("Call not found for Twilio media stream");
    }

    if (call.providerCallId !== input.event.start.callSid) {
      throw AppError.unauthorized("Twilio media stream call SID does not match call record");
    }

    await this.transitionCall(call.id, call.status, CallStatus.listening);

    return this.options.sessions.startSession({
      callId: call.id,
      companyId: call.companyId,
      provider: "twilio",
      providerCallId: call.providerCallId,
      streamSid: input.event.start.streamSid,
      accountSid: input.event.start.accountSid,
      mediaEncoding: input.event.start.mediaFormat?.encoding,
      mediaSampleRate: input.event.start.mediaFormat?.sampleRate,
      mediaChannels: input.event.start.mediaFormat?.channels,
      requestId: input.requestId
    });
  }

  async handleTwilioMedia(
    input: HandleTwilioMediaInput
  ): Promise<readonly TwilioOutboundMessage[]> {
    const outboundMessages: TwilioOutboundMessage[] = [];
    const interrupted = await this.options.sessions.interruptAssistantResponse(
      input.event.streamSid
    );

    if (interrupted) {
      outboundMessages.push(createTwilioClearMessage(input.event.streamSid));
      this.options.log.info(
        { streamSid: input.event.streamSid },
        "Caller interrupted assistant response"
      );
    }

    await this.options.sessions.appendInboundAudioFrame({
      streamSid: input.event.streamSid,
      sequenceNumber: input.event.sequenceNumber,
      chunk: input.event.media.chunk,
      timestampMs: input.event.media.timestamp,
      payload: input.event.media.payload,
      track: input.event.media.track
    });

    const bufferedFrameCount = await this.options.sessions.getBufferedInboundFrameCount(
      input.event.streamSid
    );

    if (bufferedFrameCount < this.framesPerTurn) {
      return outboundMessages;
    }

    outboundMessages.push(
      ...(await this.processBufferedTurn(
        input.event.streamSid,
        `twilio-media-${input.event.sequenceNumber}`
      ))
    );

    return outboundMessages;
  }

  async handleTwilioMark(input: HandleTwilioMarkInput): Promise<void> {
    await this.options.sessions.markAssistantResponseFinished(
      input.event.streamSid,
      input.event.mark.name
    );
  }

  async handleTwilioStop(input: HandleTwilioStopInput): Promise<readonly TwilioOutboundMessage[]> {
    const session = await this.options.sessions.getByStreamSid(input.event.streamSid);

    if (!session) {
      this.options.log.warn(
        { streamSid: input.event.streamSid },
        "Twilio stream stopped without session"
      );
      return [];
    }

    const outboundMessages = await this.processBufferedTurn(input.event.streamSid, "twilio-stop");
    await this.transitionCall(session.callId, undefined, CallStatus.ended);
    await this.options.sessions.endSession(input.event.streamSid, "ended");
    return outboundMessages;
  }

  async handleTwilioConnectionClosed(input: {
    readonly streamSid: string;
    readonly code: number;
    readonly reason: string;
  }): Promise<void> {
    const session = await this.options.sessions.getByStreamSid(input.streamSid);

    if (!session || session.status === "ended" || session.status === "failed") {
      return;
    }

    if (input.code === 1000) {
      await this.transitionCall(session.callId, undefined, CallStatus.ended);
      await this.options.sessions.endSession(input.streamSid, "ended");
      return;
    }

    await this.transitionCall(session.callId, undefined, CallStatus.failed, {
      failureReason: `Twilio media stream closed unexpectedly: ${input.code} ${input.reason}`.trim()
    });
    await this.options.sessions.endSession(input.streamSid, "failed");
  }

  private async processBufferedTurn(
    streamSid: string,
    requestId: string
  ): Promise<readonly TwilioOutboundMessage[]> {
    const session = await this.options.sessions.getByStreamSid(streamSid);

    if (!session || session.status === "ended" || session.status === "failed") {
      return [];
    }

    const lockAcquired = await this.options.sessions.tryStartTurn(streamSid);

    if (!lockAcquired) {
      return [];
    }

    try {
      const frames = await this.options.sessions.drainInboundAudioFrames(streamSid);

      if (frames.length === 0) {
        return [];
      }

      const result = await this.options.turns.processTwilioBufferedTurn({
        session,
        frames,
        requestId
      });

      await this.options.sessions.incrementOutboundFrameCount(
        streamSid,
        result.outboundMessages.filter((message) => message.event === "media").length
      );
      const markName = result.outboundMessages.find((message) => message.event === "mark")?.mark
        .name;

      if (markName) {
        await this.options.sessions.markAssistantResponseStarted(streamSid, markName);
      }

      return result.outboundMessages;
    } finally {
      await this.options.sessions.finishTurn(streamSid);
    }
  }

  private async transitionCall(
    callId: string,
    knownStatus: CallStatus | undefined,
    targetStatus: CallStatus,
    data: { readonly failureReason?: string } = {}
  ): Promise<void> {
    const call =
      knownStatus === undefined
        ? await this.options.prisma.call.findUnique({
            where: { id: callId },
            select: { status: true }
          })
        : { status: knownStatus };

    if (!call || call.status === targetStatus || isTerminalStatus(call.status)) {
      return;
    }

    for (const nextStatus of resolveCallStatusPath(call.status, targetStatus)) {
      await this.options.prisma.call.update({
        where: { id: callId },
        data: {
          status: nextStatus,
          endedAt: isTerminalStatus(nextStatus) ? new Date() : undefined,
          failureReason: nextStatus === CallStatus.failed ? data.failureReason : undefined
        }
      });
    }
  }
}

export function resolveCallStatusPath(
  currentStatus: CallStatus,
  targetStatus: CallStatus
): readonly CallStatus[] {
  if (currentStatus === targetStatus || isTerminalStatus(currentStatus)) {
    return [];
  }

  const path =
    targetStatus === CallStatus.listening && currentStatus !== CallStatus.connected
      ? [CallStatus.connected, targetStatus]
      : targetStatus === CallStatus.ended && currentStatus === CallStatus.initiated
        ? [CallStatus.connected, targetStatus]
        : [targetStatus];

  let from = currentStatus;
  for (const to of path) {
    assertValidCallTransition(from, to);
    from = to;
  }

  return path;
}

function isTerminalStatus(status: CallStatus): boolean {
  return status === CallStatus.ended || status === CallStatus.failed;
}
