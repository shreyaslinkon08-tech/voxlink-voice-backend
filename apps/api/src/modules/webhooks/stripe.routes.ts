import type { FastifyPluginCallback } from "fastify";
import { AppError } from "../../errors/app-error.js";
import { verifyStripeWebhookSignature } from "../billing/stripe-client.js";
import { processStripeWebhook } from "../billing/stripe-billing.service.js";

export const stripeWebhookRoutes: FastifyPluginCallback = (app, _options, done) => {
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_request, body, parserDone) => {
      parserDone(null, body);
    }
  );

  app.post("/", async (request) => {
    const rawBody = requireRawBody(request.body);
    const signature = request.headers["stripe-signature"];
    const signatureHeader = Array.isArray(signature) ? signature[0] : signature;

    if (!verifyStripeWebhookSignature(rawBody, signatureHeader, app.config.STRIPE_WEBHOOK_SECRET)) {
      throw AppError.forbidden("Stripe webhook signature is invalid");
    }

    return {
      ok: true,
      ...(await processStripeWebhook(app, request, rawBody))
    };
  });

  done();
};

function requireRawBody(body: unknown): string {
  if (typeof body !== "string") {
    throw new Error("Stripe webhook body parser did not return a raw JSON body");
  }

  return body;
}
