import axios, { AxiosError } from "axios";
import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { CheckLogEntry, logCheck, logSummary, printSummary, SummaryReport } from "./logger.js";
import { sendDownAlert, sendRecoveryAlert } from "./notifier.js";

interface AttemptResult {
  url: string;
  timestamp: string;
  responseStatus: number | null;
  responseTimeMs: number;
  healthy: boolean;
  errorMessage?: string;
}

interface MonitorResult extends AttemptResult {
  attempts: number;
}

interface SiteState {
  isDown: boolean;
  lastSuccessfulCheck?: string;
  lastFailureAlertSentAt?: string;
  lastFailureMessage?: string;
  lastRecoveryNotificationSentAt?: string;
}

interface MonitorState {
  sites: Record<string, SiteState>;
}

const defaultState: MonitorState = {
  sites: {}
};

function createRunId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function readState(): Promise<MonitorState> {
  try {
    const content = await fs.readFile(config.stateFile, "utf8");
    const parsed = JSON.parse(content) as MonitorState;
    return {
      sites: parsed.sites ?? {}
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return structuredClone(defaultState);
    }

    throw error;
  }
}

async function writeState(state: MonitorState): Promise<void> {
  await fs.mkdir(path.dirname(config.stateFile), { recursive: true });
  await fs.writeFile(config.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function getSiteState(state: MonitorState, url: string): SiteState {
  const existing = state.sites[url];
  if (existing) {
    return existing;
  }

  const created: SiteState = {
    isDown: false
  };

  state.sites[url] = created;
  return created;
}

function formatAxiosError(error: unknown): string {
  if (!axios.isAxiosError(error)) {
    return error instanceof Error ? error.message : String(error);
  }

  const axiosError = error as AxiosError;
  const code = axiosError.code ? `${axiosError.code}: ` : "";
  return `${code}${axiosError.message}`;
}

async function checkOnce(url: string): Promise<AttemptResult> {
  const startedAt = performance.now();
  const timestamp = new Date().toISOString();

  try {
    const response = await axios.get(url, {
      timeout: config.requestTimeoutMs,
      maxRedirects: 5,
      validateStatus: () => true,
      headers: {
        "User-Agent": "website-monitoring-automation/1.0"
      }
    });

    const responseTimeMs = Math.round(performance.now() - startedAt);
    const healthy = response.status >= 200 && response.status <= 299;

    return {
      url,
      timestamp,
      responseStatus: response.status,
      responseTimeMs,
      healthy,
      errorMessage: healthy ? undefined : `Unexpected HTTP status ${response.status}`
    };
  } catch (error) {
    return {
      url,
      timestamp,
      responseStatus: null,
      responseTimeMs: Math.round(performance.now() - startedAt),
      healthy: false,
      errorMessage: formatAxiosError(error)
    };
  }
}

async function checkWithRetries(url: string): Promise<MonitorResult> {
  const totalAttempts = config.retryCount + 1;
  let lastResult: AttemptResult | undefined;

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    lastResult = await checkOnce(url);

    if (lastResult.healthy) {
      return {
        ...lastResult,
        attempts: attempt
      };
    }

    if (attempt < totalAttempts) {
      console.warn(
        `Check failed for ${url} on attempt ${attempt}/${totalAttempts}: ${lastResult.errorMessage}. Retrying in ${config.retryIntervalMs} ms.`
      );
      await delay(config.retryIntervalMs);
    }
  }

  if (!lastResult) {
    throw new Error(`No check result was produced for ${url}.`);
  }

  return {
    ...lastResult,
    attempts: totalAttempts
  };
}

function toLogEntry(runId: string, result: MonitorResult): CheckLogEntry {
  return {
    runId,
    url: result.url,
    timestamp: result.timestamp,
    responseStatus: result.responseStatus,
    responseTimeMs: result.responseTimeMs,
    healthStatus: result.healthy ? "UP" : "DOWN",
    attempts: result.attempts,
    errorMessage: result.errorMessage
  };
}

async function handleStateTransition(state: MonitorState, result: MonitorResult): Promise<void> {
  const siteState = getSiteState(state, result.url);

  if (result.healthy) {
    const previousLastSuccessfulCheck = siteState.lastSuccessfulCheck ?? result.timestamp;
    const wasDown = siteState.isDown;

    siteState.isDown = false;
    siteState.lastSuccessfulCheck = result.timestamp;
    siteState.lastFailureMessage = undefined;
    siteState.lastFailureAlertSentAt = undefined;

    if (wasDown) {
      try {
        await sendRecoveryAlert({
          url: result.url,
          timestamp: result.timestamp,
          lastSuccessfulCheck: previousLastSuccessfulCheck,
          responseStatus: result.responseStatus,
          responseTimeMs: result.responseTimeMs
        });
        siteState.lastRecoveryNotificationSentAt = result.timestamp;
      } catch (error) {
        console.error(`Failed to send recovery notification for ${result.url}.`, error);
      }
    }

    return;
  }

  const shouldSendDownAlert = !siteState.isDown || !siteState.lastFailureAlertSentAt;

  siteState.isDown = true;
  siteState.lastFailureMessage = result.errorMessage ?? "Unknown error";

  if (shouldSendDownAlert) {
    try {
      await sendDownAlert({
        url: result.url,
        errorMessage: siteState.lastFailureMessage,
        timestamp: result.timestamp,
        lastSuccessfulCheck: siteState.lastSuccessfulCheck
      });
      siteState.lastFailureAlertSentAt = result.timestamp;
    } catch (error) {
      console.error(`Failed to send DOWN notification for ${result.url}.`, error);
    }
  }
}

export async function runMonitor(trigger = "manual"): Promise<SummaryReport> {
  const runId = createRunId();
  const startedAt = new Date();
  const state = await readState();

  console.info(`Starting website monitor run ${runId} (${trigger}).`);

  const monitorResults = await Promise.all(config.websites.map((url) => checkWithRetries(url)));
  const results: CheckLogEntry[] = [];

  for (const result of monitorResults) {
    const logEntry = toLogEntry(runId, result);

    await logCheck(logEntry);
    await handleStateTransition(state, result);

    results.push(logEntry);
  }

  await writeState(state);

  const finishedAt = new Date();
  const summary: SummaryReport = {
    runId,
    trigger,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    total: results.length,
    up: results.filter((result) => result.healthStatus === "UP").length,
    down: results.filter((result) => result.healthStatus === "DOWN").length,
    results
  };

  await logSummary(summary);
  printSummary(summary);

  return summary;
}

const currentFilePath = fileURLToPath(import.meta.url);
const executedFilePath = process.argv[1] ? path.resolve(process.argv[1]) : "";

if (currentFilePath === executedFilePath) {
  runMonitor("manual")
    .then((summary) => {
      process.exitCode = summary.down > 0 ? 1 : 0;
    })
    .catch((error) => {
      console.error("Monitor run failed.", error);
      process.exitCode = 1;
    });
}
