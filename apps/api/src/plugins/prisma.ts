import fp from "fastify-plugin";
import { PrismaClient } from "@prisma/client";

export const prismaPlugin = fp((app, _options, done) => {
  const prisma = new PrismaClient({
    log: app.config.NODE_ENV === "development" ? ["warn", "error"] : ["error"]
  });

  app.decorate("prisma", prisma);

  app.addHook("onClose", async () => {
    await prisma.$disconnect();
  });

  done();
});
