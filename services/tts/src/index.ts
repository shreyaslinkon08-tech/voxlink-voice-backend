export type { TtsModelId, TtsProviderPort, TtsSynthesisRequest } from "@altrion/shared";

export { GroqTtsProvider, type GroqTtsProviderConfig } from "./groq-tts-provider.js";

export const ttsProviderKind = "tts" as const;
