export type {
  ChatMessage,
  LlmCompletionRequest,
  LlmCompletionResponse,
  LlmModelProfile,
  LlmProviderPort
} from "@voxlink/shared";

export { GroqLlmProvider, type GroqLlmProviderConfig } from "./groq-llm-provider.js";

export const llmProviderKind = "llm" as const;
