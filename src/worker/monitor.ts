import { getDb } from "@/lib/db";
import { cleanupStorageArtifacts } from "@/lib/housekeeping";
import { runMonitoringCycle } from "@/lib/monitoring";

const intervalMs = 5_000;
let isRunning = false;

async function bootstrap() {
  getDb();

  const runOnce = async () => {
    if (isRunning) {
      console.log("[monitor] previous cycle still running, skipping this tick");
      return;
    }

    isRunning = true;
    try {
      try {
        const housekeeping = await cleanupStorageArtifacts();
        if (!housekeeping.skipped) {
          console.log(
            `[monitor] storage housekeeping completed: ${housekeeping.removedLogs} old log file(s), git gc=${housekeeping.gitGc}`
          );
        }
      } catch (error) {
        console.error("[monitor] storage housekeeping failed", error);
      }

      const count = await runMonitoringCycle();
      console.log(`[monitor] checked ${count} AP(s)/switch(es) at ${new Date().toISOString()}`);
    } catch (error) {
      console.error("[monitor] cycle failed", error);
    } finally {
      isRunning = false;
    }
  };

  await runOnce();
  setInterval(runOnce, intervalMs);
}

bootstrap().catch((error) => {
  console.error("[monitor] failed to start", error);
  process.exitCode = 1;
});