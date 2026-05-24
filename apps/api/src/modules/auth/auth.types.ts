import type { UserRole } from "@voxlink/shared";

export interface AccessTokenPayload {
  readonly sub: string;
  readonly companyId: string;
  readonly role: UserRole;
  readonly email: string;
}

export interface AuthenticatedUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly emailVerifiedAt: string | null;
  readonly memberships: readonly {
    readonly companyId: string;
    readonly companyName: string;
    readonly role: UserRole;
  }[];
}
