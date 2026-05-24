import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyStripeWebhookSignature } from "./stripe-client.js";

describe("Stripe webhook verification", () => {
  it("accepts a valid Stripe v1 signature", () => {
    const body = JSON.stringify({ id: "evt_test", type: "checkout.session.completed" });
    const secret = "whsec_test_secret";
    const timestamp = 1_800_000_000;
    const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");

    expect(
      verifyStripeWebhookSignature(body, `t=${timestamp},v1=${signature}`, secret, timestamp)
    ).toBe(true);
  });

  it("rejects stale or mismatched signatures", () => {
    expect(
      verifyStripeWebhookSignature(
        '{"ok":true}',
        "t=1800000000,v1=bad",
        "whsec_test_secret",
        1_800_001_000
      )
    ).toBe(false);
  });
});
