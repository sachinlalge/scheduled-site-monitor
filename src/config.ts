import dotenv from "dotenv";
import path from "node:path";

dotenv.config();

export interface EmailConfig {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  to: string[];
}

export interface AppConfig {
  websites: string[];
  scheduleExpression: string;
  scheduleTimezone: string;
  requestTimeoutMs: number;
  retryCount: number;
  retryIntervalMs: number;
  runOnStart: boolean;
  logFile: string;
  summaryFile: string;
  stateFile: string;
  email: EmailConfig;
}

const defaultWebsites = [
  "https://edgelearning.co/",
  "https://sircletech.in/",
  "https://finawiz.com/"
];

function readString(name: string, fallback?: string): string {
  const value = process.env[name]?.trim();
  if (value) {
    return value;
  }

  if (fallback !== undefined) {
    return fallback;
  }

  throw new Error(`Missing required environment variable: ${name}`);
}

function readNumber(name: string, fallback: number): number {
  const rawValue = process.env[name]?.trim();
  if (!rawValue) {
    return fallback;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative number.`);
  }

  return parsed;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const rawValue = process.env[name]?.trim().toLowerCase();
  if (!rawValue) {
    return fallback;
  }

  if (["true", "1", "yes", "y"].includes(rawValue)) {
    return true;
  }

  if (["false", "0", "no", "n"].includes(rawValue)) {
    return false;
  }

  throw new Error(`${name} must be true or false.`);
}

function readCsv(name: string, fallback: string[]): string[] {
  const rawValue = process.env[name]?.trim();
  if (!rawValue) {
    return fallback;
  }

  return rawValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function resolvePath(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}

function validateWebsites(websites: string[]): string[] {
  if (websites.length === 0) {
    throw new Error("At least one website must be configured.");
  }

  return websites.map((website) => {
    const url = new URL(website);
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error(`Website URL must use http or https: ${website}`);
    }

    return url.toString();
  });
}

function buildEmailConfig(): EmailConfig {
  const enabled = readBoolean("ALERTS_ENABLED", false);
  const host = process.env.SMTP_HOST?.trim() ?? "";
  const user = process.env.SMTP_USER?.trim() ?? "";
  const pass = process.env.SMTP_PASS?.trim() ?? "";
  const from = process.env.EMAIL_FROM?.trim() ?? "";
  const to = readCsv("EMAIL_TO", []);

  if (enabled) {
    const missing = [
      ["SMTP_HOST", host],
      ["SMTP_USER", user],
      ["SMTP_PASS", pass],
      ["EMAIL_FROM", from],
      ["EMAIL_TO", to.join(",")]
    ].filter(([, value]) => !value);

    if (missing.length > 0) {
      throw new Error(
        `Email alerts are enabled, but these variables are missing: ${missing
          .map(([name]) => name)
          .join(", ")}`
      );
    }
  }

  return {
    enabled,
    host,
    port: readNumber("SMTP_PORT", 587),
    secure: readBoolean("SMTP_SECURE", false),
    user,
    pass,
    from,
    to
  };
}

export const config: AppConfig = {
  websites: validateWebsites(readCsv("WEBSITES", defaultWebsites)),
  scheduleExpression: readString("SCHEDULE_CRON", "0 9,15 * * *"),
  scheduleTimezone: readString("SCHEDULE_TIMEZONE", "Asia/Kolkata"),
  requestTimeoutMs: readNumber("REQUEST_TIMEOUT_MS", 15_000),
  retryCount: readNumber("RETRY_COUNT", 3),
  retryIntervalMs: readNumber("RETRY_INTERVAL_MS", 30_000),
  runOnStart: readBoolean("RUN_ON_START", true),
  logFile: resolvePath(readString("LOG_FILE", "logs/checks.jsonl")),
  summaryFile: resolvePath(readString("SUMMARY_FILE", "logs/summaries.jsonl")),
  stateFile: resolvePath(readString("STATE_FILE", "state/outages.json")),
  email: buildEmailConfig()
};
