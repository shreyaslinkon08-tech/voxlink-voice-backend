import { describe, expect, it } from "vitest";
import {
  buildTwilioMediaStreamUrl,
  createTwilioClearMessage,
  createTwilioMediaStreamToken,
  getCallIdFromStartEvent,
  parseTwilioMediaStreamMessage,
  verifyTwilioMediaStreamToken
} from "./twilio-media-stream.js";

describe("Twilio media stream messages", () => {
  it("parses start events and extracts call ids from custom parameters", () => {
    const event = parseTwilioMediaStreamMessage(
      JSON.stringify({
        event: "start",
        sequenceNumber: "1",
        start: {
          accountSid: "AC123",
          callSid: "CA123",
          streamSid: "MZ123",
          mediaFormat: {
            encoding: "audio/x-mulaw",
            sampleRate: 8000,
            channels: 1
          },
          customParameters: {
            callId: "60cb483a-4b53-4a8f-8e59-17c1ea9ef0d8"
          }
        }
      })
    );

    expect(event.event).toBe("start");
    if (event.event !== "start") {
      throw new Error("Expected start event");
    }
    expect(getCallIdFromStartEvent(event)).toBe("60cb483a-4b53-4a8f-8e59-17c1ea9ef0d8");
  });

  it("parses media events from buffer messages", () => {
    const event = parseTwilioMediaStreamMessage(
      Buffer.from(
        JSON.stringify({
          event: "media",
          streamSid: "MZ123",
          sequenceNumber: "2",
          media: {
            track: "inbound",
            chunk: "1",
            timestamp: "20",
            payload: "////"
          }
        })
      )
    );

    expect(event.event).toBe("media");
    if (event.event !== "media") {
      throw new Error("Expected media event");
    }
    expect(event.media.timestamp).toBe(20);
  });

  it("builds websocket URLs from configured webhook URLs", () => {
    expect(
      buildTwilioMediaStreamUrl("https://voice.example.com/webhooks/twilio", "call-1", "token-1")
    ).toBe("wss://voice.example.com/webhooks/twilio/media?callId=call-1&token=token-1");
  });

  it("creates short-lived stream tokens", () => {
    const callId = "60cb483a-4b53-4a8f-8e59-17c1ea9ef0d8";
    const token = createTwilioMediaStreamToken(callId, "secret", new Date("2026-05-24T00:10:00Z"));

    expect(
      verifyTwilioMediaStreamToken(callId, token, "secret", new Date("2026-05-24T00:09:00Z"))
    ).toBe(true);
    expect(
      verifyTwilioMediaStreamToken(callId, token, "secret", new Date("2026-05-24T00:11:00Z"))
    ).toBe(false);
  });

  it("creates Twilio clear messages for barge-in interruption", () => {
    expect(createTwilioClearMessage("MZ123")).toEqual({
      event: "clear",
      streamSid: "MZ123"
    });
  });
});
