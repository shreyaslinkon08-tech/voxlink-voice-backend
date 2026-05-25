import fp from "fastify-plugin";
import { Redis } from "ioredis";

export const redisPlugin = fp((app, _options, done) => {
  const redis = new Redis(app.config.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1
  });

  app.decorate("redis", redis);

  app.addHook("onClose", async () => {
    await redis.quit();
  });

  done();
});
