import { NextResponse } from "next/server";
import { getAllLogs, getMonitoringConfig, getRecentLogs, getStatusSummary } from "@/lib/monitoring";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const searchMode = url.searchParams.get("search") === "1";

  return NextResponse.json({
    data: {
      monitoring: getMonitoringConfig(),
      summary: getStatusSummary(),
      logs: searchMode
        ? getAllLogs({
            from: url.searchParams.get("from") ?? undefined,
            to: url.searchParams.get("to") ?? undefined,
            controller: url.searchParams.get("controller") ?? undefined,
            name: url.searchParams.get("name") ?? undefined,
            host: url.searchParams.get("host") ?? undefined
          })
        : getRecentLogs(50)
    }
  });
}