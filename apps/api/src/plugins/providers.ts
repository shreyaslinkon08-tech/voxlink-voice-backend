import fp from "fastify-plugin";
import { GroqLlmProvider } from "@altrion/llm";
import { GroqSttProvider } from "@altrion/stt";
import { TwilioTelephonyProvider } from "@altrion/telephony";
import { GroqTtsProvider } from "@altrion/tts";
import type { LlmModelProfile } from "@altrion/shared";
import { ProviderRegistry } from "../providers/provider-registry.js";

export const providersPlugin = fp((app, _options, done) => {
  const registry = new ProviderRegistry();
  const groqApiKeys = parseCsv(app.config.GROQ_API_KEYS);

  registry.register(
    new TwilioTelephonyProvider({
      accountSid: app.config.TWILIO_ACCOUNT_SID,
      authToken: app.config.TWILIO_AUTH_TOKEN,
      apiBaseUrl: app.config.TWILIO_API_BASE_URL,
      requestTimeoutMs: app.config.TWILIO_PROVIDER_TIMEOUT_MS
    })
  );

  if (groqApiKeys.length === 0) {
    app.log.warn("Groq providers were not registered because GROQ_API_KEYS is empty");
  } else {
    const llmModels: Partial<Record<LlmModelProfile, string>> = {
      llama: app.config.GROQ_LLM_MODEL_LLAMA,
      gemma: app.config.GROQ_LLM_MODEL_GEMMA,
      gpt: app.config.GROQ_LLM_MODEL_GPT
    };

    if (app.config.GROQ_LLM_MODEL_MIXTRAL.trim()) {
      llmModels.mixtral = app.config.GROQ_LLM_MODEL_MIXTRAL.trim();
    }

    registry.register(
      new GroqLlmProvider({
        apiKeys: groqApiKeys,
        baseUrl: app.config.GROQ_BASE_URL,
        defaultProfile: app.config.GROQ_LLM_DEFAULT_PROFILE,
        models: llmModels,
        requestTimeoutMs: app.config.GROQ_PROVIDER_TIMEOUT_MS
      })
    );

    registry.register(
      new GroqSttProvider({
        apiKeys: groqApiKeys,
        baseUrl: app.config.GROQ_BASE_URL,
        defaultModel: app.config.GROQ_STT_MODEL,
        requestTimeoutMs: app.config.GROQ_PROVIDER_TIMEOUT_MS
      })
    );

    registry.register(
      new GroqTtsProvider({
        apiKeys: groqApiKeys,
        baseUrl: app.config.GROQ_BASE_URL,
        defaultModel: app.config.GROQ_TTS_MODEL,
        requestTimeoutMs: app.config.GROQ_PROVIDER_TIMEOUT_MS
      })
    );
  }

  app.decorate("providers", registry);
  done();
});

function parseCsv(value: string): readonly string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
