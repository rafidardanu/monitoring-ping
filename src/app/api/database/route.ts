import { NextResponse } from "next/server";
import { resetMonitoringData } from "@/lib/monitoring";

export async function DELETE() {
  resetMonitoringData();
  return NextResponse.json({ ok: true });
}