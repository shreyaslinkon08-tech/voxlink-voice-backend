import { describe, expect, it, vi } from "vitest";
import { PlivoTelephonyProvider, createPlivoSignatureV3 } from "./plivo-telephony-provider.js";

describe("PlivoTelephonyProvider", () => {
  it("validates v3 webhook signatures over URL, sorted form fields, and nonce", () => {
    const rawUrl = "https://voice.example.com/webhooks/plivo/voice";
    const rawBody = "From=%2B919876543210&To=%2B918080808080&CallUUID=call-1";
    const nonce = "1700000000000";
    const signature = createPlivoSignatureV3(
      rawUrl,
      {
        CallUUID: "call-1",
        From: "+919876543210",
        To: "+918080808080"
      },
      nonce,
      "auth-token"
    );
    const provider = new PlivoTelephonyProvider({ authToken: "auth-token" });

    expect(provider.verifyWebhookSignatureV3(rawUrl, rawBody, signature, nonce)).toBe(true);
    expect(provider.verifyWebhookSignatureV3(rawUrl, rawBody, "bad-signature", nonce)).toBe(false);
  });

  it("searches Plivo India local voice numbers with account-scoped REST auth", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        objects: [
          {
            number: "918080808080",
            city: "BENGALURU",
            region: "KA",
            country_iso2: "IN",
            voice_enabled: true,
            sms_enabled: false,
            mms_enabled: false
          }
        ]
      })
    );
    const provider = new PlivoTelephonyProvider({
      authId: "MA123",
      authToken: "auth-token",
      fetchImpl
    });

    const numbers = await provider.searchAvailablePhoneNumbers(
      { countryCode: "in", limit: 5 },
      { requestId: "req-1", companyId: "company-1" }
    );

    const url = fetchImpl.mock.calls[0]?.[0] as URL;
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(url.toString()).toContain("/v1/Account/MA123/PhoneNumber/");
    expect(url.searchParams.get("country_iso")).toBe("IN");
    expect(url.searchParams.get("services")).toBe("voice");
    expect((init.headers as Record<string, string>).authorization).toBe(
      `Basic ${Buffer.from("MA123:auth-token").toString("base64")}`
    );
    expect(numbers).toEqual([
      {
        e164: "+918080808080",
        friendlyName: "BENGALURU",
        locality: "BENGALURU",
        region: "KA",
        countryCode: "IN",
        capabilities: { voice: true, sms: false, mms: false },
        providerMetadata: {
          plivoNumber: "918080808080",
          type: undefined
        }
      }
    ]);
  });

  it("creates a Plivo application and assigns it when routing sync has no app yet", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ app_id: "123456789" }))
      .mockResolvedValueOnce(jsonResponse({ number: "918080808080", app_id: "123456789" }));
    const provider = new PlivoTelephonyProvider({
      authId: "MA123",
      authToken: "auth-token",
      fetchImpl
    });

    await expect(
      provider.updatePhoneNumberRouting(
        {
          providerNumberSid: "+918080808080",
          voiceWebhookUrl: "https://voice.example.com/webhooks/plivo/voice",
          statusCallbackUrl: "https://voice.example.com/webhooks/plivo/status"
        },
        { requestId: "req-1", companyId: "company-1" }
      )
    ).resolves.toEqual({
      providerNumberSid: "918080808080",
      providerMetadata: {
        plivoNumber: "918080808080",
        applicationId: "123456789",
        managedApplication: true
      }
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
