import type { EmailSender } from "../email/email-sender.js";

export interface VerificationEmailJob {
  readonly email: string;
  readonly name: string;
  readonly verificationUrl: string;
}

export interface PasswordResetEmailJob {
  readonly email: string;
  readonly name: string;
  readonly resetUrl: string;
}

export interface TeamInvitationEmailJob {
  readonly email: string;
  readonly companyName: string;
  readonly invitedByName: string;
  readonly role: string;
  readonly invitationUrl: string;
}

export interface EmailJobPort {
  enqueueVerificationEmail(job: VerificationEmailJob): Promise<void>;
  enqueuePasswordResetEmail(job: PasswordResetEmailJob): Promise<void>;
  enqueueTeamInvitationEmail(job: TeamInvitationEmailJob): Promise<void>;
}

export class InlineEmailJobPort implements EmailJobPort {
  constructor(private readonly sender: EmailSender) {}

  async enqueueVerificationEmail(job: VerificationEmailJob): Promise<void> {
    await this.sender.send({
      to: job.email,
      subject: "Verify your Altrion Voice account",
      text: `Hi ${job.name},\n\nVerify your account:\n${job.verificationUrl}\n\nIf you did not request this, you can ignore this email.`
    });
  }

  async enqueuePasswordResetEmail(job: PasswordResetEmailJob): Promise<void> {
    await this.sender.send({
      to: job.email,
      subject: "Reset your Altrion Voice password",
      text: `Hi ${job.name},\n\nReset your password:\n${job.resetUrl}\n\nIf you did not request this, you can ignore this email.`
    });
  }

  async enqueueTeamInvitationEmail(job: TeamInvitationEmailJob): Promise<void> {
    await this.sender.send({
      to: job.email,
      subject: `${job.invitedByName} invited you to ${job.companyName} on Altrion Voice`,
      text: `You have been invited to join ${job.companyName} as ${job.role.replaceAll("_", " ")}.\n\nAccept the invitation:\n${job.invitationUrl}\n\nIf you were not expecting this invitation, you can ignore this email.`
    });
  }
}
