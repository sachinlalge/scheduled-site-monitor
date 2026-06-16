import nodemailer from "nodemailer";
import { config } from "./config.js";

interface DownAlertPayload {
  url: string;
  errorMessage: string;
  timestamp: string;
  lastSuccessfulCheck?: string;
}

interface RecoveryAlertPayload {
  url: string;
  timestamp: string;
  lastSuccessfulCheck: string;
  responseStatus: number | null;
  responseTimeMs: number;
}

const transporter = config.email.enabled
  ? nodemailer.createTransport({
      host: config.email.host,
      port: config.email.port,
      secure: config.email.secure,
      auth: {
        user: config.email.user,
        pass: config.email.pass
      }
    })
  : null;

export async function verifyEmailConfiguration(): Promise<void> {
  if (!transporter) {
    console.warn("Email alerts are disabled.");
    return;
  }

  await transporter.verify();
}

export async function sendDownAlert(payload: DownAlertPayload): Promise<void> {
  if (!transporter) {
    console.warn(`DOWN alert skipped because email alerts are disabled: ${payload.url}`);
    return;
  }

  const lastSuccessfulCheck = payload.lastSuccessfulCheck ?? "No successful check recorded yet";

  await transporter.sendMail({
    from: config.email.from,
    to: config.email.to,
    subject: `[Website Monitor] DOWN: ${payload.url}`,
    text: [
      "A monitored website is DOWN.",
      "",
      `Website URL: ${payload.url}`,
      `Error message: ${payload.errorMessage}`,
      `Timestamp: ${payload.timestamp}`,
      `Last known successful check: ${lastSuccessfulCheck}`
    ].join("\n")
  });
}

export async function sendRecoveryAlert(payload: RecoveryAlertPayload): Promise<void> {
  if (!transporter) {
    console.warn(`Recovery alert skipped because email alerts are disabled: ${payload.url}`);
    return;
  }

  await transporter.sendMail({
    from: config.email.from,
    to: config.email.to,
    subject: `[Website Monitor] RECOVERED: ${payload.url}`,
    text: [
      "A monitored website has recovered.",
      "",
      `Website URL: ${payload.url}`,
      `Timestamp: ${payload.timestamp}`,
      `Response status: ${payload.responseStatus ?? "N/A"}`,
      `Response time: ${payload.responseTimeMs} ms`,
      `Last known successful check: ${payload.lastSuccessfulCheck}`
    ].join("\n")
  });
}
