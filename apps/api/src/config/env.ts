import { z } from "zod";

const booleanEnvSchema = z.preprocess((value) => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value !== "string") {
    return value;
  }

  const normalized = value.trim().toLowerCase();

  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }

  return value;
}, z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  TRUST_PROXY: booleanEnvSchema.default(false),
  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  API_PUBLIC_URL: z.string().url().default("http://localhost:4000"),
  WEB_PUBLIC_URL: z.string().url().default("http://localhost:3000"),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  MAIL_HOST: z.string().min(1).default("localhost"),
  MAIL_PORT: z.coerce.number().int().positive().default(1025),
  MAIL_FROM: z.string().min(1).default("VoxLink Voice <no-reply@voxlink.local>"),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  COOKIE_SECRET: z.string().min(32),
  GOOGLE_OAUTH_CLIENT_ID: z.string().default(""),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().default(""),
  GOOGLE_OAUTH_REDIRECT_URL: z.string().url().or(z.literal("")).default(""),
  BILLING_PROVIDER: z.enum(["internal", "stripe"]).default("internal"),
  ALLOW_INTERNAL_BILLING_IN_PRODUCTION: booleanEnvSchema.default(false),
  STRIPE_SECRET_KEY: z.string().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().default(""),
  STRIPE_API_BASE_URL: z.string().url().default("https://api.stripe.com"),
  STRIPE_PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  STRIPE_PRICE_ID_STARTER: z.string().default(""),
  STRIPE_PRICE_ID_GROWTH: z.string().default(""),
  STRIPE_PRICE_ID_SCALE: z.string().default(""),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_WINDOW: z.string().min(1).default("1 minute"),
  TWILIO_ACCOUNT_SID: z.string().default(""),
  TWILIO_AUTH_TOKEN: z.string().default(""),
  TWILIO_API_BASE_URL: z.string().url().default("https://api.twilio.com"),
  TWILIO_PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  TWILIO_WEBHOOK_BASE_URL: z.string().url().default("http://localhost:4000"),
  GROQ_API_KEYS: z.string().default(""),
  GROQ_BASE_URL: z.string().url().default("https://api.groq.com/openai/v1"),
  GROQ_PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  GROQ_LLM_DEFAULT_PROFILE: z.enum(["llama", "gemma", "mixtral", "gpt"]).default("llama"),
  GROQ_LLM_MODEL_LLAMA: z.string().min(1).default("llama-3.3-70b-versatile"),
  GROQ_LLM_MODEL_GEMMA: z.string().min(1).default("gemma2-9b-it"),
  GROQ_LLM_MODEL_MIXTRAL: z.string().default(""),
  GROQ_LLM_MODEL_GPT: z.string().min(1).default("openai/gpt-oss-120b"),
  GROQ_STT_MODEL: z
    .enum(["whisper-large-v3", "whisper-large-v3-turbo"])
    .default("whisper-large-v3-turbo"),
  GROQ_TTS_MODEL: z
    .enum(["canopylabs/orpheus-v1-english", "canopylabs/orpheus-arabic-saudi"])
    .default("canopylabs/orpheus-v1-english")
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const normalizedSource = { ...source };

  if (!normalizedSource.API_PORT && normalizedSource.PORT) {
    normalizedSource.API_PORT = normalizedSource.PORT;
  }

  normalizeProductionUrls(normalizedSource);

  const result = envSchema.safeParse(normalizedSource);

  if (!result.success) {
    const message = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid API environment: ${message}`);
  }

  assertProductionSafeConfig(result.data);
  return result.data;
}

function assertProductionSafeConfig(config: AppConfig): void {
  if (config.NODE_ENV !== "production") {
    return;
  }

  const issues: string[] = [];
  requireHttps("API_PUBLIC_URL", config.API_PUBLIC_URL, issues);
  requireHttps("WEB_PUBLIC_URL", config.WEB_PUBLIC_URL, issues);
  requireHttps("WEB_ORIGIN", config.WEB_ORIGIN, issues);
  requireHttps("TWILIO_API_BASE_URL", config.TWILIO_API_BASE_URL, issues);
  requireHttps("TWILIO_WEBHOOK_BASE_URL", config.TWILIO_WEBHOOK_BASE_URL, issues);
  requireHttps("GROQ_BASE_URL", config.GROQ_BASE_URL, issues);
  requireHttps("STRIPE_API_BASE_URL", config.STRIPE_API_BASE_URL, issues);

  requireStrongSecret("JWT_ACCESS_SECRET", config.JWT_ACCESS_SECRET, issues);
  requireStrongSecret("JWT_REFRESH_SECRET", config.JWT_REFRESH_SECRET, issues);
  requireStrongSecret("COOKIE_SECRET", config.COOKIE_SECRET, issues);
  requireOptionalOAuthPair(config, issues);
  requireProductionBillingConfig(config, issues);

  if (
    new Set([config.JWT_ACCESS_SECRET, config.JWT_REFRESH_SECRET, config.COOKIE_SECRET]).size < 3
  ) {
    issues.push("JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, and COOKIE_SECRET must be unique");
  }

  if (issues.length > 0) {
    throw new Error(`Invalid production API environment: ${issues.join("; ")}`);
  }
}

function normalizeProductionUrls(source: NodeJS.ProcessEnv): void {
  if (source.NODE_ENV !== "production") {
    return;
  }

  const apiPublicUrl = source.API_PUBLIC_URL;

  if (!apiPublicUrl || isLocalUrl(apiPublicUrl)) {
    return;
  }

  if (!source.WEB_PUBLIC_URL || isLocalUrl(source.WEB_PUBLIC_URL)) {
    source.WEB_PUBLIC_URL = apiPublicUrl;
  }

  if (!source.WEB_ORIGIN || isLocalUrl(source.WEB_ORIGIN)) {
    source.WEB_ORIGIN = source.WEB_PUBLIC_URL;
  }

  if (!source.TWILIO_WEBHOOK_BASE_URL || isLocalUrl(source.TWILIO_WEBHOOK_BASE_URL)) {
    source.TWILIO_WEBHOOK_BASE_URL = apiPublicUrl;
  }
}

function requireOptionalOAuthPair(config: AppConfig, issues: string[]): void {
  const hasGoogleClientId = Boolean(config.GOOGLE_OAUTH_CLIENT_ID.trim());
  const hasGoogleClientSecret = Boolean(config.GOOGLE_OAUTH_CLIENT_SECRET.trim());

  if (hasGoogleClientId !== hasGoogleClientSecret) {
    issues.push("GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET must be provided together");
  }

  if (config.GOOGLE_OAUTH_REDIRECT_URL) {
    requireHttps("GOOGLE_OAUTH_REDIRECT_URL", config.GOOGLE_OAUTH_REDIRECT_URL, issues);
  }
}

function requireProductionBillingConfig(config: AppConfig, issues: string[]): void {
  if (config.BILLING_PROVIDER !== "stripe") {
    if (!config.ALLOW_INTERNAL_BILLING_IN_PRODUCTION) {
      issues.push(
        "BILLING_PROVIDER=stripe is required in production unless ALLOW_INTERNAL_BILLING_IN_PRODUCTION=true"
      );
    }

    return;
  }

  if (!config.STRIPE_SECRET_KEY.startsWith("sk_")) {
    issues.push("STRIPE_SECRET_KEY must be configured for Stripe billing");
  }

  if (!config.STRIPE_WEBHOOK_SECRET.startsWith("whsec_")) {
    issues.push("STRIPE_WEBHOOK_SECRET must be configured for Stripe webhooks");
  }

  if (!config.STRIPE_PRICE_ID_STARTER.startsWith("price_")) {
    issues.push("STRIPE_PRICE_ID_STARTER must be configured for the Starter plan");
  }

  if (!config.STRIPE_PRICE_ID_GROWTH.startsWith("price_")) {
    issues.push("STRIPE_PRICE_ID_GROWTH must be configured for the Growth plan");
  }
}

function requireHttps(name: string, value: string, issues: string[]): void {
  if (new URL(value).protocol !== "https:") {
    issues.push(`${name} must use https in production`);
  }
}

function isLocalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "0.0.0.0"].includes(url.hostname);
  } catch {
    return false;
  }
}

function requireStrongSecret(name: string, value: string, issues: string[]): void {
  const normalized = value.trim().toLowerCase();

  if (
    value.trim().length < 32 ||
    normalized.includes("replace-with") ||
    normalized.includes("changeme") ||
    normalized.includes("dev_password") ||
    normalized.includes("password")
  ) {
    issues.push(`${name} must be a unique non-placeholder secret with at least 32 characters`);
  }
}
