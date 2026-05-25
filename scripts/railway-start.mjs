import { spawn } from "node:child_process";

const serviceName = process.env.RAILWAY_SERVICE_NAME ?? "";
const explicitTarget = process.env.VOXLINK_DEPLOY_TARGET ?? "";
const target = resolveTarget(explicitTarget || serviceName);

if (!target) {
  console.error(
    [
      "VoxLink could not infer which app to start.",
      "Set VOXLINK_DEPLOY_TARGET=api or VOXLINK_DEPLOY_TARGET=web in Railway.",
      `RAILWAY_SERVICE_NAME=${JSON.stringify(serviceName)}`
    ].join(" ")
  );
  process.exit(1);
}

if (target === "api") {
  await run("npm", ["run", "db:deploy", "-w", "@voxlink/api"]);
  await run("npm", ["run", "serve", "-w", "@voxlink/api"]);
}

if (target === "web") {
  await run("npm", ["run", "start", "-w", "@voxlink/web"]);
}

function resolveTarget(value) {
  const normalized = value.trim().toLowerCase();

  if (normalized === "api" || normalized.includes("api") || normalized.includes("backend")) {
    return "api";
  }

  if (normalized === "web" || normalized.includes("web") || normalized.includes("frontend")) {
    return "web";
  }

  if (!normalized) {
    return "api";
  }

  if (
    ["llm", "stt", "tts", "rag", "telephony", "shared"].some((name) => normalized.includes(name))
  ) {
    console.error(
      `${value} is an internal VoxLink package, not a standalone Railway HTTP service. ` +
        "Delete that Railway service and deploy only @voxlink/api and @voxlink/web."
    );
    return null;
  }

  return "api";
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      shell: process.platform === "win32",
      stdio: "inherit"
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} exited with ${signal ?? code}`));
    });
  });
}
