import { readFileSync, existsSync } from "node:fs";

loadDotEnv();

const required = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_TEST_FROM_NUMBER",
  "TWILIO_TEST_TO_NUMBER",
  "TWILIO_WEBHOOK_BASE_URL"
];
const missing = required.filter((name) => !process.env[name]?.trim());

if (missing.length > 0) {
  console.error(`Missing required env vars: ${missing.join(", ")}`);
  process.exit(1);
}

const voiceUrl = new URL("/webhooks/twilio/voice", process.env.TWILIO_WEBHOOK_BASE_URL);
const statusCallback = new URL("/webhooks/twilio/status", process.env.TWILIO_WEBHOOK_BASE_URL);
const body = new URLSearchParams({
  To: process.env.TWILIO_TEST_TO_NUMBER,
  From: process.env.TWILIO_TEST_FROM_NUMBER,
  Url: voiceUrl.toString(),
  Method: "POST",
  StatusCallback: statusCallback.toString(),
  StatusCallbackMethod: "POST"
});

for (const event of ["initiated", "ringing", "answered", "completed"]) {
  body.append("StatusCallbackEvent", event);
}

if (process.argv.includes("--dry-run")) {
  console.log(
    JSON.stringify(
      {
        ok: true,
        dryRun: true,
        voiceUrl: voiceUrl.toString(),
        statusCallback: statusCallback.toString(),
        from: process.env.TWILIO_TEST_FROM_NUMBER,
        to: process.env.TWILIO_TEST_TO_NUMBER
      },
      null,
      2
    )
  );
  process.exit(0);
}

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const response = await fetch(
  `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Calls.json`,
  {
    method: "POST",
    body,
    headers: {
      authorization: `Basic ${Buffer.from(
        `${accountSid}:${process.env.TWILIO_AUTH_TOKEN}`
      ).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded"
    }
  }
);
const payload = await response.text();

if (!response.ok) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        status: response.status,
        body: payload.slice(0, 1000)
      },
      null,
      2
    )
  );
  process.exit(1);
}

console.log(payload);

function loadDotEnv(path = ".env") {
  if (!existsSync(path)) {
    return;
  }

  const contents = readFileSync(path, "utf8");

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const [key, ...valueParts] = trimmed.split("=");
    const value = valueParts.join("=").replace(/^"|"$/g, "");

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
