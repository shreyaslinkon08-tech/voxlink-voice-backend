import type { Redis } from "ioredis";

export type VoiceSessionStatus = "starting" | "connected" | "streaming" | "ended" | "failed";

export interface StartVoiceSessionInput {
  readonly callId: string;
  readonly companyId: string;
  readonly provider: "plivo" | "twilio";
  readonly providerCallId: string;
  readonly streamSid: string;
  readonly accountSid?: string;
  readonly mediaEncoding?: string;
  readonly mediaSampleRate?: number;
  readonly mediaChannels?: number;
  readonly requestId: string;
}

export interface AppendAudioFrameInput {
  readonly streamSid: string;
  readonly sequenceNumber: string;
  readonly chunk: string;
  readonly timestampMs: number;
  readonly payload: string;
  readonly track: string;
}

export type VoiceAudioFrame = AppendAudioFrameInput;

export interface VoiceSessionSnapshot {
  readonly callId: string;
  readonly companyId: string;
  readonly provider: "plivo" | "twilio";
  readonly providerCallId: string;
  readonly streamSid: string;
  readonly status: VoiceSessionStatus;
  readonly inboundFrameCount: number;
  readonly outboundFrameCount: number;
  readonly interruptionCount: number;
  readonly assistantSpeaking: boolean;
  readonly activeResponseMarkName?: string;
  readonly lastSequenceNumber?: string;
  readonly lastMediaTimestampMs?: number;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly endedAt?: string;
}

export interface RedisVoiceSessionStoreOptions {
  readonly ttlSeconds?: number;
  readonly maxBufferedFrames?: number;
}

const defaultTtlSeconds = 60 * 60 * 6;
const defaultMaxBufferedFrames = 600;

export class RedisVoiceSessionStore {
  private readonly ttlSeconds: number;
  private readonly maxBufferedFrames: number;

  constructor(
    private readonly redis: Redis,
    options: RedisVoiceSessionStoreOptions = {}
  ) {
    this.ttlSeconds = options.ttlSeconds ?? defaultTtlSeconds;
    this.maxBufferedFrames = options.maxBufferedFrames ?? defaultMaxBufferedFrames;
  }

  async startSession(input: StartVoiceSessionInput): Promise<VoiceSessionSnapshot> {
    const now = new Date().toISOString();
    const session: Record<string, string> = {
      callId: input.callId,
      companyId: input.companyId,
      provider: input.provider,
      providerCallId: input.providerCallId,
      streamSid: input.streamSid,
      status: "connected",
      inboundFrameCount: "0",
      outboundFrameCount: "0",
      interruptionCount: "0",
      assistantSpeaking: "false",
      startedAt: now,
      updatedAt: now,
      requestId: input.requestId
    };

    if (input.accountSid) {
      session.accountSid = input.accountSid;
    }

    if (input.mediaEncoding) {
      session.mediaEncoding = input.mediaEncoding;
    }

    if (input.mediaSampleRate) {
      session.mediaSampleRate = String(input.mediaSampleRate);
    }

    if (input.mediaChannels) {
      session.mediaChannels = String(input.mediaChannels);
    }

    await this.redis
      .multi()
      .hset(voiceSessionKey(input.streamSid), session)
      .expire(voiceSessionKey(input.streamSid), this.ttlSeconds)
      .set(voiceCallKey(input.callId), input.streamSid, "EX", this.ttlSeconds)
      .del(voiceAudioBufferKey(input.streamSid))
      .exec();

    return this.getByStreamSid(input.streamSid).then((stored) => {
      if (!stored) {
        throw new Error("Voice session was not stored");
      }

      return stored;
    });
  }

  async appendInboundAudioFrame(input: AppendAudioFrameInput): Promise<void> {
    const now = new Date().toISOString();
    const frame = JSON.stringify({
      sequenceNumber: input.sequenceNumber,
      chunk: input.chunk,
      timestampMs: input.timestampMs,
      payload: input.payload,
      track: input.track
    });

    await this.redis
      .multi()
      .rpush(voiceAudioBufferKey(input.streamSid), frame)
      .ltrim(voiceAudioBufferKey(input.streamSid), -this.maxBufferedFrames, -1)
      .expire(voiceAudioBufferKey(input.streamSid), this.ttlSeconds)
      .hincrby(voiceSessionKey(input.streamSid), "inboundFrameCount", 1)
      .hset(voiceSessionKey(input.streamSid), {
        status: "streaming",
        lastSequenceNumber: input.sequenceNumber,
        lastMediaTimestampMs: String(input.timestampMs),
        updatedAt: now
      })
      .expire(voiceSessionKey(input.streamSid), this.ttlSeconds)
      .exec();
  }

  async getBufferedInboundFrameCount(streamSid: string): Promise<number> {
    return this.redis.llen(voiceAudioBufferKey(streamSid));
  }

  async drainInboundAudioFrames(streamSid: string): Promise<readonly VoiceAudioFrame[]> {
    const result = await this.redis
      .multi()
      .lrange(voiceAudioBufferKey(streamSid), 0, -1)
      .del(voiceAudioBufferKey(streamSid))
      .exec();
    const frames = result?.[0]?.[1];

    if (!Array.isArray(frames)) {
      return [];
    }

    return frames.map(parseAudioFrame).filter((frame) => frame !== null);
  }

  async tryStartTurn(streamSid: string, ttlSeconds = 45): Promise<boolean> {
    const result = await this.redis.set(voiceTurnLockKey(streamSid), "1", "EX", ttlSeconds, "NX");
    return result === "OK";
  }

  async finishTurn(streamSid: string): Promise<void> {
    await this.redis.del(voiceTurnLockKey(streamSid));
  }

  async incrementOutboundFrameCount(streamSid: string, amount: number): Promise<void> {
    if (amount <= 0) {
      return;
    }

    await this.redis
      .multi()
      .hincrby(voiceSessionKey(streamSid), "outboundFrameCount", amount)
      .hset(voiceSessionKey(streamSid), { updatedAt: new Date().toISOString() })
      .expire(voiceSessionKey(streamSid), this.ttlSeconds)
      .exec();
  }

  async markAssistantResponseStarted(streamSid: string, markName: string): Promise<void> {
    await this.redis
      .multi()
      .hset(voiceSessionKey(streamSid), {
        assistantSpeaking: "true",
        activeResponseMarkName: markName,
        updatedAt: new Date().toISOString()
      })
      .expire(voiceSessionKey(streamSid), this.ttlSeconds)
      .exec();
  }

  async markAssistantResponseFinished(streamSid: string, markName?: string): Promise<void> {
    const session = await this.getByStreamSid(streamSid);

    if (!session?.assistantSpeaking) {
      return;
    }

    if (markName && session.activeResponseMarkName && markName !== session.activeResponseMarkName) {
      return;
    }

    await this.redis
      .multi()
      .hset(voiceSessionKey(streamSid), {
        assistantSpeaking: "false",
        activeResponseMarkName: "",
        updatedAt: new Date().toISOString()
      })
      .expire(voiceSessionKey(streamSid), this.ttlSeconds)
      .exec();
  }

  async interruptAssistantResponse(streamSid: string): Promise<boolean> {
    const session = await this.getByStreamSid(streamSid);

    if (!session?.assistantSpeaking) {
      return false;
    }

    await this.redis
      .multi()
      .hset(voiceSessionKey(streamSid), {
        assistantSpeaking: "false",
        activeResponseMarkName: "",
        updatedAt: new Date().toISOString()
      })
      .hincrby(voiceSessionKey(streamSid), "interruptionCount", 1)
      .expire(voiceSessionKey(streamSid), this.ttlSeconds)
      .exec();

    return true;
  }

  async endSession(streamSid: string, status: Extract<VoiceSessionStatus, "ended" | "failed">) {
    const now = new Date().toISOString();
    const session = await this.getByStreamSid(streamSid);

    if (!session) {
      return null;
    }

    await this.redis
      .multi()
      .hset(voiceSessionKey(streamSid), {
        status,
        updatedAt: now,
        endedAt: now
      })
      .expire(voiceSessionKey(streamSid), this.ttlSeconds)
      .expire(voiceAudioBufferKey(streamSid), this.ttlSeconds)
      .expire(voiceCallKey(session.callId), this.ttlSeconds)
      .exec();

    return this.getByStreamSid(streamSid);
  }

  async getByStreamSid(streamSid: string): Promise<VoiceSessionSnapshot | null> {
    const data = await this.redis.hgetall(voiceSessionKey(streamSid));

    if (!data.callId || !data.companyId || !data.providerCallId || !data.streamSid) {
      return null;
    }

    return {
      callId: data.callId,
      companyId: data.companyId,
      provider: data.provider === "plivo" ? "plivo" : "twilio",
      providerCallId: data.providerCallId,
      streamSid: data.streamSid,
      status: parseVoiceSessionStatus(data.status),
      inboundFrameCount: parseCounter(data.inboundFrameCount),
      outboundFrameCount: parseCounter(data.outboundFrameCount),
      interruptionCount: parseCounter(data.interruptionCount),
      assistantSpeaking: data.assistantSpeaking === "true",
      activeResponseMarkName: data.activeResponseMarkName || undefined,
      lastSequenceNumber: data.lastSequenceNumber,
      lastMediaTimestampMs: parseOptionalNumber(data.lastMediaTimestampMs),
      startedAt: data.startedAt ?? new Date(0).toISOString(),
      updatedAt: data.updatedAt ?? new Date(0).toISOString(),
      endedAt: data.endedAt
    };
  }
}

export function voiceSessionKey(streamSid: string): string {
  return `voice:session:${streamSid}`;
}

export function voiceCallKey(callId: string): string {
  return `voice:call:${callId}`;
}

export function voiceAudioBufferKey(streamSid: string): string {
  return `voice:audio:${streamSid}`;
}

export function voiceTurnLockKey(streamSid: string): string {
  return `voice:turn-lock:${streamSid}`;
}

function parseAudioFrame(value: unknown): VoiceAudioFrame | null {
  if (typeof value !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Partial<VoiceAudioFrame>;

    if (
      !parsed.streamSid ||
      !parsed.sequenceNumber ||
      !parsed.chunk ||
      !parsed.payload ||
      typeof parsed.timestampMs !== "number" ||
      !parsed.track
    ) {
      return null;
    }

    return {
      streamSid: parsed.streamSid,
      sequenceNumber: parsed.sequenceNumber,
      chunk: parsed.chunk,
      timestampMs: parsed.timestampMs,
      payload: parsed.payload,
      track: parsed.track
    };
  } catch {
    return null;
  }
}

function parseVoiceSessionStatus(value: string | undefined): VoiceSessionStatus {
  switch (value) {
    case "starting":
    case "connected":
    case "streaming":
    case "ended":
    case "failed":
      return value;
    default:
      return "starting";
  }
}

function parseCounter(value: string | undefined): number {
  return value ? Number(value) : 0;
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  return value ? Number(value) : undefined;
}
