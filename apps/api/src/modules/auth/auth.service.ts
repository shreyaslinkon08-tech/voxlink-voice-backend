import { Prisma, UsageMetric } from "@prisma/client";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { AppError } from "../../errors/app-error.js";
import { currentMonthlyPeriod } from "../../utils/period.js";
import { hashPassword, verifyPassword } from "../../utils/password.js";
import { addSlugSuffix, slugify } from "../../utils/slug.js";
import { createOpaqueToken, hashToken } from "../../utils/token.js";
import type {
  ForgotPasswordInput,
  GoogleOAuthCallbackQuery,
  GoogleOAuthStartQuery,
  LoginInput,
  ResetPasswordInput,
  SignupInput
} from "./auth.schemas.js";
import type { AccessTokenPayload, AuthenticatedUser } from "./auth.types.js";
import { createRefreshToken, signAccessToken } from "./token-service.js";

const emailVerificationTtlMs = 24 * 60 * 60 * 1000;
const passwordResetTtlMs = 60 * 60 * 1000;
const googleOAuthStateTtlMs = 10 * 60 * 1000;
const googleTokenEndpoint = "https://oauth2.googleapis.com/token";
const googleUserInfoEndpoint = "https://openidconnect.googleapis.com/v1/userinfo";

interface GoogleOAuthState {
  readonly nonce: string;
  readonly mode: "login" | "signup";
  readonly companyName?: string;
  readonly invitationToken?: string;
  readonly next?: string;
  readonly createdAt: number;
}

interface GoogleUserInfo {
  readonly sub: string;
  readonly email: string;
  readonly email_verified: boolean;
  readonly name?: string;
  readonly picture?: string;
}

type AuthUserRecord = {
  id: string;
  email: string;
  name: string;
  emailVerifiedAt: Date | null;
  memberships: {
    companyId: string;
    role: "super_admin" | "company_admin" | "operator";
    company: { name: string; status?: string };
  }[];
};

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function getClientUserAgent(request: FastifyRequest): string | undefined {
  const value = request.headers["user-agent"];
  return Array.isArray(value) ? value.join(", ") : value;
}

async function buildUniqueCompanySlug(app: FastifyInstance, companyName: string): Promise<string> {
  const baseSlug = slugify(companyName);
  const existing = await app.prisma.company.findUnique({
    where: { slug: baseSlug },
    select: { id: true }
  });

  if (!existing) {
    return baseSlug;
  }

  return addSlugSuffix(baseSlug, createOpaqueToken(4));
}

function userResponse(user: {
  id: string;
  email: string;
  name: string;
  emailVerifiedAt: Date | null;
  memberships: {
    companyId: string;
    role: "super_admin" | "company_admin" | "operator";
    company: { name: string };
  }[];
}): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    memberships: user.memberships.map((membership) => ({
      companyId: membership.companyId,
      companyName: membership.company.name,
      role: membership.role
    }))
  };
}

function googleOAuthRedirectUrl(app: FastifyInstance): string {
  return (
    app.config.GOOGLE_OAUTH_REDIRECT_URL ||
    new URL("/auth/google/callback", app.config.API_PUBLIC_URL).toString()
  );
}

function assertGoogleOAuthConfigured(app: FastifyInstance): void {
  if (!app.config.GOOGLE_OAUTH_CLIENT_ID || !app.config.GOOGLE_OAUTH_CLIENT_SECRET) {
    throw AppError.badRequest("Google sign-in is not configured");
  }
}

function encodeGoogleOAuthState(state: GoogleOAuthState): string {
  return Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
}

function decodeGoogleOAuthState(value: string): GoogleOAuthState {
  const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;

  if (!parsed || typeof parsed !== "object") {
    throw AppError.badRequest("Invalid Google sign-in state");
  }

  const state = parsed as Partial<GoogleOAuthState>;

  if (
    !state.nonce ||
    !state.mode ||
    typeof state.createdAt !== "number" ||
    !["login", "signup"].includes(state.mode)
  ) {
    throw AppError.badRequest("Invalid Google sign-in state");
  }

  if (Date.now() - state.createdAt > googleOAuthStateTtlMs) {
    throw AppError.badRequest("Google sign-in state expired");
  }

  return state as GoogleOAuthState;
}

export function createGoogleOAuthAuthorization(
  app: FastifyInstance,
  input: GoogleOAuthStartQuery
): { readonly authorizationUrl: string; readonly stateCookieValue: string } {
  assertGoogleOAuthConfigured(app);

  if (input.mode === "signup" && !input.companyName && !input.invitationToken) {
    throw AppError.badRequest("Company name or invitation token is required for Google signup");
  }

  const state: GoogleOAuthState = {
    nonce: createOpaqueToken(18),
    mode: input.mode,
    companyName: input.companyName,
    invitationToken: input.invitationToken,
    next: input.next,
    createdAt: Date.now()
  };
  const redirectUri = googleOAuthRedirectUrl(app);
  const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");

  authorizationUrl.searchParams.set("client_id", app.config.GOOGLE_OAUTH_CLIENT_ID);
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", "openid email profile");
  authorizationUrl.searchParams.set("state", state.nonce);
  authorizationUrl.searchParams.set("prompt", "select_account");

  return {
    authorizationUrl: authorizationUrl.toString(),
    stateCookieValue: encodeGoogleOAuthState(state)
  };
}

export async function completeGoogleOAuthSignIn(
  app: FastifyInstance,
  request: FastifyRequest,
  query: GoogleOAuthCallbackQuery,
  stateCookieValue: string
): Promise<{
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly redirectPath: string;
  readonly user: AuthenticatedUser;
}> {
  assertGoogleOAuthConfigured(app);

  const state = decodeGoogleOAuthState(stateCookieValue);

  if (!query.code || !query.state) {
    throw AppError.badRequest("Google sign-in callback is missing required parameters");
  }

  if (state.nonce !== query.state) {
    throw AppError.badRequest("Google sign-in state mismatch");
  }

  const googleUser = await fetchGoogleUserInfo(app, query.code);

  if (!googleUser.email_verified) {
    throw AppError.forbidden("Google account email must be verified");
  }

  const passwordHash = await hashPassword(createOpaqueToken());
  const now = new Date();
  const { periodStart, periodEnd } = currentMonthlyPeriod();

  const result = await app.prisma.$transaction(async (tx) => {
    const existingIdentity = await tx.oAuthIdentity.findUnique({
      where: {
        provider_providerSubject: {
          provider: "google",
          providerSubject: googleUser.sub
        }
      },
      select: { userId: true }
    });

    if (existingIdentity) {
      const preferredCompanyId = state.invitationToken
        ? await acceptInvitationForExistingUser(tx, {
            invitationToken: state.invitationToken,
            email: googleUser.email,
            userId: existingIdentity.userId,
            now
          })
        : undefined;

      await tx.oAuthIdentity.update({
        where: {
          provider_providerSubject: {
            provider: "google",
            providerSubject: googleUser.sub
          }
        },
        data: {
          email: googleUser.email,
          metadata: googleUserMetadata(googleUser)
        }
      });

      return {
        user: await findAuthUserById(tx, existingIdentity.userId),
        preferredCompanyId
      };
    }

    const existingUser = await tx.user.findUnique({
      where: { email: googleUser.email },
      select: { id: true, emailVerifiedAt: true }
    });

    if (existingUser) {
      const preferredCompanyId = state.invitationToken
        ? await acceptInvitationForExistingUser(tx, {
            invitationToken: state.invitationToken,
            email: googleUser.email,
            userId: existingUser.id,
            now
          })
        : undefined;

      await tx.user.update({
        where: { id: existingUser.id },
        data: {
          emailVerifiedAt: existingUser.emailVerifiedAt ?? now
        }
      });

      await tx.oAuthIdentity.create({
        data: {
          userId: existingUser.id,
          provider: "google",
          providerSubject: googleUser.sub,
          email: googleUser.email,
          metadata: googleUserMetadata(googleUser)
        }
      });

      return {
        user: await findAuthUserById(tx, existingUser.id),
        preferredCompanyId
      };
    }

    if (state.invitationToken) {
      const invitation = await findUsableInvitation(tx, {
        invitationToken: state.invitationToken,
        email: googleUser.email,
        now
      });
      const created = await tx.user.create({
        data: {
          email: googleUser.email,
          name: googleUser.name || googleUser.email,
          passwordHash,
          emailVerifiedAt: now,
          memberships: {
            create: {
              companyId: invitation.companyId,
              role: invitation.role
            }
          },
          oauthIdentities: {
            create: {
              provider: "google",
              providerSubject: googleUser.sub,
              email: googleUser.email,
              metadata: googleUserMetadata(googleUser)
            }
          }
        },
        select: { id: true }
      });

      await tx.companyInvitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: now }
      });

      return {
        user: await findAuthUserById(tx, created.id),
        preferredCompanyId: invitation.companyId
      };
    }

    if (state.mode === "signup" && state.companyName) {
      const companySlug = await buildUniqueCompanySlug(app, state.companyName);
      const company = await tx.company.create({
        data: {
          name: state.companyName,
          slug: companySlug
        }
      });
      const created = await tx.user.create({
        data: {
          email: googleUser.email,
          name: googleUser.name || googleUser.email,
          passwordHash,
          emailVerifiedAt: now,
          memberships: {
            create: {
              companyId: company.id,
              role: "company_admin"
            }
          },
          oauthIdentities: {
            create: {
              provider: "google",
              providerSubject: googleUser.sub,
              email: googleUser.email,
              metadata: googleUserMetadata(googleUser)
            }
          }
        },
        select: { id: true }
      });

      await tx.subscription.create({
        data: {
          companyId: company.id,
          planCode: "starter_trial"
        }
      });

      await tx.usageTracking.createMany({
        data: Object.values(UsageMetric).map((metric) => ({
          companyId: company.id,
          metric,
          amount: 0,
          periodStart,
          periodEnd
        }))
      });

      return {
        user: await findAuthUserById(tx, created.id),
        preferredCompanyId: company.id
      };
    }

    throw AppError.badRequest("No Altrion account exists for this Google account");
  });

  const selectedMembership = selectActiveMembership(result.user, result.preferredCompanyId);
  const refresh = createRefreshToken();

  await app.prisma.refreshSession.create({
    data: {
      userId: result.user.id,
      tokenHash: refresh.tokenHash,
      expiresAt: refresh.expiresAt,
      ipAddress: request.ip,
      userAgent: getClientUserAgent(request)
    }
  });

  const payload: AccessTokenPayload = {
    sub: result.user.id,
    companyId: selectedMembership.companyId,
    role: selectedMembership.role,
    email: result.user.email
  };

  return {
    accessToken: signAccessToken(app, payload),
    refreshToken: refresh.token,
    redirectPath: state.next ?? "/dashboard",
    user: userResponse(result.user)
  };
}

async function fetchGoogleUserInfo(app: FastifyInstance, code: string): Promise<GoogleUserInfo> {
  const redirectUri = googleOAuthRedirectUrl(app);
  const tokenResponse = await fetch(googleTokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      code,
      client_id: app.config.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: app.config.GOOGLE_OAUTH_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code"
    })
  });

  if (!tokenResponse.ok) {
    throw AppError.badGateway("Google token exchange failed");
  }

  const tokenPayload = (await tokenResponse.json()) as {
    readonly access_token?: unknown;
    readonly token_type?: unknown;
  };

  if (typeof tokenPayload.access_token !== "string") {
    throw AppError.badGateway("Google token response did not include an access token");
  }

  const userInfoResponse = await fetch(googleUserInfoEndpoint, {
    headers: {
      Authorization: `Bearer ${tokenPayload.access_token}`
    }
  });

  if (!userInfoResponse.ok) {
    throw AppError.badGateway("Google userinfo request failed");
  }

  const userInfo = (await userInfoResponse.json()) as Partial<GoogleUserInfo>;

  if (
    typeof userInfo.sub !== "string" ||
    typeof userInfo.email !== "string" ||
    typeof userInfo.email_verified !== "boolean"
  ) {
    throw AppError.badGateway("Google userinfo response is missing required profile fields");
  }

  return {
    sub: userInfo.sub,
    email: userInfo.email.toLowerCase(),
    email_verified: userInfo.email_verified,
    name: typeof userInfo.name === "string" ? userInfo.name : undefined,
    picture: typeof userInfo.picture === "string" ? userInfo.picture : undefined
  };
}

function googleUserMetadata(userInfo: GoogleUserInfo): Prisma.InputJsonObject {
  return {
    email: userInfo.email,
    emailVerified: userInfo.email_verified,
    ...(userInfo.name ? { name: userInfo.name } : {}),
    ...(userInfo.picture ? { picture: userInfo.picture } : {})
  } satisfies Prisma.InputJsonObject;
}

async function findAuthUserById(
  tx: Prisma.TransactionClient,
  userId: string
): Promise<AuthUserRecord> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    include: {
      memberships: {
        include: {
          company: {
            select: {
              name: true,
              status: true
            }
          }
        }
      }
    }
  });

  if (!user) {
    throw AppError.unauthorized();
  }

  return user;
}

function selectActiveMembership(
  user: AuthUserRecord,
  preferredCompanyId?: string
): {
  readonly companyId: string;
  readonly role: "super_admin" | "company_admin" | "operator";
} {
  const activeMemberships = user.memberships.filter(
    (membership) => membership.company.status === "active"
  );
  const selected = preferredCompanyId
    ? activeMemberships.find((membership) => membership.companyId === preferredCompanyId)
    : activeMemberships[0];

  if (!selected) {
    throw AppError.forbidden("No active company membership is available");
  }

  return selected;
}

async function findUsableInvitation(
  tx: Prisma.TransactionClient,
  input: {
    readonly invitationToken: string;
    readonly email: string;
    readonly now: Date;
  }
): Promise<{
  readonly id: string;
  readonly companyId: string;
  readonly role: "company_admin" | "operator";
}> {
  const invitation = await tx.companyInvitation.findUnique({
    where: { tokenHash: hashToken(input.invitationToken) },
    select: {
      id: true,
      companyId: true,
      email: true,
      role: true,
      expiresAt: true,
      acceptedAt: true
    }
  });

  if (
    !invitation ||
    invitation.acceptedAt ||
    invitation.expiresAt <= input.now ||
    invitation.email !== input.email
  ) {
    throw AppError.badRequest("Invitation link is invalid or expired");
  }

  if (invitation.role === "super_admin") {
    throw AppError.badRequest("Invitation role is not supported");
  }

  return {
    id: invitation.id,
    companyId: invitation.companyId,
    role: invitation.role
  };
}

async function acceptInvitationForExistingUser(
  tx: Prisma.TransactionClient,
  input: {
    readonly invitationToken: string;
    readonly email: string;
    readonly userId: string;
    readonly now: Date;
  }
): Promise<string> {
  const invitation = await findUsableInvitation(tx, input);
  const existingMembership = await tx.companyMembership.findUnique({
    where: {
      userId_companyId: {
        userId: input.userId,
        companyId: invitation.companyId
      }
    },
    select: { id: true }
  });

  if (!existingMembership) {
    await tx.companyMembership.create({
      data: {
        userId: input.userId,
        companyId: invitation.companyId,
        role: invitation.role
      }
    });
  }

  await tx.companyInvitation.update({
    where: { id: invitation.id },
    data: { acceptedAt: input.now }
  });

  return invitation.companyId;
}

export async function signup(
  app: FastifyInstance,
  input: SignupInput
): Promise<{ user: AuthenticatedUser }> {
  const now = new Date();
  const existingUser = await app.prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true }
  });

  if (existingUser) {
    throw AppError.conflict("An account already exists for this email");
  }

  const passwordHash = await hashPassword(input.password);
  const verificationToken = createOpaqueToken();
  const verificationTokenHash = hashToken(verificationToken);
  const { periodStart, periodEnd } = currentMonthlyPeriod();

  try {
    const created = await app.prisma.$transaction(async (tx) => {
      if (input.invitationToken) {
        const invitation = await tx.companyInvitation.findUnique({
          where: { tokenHash: hashToken(input.invitationToken) },
          include: {
            company: {
              select: { id: true, name: true }
            }
          }
        });

        if (
          !invitation ||
          invitation.acceptedAt ||
          invitation.expiresAt <= now ||
          invitation.email !== input.email
        ) {
          throw AppError.badRequest("Invitation link is invalid or expired");
        }

        const user = await tx.user.create({
          data: {
            email: input.email,
            name: input.name,
            passwordHash,
            memberships: {
              create: {
                companyId: invitation.companyId,
                role: invitation.role
              }
            },
            emailVerificationTokens: {
              create: {
                tokenHash: verificationTokenHash,
                expiresAt: new Date(Date.now() + emailVerificationTtlMs)
              }
            }
          },
          include: {
            memberships: {
              include: {
                company: {
                  select: { name: true }
                }
              }
            }
          }
        });

        await tx.companyInvitation.update({
          where: { id: invitation.id },
          data: { acceptedAt: now }
        });

        return user;
      }

      if (!input.companyName) {
        throw AppError.badRequest("Company name is required");
      }

      const companySlug = await buildUniqueCompanySlug(app, input.companyName);
      const company = await tx.company.create({
        data: {
          name: input.companyName,
          slug: companySlug
        }
      });

      const user = await tx.user.create({
        data: {
          email: input.email,
          name: input.name,
          passwordHash,
          memberships: {
            create: {
              companyId: company.id,
              role: "company_admin"
            }
          },
          emailVerificationTokens: {
            create: {
              tokenHash: verificationTokenHash,
              expiresAt: new Date(Date.now() + emailVerificationTtlMs)
            }
          }
        },
        include: {
          memberships: {
            include: {
              company: {
                select: { name: true }
              }
            }
          }
        }
      });

      await tx.subscription.create({
        data: {
          companyId: company.id,
          planCode: "starter_trial"
        }
      });

      await tx.usageTracking.createMany({
        data: Object.values(UsageMetric).map((metric) => ({
          companyId: company.id,
          metric,
          amount: 0,
          periodStart,
          periodEnd
        }))
      });

      return user;
    });

    const verificationUrl = `${app.config.WEB_PUBLIC_URL}/verify-email?token=${verificationToken}`;
    await app.emailJobs.enqueueVerificationEmail({
      email: created.email,
      name: created.name,
      verificationUrl
    });

    return { user: userResponse(created) };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw AppError.conflict("Account or company already exists");
    }

    throw error;
  }
}

export async function login(
  app: FastifyInstance,
  request: FastifyRequest,
  input: LoginInput
): Promise<{ accessToken: string; refreshToken: string; user: AuthenticatedUser }> {
  const user = await app.prisma.user.findUnique({
    where: { email: input.email },
    include: {
      memberships: {
        include: {
          company: {
            select: {
              name: true,
              status: true
            }
          }
        }
      }
    }
  });

  if (!user || !(await verifyPassword(user.passwordHash, input.password))) {
    throw AppError.unauthorized("Invalid email or password");
  }

  if (!user.emailVerifiedAt) {
    throw AppError.forbidden("Email verification is required before login");
  }

  const eligibleMemberships = user.memberships.filter(
    (membership) => membership.company.status === "active"
  );
  const selectedMembership = input.companyId
    ? eligibleMemberships.find((membership) => membership.companyId === input.companyId)
    : eligibleMemberships[0];

  if (!selectedMembership) {
    throw AppError.forbidden("No active company membership is available");
  }

  const refresh = createRefreshToken();
  await app.prisma.refreshSession.create({
    data: {
      userId: user.id,
      tokenHash: refresh.tokenHash,
      expiresAt: refresh.expiresAt,
      ipAddress: request.ip,
      userAgent: getClientUserAgent(request)
    }
  });

  const payload: AccessTokenPayload = {
    sub: user.id,
    companyId: selectedMembership.companyId,
    role: selectedMembership.role,
    email: user.email
  };

  return {
    accessToken: signAccessToken(app, payload),
    refreshToken: refresh.token,
    user: userResponse(user)
  };
}

export async function verifyEmail(app: FastifyInstance, token: string): Promise<void> {
  const tokenHash = hashToken(token);
  const now = new Date();

  const record = await app.prisma.emailVerificationToken.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      usedAt: true
    }
  });

  if (!record || record.usedAt || record.expiresAt <= now) {
    throw AppError.badRequest("Verification link is invalid or expired");
  }

  await app.prisma.$transaction([
    app.prisma.emailVerificationToken.update({
      where: { id: record.id },
      data: { usedAt: now }
    }),
    app.prisma.user.update({
      where: { id: record.userId },
      data: { emailVerifiedAt: now }
    })
  ]);
}

export async function forgotPassword(
  app: FastifyInstance,
  input: ForgotPasswordInput
): Promise<void> {
  const user = await app.prisma.user.findUnique({
    where: { email: input.email },
    select: {
      id: true,
      email: true,
      name: true
    }
  });

  if (!user) {
    return;
  }

  const resetToken = createOpaqueToken();
  const resetUrl = `${app.config.WEB_PUBLIC_URL}/reset-password?token=${resetToken}`;

  await app.prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(resetToken),
      expiresAt: new Date(Date.now() + passwordResetTtlMs)
    }
  });

  await app.emailJobs.enqueuePasswordResetEmail({
    email: user.email,
    name: user.name,
    resetUrl
  });
}

export async function resetPassword(
  app: FastifyInstance,
  input: ResetPasswordInput
): Promise<void> {
  const tokenHash = hashToken(input.token);
  const now = new Date();

  const record = await app.prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      usedAt: true
    }
  });

  if (!record || record.usedAt || record.expiresAt <= now) {
    throw AppError.badRequest("Reset link is invalid or expired");
  }

  const passwordHash = await hashPassword(input.password);

  await app.prisma.$transaction([
    app.prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: now }
    }),
    app.prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash }
    }),
    app.prisma.refreshSession.updateMany({
      where: {
        userId: record.userId,
        revokedAt: null
      },
      data: { revokedAt: now }
    })
  ]);
}

export async function refreshSession(
  app: FastifyInstance,
  request: FastifyRequest,
  refreshToken: string
): Promise<{ accessToken: string; refreshToken: string; user: AuthenticatedUser }> {
  const tokenHash = hashToken(refreshToken);
  const now = new Date();

  const session = await app.prisma.refreshSession.findUnique({
    where: { tokenHash },
    include: {
      user: {
        include: {
          memberships: {
            include: {
              company: {
                select: {
                  name: true,
                  status: true
                }
              }
            }
          }
        }
      }
    }
  });

  if (!session || session.revokedAt || session.expiresAt <= now) {
    throw AppError.unauthorized("Invalid or expired refresh token");
  }

  if (!session.user.emailVerifiedAt) {
    throw AppError.forbidden("Email verification is required");
  }

  const selectedMembership = session.user.memberships.find(
    (membership) => membership.company.status === "active"
  );

  if (!selectedMembership) {
    throw AppError.forbidden("No active company membership is available");
  }

  const nextRefresh = createRefreshToken();

  await app.prisma.$transaction([
    app.prisma.refreshSession.update({
      where: { id: session.id },
      data: { revokedAt: now }
    }),
    app.prisma.refreshSession.create({
      data: {
        userId: session.userId,
        tokenHash: nextRefresh.tokenHash,
        expiresAt: nextRefresh.expiresAt,
        ipAddress: request.ip,
        userAgent: getClientUserAgent(request),
        rotatedFromId: session.id
      }
    })
  ]);

  return {
    accessToken: signAccessToken(app, {
      sub: session.user.id,
      companyId: selectedMembership.companyId,
      role: selectedMembership.role,
      email: session.user.email
    }),
    refreshToken: nextRefresh.token,
    user: userResponse(session.user)
  };
}

export async function revokeRefreshSession(
  app: FastifyInstance,
  refreshToken: string | undefined
): Promise<void> {
  if (!refreshToken) {
    return;
  }

  await app.prisma.refreshSession.updateMany({
    where: {
      tokenHash: hashToken(refreshToken),
      revokedAt: null
    },
    data: {
      revokedAt: new Date()
    }
  });
}

export async function getCurrentUser(
  app: FastifyInstance,
  userId: string
): Promise<AuthenticatedUser> {
  const user = await app.prisma.user.findUnique({
    where: { id: userId },
    include: {
      memberships: {
        include: {
          company: {
            select: { name: true }
          }
        }
      }
    }
  });

  if (!user) {
    throw AppError.unauthorized();
  }

  return userResponse(user);
}
