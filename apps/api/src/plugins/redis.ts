import fp from "fastify-plugin";
import { Redis } from "ioredis";

export const redisPlugin = fp(async (app) => {
  const redis = new Redis(app.config.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1
  });

  await redis.connect();
  app.decorate("redis", redis);

  app.addHook("onClose", async () => {
    await redis.quit();
  });
});
