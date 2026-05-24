import "dotenv/config";
import { buildApp } from "./app.js";
import { loadConfig } from "./config/env.js";

const config = loadConfig();
const app = await buildApp(config);
let isShuttingDown = false;

try {
  await app.listen({ host: config.API_HOST, port: config.API_PORT });
} catch (error) {
  app.log.error({ error }, "Failed to start API server");
  process.exit(1);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown(signal);
  });
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  app.log.info({ signal }, "Shutting down API server");

  try {
    await app.close();
    process.exit(0);
  } catch (error) {
    app.log.error({ error }, "Failed to shut down API server cleanly");
    process.exit(1);
  }
}
