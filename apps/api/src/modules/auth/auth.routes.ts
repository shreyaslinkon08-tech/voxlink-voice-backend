import type { FastifyPluginCallback } from "fastify";
import {
  clearAuthCookies,
  clearGoogleOAuthStateCookie,
  googleOAuthStateCookieName,
  refreshCookieName,
  setAuthCookies,
  setGoogleOAuthStateCookie
} from "./cookies.js";
import {
  forgotPasswordSchema,
  googleOAuthCallbackQuerySchema,
  googleOAuthStartQuerySchema,
  loginSchema,
  resetPasswordSchema,
  signupSchema,
  verifyEmailQuerySchema
} from "./auth.schemas.js";
import {
  completeGoogleOAuthSignIn,
  createGoogleOAuthAuthorization,
  forgotPassword,
  getCurrentUser,
  login,
  refreshSession,
  resetPassword,
  revokeRefreshSession,
  signup,
  verifyEmail
} from "./auth.service.js";
import { requireTenantContext } from "../../security/tenant-context.js";
import { AppError } from "../../errors/app-error.js";

export const authRoutes: FastifyPluginCallback = (app, _options, done) => {
  app.get("/google/start", async (request, reply) => {
    let fallbackPath = "/login?error=google_sign_in_failed";

    try {
      const query = googleOAuthStartQuerySchema.parse(request.query);
      fallbackPath =
        query.mode === "signup"
          ? "/signup?error=google_sign_in_failed"
          : "/login?error=google_sign_in_failed";
      const { authorizationUrl, stateCookieValue } = createGoogleOAuthAuthorization(app, query);

      setGoogleOAuthStateCookie(reply, app.config, stateCookieValue);
      return reply.redirect(authorizationUrl);
    } catch (error) {
      request.log.warn({ error }, "Google sign-in could not be started");
      return reply.redirect(new URL(fallbackPath, app.config.WEB_PUBLIC_URL).toString());
    }
  });

  app.get("/google/callback", async (request, reply) => {
    const signedStateCookie = request.cookies[googleOAuthStateCookieName];
    clearGoogleOAuthStateCookie(reply, app.config);

    try {
      const query = googleOAuthCallbackQuerySchema.parse(request.query);

      if (query.error) {
        throw AppError.badRequest(`Google sign-in was not completed: ${query.error}`);
      }

      if (!signedStateCookie) {
        throw AppError.badRequest("Google sign-in state cookie is missing");
      }

      const unsigned = request.unsignCookie(signedStateCookie);

      if (!unsigned.valid || typeof unsigned.value !== "string") {
        throw AppError.badRequest("Google sign-in state cookie is invalid");
      }

      const result = await completeGoogleOAuthSignIn(app, request, query, unsigned.value);
      setAuthCookies(reply, app.config, result.accessToken, result.refreshToken);

      return reply.redirect(new URL(result.redirectPath, app.config.WEB_PUBLIC_URL).toString());
    } catch (error) {
      request.log.warn({ error }, "Google sign-in failed");
      clearAuthCookies(reply, app.config);
      return reply.redirect(
        new URL("/login?error=google_sign_in_failed", app.config.WEB_PUBLIC_URL).toString()
      );
    }
  });

  app.post("/signup", async (request, reply) => {
    const input = signupSchema.parse(request.body);
    const result = await signup(app, input);

    reply.status(201);
    return {
      user: result.user,
      emailVerificationRequired: true
    };
  });

  app.post("/login", async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const result = await login(app, request, input);
    setAuthCookies(reply, app.config, result.accessToken, result.refreshToken);

    return {
      user: result.user
    };
  });

  app.post("/logout", async (request, reply) => {
    await revokeRefreshSession(app, request.cookies[refreshCookieName]);
    clearAuthCookies(reply, app.config);

    return { ok: true };
  });

  app.post("/refresh", async (request, reply) => {
    const refreshToken = request.cookies[refreshCookieName];

    if (!refreshToken) {
      clearAuthCookies(reply, app.config);
      reply.status(401);
      return {
        error: {
          code: "UNAUTHORIZED",
          message: "Refresh token is required",
          requestId: request.id
        }
      };
    }

    const result = await refreshSession(app, request, refreshToken);
    setAuthCookies(reply, app.config, result.accessToken, result.refreshToken);

    return {
      user: result.user
    };
  });

  app.get("/me", { preHandler: async (request) => app.authenticate(request) }, async (request) => {
    const tenant = requireTenantContext(request);
    const user = await getCurrentUser(app, tenant.userId);

    return {
      user,
      currentCompanyId: tenant.companyId,
      role: tenant.role
    };
  });

  app.get("/verify-email", async (request) => {
    const query = verifyEmailQuerySchema.parse(request.query);
    await verifyEmail(app, query.token);

    return { ok: true };
  });

  app.post("/forgot-password", async (request) => {
    const input = forgotPasswordSchema.parse(request.body);
    await forgotPassword(app, input);

    return { ok: true };
  });

  app.post("/reset-password", async (request) => {
    const input = resetPasswordSchema.parse(request.body);
    await resetPassword(app, input);

    return { ok: true };
  });

  done();
};
