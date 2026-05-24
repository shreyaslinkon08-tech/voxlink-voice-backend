import type { FastifyReply } from "fastify";
import type { AppConfig } from "../../config/env.js";

export const accessCookieName = "voxlink_access";
export const refreshCookieName = "voxlink_refresh";
export const googleOAuthStateCookieName = "voxlink_google_oauth_state";

export const accessTokenTtlSeconds = 15 * 60;
export const refreshTokenTtlSeconds = 30 * 24 * 60 * 60;

function cookieOptions(config: AppConfig, maxAge: number) {
  return {
    httpOnly: true,
    maxAge,
    path: "/",
    sameSite: "lax" as const,
    secure: config.NODE_ENV === "production"
  };
}

export function setAuthCookies(
  reply: FastifyReply,
  config: AppConfig,
  accessToken: string,
  refreshToken: string
): void {
  reply.setCookie(accessCookieName, accessToken, cookieOptions(config, accessTokenTtlSeconds));
  reply.setCookie(refreshCookieName, refreshToken, cookieOptions(config, refreshTokenTtlSeconds));
}

export function clearAuthCookies(reply: FastifyReply, config: AppConfig): void {
  const options = cookieOptions(config, 0);

  reply.clearCookie(accessCookieName, options);
  reply.clearCookie(refreshCookieName, options);
}

export function setGoogleOAuthStateCookie(
  reply: FastifyReply,
  config: AppConfig,
  state: string
): void {
  reply.setCookie(googleOAuthStateCookieName, state, {
    ...cookieOptions(config, 10 * 60),
    path: "/auth/google",
    signed: true
  });
}

export function clearGoogleOAuthStateCookie(reply: FastifyReply, config: AppConfig): void {
  reply.clearCookie(googleOAuthStateCookieName, {
    ...cookieOptions(config, 0),
    path: "/auth/google",
    signed: true
  });
}
