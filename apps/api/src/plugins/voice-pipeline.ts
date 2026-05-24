import fp from "fastify-plugin";
import { RedisVoiceSessionStore } from "../modules/realtime/voice-session-store.js";
import { VoicePipelineService } from "../modules/realtime/voice-pipeline.js";
import { VoiceTurnService } from "../modules/realtime/voice-turn-service.js";

export const voicePipelinePlugin = fp((app, _options, done) => {
  const voiceSessions = new RedisVoiceSessionStore(app.redis);
  const voiceTurns = new VoiceTurnService({
    prisma: app.prisma,
    providers: app.providers,
    log: app.log
  });
  const voicePipeline = new VoicePipelineService({
    prisma: app.prisma,
    sessions: voiceSessions,
    turns: voiceTurns,
    log: app.log
  });

  app.decorate("voiceSessions", voiceSessions);
  app.decorate("voiceTurns", voiceTurns);
  app.decorate("voicePipeline", voicePipeline);
  done();
});
