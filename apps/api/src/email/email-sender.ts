import nodemailer from "nodemailer";
import type { AppConfig } from "../config/env.js";

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export function createSmtpEmailSender(config: AppConfig): EmailSender {
  const transporter = nodemailer.createTransport({
    host: config.MAIL_HOST,
    port: config.MAIL_PORT,
    secure: false
  });

  return {
    async send(message) {
      await transporter.sendMail({
        from: config.MAIL_FROM,
        to: message.to,
        subject: message.subject,
        text: message.text
      });
    }
  };
}
