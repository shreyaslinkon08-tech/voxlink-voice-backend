import { CallStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { VoicePipelineService, resolveCallStatusPath } from "./voice-pipeline.js";

describe("voice pipeline call state transitions", () => {
  it("moves an initiated call through connected before listening", () => {
    expect(resolveCallStatusPath(CallStatus.initiated, CallStatus.listening)).toEqual([
      CallStatus.connected,
      CallStatus.listening
    ]);
  });

  it("allows listening calls to end cleanly", () => {
    expect(resolveCallStatusPath(CallStatus.listening, CallStatus.ended)).toEqual([
      CallStatus.ended
    ]);
  });

  it("does not move terminal calls", () => {
    expect(resolveCallStatusPath(CallStatus.ended, CallStatus.failed)).toEqual([]);
  });

  it("sends Twilio clear when caller audio interrupts assistant speech", async () => {
    const pipeline = new VoicePipelineService({
      prisma: {} as never,
      turns: {} as never,
      log: {
        info: () => undefined
      } as never,
      sessions: {
        interruptAssistantResponse: () => Promise.resolve(true),
        appendInboundAudioFrame: () => Promise.resolve(),
        getBufferedInboundFrameCount: () => Promise.resolve(1)
      } as never,
      framesPerTurn: 10
    });

    const messages = await pipeline.handleTwilioMedia({
      event: {
        event: "media",
        streamSid: "MZ123",
        sequenceNumber: "2",
        media: {
          track: "inbound",
          chunk: "1",
          timestamp: 20,
          payload: "////"
        }
      }
    });

    expect(messages).toEqual([{ event: "clear", streamSid: "MZ123" }]);
  });
});
