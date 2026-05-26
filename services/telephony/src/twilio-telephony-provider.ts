import { createHmac, timingSafeEqual } from "node:crypto";
import {
  ProviderHealthTracker,
  ProviderRequestError,
  isAbortError,
  isRetryableProviderCode,
  providerCodeFromHttpStatus,
  redactProviderSecrets,
  safeReadResponseText,
  type ProviderExecutionContext,
  type ProviderHealthSnapshot,
  type TelephonyAvailableNumberSearchRequest,
  type TelephonyAvailablePhoneNumber,
  type TelephonyInboundCall,
  type TelephonyNumberCapabilities,
  type TelephonyProvisionNumberRequest,
  type TelephonyProvisionNumberResponse,
  type TelephonyProviderPort
} from "@voxlink/shared";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface TwilioTelephonyProviderConfig {
  readonly accountSid?: string;
  readonly authToken: string;
  readonly apiBaseUrl?: string;
  readonly fetchImpl?: FetchLike;
  readonly requestTimeoutMs?: number;
}

interface TwilioAvailableNumbersResponse {
  readonly available_phone_numbers?: readonly TwilioAvailableNumberPayload[];
}

interface TwilioAvailableNumberPayload {
  readonly phone_number?: string;
  readonly friendly_name?: string;
  readonly locality?: string | null;
  readonly region?: string | null;
  readonly iso_country?: string | null;
  readonly capabilities?: Record<string, unknown>;
}

interface TwilioIncomingPhoneNumberPayload {
  readonly sid?: string;
  readonly account_sid?: string;
  readonly phone_number?: string;
  readonly friendly_name?: string;
  readonly capabilities?: Record<string, unknown>;
}

export class TwilioTelephonyProvider implements TelephonyProviderPort {
  readonly providerKind = "telephony" as const;
  readonly providerName = "twilio";

  private readonly accountSid?: string;
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly requestTimeoutMs: number;
  private readonly healthTracker = new ProviderHealthTracker({
    providerKind: this.providerKind,
    providerName: this.providerName
  });

  constructor(private readonly config: TwilioTelephonyProviderConfig) {
    this.accountSid = config.accountSid?.trim() || undefined;
    this.apiBaseUrl = config.apiBaseUrl ?? "https://api.twilio.com";
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.requestTimeoutMs = config.requestTimeoutMs ?? 10_000;
  }

  health(): Promise<ProviderHealthSnapshot> {
    return Promise.resolve(this.healthTracker.snapshot());
  }

  verifyWebhookSignature(rawUrl: string, rawBody: string, signature: string): Promise<boolean> {
    const expected = createTwilioSignature(rawUrl, parseFormBody(rawBody), this.config.authToken);
    return Promise.resolve(safeEqualBase64(expected, signature));
  }

  parseInboundCall(rawBody: string): Promise<TelephonyInboundCall> {
    const body = parseFormBody(rawBody);
    const providerCallId = body.CallSid;
    const to = body.To;
    const from = body.From;

    if (!providerCallId || !to || !from) {
      throw new Error("Twilio inbound call webhook is missing CallSid, To, or From");
    }

    return Promise.resolve({
      providerCallId,
      to,
      from,
      providerAccountId: body.AccountSid
    });
  }

  async searchAvailablePhoneNumbers(
    request: TelephonyAvailableNumberSearchRequest,
    context: ProviderExecutionContext
  ): Promise<readonly TelephonyAvailablePhoneNumber[]> {
    const accountSid = this.requireAccountSid();
    const countryCode = request.countryCode.trim().toUpperCase();
    const url = this.endpoint(
      `Accounts/${accountSid}/AvailablePhoneNumbers/${encodeURIComponent(countryCode)}/Local.json`
    );
    url.searchParams.set("VoiceEnabled", String(request.voiceEnabled ?? true));

    if (request.areaCode) {
      url.searchParams.set("AreaCode", request.areaCode.trim());
    }

    if (request.contains) {
      url.searchParams.set("Contains", request.contains.trim());
    }

    if (request.limit) {
      url.searchParams.set("PageSize", String(Math.min(request.limit, 20)));
    }

    const payload = await this.requestJson<TwilioAvailableNumbersResponse>(
      url,
      { method: "GET" },
      context,
      "search available phone numbers"
    );

    return (payload.available_phone_numbers ?? [])
      .filter((number): number is TwilioAvailableNumberPayload & { readonly phone_number: string } =>
        Boolean(number.phone_number)
      )
      .map((number) => ({
        e164: number.phone_number,
        friendlyName: number.friendly_name,
        locality: number.locality ?? undefined,
        region: number.region ?? undefined,
        countryCode: number.iso_country ?? countryCode,
        capabilities: capabilitiesFromTwilio(number.capabilities),
        providerMetadata: {
          locality: number.locality ?? undefined,
          region: number.region ?? undefined
        }
      }));
  }

  async provisionPhoneNumber(
    request: TelephonyProvisionNumberRequest,
    context: ProviderExecutionContext
  ): Promise<TelephonyProvisionNumberResponse> {
    const accountSid = this.requireAccountSid();
    const body = new URLSearchParams({
      PhoneNumber: request.e164,
      VoiceUrl: request.voiceWebhookUrl,
      VoiceMethod: "POST",
      StatusCallback: request.statusCallbackUrl,
      StatusCallbackMethod: "POST"
    });

    if (request.label) {
      body.set("FriendlyName", request.label);
    }

    const payload = await this.requestJson<TwilioIncomingPhoneNumberPayload>(
      this.endpoint(`Accounts/${accountSid}/IncomingPhoneNumbers.json`),
      {
        method: "POST",
        body
      },
      context,
      "provision phone number"
    );

    if (!payload.sid || !payload.phone_number) {
      throw new ProviderRequestError({
        providerKind: this.providerKind,
        providerName: this.providerName,
        code: "internal_provider_error",
        message: "Twilio provisioned a number but did not return a SID and phone number",
        retryable: true,
        cause: payload
      });
    }

    return {
      e164: payload.phone_number,
      providerNumberSid: payload.sid,
      providerAccountId: payload.account_sid,
      friendlyName: payload.friendly_name,
      capabilities: payload.capabilities ? capabilitiesFromTwilio(payload.capabilities) : undefined,
      providerMetadata: {
        accountSid: payload.account_sid
      }
    };
  }

  async updatePhoneNumberRouting(
    request: {
      readonly providerNumberSid: string;
      readonly voiceWebhookUrl: string;
      readonly statusCallbackUrl: string;
    },
    context: ProviderExecutionContext
  ): Promise<void> {
    const accountSid = this.requireAccountSid();
    const body = new URLSearchParams({
      VoiceUrl: request.voiceWebhookUrl,
      VoiceMethod: "POST",
      StatusCallback: request.statusCallbackUrl,
      StatusCallbackMethod: "POST"
    });

    await this.requestVoid(
      this.endpoint(
        `Accounts/${accountSid}/IncomingPhoneNumbers/${encodeURIComponent(
          request.providerNumberSid
        )}.json`
      ),
      {
        method: "POST",
        body
      },
      context,
      "update phone number routing"
    );
  }

  async releasePhoneNumber(
    request: { readonly providerNumberSid: string },
    context: ProviderExecutionContext
  ): Promise<void> {
    const accountSid = this.requireAccountSid();

    await this.requestVoid(
      this.endpoint(
        `Accounts/${accountSid}/IncomingPhoneNumbers/${encodeURIComponent(
          request.providerNumberSid
        )}.json`
      ),
      { method: "DELETE" },
      context,
      "release phone number"
    );
  }

  private async requestJson<TPayload>(
    url: URL,
    init: RequestInit,
    context: ProviderExecutionContext,
    operationName: string
  ): Promise<TPayload> {
    const response = await this.request(url, init, context, operationName);
    return (await response.json()) as TPayload;
  }

  private async requestVoid(
    url: URL,
    init: RequestInit,
    context: ProviderExecutionContext,
    operationName: string
  ): Promise<void> {
    await this.request(url, init, context, operationName);
  }

  private async request(
    url: URL,
    init: RequestInit,
    context: ProviderExecutionContext,
    operationName: string
  ): Promise<Response> {
    const timeoutMs = context.timeoutPolicy?.requestTimeoutMs ?? this.requestTimeoutMs;
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), timeoutMs);

    try {
      this.healthTracker.assertCanRequest(context.circuitBreakerPolicy);
      const response = await this.fetchImpl(url, {
        ...init,
        headers: {
          authorization: this.authorizationHeader(),
          "content-type": "application/x-www-form-urlencoded",
          "x-voxlink-request-id": context.requestId,
          ...(context.companyId ? { "x-voxlink-company-id": context.companyId } : {}),
          ...init.headers
        },
        signal: abortController.signal
      });

      if (!response.ok) {
        throw await this.errorFromResponse(response, operationName);
      }

      this.healthTracker.recordSuccess();
      return response;
    } catch (error) {
      const providerError = this.normalizeError(error, operationName);
      this.healthTracker.recordFailure(providerError, context.circuitBreakerPolicy);
      throw providerError;
    } finally {
      clearTimeout(timeout);
    }
  }

  private endpoint(path: string): URL {
    return new URL(`/2010-04-01/${path.replace(/^\//, "")}`, this.apiBaseUrl);
  }

  private requireAccountSid(): string {
    if (!this.accountSid) {
      throw new ProviderRequestError({
        providerKind: this.providerKind,
        providerName: this.providerName,
        code: "authentication_failed",
        message: "Twilio account SID is required for phone number provisioning",
        retryable: false
      });
    }

    return this.accountSid;
  }

  private authorizationHeader(): string {
    return `Basic ${Buffer.from(`${this.requireAccountSid()}:${this.config.authToken}`).toString(
      "base64"
    )}`;
  }

  private async errorFromResponse(
    response: Response,
    operationName: string
  ): Promise<ProviderRequestError> {
    const body = await safeReadResponseText(response);
    const statusCode = response.status;
    const code = providerCodeFromHttpStatus(statusCode, body);
    const twilioMessage = extractTwilioErrorMessage(body);

    return new ProviderRequestError({
      providerKind: this.providerKind,
      providerName: this.providerName,
      code,
      message: twilioMessage
        ? `Twilio ${operationName} failed: ${twilioMessage}`
        : `Twilio ${operationName} failed with HTTP ${statusCode}`,
      retryable: isRetryableProviderCode(code),
      cause: { statusCode, body: redactProviderSecrets(body) }
    });
  }

  private normalizeError(error: unknown, operationName: string): ProviderRequestError {
    if (error instanceof ProviderRequestError) {
      return error;
    }

    if (isAbortError(error)) {
      return new ProviderRequestError({
        providerKind: this.providerKind,
        providerName: this.providerName,
        code: "timeout",
        message: `Twilio ${operationName} timed out`,
        retryable: true,
        cause: error
      });
    }

    return new ProviderRequestError({
      providerKind: this.providerKind,
      providerName: this.providerName,
      code: "transient_network",
      message: `Twilio ${operationName} failed before a response was received`,
      retryable: true,
      cause: error
    });
  }
}

function extractTwilioErrorMessage(body: string): string | undefined {
  if (!body.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(body) as {
      readonly message?: unknown;
      readonly code?: unknown;
      readonly status?: unknown;
    };
    const message = typeof parsed.message === "string" ? parsed.message.trim() : "";
    const code =
      typeof parsed.code === "number" || typeof parsed.code === "string" ? String(parsed.code) : "";

    if (message && code) {
      return `${message} (Twilio code ${code})`;
    }

    return message || undefined;
  } catch {
    return body.replace(/\s+/g, " ").trim().slice(0, 240) || undefined;
  }
}

export function createTwilioSignature(
  rawUrl: string,
  params: Readonly<Record<string, string>>,
  authToken: string
): string {
  const data = Object.keys(params)
    .sort()
    .reduce((accumulator, key) => `${accumulator}${key}${params[key] ?? ""}`, rawUrl);

  return createHmac("sha1", authToken).update(data).digest("base64");
}

export function parseFormBody(rawBody: string): Record<string, string> {
  const params = new URLSearchParams(rawBody);
  const parsed: Record<string, string> = {};

  for (const [key, value] of params.entries()) {
    parsed[key] = value;
  }

  return parsed;
}

function safeEqualBase64(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);

  if (expectedBuffer.byteLength !== actualBuffer.byteLength) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, actualBuffer);
}

function capabilitiesFromTwilio(value: Record<string, unknown> | undefined): TelephonyNumberCapabilities {
  const read = (lowerKey: string, upperKey: string): boolean =>
    Boolean(value?.[lowerKey] ?? value?.[upperKey]);

  return {
    voice: read("voice", "Voice"),
    sms: read("sms", "SMS"),
    mms: read("mms", "MMS")
  };
}

export function executionContextForWebhook(requestId: string): ProviderExecutionContext {
  return { requestId };
}
