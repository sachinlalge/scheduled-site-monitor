import cron from "node-cron";
import { config } from "./config.js";
import { runMonitor } from "./monitor.js";
import { verifyEmailConfiguration } from "./notifier.js";

let isRunning = false;

async function executeRun(trigger: string): Promise<void> {
  if (isRunning) {
    console.warn(`Skipping ${trigger} monitor run because a previous run is still active.`);
    return;
  }

  isRunning = true;

  try {
    await runMonitor(trigger);
  } catch (error) {
    console.error(`Monitor run failed for trigger ${trigger}.`, error);
  } finally {
    isRunning = false;
  }
}

async function main(): Promise<void> {
  await verifyEmailConfiguration();

  if (!cron.validate(config.scheduleExpression)) {
    throw new Error(`Invalid cron expression: ${config.scheduleExpression}`);
  }

  cron.schedule(
    config.scheduleExpression,
    () => {
      void executeRun("scheduled");
    },
    {
      timezone: config.scheduleTimezone
    }
  );

  console.info(
    `Website monitor scheduled with "${config.scheduleExpression}" in timezone ${config.scheduleTimezone}.`
  );
  console.info(`Monitoring ${config.websites.length} website(s): ${config.websites.join(", ")}`);

  if (config.runOnStart) {
    await executeRun("startup");
  }
}

main().catch((error) => {
  console.error("Scheduler failed to start.", error);
  process.exitCode = 1;
});

process.on("SIGINT", () => {
  console.info("Received SIGINT. Exiting.");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.info("Received SIGTERM. Exiting.");
  process.exit(0);
});
