import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { internalApiUrl } from "./api-url";

export interface SessionUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly memberships: readonly {
    readonly companyId: string;
    readonly companyName: string;
    readonly role: string;
  }[];
}

export interface SessionResponse {
  readonly user: SessionUser;
  readonly currentCompanyId: string;
  readonly role: string;
}

export interface CompanyResponse {
  readonly company: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
    readonly status: string;
  };
}

export interface CompanyTeamResponse {
  readonly members: readonly {
    readonly id: string;
    readonly role: string;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly user: {
      readonly id: string;
      readonly email: string;
      readonly name: string;
      readonly emailVerifiedAt: string | null;
      readonly createdAt: string;
    };
  }[];
  readonly invitations: readonly {
    readonly id: string;
    readonly email: string;
    readonly role: string;
    readonly expiresAt: string;
    readonly acceptedAt: string | null;
    readonly createdAt: string;
    readonly invitedBy: {
      readonly id: string;
      readonly name: string;
      readonly email: string;
    } | null;
  }[];
}

export interface DashboardSummaryResponse {
  readonly summary: {
    readonly activeCalls: number;
    readonly totalCalls: number;
    readonly aiAgents: number;
    readonly phoneNumbers: number;
    readonly knowledgeItems: number;
    readonly transcriptChunks: number;
    readonly openHandoffs: number;
    readonly requestedHandoffs: number;
    readonly callMinutes: string;
  };
}

export interface AgentListResponse {
  readonly agents: readonly {
    readonly id: string;
    readonly name: string;
    readonly status: string;
    readonly systemPrompt: string;
    readonly personality: string | null;
    readonly voiceSettings: unknown;
    readonly businessHours: unknown;
    readonly escalationRules: unknown;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly _count: {
      readonly phoneNumbers: number;
      readonly calls: number;
    };
  }[];
  readonly total: number;
}

export interface AgentDetailResponse {
  readonly agent: AgentListResponse["agents"][number];
}

export interface PhoneNumberListResponse {
  readonly phoneNumbers: readonly {
    readonly id: string;
    readonly e164: string;
    readonly label: string | null;
    readonly provider: string;
    readonly providerNumberSid: string | null;
    readonly providerMetadata: unknown;
    readonly status: string;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly aiAgent: {
      readonly id: string;
      readonly name: string;
      readonly status: string;
    } | null;
    readonly _count: {
      readonly calls: number;
    };
  }[];
  readonly total: number;
}

export interface CallListResponse {
  readonly calls: readonly {
    readonly id: string;
    readonly provider: string;
    readonly providerCallId: string;
    readonly fromNumber: string;
    readonly toNumber: string;
    readonly status: string;
    readonly startedAt: string | null;
    readonly endedAt: string | null;
    readonly failureReason: string | null;
    readonly metadata: unknown;
    readonly createdAt: string;
    readonly phoneNumber: {
      readonly id: string;
      readonly e164: string;
      readonly label: string | null;
    } | null;
    readonly aiAgent: {
      readonly id: string;
      readonly name: string;
    } | null;
    readonly operatorHandoffs: readonly OperatorHandoff[];
    readonly recordings: readonly CallRecording[];
    readonly _count: {
      readonly transcriptChunks: number;
      readonly recordings: number;
    };
  }[];
  readonly total: number;
  readonly activeCount: number;
}

export interface CallDetailResponse {
  readonly call: CallListResponse["calls"][number] & {
    readonly metadata: unknown;
    readonly transcriptChunks: readonly {
      readonly id: string;
      readonly sequence: number;
      readonly speakerRole: string;
      readonly text: string;
      readonly startedAtMs: number | null;
      readonly endedAtMs: number | null;
      readonly confidence: string | number | null;
      readonly metadata: unknown;
      readonly createdAt: string;
    }[];
    readonly operatorHandoffs: readonly OperatorHandoff[];
    readonly recordings: readonly (CallRecording & {
      readonly metadata: unknown;
    })[];
  };
}

export interface CallRecording {
  readonly id: string;
  readonly provider: string;
  readonly providerRecordingId: string;
  readonly status: string;
  readonly recordingUrl: string | null;
  readonly durationSeconds: number | null;
  readonly channels: number | null;
  readonly source: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface OperatorHandoff {
  readonly id: string;
  readonly status: string;
  readonly reason: string | null;
  readonly notes: string | null;
  readonly requestedAt: string;
  readonly acceptedAt: string | null;
  readonly resolvedAt: string | null;
  readonly requestedBy: UserSummary | null;
  readonly acceptedBy: UserSummary | null;
  readonly resolvedBy: UserSummary | null;
}

export interface OperatorHandoffListResponse {
  readonly handoffs: readonly (OperatorHandoff & {
    readonly call: {
      readonly id: string;
      readonly providerCallId: string;
      readonly fromNumber: string;
      readonly toNumber: string;
      readonly status: string;
      readonly startedAt: string | null;
      readonly createdAt: string;
      readonly aiAgent: {
        readonly id: string;
        readonly name: string;
      } | null;
      readonly phoneNumber: {
        readonly id: string;
        readonly e164: string;
        readonly label: string | null;
      } | null;
    };
  })[];
}

interface UserSummary {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}

export interface KnowledgeBaseListResponse {
  readonly knowledgeBase: readonly {
    readonly id: string;
    readonly title: string;
    readonly sourceType: string;
    readonly status: string;
    readonly sourceUri: string | null;
    readonly contentSha256: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly _count: {
      readonly embeddings: number;
    };
  }[];
  readonly total: number;
}

export interface ProviderHealthResponse {
  readonly providers: readonly {
    readonly providerKind: string;
    readonly providerName: string;
    readonly circuitState: string;
    readonly consecutiveFailures: number;
    readonly configured: boolean;
  }[];
}

export interface BillingSummaryResponse {
  readonly summary: {
    readonly subscription: {
      readonly id: string;
      readonly status: string;
      readonly planCode: string;
      readonly currentPeriodStart: string | null;
      readonly currentPeriodEnd: string | null;
      readonly providerCustomerId: string | null;
      readonly providerSubscriptionId: string | null;
      readonly createdAt: string;
      readonly updatedAt: string;
    } | null;
    readonly plan: {
      readonly code: string;
      readonly name: string;
      readonly description: string;
      readonly monthlyPriceCents: number | null;
      readonly resourceLimits: {
        readonly ai_agents: number | null;
        readonly phone_numbers: number | null;
      };
    };
    readonly usage: readonly {
      readonly metric: string;
      readonly amount: number;
      readonly limit: number | null;
      readonly remaining: number | null;
      readonly percentUsed: number | null;
      readonly isLimited: boolean;
      readonly isNearLimit: boolean;
      readonly isExceeded: boolean;
      readonly periodStart: string;
      readonly periodEnd: string;
    }[];
  };
}

export interface AdminCompanyListResponse {
  readonly companies: readonly AdminCompany[];
  readonly total: number;
}

export interface AdminCompanyDetailResponse {
  readonly company: AdminCompany;
  readonly billing: BillingSummaryResponse["summary"];
}

export interface AdminCompany {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly subscriptions: readonly {
    readonly id: string;
    readonly status: string;
    readonly planCode: string;
    readonly currentPeriodStart: string | null;
    readonly currentPeriodEnd: string | null;
    readonly providerCustomerId: string | null;
    readonly providerSubscriptionId: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
  }[];
  readonly _count: {
    readonly memberships: number;
    readonly aiAgents: number;
    readonly phoneNumbers: number;
    readonly calls: number;
    readonly knowledgeBase: number;
  };
}

export interface AuditEventListResponse {
  readonly auditEvents: readonly {
    readonly id: string;
    readonly companyId: string | null;
    readonly actorUserId: string | null;
    readonly action: string;
    readonly resourceType: string;
    readonly resourceId: string | null;
    readonly requestId: string | null;
    readonly ipAddress: string | null;
    readonly userAgent: string | null;
    readonly metadata: unknown;
    readonly createdAt: string;
    readonly company: {
      readonly id: string;
      readonly name: string;
      readonly slug: string;
      readonly status: string;
    } | null;
    readonly actor: {
      readonly id: string;
      readonly name: string;
      readonly email: string;
    } | null;
  }[];
  readonly total: number;
}

async function apiFetch<TResponse>(path: string): Promise<TResponse> {
  const cookieStore = await cookies();
  let response: Response;

  try {
    response = await fetch(`${internalApiUrl}${path}`, {
      cache: "no-store",
      headers: {
        cookie: cookieStore.toString()
      }
    });
  } catch {
    redirect("/login");
  }

  if (response.status === 401 || response.status === 403) {
    redirect("/login");
  }

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  return (await response.json()) as TResponse;
}

export async function getSession(): Promise<SessionResponse> {
  return apiFetch<SessionResponse>("/auth/me");
}

export async function getCurrentCompany(): Promise<CompanyResponse> {
  return apiFetch<CompanyResponse>("/companies/current");
}

export async function getCompanyTeam(): Promise<CompanyTeamResponse> {
  return apiFetch<CompanyTeamResponse>("/companies/current/members");
}

export async function getDashboardSummary(): Promise<DashboardSummaryResponse> {
  return apiFetch<DashboardSummaryResponse>("/dashboard/summary");
}

export async function getAgents(): Promise<AgentListResponse> {
  return apiFetch<AgentListResponse>("/agents");
}

export async function getAgent(agentId: string): Promise<AgentDetailResponse> {
  return apiFetch<AgentDetailResponse>(`/agents/${agentId}`);
}

export async function getPhoneNumbers(): Promise<PhoneNumberListResponse> {
  return apiFetch<PhoneNumberListResponse>("/phone-numbers");
}

export async function getCalls(
  input: {
    readonly status?: string;
    readonly search?: string;
  } = {}
): Promise<CallListResponse> {
  const searchParams = new URLSearchParams();

  if (input.status) {
    searchParams.set("status", input.status);
  }

  if (input.search) {
    searchParams.set("search", input.search);
  }

  const queryString = searchParams.toString();
  return apiFetch<CallListResponse>(queryString ? `/calls?${queryString}` : "/calls");
}

export async function getCall(callId: string): Promise<CallDetailResponse> {
  return apiFetch<CallDetailResponse>(`/calls/${callId}`);
}

export async function getOpenOperatorHandoffs(): Promise<OperatorHandoffListResponse> {
  return apiFetch<OperatorHandoffListResponse>("/calls/handoffs");
}

export async function getKnowledgeBase(): Promise<KnowledgeBaseListResponse> {
  return apiFetch<KnowledgeBaseListResponse>("/knowledge-base");
}

export async function getProviderHealth(): Promise<ProviderHealthResponse> {
  return apiFetch<ProviderHealthResponse>("/providers/health");
}

export async function getBillingSummary(): Promise<BillingSummaryResponse> {
  return apiFetch<BillingSummaryResponse>("/billing/summary");
}

export async function getAdminCompanies(
  input: {
    readonly status?: string;
    readonly search?: string;
  } = {}
): Promise<AdminCompanyListResponse> {
  const searchParams = new URLSearchParams();

  if (input.status) {
    searchParams.set("status", input.status);
  }

  if (input.search) {
    searchParams.set("search", input.search);
  }

  const queryString = searchParams.toString();
  return apiFetch<AdminCompanyListResponse>(
    queryString ? `/admin/companies?${queryString}` : "/admin/companies"
  );
}

export async function getAdminCompany(companyId: string): Promise<AdminCompanyDetailResponse> {
  return apiFetch<AdminCompanyDetailResponse>(`/admin/companies/${companyId}`);
}

export async function getAuditEvents(
  input: {
    readonly companyId?: string;
    readonly resourceType?: string;
    readonly action?: string;
    readonly search?: string;
  } = {}
): Promise<AuditEventListResponse> {
  const searchParams = new URLSearchParams();

  if (input.companyId) {
    searchParams.set("companyId", input.companyId);
  }

  if (input.resourceType) {
    searchParams.set("resourceType", input.resourceType);
  }

  if (input.action) {
    searchParams.set("action", input.action);
  }

  if (input.search) {
    searchParams.set("search", input.search);
  }

  const queryString = searchParams.toString();
  return apiFetch<AuditEventListResponse>(
    queryString ? `/audit-events?${queryString}` : "/audit-events"
  );
}
