import { createHash } from "node:crypto";

export interface TwilioEventIdentityInput {
  readonly callSid?: string;
  readonly eventType: string;
  readonly callStatus?: string;
  readonly rawBody: string;
  readonly idempotencyToken?: string;
}

export function createTwilioProviderEventId(input: TwilioEventIdentityInput): string {
  if (input.idempotencyToken) {
    return input.idempotencyToken;
  }

  return `${input.callSid ?? "unknown"}:${input.eventType}:${input.callStatus ?? "unknown"}:${hashTwilioPayload(input.rawBody)}`;
}

export function hashTwilioPayload(rawBody: string): string {
  return createHash("sha256").update(rawBody).digest("hex");
}
