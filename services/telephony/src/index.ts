export type { TelephonyInboundCall, TelephonyProviderPort } from "@altrion/shared";

export {
  TwilioTelephonyProvider,
  createTwilioSignature,
  executionContextForWebhook,
  parseFormBody,
  type TwilioTelephonyProviderConfig
} from "./twilio-telephony-provider.js";

export const telephonyProviderKind = "telephony" as const;
