import { Buffer } from "node:buffer";
import { z } from "zod";
import type {
  TwilioMediaEvent,
  TwilioMediaStartEvent,
  TwilioMediaStopEvent,
  TwilioOutboundMessage
} from "./twilio-media-stream.js";

const startEventSchema = z.object({
  event: z.literal("start"),
  sequenceNumber: z.union([z.string(), z.number()]).optional(),
  streamId: z.string().min(1),
  start: z
    .object({
      callId: z.string().optional(),
      accountId: z.string().optional(),
      mediaFormat: z
        .object({
          encoding: z.string().optional(),
          sampleRate: z.number().int().positive().optional(),
          channels: z.number().int().positive().optional()
        })
        .optional()
    })
    .passthrough()
    .optional()
});

const mediaEventSchema = z.object({
  event: z.literal("media"),
  sequenceNumber: z.union([z.string(), z.number()]).optional(),
  streamId: z.string().min(1),
  media: z.object({
    payload: z.string().min(1),
    timestamp: z.union([z.string(), z.number()]).optional()
  })
});

const stopEventSchema = z.object({
  event: z.literal("stop"),
  sequenceNumber: z.union([z.string(), z.number()]).optional(),
  streamId: z.string().min(1)
});

const playedStreamEventSchema = z.object({
  event: z.literal("playedStream"),
  streamId: z.string().min(1),
  name: z.string().optional()
});

const clearedAudioEventSchema = z.object({
  event: z.literal("clearedAudio"),
  streamId: z.string().min(1)
});

const plivoMediaStreamEventSchema = z.discriminatedUnion("event", [
  startEventSchema,
  mediaEventSchema,
  stopEventSchema,
  playedStreamEventSchema,
  clearedAudioEventSchema
]);

export type PlivoMediaStreamEvent = z.infer<typeof plivoMediaStreamEventSchema>;

export function parsePlivoMediaStreamMessage(message: unknown): PlivoMediaStreamEvent {
  const text = rawMessageToString(message);
  const parsed: unknown = JSON.parse(text);

  return plivoMediaStreamEventSchema.parse(parsed);
}

export function buildPlivoMediaStreamUrl(baseUrl: string, callId: string, token: string): string {
  const url = new URL("/webhooks/plivo/media", baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("callId", callId);
  url.searchParams.set("token", token);
  return url.toString();
}

export function plivoStartToTwilioStart(
  event: Extract<PlivoMediaStreamEvent, { event: "start" }>,
  fallbackCallId: string
): TwilioMediaStartEvent {
  return {
    event: "start",
    sequenceNumber: String(event.sequenceNumber ?? "1"),
    start: {
      accountSid: event.start?.accountId,
      callSid: event.start?.callId ?? fallbackCallId,
      streamSid: event.streamId,
      tracks: ["inbound"],
      mediaFormat: {
        encoding: event.start?.mediaFormat?.encoding ?? "audio/x-mulaw",
        sampleRate: event.start?.mediaFormat?.sampleRate ?? 8000,
        channels: event.start?.mediaFormat?.channels ?? 1
      },
      customParameters: {
        callId: fallbackCallId
      }
    }
  };
}

export function plivoMediaToTwilioMedia(
  event: Extract<PlivoMediaStreamEvent, { event: "media" }>
): TwilioMediaEvent {
  return {
    event: "media",
    sequenceNumber: String(event.sequenceNumber ?? Date.now()),
    streamSid: event.streamId,
    media: {
      track: "inbound",
      chunk: String(event.sequenceNumber ?? Date.now()),
      timestamp: Number(event.media.timestamp ?? 0),
      payload: event.media.payload
    }
  };
}

export function plivoStopToTwilioStop(
  event: Extract<PlivoMediaStreamEvent, { event: "stop" }>
): TwilioMediaStopEvent {
  return {
    event: "stop",
    sequenceNumber: String(event.sequenceNumber ?? Date.now()),
    streamSid: event.streamId,
    stop: {}
  };
}

export function twilioOutboundToPlivoMessage(message: TwilioOutboundMessage): string {
  switch (message.event) {
    case "media":
      return JSON.stringify({
        event: "playAudio",
        media: {
          contentType: "audio/x-mulaw",
          sampleRate: 8000,
          payload: message.media.payload
        }
      });
    case "mark":
      return JSON.stringify({
        event: "checkpoint",
        streamId: message.streamSid,
        name: message.mark.name
      });
    case "clear":
      return JSON.stringify({
        event: "clearAudio",
        streamId: message.streamSid
      });
  }
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

  throw new Error("Unsupported Plivo media stream message type");
}
