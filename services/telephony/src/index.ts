export type { TelephonyInboundCall, TelephonyProviderPort } from "@voxlink/shared";

export {
  PlivoTelephonyProvider,
  createPlivoSignatureV3,
  type PlivoTelephonyProviderConfig
} from "./plivo-telephony-provider.js";

export {
  TwilioTelephonyProvider,
  createTwilioSignature,
  executionContextForWebhook,
  parseFormBody,
  type TwilioTelephonyProviderConfig
} from "./twilio-telephony-provider.js";

export const telephonyProviderKind = "telephony" as const;
