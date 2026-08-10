import { getDb } from "@/lib/db";
import { runMonitoringCycle } from "@/lib/monitoring";

const intervalMs = 5_000;

async function bootstrap() {
  getDb();

  const runOnce = async () => {
    try {
      const count = await runMonitoringCycle();
      console.log(`[monitor] checked ${count} AP(s) at ${new Date().toISOString()}`);
    } catch (error) {
      console.error("[monitor] cycle failed", error);
    }
  };

  await runOnce();
  setInterval(runOnce, intervalMs);
}

bootstrap().catch((error) => {
  console.error("[monitor] failed to start", error);
  process.exitCode = 1;
});