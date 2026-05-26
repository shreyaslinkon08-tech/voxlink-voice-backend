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
  type TelephonyProviderPort,
  type TelephonyUpdateNumberRoutingResponse
} from "@voxlink/shared";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface PlivoTelephonyProviderConfig {
  readonly authId?: string;
  readonly authToken: string;
  readonly apiBaseUrl?: string;
  readonly fetchImpl?: FetchLike;
  readonly requestTimeoutMs?: number;
}

interface PlivoAvailableNumbersResponse {
  readonly objects?: readonly PlivoAvailableNumberPayload[];
}

interface PlivoAvailableNumberPayload {
  readonly number?: string;
  readonly city?: string | null;
  readonly region?: string | null;
  readonly country?: string | null;
  readonly country_iso2?: string | null;
  readonly voice_enabled?: boolean;
  readonly sms_enabled?: boolean;
  readonly mms_enabled?: boolean;
  readonly type?: string | null;
}

interface PlivoApplicationResponse {
  readonly app_id?: string;
  readonly api_id?: string;
  readonly message?: string;
}

interface PlivoNumberResponse {
  readonly number?: string;
  readonly app_id?: string;
  readonly alias?: string;
  readonly api_id?: string;
}

export class PlivoTelephonyProvider implements TelephonyProviderPort {
  readonly providerKind = "telephony" as const;
  readonly providerName = "plivo";

  private readonly authId?: string;
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly requestTimeoutMs: number;
  private readonly healthTracker = new ProviderHealthTracker({
    providerKind: this.providerKind,
    providerName: this.providerName
  });

  constructor(private readonly config: PlivoTelephonyProviderConfig) {
    this.authId = config.authId?.trim() || undefined;
    this.apiBaseUrl = config.apiBaseUrl ?? "https://api.plivo.com";
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.requestTimeoutMs = config.requestTimeoutMs ?? 10_000;
  }

  health(): Promise<ProviderHealthSnapshot> {
    return Promise.resolve(this.healthTracker.snapshot());
  }

  verifyWebhookSignature(rawUrl: string, rawBody: string, signature: string): Promise<boolean> {
    return Promise.resolve(this.verifyWebhookSignatureV3(rawUrl, rawBody, signature, ""));
  }

  verifyWebhookSignatureV3(
    rawUrl: string,
    rawBody: string,
    signature: string,
    nonce: string,
    method: "GET" | "POST" = "POST"
  ): boolean {
    if (!nonce) {
      return false;
    }

    const expected = createPlivoSignatureV3(
      rawUrl,
      method === "POST" ? parseFormBody(rawBody) : {},
      nonce,
      this.config.authToken
    );

    return signature
      .split(",")
      .map((entry) => entry.trim())
      .some((entry) => safeEqualBase64(expected, entry));
  }

  parseInboundCall(rawBody: string): Promise<TelephonyInboundCall> {
    const body = parseFormBody(rawBody);
    const providerCallId = body.CallUUID;
    const to = normalizeE164(body.To);
    const from = normalizeE164(body.From);

    if (!providerCallId || !to || !from) {
      throw new Error("Plivo inbound call webhook is missing CallUUID, To, or From");
    }

    return Promise.resolve({
      providerCallId,
      to,
      from,
      providerAccountId: body.AccountID
    });
  }

  async searchAvailablePhoneNumbers(
    request: TelephonyAvailableNumberSearchRequest,
    context: ProviderExecutionContext
  ): Promise<readonly TelephonyAvailablePhoneNumber[]> {
    const authId = this.requireAuthId();
    const countryCode = request.countryCode.trim().toUpperCase();
    const url = this.endpoint(`Account/${authId}/PhoneNumber/`);
    url.searchParams.set("country_iso", countryCode);
    url.searchParams.set("services", "voice");
    url.searchParams.set("type", "local");

    if (request.limit) {
      url.searchParams.set("limit", String(Math.min(request.limit, 20)));
    }

    if (request.contains) {
      url.searchParams.set("pattern", request.contains.trim());
    } else if (request.areaCode) {
      url.searchParams.set("pattern", request.areaCode.trim());
    }

    const payload = await this.requestJson<PlivoAvailableNumbersResponse>(
      url,
      { method: "GET" },
      context,
      "search available phone numbers"
    );

    return (payload.objects ?? [])
      .filter((number): number is PlivoAvailableNumberPayload & { readonly number: string } =>
        Boolean(number.number)
      )
      .map((number) => ({
        e164: normalizeE164(number.number) ?? `+${number.number}`,
        friendlyName: number.city ?? number.number,
        locality: number.city ?? undefined,
        region: number.region ?? undefined,
        countryCode: number.country_iso2 ?? number.country ?? countryCode,
        capabilities: capabilitiesFromPlivo(number),
        providerMetadata: {
          plivoNumber: normalizePlivoNumber(number.number),
          type: number.type ?? undefined
        }
      }));
  }

  async provisionPhoneNumber(
    request: TelephonyProvisionNumberRequest,
    context: ProviderExecutionContext
  ): Promise<TelephonyProvisionNumberResponse> {
    const plivoNumber = normalizePlivoNumber(request.e164);
    const application = await this.createApplication(
      {
        label: request.label ?? `VoxLink ${request.e164}`,
        voiceWebhookUrl: request.voiceWebhookUrl,
        statusCallbackUrl: request.statusCallbackUrl
      },
      context
    );

    const payload = await this.requestJson<PlivoNumberResponse>(
      this.endpoint(
        `Account/${this.requireAuthId()}/PhoneNumber/${encodeURIComponent(plivoNumber)}/`
      ),
      {
        method: "POST",
        body: new URLSearchParams({
          app_id: application.applicationId,
          alias: request.label ?? `VoxLink ${request.e164}`
        })
      },
      context,
      "provision phone number"
    );

    return {
      e164: normalizeE164(payload.number) ?? request.e164,
      providerNumberSid: plivoNumber,
      providerAccountId: this.authId,
      friendlyName: payload.alias ?? request.label,
      capabilities: { voice: true, sms: false, mms: false },
      providerMetadata: {
        plivoNumber,
        applicationId: application.applicationId,
        managedApplication: true
      }
    };
  }

  async updatePhoneNumberRouting(
    request: {
      readonly providerNumberSid: string;
      readonly providerMetadata?: Record<string, unknown>;
      readonly voiceWebhookUrl: string;
      readonly statusCallbackUrl: string;
    },
    context: ProviderExecutionContext
  ): Promise<TelephonyUpdateNumberRoutingResponse> {
    const plivoNumber = normalizePlivoNumber(request.providerNumberSid);
    const existingApplicationId = metadataString(request.providerMetadata, "applicationId");
    const application =
      existingApplicationId ??
      (
        await this.createApplication(
          {
            label: `VoxLink ${formatE164(plivoNumber)}`,
            voiceWebhookUrl: request.voiceWebhookUrl,
            statusCallbackUrl: request.statusCallbackUrl
          },
          context
        )
      ).applicationId;

    if (existingApplicationId) {
      await this.updateApplication(
        {
          applicationId: existingApplicationId,
          voiceWebhookUrl: request.voiceWebhookUrl,
          statusCallbackUrl: request.statusCallbackUrl
        },
        context
      );
    }

    await this.updatePhoneNumberApplication(plivoNumber, application, context);

    return {
      providerNumberSid: plivoNumber,
      providerMetadata: {
        ...(request.providerMetadata ?? {}),
        plivoNumber,
        applicationId: application,
        managedApplication: existingApplicationId
          ? request.providerMetadata?.managedApplication === true
          : true
      }
    };
  }

  async releasePhoneNumber(
    request: {
      readonly providerNumberSid: string;
      readonly providerMetadata?: Record<string, unknown>;
    },
    context: ProviderExecutionContext
  ): Promise<void> {
    const plivoNumber = normalizePlivoNumber(request.providerNumberSid);

    await this.requestVoid(
      this.endpoint(`Account/${this.requireAuthId()}/Number/${encodeURIComponent(plivoNumber)}/`),
      { method: "DELETE" },
      context,
      "release phone number"
    );

    const applicationId = metadataString(request.providerMetadata, "applicationId");

    if (applicationId && request.providerMetadata?.managedApplication === true) {
      await this.requestVoid(
        this.endpoint(
          `Account/${this.requireAuthId()}/Application/${encodeURIComponent(applicationId)}/`
        ),
        { method: "DELETE" },
        context,
        "delete managed application"
      );
    }
  }

  private async createApplication(
    input: {
      readonly label: string;
      readonly voiceWebhookUrl: string;
      readonly statusCallbackUrl: string;
    },
    context: ProviderExecutionContext
  ): Promise<{ readonly applicationId: string }> {
    const payload = await this.requestJson<PlivoApplicationResponse>(
      this.endpoint(`Account/${this.requireAuthId()}/Application/`),
      {
        method: "POST",
        body: new URLSearchParams({
          app_name: input.label.slice(0, 60),
          answer_url: input.voiceWebhookUrl,
          answer_method: "POST",
          hangup_url: input.statusCallbackUrl,
          hangup_method: "POST"
        })
      },
      context,
      "create application"
    );

    if (!payload.app_id) {
      throw new ProviderRequestError({
        providerKind: this.providerKind,
        providerName: this.providerName,
        code: "internal_provider_error",
        message: "Plivo created an application but did not return an app_id",
        retryable: true,
        cause: payload
      });
    }

    return { applicationId: payload.app_id };
  }

  private async updateApplication(
    input: {
      readonly applicationId: string;
      readonly voiceWebhookUrl: string;
      readonly statusCallbackUrl: string;
    },
    context: ProviderExecutionContext
  ): Promise<void> {
    await this.requestVoid(
      this.endpoint(
        `Account/${this.requireAuthId()}/Application/${encodeURIComponent(input.applicationId)}/`
      ),
      {
        method: "POST",
        body: new URLSearchParams({
          answer_url: input.voiceWebhookUrl,
          answer_method: "POST",
          hangup_url: input.statusCallbackUrl,
          hangup_method: "POST"
        })
      },
      context,
      "update application"
    );
  }

  private async updatePhoneNumberApplication(
    plivoNumber: string,
    applicationId: string,
    context: ProviderExecutionContext
  ): Promise<void> {
    await this.requestVoid(
      this.endpoint(`Account/${this.requireAuthId()}/Number/${encodeURIComponent(plivoNumber)}/`),
      {
        method: "POST",
        body: new URLSearchParams({ app_id: applicationId })
      },
      context,
      "update phone number routing"
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
    return new URL(`/v1/${path.replace(/^\//, "")}`, this.apiBaseUrl);
  }

  private requireAuthId(): string {
    if (!this.authId) {
      throw new ProviderRequestError({
        providerKind: this.providerKind,
        providerName: this.providerName,
        code: "authentication_failed",
        message: "Plivo auth ID is required for telephony provisioning",
        retryable: false
      });
    }

    return this.authId;
  }

  private authorizationHeader(): string {
    return `Basic ${Buffer.from(`${this.requireAuthId()}:${this.config.authToken}`).toString(
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
    const message = extractProviderMessage(body);

    return new ProviderRequestError({
      providerKind: this.providerKind,
      providerName: this.providerName,
      code,
      message: message
        ? `Plivo ${operationName} failed: ${message}`
        : `Plivo ${operationName} failed with HTTP ${statusCode}`,
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
        message: `Plivo ${operationName} timed out`,
        retryable: true,
        cause: error
      });
    }

    return new ProviderRequestError({
      providerKind: this.providerKind,
      providerName: this.providerName,
      code: "transient_network",
      message: `Plivo ${operationName} failed before a response was received`,
      retryable: true,
      cause: error
    });
  }
}

export function createPlivoSignatureV3(
  rawUrl: string,
  params: Readonly<Record<string, string>>,
  nonce: string,
  authToken: string
): string {
  const paramString = Object.keys(params)
    .sort()
    .map((key) => `${key}${params[key] ?? ""}`)
    .join("");
  const signingPayload = paramString ? `${rawUrl}.${paramString}.${nonce}` : `${rawUrl}.${nonce}`;
  return createHmac("sha256", authToken).update(signingPayload).digest("base64");
}

export function parseFormBody(rawBody: string): Record<string, string> {
  const params = new URLSearchParams(rawBody);
  const parsed: Record<string, string> = {};

  for (const [key, value] of params.entries()) {
    parsed[key] = value;
  }

  return parsed;
}

function normalizePlivoNumber(value: string): string {
  return value.replace(/[^\d]/g, "");
}

function normalizeE164(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const digits = normalizePlivoNumber(value);
  return digits ? `+${digits}` : undefined;
}

function formatE164(plivoNumber: string): string {
  return `+${normalizePlivoNumber(plivoNumber)}`;
}

function capabilitiesFromPlivo(value: PlivoAvailableNumberPayload): TelephonyNumberCapabilities {
  return {
    voice: value.voice_enabled ?? true,
    sms: value.sms_enabled ?? false,
    mms: value.mms_enabled ?? false
  };
}

function metadataString(
  metadata: Readonly<Record<string, unknown>> | undefined,
  key: string
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function extractProviderMessage(body: string): string | undefined {
  if (!body.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(body) as {
      readonly message?: unknown;
      readonly error?: unknown;
      readonly detail?: unknown;
    };
    const message =
      typeof parsed.message === "string"
        ? parsed.message
        : typeof parsed.error === "string"
          ? parsed.error
          : typeof parsed.detail === "string"
            ? parsed.detail
            : "";
    return message.trim() || undefined;
  } catch {
    return body.replace(/\s+/g, " ").trim().slice(0, 240) || undefined;
  }
}

function safeEqualBase64(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);

  if (expectedBuffer.byteLength !== actualBuffer.byteLength) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, actualBuffer);
}
