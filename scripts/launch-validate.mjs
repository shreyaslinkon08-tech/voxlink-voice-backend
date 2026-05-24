import { readFileSync, existsSync } from "node:fs";

loadDotEnv();

const failures = [];
const warnings = [];

requireValue("DATABASE_URL");
requireHttps("API_PUBLIC_URL");
requireHttps("WEB_PUBLIC_URL");
requireHttps("WEB_ORIGIN");
requireValue("REDIS_URL");
requireSecret("JWT_ACCESS_SECRET", 32);
requireSecret("JWT_REFRESH_SECRET", 32);
requireSecret("COOKIE_SECRET", 32);
requireValue("TWILIO_ACCOUNT_SID");
requireSecret("TWILIO_AUTH_TOKEN", 16);
requireHttps("TWILIO_WEBHOOK_BASE_URL");
requireValue("GROQ_API_KEYS");
requireGoogleOAuth();
requireStripeBilling();

if (process.env.NODE_ENV !== "production") {
  warnings.push("NODE_ENV is not production for this launch validation run");
}

await checkHttpEndpoint("/health", 200);
await checkHttpEndpoint("/ready", 200);

const result = {
  ok: failures.length === 0,
  failures,
  warnings
};

console.log(JSON.stringify(result, null, 2));

if (failures.length > 0) {
  process.exit(1);
}

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

function requireValue(name) {
  const value = process.env[name]?.trim();

  if (!value || isPlaceholder(value)) {
    failures.push(`${name} is missing or still uses a placeholder value`);
  }
}

function requireSecret(name, minimumLength) {
  const value = process.env[name]?.trim() ?? "";

  if (!value || value.length < minimumLength || isPlaceholder(value)) {
    failures.push(`${name} must be a non-placeholder secret with at least ${minimumLength} chars`);
  }
}

function requireHttps(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    failures.push(`${name} is required`);
    return;
  }

  try {
    if (new URL(value).protocol !== "https:") {
      failures.push(`${name} must use https for launch`);
    }
  } catch {
    failures.push(`${name} must be a valid URL`);
  }
}

function requireGoogleOAuth() {
  requireValue("GOOGLE_OAUTH_CLIENT_ID");
  requireSecret("GOOGLE_OAUTH_CLIENT_SECRET", 16);
  requireHttps("GOOGLE_OAUTH_REDIRECT_URL");
}

function requireStripeBilling() {
  if (process.env.BILLING_PROVIDER !== "stripe") {
    failures.push("BILLING_PROVIDER must be stripe before charging customers");
  }

  if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_")) {
    failures.push("STRIPE_SECRET_KEY must be configured");
  }

  if (!process.env.STRIPE_WEBHOOK_SECRET?.startsWith("whsec_")) {
    failures.push("STRIPE_WEBHOOK_SECRET must be configured");
  }

  for (const name of ["STRIPE_PRICE_ID_STARTER", "STRIPE_PRICE_ID_GROWTH"]) {
    if (!process.env[name]?.startsWith("price_")) {
      failures.push(`${name} must be configured`);
    }
  }
}

async function checkHttpEndpoint(path, expectedStatus) {
  const baseUrl = process.env.API_PUBLIC_URL;

  if (!baseUrl?.startsWith("https://")) {
    return;
  }

  const url = new URL(path, baseUrl);

  try {
    const response = await fetch(url, {
      headers: { "user-agent": "voxlink-launch-validate/1.0" }
    });

    if (response.status !== expectedStatus) {
      failures.push(`${url.toString()} returned ${response.status}, expected ${expectedStatus}`);
    }
  } catch (error) {
    failures.push(`${url.toString()} could not be reached: ${error.message}`);
  }
}

function isPlaceholder(value) {
  const normalized = value.toLowerCase();
  return (
    normalized.includes("replace-with") ||
    normalized.includes("changeme") ||
    normalized.includes("example.") ||
    normalized.includes("dev_password")
  );
}
