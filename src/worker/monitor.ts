import { getDb } from "@/lib/db";
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