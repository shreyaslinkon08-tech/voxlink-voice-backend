import fp from "fastify-plugin";
import { createSmtpEmailSender } from "../email/email-sender.js";
import { InlineEmailJobPort } from "../jobs/email-job-port.js";

export const emailPlugin = fp((app, _options, done) => {
  const sender = createSmtpEmailSender(app.config);
  app.decorate("emailJobs", new InlineEmailJobPort(sender));
  done();
});
