import { z } from "zod";

export const userRoleValues = ["super_admin", "company_admin", "operator"] as const;

export const userRoleSchema = z.enum(userRoleValues);

export type UserRole = z.infer<typeof userRoleSchema>;

export const permissionValues = [
  "company:read",
  "company:update",
  "company:create",
  "dashboard:read",
  "agent:read",
  "agent:write",
  "phone_number:read",
  "phone_number:write",
  "call:read",
  "call:write",
  "knowledge_base:read",
  "knowledge_base:write",
  "audit:read"
] as const;

export const permissionSchema = z.enum(permissionValues);

export type Permission = z.infer<typeof permissionSchema>;

export const rolePermissions: Readonly<Record<UserRole, readonly Permission[]>> = {
  super_admin: permissionValues,
  company_admin: [
    "company:read",
    "company:update",
    "dashboard:read",
    "agent:read",
    "agent:write",
    "phone_number:read",
    "phone_number:write",
    "call:read",
    "call:write",
    "knowledge_base:read",
    "knowledge_base:write",
    "audit:read"
  ],
  operator: [
    "company:read",
    "dashboard:read",
    "agent:read",
    "phone_number:read",
    "call:read",
    "knowledge_base:read"
  ]
};

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return rolePermissions[role].includes(permission);
}
