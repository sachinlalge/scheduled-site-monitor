import { chromium, type Browser, type Page } from "playwright";
import { setTimeout as delay } from "node:timers/promises";
import { config } from "./config.js";

interface BrowserDiagnostics {
  title: string;
  finalUrl: string;
  readyState: string;
  visibleTextLength: number;
  visibleTextSample: string;
  meaningfulMediaCount: number;
  visibleElementCount: number;
  bodyChildCount: number;
}

export interface BrowserCheckResult {
  healthy: boolean;
  responseStatus: number | null;
  responseTimeMs: number;
  errorMessage?: string;
}

function truncate(value: string, maxLength = 220): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
}

function formatDiagnostics(diagnostics: BrowserDiagnostics): string {
  return [
    `visible text: ${diagnostics.visibleTextLength} chars`,
    `visible elements: ${diagnostics.visibleElementCount}`,
    `visible media: ${diagnostics.meaningfulMediaCount}`,
    `ready state: ${diagnostics.readyState}`,
    `title: ${diagnostics.title || "N/A"}`,
    `final URL: ${diagnostics.finalUrl}`
  ].join("; ");
}

function isSameOriginResource(pageUrl: string, resourceUrl: string): boolean {
  try {
    return new URL(pageUrl).origin === new URL(resourceUrl).origin;
  } catch {
    return false;
  }
}

async function collectDiagnostics(page: Page): Promise<BrowserDiagnostics> {
  return page.evaluate(() => {
    const body = document.body;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    function isVisible(element: Element): boolean {
      const style = window.getComputedStyle(element);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        Number(style.opacity) === 0
      ) {
        return false;
      }

      return Array.from(element.getClientRects()).some((rect) => {
        return (
          rect.width > 1 &&
          rect.height > 1 &&
          rect.bottom >= 0 &&
          rect.right >= 0 &&
          rect.top <= viewportHeight &&
          rect.left <= viewportWidth
        );
      });
    }

    const elements = Array.from(body?.querySelectorAll("*") ?? []);
    const visibleElements = elements.filter(isVisible);
    const visibleText = (body?.innerText ?? "").replace(/\s+/g, " ").trim();

    const meaningfulMediaCount = visibleElements.filter((element) => {
      const tagName = element.tagName.toLowerCase();
      if (!["canvas", "img", "picture", "svg", "video"].includes(tagName)) {
        return false;
      }

      const rect = element.getBoundingClientRect();
      return rect.width * rect.height >= 4096;
    }).length;

    return {
      title: document.title,
      finalUrl: window.location.href,
      readyState: document.readyState,
      visibleTextLength: visibleText.length,
      visibleTextSample: visibleText.slice(0, 180),
      meaningfulMediaCount,
      visibleElementCount: visibleElements.length,
      bodyChildCount: body?.children.length ?? 0
    };
  });
}

export async function runBrowserCheck(url: string): Promise<BrowserCheckResult> {
  const startedAt = performance.now();
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedCriticalRequests: string[] = [];
  const failedCriticalResponses: string[] = [];
  let browser: Browser | undefined;

  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 1365, height: 768 },
      userAgent: "website-monitoring-automation/1.0 Playwright"
    });

    page.setDefaultTimeout(config.browserCheck.timeoutMs);
    page.setDefaultNavigationTimeout(config.browserCheck.timeoutMs);

    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(truncate(message.text()));
      }
    });

    page.on("pageerror", (error) => {
      pageErrors.push(truncate(error.message));
    });

    page.on("requestfailed", (request) => {
      const resourceType = request.resourceType();
      const requestUrl = request.url();
      const isCriticalType = ["document", "script", "stylesheet"].includes(resourceType);

      if (isCriticalType && isSameOriginResource(url, requestUrl)) {
        const failure = request.failure()?.errorText ?? "unknown request failure";
        failedCriticalRequests.push(`${resourceType} ${truncate(requestUrl, 120)} (${failure})`);
      }
    });

    page.on("response", (response) => {
      const request = response.request();
      const resourceType = request.resourceType();
      const responseUrl = response.url();
      const isCriticalType = ["document", "script", "stylesheet"].includes(resourceType);

      if (
        isCriticalType &&
        isSameOriginResource(url, responseUrl) &&
        response.status() >= 400
      ) {
        failedCriticalResponses.push(
          `${resourceType} ${truncate(responseUrl, 120)} (HTTP ${response.status()})`
        );
      }
    });

    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: config.browserCheck.timeoutMs
    });

    try {
      await page.waitForLoadState("networkidle", {
        timeout: Math.min(5_000, config.browserCheck.timeoutMs)
      });
    } catch {
      // Some healthy pages keep long-lived connections open. DOM and post-load checks still run.
    }

    if (config.browserCheck.postLoadWaitMs > 0) {
      await delay(config.browserCheck.postLoadWaitMs);
    }

    const diagnostics = await collectDiagnostics(page);
    const responseStatus = response?.status() ?? null;
    const failures: string[] = [];

    if (responseStatus !== null && (responseStatus < 200 || responseStatus > 299)) {
      failures.push(`Browser navigation returned HTTP ${responseStatus}`);
    }

    if (
      diagnostics.visibleTextLength < config.browserCheck.minVisibleTextLength &&
      diagnostics.meaningfulMediaCount === 0
    ) {
      failures.push(
        `Rendered page appears blank or nearly blank (${formatDiagnostics(diagnostics)})`
      );
    }

    if (pageErrors.length > 0) {
      failures.push(`Unhandled frontend error: ${pageErrors.slice(0, 3).join(" | ")}`);
    }

    if (failedCriticalRequests.length > 0) {
      failures.push(
        `Critical frontend resource failed: ${failedCriticalRequests.slice(0, 3).join(" | ")}`
      );
    }

    if (failedCriticalResponses.length > 0) {
      failures.push(
        `Critical frontend resource returned an error: ${failedCriticalResponses
          .slice(0, 3)
          .join(" | ")}`
      );
    }

    if (config.browserCheck.failOnConsoleError && consoleErrors.length > 0) {
      failures.push(`Browser console error: ${consoleErrors.slice(0, 3).join(" | ")}`);
    }

    return {
      healthy: failures.length === 0,
      responseStatus,
      responseTimeMs: Math.round(performance.now() - startedAt),
      errorMessage: failures.length > 0 ? failures.join("; ") : undefined
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      healthy: false,
      responseStatus: null,
      responseTimeMs: Math.round(performance.now() - startedAt),
      errorMessage: `Browser check failed: ${truncate(message)}`
    };
  } finally {
    await browser?.close();
  }
}
