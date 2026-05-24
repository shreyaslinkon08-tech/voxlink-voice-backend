import { createHmac, timingSafeEqual } from "node:crypto";
import type { AppConfig } from "../../config/env.js";
import { AppError } from "../../errors/app-error.js";

export interface StripeCheckoutSession {
  readonly id: string;
  readonly url: string;
}

export interface StripePortalSession {
  readonly id: string;
  readonly url: string;
}

export async function createStripeCheckoutSession(
  config: AppConfig,
  input: {
    readonly customerId?: string | null;
    readonly customerEmail: string;
    readonly companyId: string;
    readonly companyName: string;
    readonly planCode: string;
    readonly priceId: string;
  }
): Promise<StripeCheckoutSession> {
  const body = new URLSearchParams({
    mode: "subscription",
    client_reference_id: input.companyId,
    success_url: new URL("/dashboard/settings?billing=success", config.WEB_PUBLIC_URL).toString(),
    cancel_url: new URL("/dashboard/settings?billing=cancelled", config.WEB_PUBLIC_URL).toString(),
    "line_items[0][price]": input.priceId,
    "line_items[0][quantity]": "1",
    "metadata[companyId]": input.companyId,
    "metadata[companyName]": input.companyName,
    "metadata[planCode]": input.planCode,
    "subscription_data[metadata][companyId]": input.companyId,
    "subscription_data[metadata][companyName]": input.companyName,
    "subscription_data[metadata][planCode]": input.planCode,
    allow_promotion_codes: "true"
  });

  if (input.customerId) {
    body.set("customer", input.customerId);
  } else {
    body.set("customer_email", input.customerEmail);
  }

  return stripePost<StripeCheckoutSession>(config, "/v1/checkout/sessions", body);
}

export async function createStripePortalSession(
  config: AppConfig,
  input: {
    readonly customerId: string;
  }
): Promise<StripePortalSession> {
  const body = new URLSearchParams({
    customer: input.customerId,
    return_url: new URL("/dashboard/settings", config.WEB_PUBLIC_URL).toString()
  });

  return stripePost<StripePortalSession>(config, "/v1/billing_portal/sessions", body);
}

export function verifyStripeWebhookSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  webhookSecret: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): boolean {
  if (!signatureHeader || !webhookSecret) {
    return false;
  }

  const parsed = parseStripeSignatureHeader(signatureHeader);

  if (!parsed.timestamp || parsed.signatures.length === 0) {
    return false;
  }

  if (Math.abs(nowSeconds - parsed.timestamp) > 5 * 60) {
    return false;
  }

  const expected = createHmac("sha256", webhookSecret)
    .update(`${parsed.timestamp}.${rawBody}`, "utf8")
    .digest("hex");

  return parsed.signatures.some((signature) => safeEqualHex(expected, signature));
}

async function stripePost<TResponse>(
  config: AppConfig,
  path: string,
  body: URLSearchParams
): Promise<TResponse> {
  assertStripeConfigured(config);
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), config.STRIPE_PROVIDER_TIMEOUT_MS);

  try {
    const response = await fetch(new URL(path, config.STRIPE_API_BASE_URL), {
      method: "POST",
      body,
      headers: {
        authorization: `Bearer ${config.STRIPE_SECRET_KEY}`,
        "content-type": "application/x-www-form-urlencoded"
      },
      signal: abortController.signal
    });

    const payloadText = await response.text();

    if (!response.ok) {
      throw AppError.badGateway(
        `Stripe request failed with HTTP ${response.status}: ${payloadText.slice(0, 300)}`
      );
    }

    return JSON.parse(payloadText) as TResponse;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw AppError.badGateway("Stripe request failed before a valid response was received");
  } finally {
    clearTimeout(timeout);
  }
}

function assertStripeConfigured(config: AppConfig): void {
  if (config.BILLING_PROVIDER !== "stripe") {
    throw AppError.badRequest("Stripe billing is not enabled");
  }

  if (!config.STRIPE_SECRET_KEY || !config.STRIPE_WEBHOOK_SECRET) {
    throw AppError.badRequest("Stripe billing is not configured");
  }
}

function parseStripeSignatureHeader(header: string): {
  readonly timestamp?: number;
  readonly signatures: readonly string[];
} {
  const signatures: string[] = [];
  let timestamp: number | undefined;

  for (const part of header.split(",")) {
    const [key, value] = part.split("=", 2);

    if (key === "t" && value) {
      const parsed = Number(value);
      timestamp = Number.isFinite(parsed) ? parsed : undefined;
    }

    if (key === "v1" && value) {
      signatures.push(value);
    }
  }

  return { timestamp, signatures };
}

function safeEqualHex(expected: string, actual: string): boolean {
  try {
    const expectedBuffer = Buffer.from(expected, "hex");
    const actualBuffer = Buffer.from(actual, "hex");

    return (
      expectedBuffer.byteLength === actualBuffer.byteLength &&
      timingSafeEqual(expectedBuffer, actualBuffer)
    );
  } catch {
    return false;
  }
}
