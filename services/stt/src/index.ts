export type {
  SttModelId,
  SttProviderPort,
  SttTranscriptionChunk,
  SttTranscriptionRequest
} from "@voxlink/shared";

export { GroqSttProvider, type GroqSttProviderConfig } from "./groq-stt-provider.js";

export const sttProviderKind = "stt" as const;
