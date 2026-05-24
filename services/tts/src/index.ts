export type { TtsModelId, TtsProviderPort, TtsSynthesisRequest } from "@voxlink/shared";

export { GroqTtsProvider, type GroqTtsProviderConfig } from "./groq-tts-provider.js";

export const ttsProviderKind = "tts" as const;
