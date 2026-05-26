import type { FastifyPluginCallback } from "fastify";
import { AppError } from "../../errors/app-error.js";
import {
  processPlivoStatusWebhook,
  processPlivoVoiceWebhook,
  verifyPlivoRequest
} from "./plivo-webhook.js";
import { buildPlivoMediaStreamUrl } from "../realtime/plivo-media-stream.js";
import { createTwilioMediaStreamToken } from "../realtime/twilio-media-stream.js";
import { plivoMediaStreamRoutes } from "./plivo-media.routes.js";

export const plivoWebhookRoutes: FastifyPluginCallback = (app, _options, done) => {
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_request, body, parserDone) => {
      parserDone(null, body);
    }
  );

  app.post("/voice", async (request, reply) => {
    const rawBody = requireRawBody(request.body);
    verifyPlivoRequest(app, request, rawBody);
    let result: Awaited<ReturnType<typeof processPlivoVoiceWebhook>>;

    try {
      result = await processPlivoVoiceWebhook(app, request, rawBody);
    } catch (error) {
      if (error instanceof AppError && error.code === "PAYMENT_REQUIRED") {
        reply.header("content-type", "text/xml; charset=utf-8");
        return unavailableXml(error.message);
      }

      if (error instanceof AppError && error.code === "FORBIDDEN") {
        reply.header("content-type", "text/xml; charset=utf-8");
        return unavailableXml(error.message);
      }

      throw error;
    }

    reply.header("content-type", "text/xml; charset=utf-8");
    return assistantStreamingXml(
      app.config.PLIVO_WEBHOOK_BASE_URL,
      app.config.COOKIE_SECRET,
      result.callId
    );
  });

  app.post("/status", async (request) => {
    const rawBody = requireRawBody(request.body);
    verifyPlivoRequest(app, request, rawBody);
    const result = await processPlivoStatusWebhook(app, request, rawBody);

    return { ok: true, ...result };
  });

  app.register(plivoMediaStreamRoutes);

  done();
};

function requireRawBody(body: unknown): string {
  if (typeof body !== "string") {
    throw new Error("Plivo webhook body parser did not return a raw form body");
  }

  return body;
}

function unavailableXml(message: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<Response>",
    `<Speak>${escapeXml(message)}. Please contact the business administrator.</Speak>`,
    "</Response>"
  ].join("");
}

function assistantStreamingXml(
  baseUrl: string,
  streamSecret: string,
  callId: string | undefined
): string {
  const streamToken = callId ? createTwilioMediaStreamToken(callId, streamSecret) : undefined;
  const streamUrl =
    callId && streamToken ? buildPlivoMediaStreamUrl(baseUrl, callId, streamToken) : undefined;

  if (!streamUrl) {
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      "<Response>",
      "<Speak>Thanks for calling. Your AI assistant session could not be initialized.</Speak>",
      "</Response>"
    ].join("");
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<Response>",
    "<Speak>Thanks for calling. Your AI assistant session has been initialized.</Speak>",
    `<Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-mulaw;rate=8000">${escapeXml(
      streamUrl
    )}</Stream>`,
    "</Response>"
  ].join("");
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
