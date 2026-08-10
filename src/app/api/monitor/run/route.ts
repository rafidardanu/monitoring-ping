import { NextResponse } from "next/server";
import { runMonitoringCycle } from "@/lib/monitoring";

export async function POST() {
  const checked = await runMonitoringCycle({ force: true });
  return NextResponse.json({ ok: true, checked });
}