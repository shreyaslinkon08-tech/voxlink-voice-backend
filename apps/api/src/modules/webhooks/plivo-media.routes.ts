import type { FastifyPluginCallback } from "fastify";
import { z } from "zod";
import {
  parsePlivoMediaStreamMessage,
  plivoMediaToTwilioMedia,
  plivoStartToTwilioStart,
  plivoStopToTwilioStop,
  twilioOutboundToPlivoMessage
} from "../realtime/plivo-media-stream.js";
import {
  type TwilioOutboundMessage,
  verifyTwilioMediaStreamToken
} from "../realtime/twilio-media-stream.js";

const querySchema = z.object({
  callId: z.string().uuid(),
  token: z.string().min(1)
});

export const plivoMediaStreamRoutes: FastifyPluginCallback = (app, _options, done) => {
  app.get("/media", { websocket: true }, (socket, request) => {
    let streamSid: string | undefined;
    let stoppedCleanly = false;
    let messageQueue = Promise.resolve();

    socket.on("message", (message) => {
      messageQueue = messageQueue
        .then(async () => {
          const event = parsePlivoMediaStreamMessage(message);

          switch (event.event) {
            case "start": {
              const streamAuth = resolveStreamAuth(request.query);

              if (
                !verifyTwilioMediaStreamToken(
                  streamAuth.callId,
                  streamAuth.token,
                  app.config.COOKIE_SECRET
                )
              ) {
                throw new Error("Invalid Plivo media stream token");
              }

              streamSid = event.streamId;
              const session = await app.voicePipeline.handleTwilioStart({
                event: plivoStartToTwilioStart(event, streamAuth.callId),
                callId: streamAuth.callId,
                requestId: request.id,
                provider: "plivo"
              });
              request.log.info(
                { callId: session.callId, streamSid: session.streamSid },
                "Plivo media stream started"
              );
              break;
            }
            case "media":
              sendOutboundMessages(
                socket,
                await app.voicePipeline.handleTwilioMedia({
                  event: plivoMediaToTwilioMedia(event)
                })
              );
              break;
            case "playedStream":
              await app.voicePipeline.handleTwilioMark({
                event: {
                  event: "mark",
                  sequenceNumber: String(Date.now()),
                  streamSid: event.streamId,
                  mark: { name: event.name ?? "" }
                }
              });
              break;
            case "clearedAudio":
              request.log.debug({ event }, "Plivo cleared audio event received");
              break;
            case "stop":
              stoppedCleanly = true;
              streamSid = event.streamId;
              sendOutboundMessages(
                socket,
                await app.voicePipeline.handleTwilioStop({
                  event: plivoStopToTwilioStop(event)
                })
              );
              socket.close(1000, "stream stopped");
              break;
          }
        })
        .catch((error: unknown) => {
          request.log.error({ error }, "Plivo media stream processing failed");
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
          request.log.error({ error, streamSid }, "Failed to close Plivo media stream session");
        });
    });

    socket.on("error", (error) => {
      request.log.error({ error, streamSid }, "Plivo media stream socket error");
    });
  });

  done();
};

function resolveStreamAuth(query: unknown): { readonly callId: string; readonly token: string } {
  const parsedQuery = querySchema.safeParse(query);

  if (!parsedQuery.success) {
    throw new Error("Plivo media stream did not include signed call context");
  }

  return parsedQuery.data;
}

function sendOutboundMessages(
  socket: { readonly readyState: number; send(message: string): void },
  messages: readonly TwilioOutboundMessage[]
): void {
  if (socket.readyState !== 1) {
    return;
  }

  for (const message of messages) {
    socket.send(twilioOutboundToPlivoMessage(message));
  }
}
