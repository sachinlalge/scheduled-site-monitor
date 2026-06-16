import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

export type HealthStatus = "UP" | "DOWN";

export interface CheckLogEntry {
  runId: string;
  url: string;
  timestamp: string;
  responseStatus: number | null;
  responseTimeMs: number;
  healthStatus: HealthStatus;
  attempts: number;
  errorMessage?: string;
}

export interface SummaryReport {
  runId: string;
  trigger: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  total: number;
  up: number;
  down: number;
  results: CheckLogEntry[];
}

async function appendJsonLine(filePath: string, payload: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(payload)}\n`, "utf8");
}

export async function logCheck(entry: CheckLogEntry): Promise<void> {
  await appendJsonLine(config.logFile, entry);
}

export async function logSummary(summary: SummaryReport): Promise<void> {
  await appendJsonLine(config.summaryFile, summary);
}

export function printSummary(summary: SummaryReport): void {
  const rows = summary.results.map((result) => ({
    url: result.url,
    status: result.responseStatus ?? "N/A",
    responseTimeMs: result.responseTimeMs,
    health: result.healthStatus,
    attempts: result.attempts,
    error: result.errorMessage ?? ""
  }));

  console.info(
    `\nRun ${summary.runId} completed: ${summary.up}/${summary.total} UP, ${summary.down}/${summary.total} DOWN.`
  );
  console.table(rows);
}
