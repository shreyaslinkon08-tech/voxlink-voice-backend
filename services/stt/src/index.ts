export type {
  SttModelId,
  SttProviderPort,
  SttTranscriptionChunk,
  SttTranscriptionRequest
} from "@altrion/shared";

export { GroqSttProvider, type GroqSttProviderConfig } from "./groq-stt-provider.js";

export const sttProviderKind = "stt" as const;
