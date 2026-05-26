import { describe, expect, it, vi } from "vitest";
import {
  TwilioTelephonyProvider,
  createTwilioSignature,
  parseFormBody
} from "./twilio-telephony-provider.js";

describe("TwilioTelephonyProvider", () => {
  it("validates signatures over the exact URL and sorted form parameters", async () => {
    const rawUrl = "https://voice.example.com/webhooks/twilio/voice";
    const rawBody = "From=%2B15550001111&To=%2B15550002222&CallSid=CA123";
    const signature = createTwilioSignature(rawUrl, parseFormBody(rawBody), "auth-token");
    const provider = new TwilioTelephonyProvider({ authToken: "auth-token" });

    await expect(provider.verifyWebhookSignature(rawUrl, rawBody, signature)).resolves.toBe(true);
    await expect(provider.verifyWebhookSignature(rawUrl, rawBody, "bad-signature")).resolves.toBe(
      false
    );
  });

  it("parses inbound call fields from Twilio form payloads", async () => {
    const provider = new TwilioTelephonyProvider({ authToken: "auth-token" });

    await expect(
      provider.parseInboundCall("From=%2B15550001111&To=%2B15550002222&CallSid=CA123")
    ).resolves.toEqual({
      providerCallId: "CA123",
      from: "+15550001111",
      to: "+15550002222",
      providerAccountId: undefined
    });
  });

  it("searches Twilio available local numbers with account-scoped REST auth", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        available_phone_numbers: [
          {
            phone_number: "+14155550123",
            friendly_name: "(415) 555-0123",
            locality: "SAN FRANCISCO",
            region: "CA",
            iso_country: "US",
            capabilities: { voice: true, SMS: true, MMS: false }
          }
        ]
      })
    );
    const provider = new TwilioTelephonyProvider({
      accountSid: "AC123",
      authToken: "auth-token",
      fetchImpl
    });

    const numbers = await provider.searchAvailablePhoneNumbers(
      { countryCode: "us", areaCode: "415", limit: 5 },
      { requestId: "req-1", companyId: "company-1" }
    );

    const url = fetchImpl.mock.calls[0]?.[0] as URL;
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(url.toString()).toContain(
      "/2010-04-01/Accounts/AC123/AvailablePhoneNumbers/US/Local.json"
    );
    expect(url.searchParams.get("VoiceEnabled")).toBe("true");
    expect(url.searchParams.get("AreaCode")).toBe("415");
    expect(url.searchParams.get("PageSize")).toBe("5");
    expect((init.headers as Record<string, string>).authorization).toBe(
      `Basic ${Buffer.from("AC123:auth-token").toString("base64")}`
    );
    expect(numbers).toEqual([
      {
        e164: "+14155550123",
        friendlyName: "(415) 555-0123",
        locality: "SAN FRANCISCO",
        region: "CA",
        countryCode: "US",
        capabilities: { voice: true, sms: true, mms: false },
        providerMetadata: {
          locality: "SAN FRANCISCO",
          region: "CA"
        }
      }
    ]);
  });

  it("provisions a Twilio number with voice and status callback URLs", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        sid: "PN123",
        account_sid: "AC123",
        phone_number: "+14155550123",
        friendly_name: "Main line",
        capabilities: { voice: true, SMS: true, MMS: false }
      })
    );
    const provider = new TwilioTelephonyProvider({
      accountSid: "AC123",
      authToken: "auth-token",
      fetchImpl
    });

    const provisioned = await provider.provisionPhoneNumber(
      {
        e164: "+14155550123",
        label: "Main line",
        voiceWebhookUrl: "https://voice.example.com/webhooks/twilio/voice",
        statusCallbackUrl: "https://voice.example.com/webhooks/twilio/status"
      },
      { requestId: "req-1", companyId: "company-1" }
    );

    const url = fetchImpl.mock.calls[0]?.[0] as URL;
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    const body = init.body as URLSearchParams;
    expect(url.toString()).toContain("/2010-04-01/Accounts/AC123/IncomingPhoneNumbers.json");
    expect(init.method).toBe("POST");
    expect(body.get("PhoneNumber")).toBe("+14155550123");
    expect(body.get("FriendlyName")).toBe("Main line");
    expect(body.get("VoiceUrl")).toBe("https://voice.example.com/webhooks/twilio/voice");
    expect(body.get("StatusCallback")).toBe(
      "https://voice.example.com/webhooks/twilio/status"
    );
    expect(provisioned).toMatchObject({
      e164: "+14155550123",
      providerNumberSid: "PN123",
      providerAccountId: "AC123"
    });
  });

  it("rejects provisioning operations when the account SID is not configured", async () => {
    const provider = new TwilioTelephonyProvider({ authToken: "auth-token" });

    await expect(
      provider.searchAvailablePhoneNumbers({ countryCode: "US", limit: 1 }, { requestId: "req-1" })
    ).rejects.toMatchObject({
      code: "authentication_failed",
      retryable: false
    });
  });

  it("surfaces Twilio API error messages when routing sync fails", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          code: 20404,
          message: "The requested resource was not found"
        },
        404
      )
    );
    const provider = new TwilioTelephonyProvider({
      accountSid: "AC123",
      authToken: "auth-token",
      fetchImpl
    });

    await expect(
      provider.updatePhoneNumberRouting(
        {
          providerNumberSid: "PN00000000000000000000000000000000",
          voiceWebhookUrl: "https://voice.example.com/webhooks/twilio/voice",
          statusCallbackUrl: "https://voice.example.com/webhooks/twilio/status"
        },
        { requestId: "req-1", companyId: "company-1" }
      )
    ).rejects.toMatchObject({
      code: "invalid_request",
      message:
        "Twilio update phone number routing failed: The requested resource was not found (Twilio code 20404)",
      retryable: false
    });
  });
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}
