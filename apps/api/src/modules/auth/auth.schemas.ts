import { z } from "zod";

const passwordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters")
  .max(128, "Password must be shorter than 129 characters");

function isSafeRelativeRedirect(value: string | undefined): boolean {
  return !value || (value.startsWith("/") && !value.startsWith("//"));
}

export const signupSchema = z
  .object({
    email: z
      .string()
      .email()
      .max(255)
      .transform((value) => value.toLowerCase()),
    name: z.string().trim().min(2).max(120),
    companyName: z.string().trim().min(2).max(160).optional(),
    password: passwordSchema,
    invitationToken: z.string().min(32).optional()
  })
  .superRefine((value, context) => {
    if (!value.invitationToken && !value.companyName) {
      context.addIssue({
        code: "custom",
        path: ["companyName"],
        message: "Company name is required"
      });
    }
  });

export const loginSchema = z.object({
  email: z
    .string()
    .email()
    .max(255)
    .transform((value) => value.toLowerCase()),
  password: z.string().min(1),
  companyId: z.string().uuid().optional()
});

export const verifyEmailQuerySchema = z.object({
  token: z.string().min(32)
});

export const forgotPasswordSchema = z.object({
  email: z
    .string()
    .email()
    .max(255)
    .transform((value) => value.toLowerCase())
});

export const resetPasswordSchema = z.object({
  token: z.string().min(32),
  password: passwordSchema
});

export const googleOAuthStartQuerySchema = z.object({
  mode: z.enum(["login", "signup"]).default("login"),
  companyName: z.string().trim().min(2).max(160).optional(),
  invitationToken: z.string().min(32).optional(),
  next: z.string().trim().optional().refine(isSafeRelativeRedirect, {
    message: "Next URL must be a relative application path"
  })
});

export const googleOAuthCallbackQuerySchema = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(16).optional(),
  error: z.string().optional(),
  scope: z.string().optional(),
  authuser: z.string().optional(),
  prompt: z.string().optional()
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type GoogleOAuthStartQuery = z.infer<typeof googleOAuthStartQuerySchema>;
export type GoogleOAuthCallbackQuery = z.infer<typeof googleOAuthCallbackQuerySchema>;
