import { describe, expect, it } from "vitest";
import { loadConfig } from "./env.js";

describe("loadConfig", () => {
  it("parses boolean environment flags safely", () => {
    const config = loadConfig({
      ...baseEnv(),
      TRUST_PROXY: "true"
    });

    expect(config.TRUST_PROXY).toBe(true);
  });

  it("rejects placeholder production secrets and non-HTTPS public URLs", () => {
    expect(() =>
      loadConfig({
        ...baseEnv(),
        NODE_ENV: "production",
        API_PUBLIC_URL: "http://api.example.com",
        JWT_ACCESS_SECRET: "replace-with-at-least-32-random-characters",
        GROQ_API_KEYS: ""
      })
    ).toThrow(/Invalid production API environment/);
  });

  it("accepts production config with HTTPS URLs and non-placeholder secrets", () => {
    const config = loadConfig({
      ...baseEnv(),
      NODE_ENV: "production",
      API_PUBLIC_URL: "https://api.example.com",
      WEB_PUBLIC_URL: "https://app.example.com",
      WEB_ORIGIN: "https://app.example.com",
      TWILIO_WEBHOOK_BASE_URL: "https://voice.example.com",
      JWT_ACCESS_SECRET: "access_secret_1234567890_1234567890_safe",
      JWT_REFRESH_SECRET: "refresh_secret_1234567890_123456789_safe",
      COOKIE_SECRET: "cookie_secret_1234567890_1234567890_safe",
      TWILIO_ACCOUNT_SID: "AC1234567890",
      TWILIO_AUTH_TOKEN: "twilio_secret_1234567890_1234567890_safe",
      GROQ_API_KEYS: "gsk_test_key_1234567890",
      BILLING_PROVIDER: "stripe",
      STRIPE_SECRET_KEY: "sk_test_1234567890",
      STRIPE_WEBHOOK_SECRET: "whsec_1234567890",
      STRIPE_PRICE_ID_STARTER: "price_starter",
      STRIPE_PRICE_ID_GROWTH: "price_growth"
    });

    expect(config.NODE_ENV).toBe("production");
  });

  it("requires Google OAuth credentials to be configured as a pair in production", () => {
    expect(() =>
      loadConfig({
        ...baseEnv(),
        NODE_ENV: "production",
        API_PUBLIC_URL: "https://api.example.com",
        WEB_PUBLIC_URL: "https://app.example.com",
        WEB_ORIGIN: "https://app.example.com",
        TWILIO_WEBHOOK_BASE_URL: "https://voice.example.com",
        JWT_ACCESS_SECRET: "access_secret_1234567890_1234567890_safe",
        JWT_REFRESH_SECRET: "refresh_secret_1234567890_123456789_safe",
        COOKIE_SECRET: "cookie_secret_1234567890_1234567890_safe",
        TWILIO_ACCOUNT_SID: "AC1234567890",
        TWILIO_AUTH_TOKEN: "twilio_secret_1234567890_1234567890_safe",
        GROQ_API_KEYS: "gsk_test_key_1234567890",
        BILLING_PROVIDER: "stripe",
        STRIPE_SECRET_KEY: "sk_test_1234567890",
        STRIPE_WEBHOOK_SECRET: "whsec_1234567890",
        STRIPE_PRICE_ID_STARTER: "price_starter",
        STRIPE_PRICE_ID_GROWTH: "price_growth",
        GOOGLE_OAUTH_CLIENT_ID: "google-client-id"
      })
    ).toThrow(/GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET/);
  });

  it("requires explicit Stripe billing in production by default", () => {
    expect(() =>
      loadConfig({
        ...baseEnv(),
        NODE_ENV: "production",
        API_PUBLIC_URL: "https://api.example.com",
        WEB_PUBLIC_URL: "https://app.example.com",
        WEB_ORIGIN: "https://app.example.com",
        TWILIO_WEBHOOK_BASE_URL: "https://voice.example.com",
        JWT_ACCESS_SECRET: "access_secret_1234567890_1234567890_safe",
        JWT_REFRESH_SECRET: "refresh_secret_1234567890_123456789_safe",
        COOKIE_SECRET: "cookie_secret_1234567890_1234567890_safe",
        TWILIO_ACCOUNT_SID: "AC1234567890",
        TWILIO_AUTH_TOKEN: "twilio_secret_1234567890_1234567890_safe",
        GROQ_API_KEYS: "gsk_test_key_1234567890"
      })
    ).toThrow(/BILLING_PROVIDER=stripe/);
  });
});

function baseEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "development",
    DATABASE_URL: "postgresql://user:pass@localhost:5432/altrion_voice?schema=public",
    JWT_ACCESS_SECRET: "access_secret_1234567890_1234567890_safe",
    JWT_REFRESH_SECRET: "refresh_secret_1234567890_123456789_safe",
    COOKIE_SECRET: "cookie_secret_1234567890_1234567890_safe",
    TWILIO_AUTH_TOKEN: "twilio_secret_1234567890_1234567890_safe",
    TWILIO_WEBHOOK_BASE_URL: "http://localhost:4000"
  };
}
