import { describe, expect, it } from "vitest";
import { buildTwilioWebhookUrls } from "./phone-number.service.js";

describe("phone number service", () => {
  it("builds Twilio voice and status webhook URLs from the configured public base", () => {
    expect(buildTwilioWebhookUrls("https://voice.example.com")).toEqual({
      voiceWebhookUrl: "https://voice.example.com/webhooks/twilio/voice",
      statusCallbackUrl: "https://voice.example.com/webhooks/twilio/status"
    });
  });
});
