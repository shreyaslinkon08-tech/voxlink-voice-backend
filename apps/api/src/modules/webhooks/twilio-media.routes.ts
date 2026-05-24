import type { FastifyPluginCallback } from "fastify";
import { z } from "zod";
import {
  getCallIdFromStartEvent,
  parseTwilioMediaStreamMessage,
  type TwilioOutboundMessage,
  verifyTwilioMediaStreamToken
} from "../realtime/twilio-media-stream.js";

const querySchema = z.object({
  callId: z.string().uuid().optional(),
  token: z.string().min(1).optional()
});

export const twilioMediaStreamRoutes: FastifyPluginCallback = (app, _options, done) => {
  app.get("/media", { websocket: true }, (socket, request) => {
    let streamSid: string | undefined;
    let stoppedCleanly = false;
    let messageQueue = Promise.resolve();

    socket.on("message", (message) => {
      messageQueue = messageQueue
        .then(async () => {
          const event = parseTwilioMediaStreamMessage(message);

          switch (event.event) {
            case "connected":
              request.log.debug({ requestId: request.id }, "Twilio media stream connected");
              break;
            case "start": {
              const streamAuth = resolveStreamAuth(request.query, event);
              if (
                !verifyTwilioMediaStreamToken(
                  streamAuth.callId,
                  streamAuth.token,
                  app.config.COOKIE_SECRET
                )
              ) {
                throw new Error("Invalid Twilio media stream token");
              }

              streamSid = event.start.streamSid;
              const session = await app.voicePipeline.handleTwilioStart({
                event,
                callId: streamAuth.callId,
                requestId: request.id
              });
              request.log.info(
                { callId: session.callId, streamSid: session.streamSid },
                "Twilio media stream started"
              );
              break;
            }
            case "media":
              sendOutboundMessages(socket, await app.voicePipeline.handleTwilioMedia({ event }));
              break;
            case "mark":
              await app.voicePipeline.handleTwilioMark({ event });
              request.log.debug({ event }, "Twilio media stream mark event received");
              break;
            case "dtmf":
              request.log.debug({ event }, "Twilio media stream control event received");
              break;
            case "stop":
              stoppedCleanly = true;
              streamSid = event.streamSid;
              sendOutboundMessages(socket, await app.voicePipeline.handleTwilioStop({ event }));
              socket.close(1000, "stream stopped");
              break;
          }
        })
        .catch((error: unknown) => {
          request.log.error({ error }, "Twilio media stream processing failed");
          socket.close(1011, "stream processing failed");
        });
    });

    socket.on("close", (code, reason) => {
      if (!streamSid || stoppedCleanly) {
        return;
      }

      const closeReason = reason.toString("utf8");
      void app.voicePipeline
        .handleTwilioConnectionClosed({ streamSid, code, reason: closeReason })
        .catch((error: unknown) => {
          request.log.error({ error, streamSid }, "Failed to close Twilio media stream session");
        });
    });

    socket.on("error", (error) => {
      request.log.error({ error, streamSid }, "Twilio media stream socket error");
    });
  });

  done();
};

function resolveStreamAuth(
  query: unknown,
  event: Parameters<typeof getCallIdFromStartEvent>[0]
): { readonly callId: string; readonly token: string } {
  const parsedQuery = querySchema.safeParse(query);
  const queryCallId = parsedQuery.success ? parsedQuery.data.callId : undefined;
  const queryToken = parsedQuery.success ? parsedQuery.data.token : undefined;
  const parameterCallId = getCallIdFromStartEvent(event);
  const callId = queryCallId ?? parameterCallId;

  if (!callId || !queryToken) {
    throw new Error("Twilio media stream did not include signed call context");
  }

  return { callId, token: queryToken };
}

function sendOutboundMessages(
  socket: { readonly readyState: number; send(message: string): void },
  messages: readonly TwilioOutboundMessage[]
): void {
  if (socket.readyState !== 1) {
    return;
  }

  for (const message of messages) {
    socket.send(JSON.stringify(message));
  }
}
