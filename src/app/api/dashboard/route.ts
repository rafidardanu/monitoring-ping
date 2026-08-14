import { NextResponse } from "next/server";
import {
  getAllLogs,
  getAllSwitchLogsAsAp,
  getMonitoringConfig,
  getRecentLogs,
  getRecentSwitchLogsAsAp,
  getStatusSummary,
  getSwitchStatusSummary
} from "@/lib/monitoring";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const searchMode = url.searchParams.get("search") === "1";
  const source = url.searchParams.get("source") === "switch" ? "switch" : "ap";

  const searchOptions = {
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    controller: url.searchParams.get("controller") ?? undefined,
    name: url.searchParams.get("name") ?? undefined,
    host: url.searchParams.get("host") ?? undefined
  };

  const logs =
    source === "switch"
      ? searchMode
        ? getAllSwitchLogsAsAp(searchOptions)
        : getRecentSwitchLogsAsAp(50)
      : searchMode
        ? getAllLogs(searchOptions)
        : getRecentLogs(50);

  return NextResponse.json({
    data: {
      monitoring: getMonitoringConfig(),
      summary: getStatusSummary(),
      switches: getSwitchStatusSummary(),
      logs
    }
  });
}