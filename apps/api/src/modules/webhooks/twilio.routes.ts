import type { FastifyPluginCallback } from "fastify";
import { AppError } from "../../errors/app-error.js";
import {
  processTwilioStatusWebhook,
  processTwilioVoiceWebhook,
  verifyTwilioRequest
} from "./twilio-webhook.js";
import {
  buildTwilioMediaStreamUrl,
  createTwilioMediaStreamToken
} from "../realtime/twilio-media-stream.js";
import { twilioMediaStreamRoutes } from "./twilio-media.routes.js";

export const twilioWebhookRoutes: FastifyPluginCallback = (app, _options, done) => {
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_request, body, parserDone) => {
      parserDone(null, body);
    }
  );

  app.post("/voice", async (request, reply) => {
    const rawBody = requireRawBody(request.body);
    await verifyTwilioRequest(app, request, rawBody);
    let result: Awaited<ReturnType<typeof processTwilioVoiceWebhook>>;

    try {
      result = await processTwilioVoiceWebhook(app, request, rawBody);
    } catch (error) {
      if (error instanceof AppError && error.code === "PAYMENT_REQUIRED") {
        reply.header("content-type", "text/xml; charset=utf-8");
        return planLimitTwiml(error.message);
      }

      if (error instanceof AppError && error.code === "FORBIDDEN") {
        reply.header("content-type", "text/xml; charset=utf-8");
        return unavailableTwiml(error.message);
      }

      throw error;
    }

    reply.header("content-type", "text/xml; charset=utf-8");
    return assistantStreamingTwiml(
      app.config.TWILIO_WEBHOOK_BASE_URL,
      app.config.COOKIE_SECRET,
      result.callId
    );
  });

  app.post("/status", async (request) => {
    const rawBody = requireRawBody(request.body);
    await verifyTwilioRequest(app, request, rawBody);
    const result = await processTwilioStatusWebhook(app, request, rawBody);

    return { ok: true, ...result };
  });

  app.register(twilioMediaStreamRoutes);

  done();
};

function requireRawBody(body: unknown): string {
  if (typeof body !== "string") {
    throw new Error("Twilio webhook body parser did not return a raw form body");
  }

  return body;
}

function planLimitTwiml(message: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<Response>",
    `<Say voice="alice">${escapeXml(message)}. Please contact the business administrator.</Say>`,
    "</Response>"
  ].join("");
}

function unavailableTwiml(message: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<Response>",
    `<Say voice="alice">${escapeXml(message)}. Please contact the business administrator.</Say>`,
    "</Response>"
  ].join("");
}

function assistantStreamingTwiml(
  baseUrl: string,
  streamSecret: string,
  callId: string | undefined
): string {
  const safeCallId = escapeXml(callId ?? "unknown");
  const streamToken = callId ? createTwilioMediaStreamToken(callId, streamSecret) : undefined;
  const streamUrl =
    callId && streamToken ? buildTwilioMediaStreamUrl(baseUrl, callId, streamToken) : undefined;

  if (!streamUrl) {
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      "<Response>",
      '<Say voice="alice">Thanks for calling. Your AI assistant session could not be initialized.</Say>',
      "</Response>"
    ].join("");
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<Response>",
    '<Say voice="alice">Thanks for calling. Your AI assistant session has been initialized.</Say>',
    "<Connect>",
    `<Stream url="${escapeXml(streamUrl)}">`,
    `<Parameter name="callId" value="${safeCallId}"/>`,
    "</Stream>",
    "</Connect>",
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
