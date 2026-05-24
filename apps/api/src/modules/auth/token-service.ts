import type { FastifyInstance } from "fastify";
import { refreshTokenTtlSeconds } from "./cookies.js";
import type { AccessTokenPayload } from "./auth.types.js";
import { createOpaqueToken, hashToken } from "../../utils/token.js";

export function signAccessToken(app: FastifyInstance, payload: AccessTokenPayload): string {
  return app.jwt.sign(payload, {
    expiresIn: "15m"
  });
}

export function createRefreshToken(): { token: string; tokenHash: string; expiresAt: Date } {
  const token = createOpaqueToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + refreshTokenTtlSeconds * 1000);

  return { token, tokenHash, expiresAt };
}
