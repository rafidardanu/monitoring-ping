import { NextResponse } from "next/server";
import { getMonitoringState, setMonitoringPaused } from "@/lib/monitoring";

export async function GET() {
  return NextResponse.json({ data: getMonitoringState() });
}

export async function POST() {
  const current = getMonitoringState();
  const next = !current.paused;
  setMonitoringPaused(next);

  return NextResponse.json({ ok: true, paused: next });
}