import { describe, expect, it } from "vitest";
import { createTwilioProviderEventId, hashTwilioPayload } from "./twilio-idempotency.js";

describe("Twilio webhook idempotency", () => {
  it("prefers Twilio idempotency tokens when present", () => {
    expect(
      createTwilioProviderEventId({
        callSid: "CA123",
        eventType: "voice",
        callStatus: "ringing",
        rawBody: "CallSid=CA123",
        idempotencyToken: "twilio-token"
      })
    ).toBe("twilio-token");
  });

  it("falls back to stable call, event, status, and payload hash identity", () => {
    const rawBody = "CallSid=CA123&CallStatus=ringing";

    expect(
      createTwilioProviderEventId({
        callSid: "CA123",
        eventType: "voice",
        callStatus: "ringing",
        rawBody
      })
    ).toBe(`CA123:voice:ringing:${hashTwilioPayload(rawBody)}`);
  });
});
