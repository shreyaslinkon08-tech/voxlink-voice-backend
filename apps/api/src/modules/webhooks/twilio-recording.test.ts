import { describe, expect, it } from "vitest";
import { extractTwilioRecording } from "./twilio-recording.js";

describe("Twilio recording extraction", () => {
  it("returns null when a webhook has no recording payload", () => {
    expect(extractTwilioRecording({ CallSid: "CA123" })).toBeNull();
  });

  it("normalizes recording metadata for persistence", () => {
    expect(
      extractTwilioRecording({
        RecordingSid: "RE123",
        RecordingStatus: "in-progress",
        RecordingUrl: "https://api.twilio.com/recording",
        RecordingDuration: "42",
        RecordingChannels: "2",
        RecordingSource: "RecordVerb"
      })
    ).toMatchObject({
      providerRecordingId: "RE123",
      status: "in_progress",
      recordingUrl: "https://api.twilio.com/recording",
      durationSeconds: 42,
      channels: 2,
      source: "RecordVerb"
    });
  });
});
