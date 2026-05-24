export type { TelephonyInboundCall, TelephonyProviderPort } from "@voxlink/shared";

export {
  TwilioTelephonyProvider,
  createTwilioSignature,
  executionContextForWebhook,
  parseFormBody,
  type TwilioTelephonyProviderConfig
} from "./twilio-telephony-provider.js";

export const telephonyProviderKind = "telephony" as const;
