import { Buffer } from "node:buffer";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const sequenceNumberSchema = z.union([z.string(), z.number()]).transform((value) => String(value));

const customParametersSchema = z.record(z.string(), z.string()).optional();

const mediaFormatSchema = z
  .object({
    encoding: z.string().optional(),
    sampleRate: z.number().int().positive().optional(),
    channels: z.number().int().positive().optional()
  })
  .optional();

const connectedEventSchema = z.object({
  event: z.literal("connected"),
  protocol: z.string().optional(),
  version: z.string().optional()
});

const startEventSchema = z.object({
  event: z.literal("start"),
  sequenceNumber: sequenceNumberSchema,
  start: z.object({
    accountSid: z.string().optional(),
    callSid: z.string().min(1),
    streamSid: z.string().min(1),
    tracks: z.array(z.string()).optional(),
    mediaFormat: mediaFormatSchema,
    customParameters: customParametersSchema
  })
});

const mediaEventSchema = z.object({
  event: z.literal("media"),
  sequenceNumber: sequenceNumberSchema,
  streamSid: z.string().min(1),
  media: z.object({
    track: z.enum(["inbound", "outbound"]).or(z.string()),
    chunk: z.union([z.string(), z.number()]).transform((value) => String(value)),
    timestamp: z.union([z.string(), z.number()]).transform((value) => Number(value)),
    payload: z.string().min(1)
  })
});

const markEventSchema = z.object({
  event: z.literal("mark"),
  sequenceNumber: sequenceNumberSchema,
  streamSid: z.string().min(1),
  mark: z.object({
    name: z.string().min(1)
  })
});

const dtmfEventSchema = z.object({
  event: z.literal("dtmf"),
  sequenceNumber: sequenceNumberSchema,
  streamSid: z.string().min(1),
  dtmf: z.object({
    digit: z.string().min(1)
  })
});

const stopEventSchema = z.object({
  event: z.literal("stop"),
  sequenceNumber: sequenceNumberSchema,
  streamSid: z.string().min(1),
  stop: z
    .object({
      accountSid: z.string().optional(),
      callSid: z.string().optional()
    })
    .optional()
});

export const twilioMediaStreamEventSchema = z.discriminatedUnion("event", [
  connectedEventSchema,
  startEventSchema,
  mediaEventSchema,
  markEventSchema,
  dtmfEventSchema,
  stopEventSchema
]);

export type TwilioMediaStreamEvent = z.infer<typeof twilioMediaStreamEventSchema>;
export type TwilioMediaStartEvent = Extract<TwilioMediaStreamEvent, { event: "start" }>;
export type TwilioMediaEvent = Extract<TwilioMediaStreamEvent, { event: "media" }>;
export type TwilioMediaStopEvent = Extract<TwilioMediaStreamEvent, { event: "stop" }>;

export interface TwilioOutboundMediaMessage {
  readonly event: "media";
  readonly streamSid: string;
  readonly media: {
    readonly payload: string;
  };
}

export interface TwilioOutboundMarkMessage {
  readonly event: "mark";
  readonly streamSid: string;
  readonly mark: {
    readonly name: string;
  };
}

export interface TwilioOutboundClearMessage {
  readonly event: "clear";
  readonly streamSid: string;
}

export type TwilioOutboundMessage =
  | TwilioOutboundMediaMessage
  | TwilioOutboundMarkMessage
  | TwilioOutboundClearMessage;

export function createTwilioClearMessage(streamSid: string): TwilioOutboundClearMessage {
  return {
    event: "clear",
    streamSid
  };
}

export function parseTwilioMediaStreamMessage(message: unknown): TwilioMediaStreamEvent {
  const text = rawMessageToString(message);
  const parsed: unknown = JSON.parse(text);

  return twilioMediaStreamEventSchema.parse(parsed);
}

export function getCallIdFromStartEvent(event: TwilioMediaStartEvent): string | undefined {
  const parameters = event.start.customParameters ?? {};
  return parameters.callId ?? parameters.CallId ?? parameters.call_id;
}

export function buildTwilioMediaStreamUrl(baseUrl: string, callId: string, token: string): string {
  const url = new URL("/webhooks/twilio/media", baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("callId", callId);
  url.searchParams.set("token", token);
  return url.toString();
}

export function createTwilioMediaStreamToken(
  callId: string,
  secret: string,
  expiresAt: Date = new Date(Date.now() + 5 * 60 * 1000)
): string {
  const expiresAtMs = String(expiresAt.getTime());
  const signature = signMediaStreamToken(callId, expiresAtMs, secret);
  return `${expiresAtMs}.${signature}`;
}

export function verifyTwilioMediaStreamToken(
  callId: string,
  token: string,
  secret: string,
  now: Date = new Date()
): boolean {
  const [expiresAtMs, signature] = token.split(".");

  if (!expiresAtMs || !signature || Number(expiresAtMs) <= now.getTime()) {
    return false;
  }

  const expected = signMediaStreamToken(callId, expiresAtMs, secret);
  const actualBuffer = Buffer.from(signature, "base64url");
  const expectedBuffer = Buffer.from(expected, "base64url");

  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function rawMessageToString(message: unknown): string {
  if (typeof message === "string") {
    return message;
  }

  if (Buffer.isBuffer(message)) {
    return message.toString("utf8");
  }

  if (message instanceof ArrayBuffer) {
    return Buffer.from(message).toString("utf8");
  }

  if (Array.isArray(message) && message.every((part) => Buffer.isBuffer(part))) {
    return Buffer.concat(message).toString("utf8");
  }

  throw new Error("Unsupported Twilio media stream message type");
}

function signMediaStreamToken(callId: string, expiresAtMs: string, secret: string): string {
  return createHmac("sha256", secret).update(`${callId}.${expiresAtMs}`).digest("base64url");
}
