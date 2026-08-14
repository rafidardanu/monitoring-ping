import { NextResponse } from "next/server";
import { createSwitch, listSwitchRecords } from "@/lib/monitoring";

export async function GET() {
  return NextResponse.json({ data: listSwitchRecords() });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    building?: string;
    name?: string;
    host?: string;
  };

  if (!body.building?.trim() || !body.name?.trim() || !body.host?.trim()) {
    return NextResponse.json({ error: "Gedung, nama, dan IP address wajib diisi" }, { status: 400 });
  }

  try {
    createSwitch({
      building: body.building,
      name: body.name,
      host: body.host
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Gagal menyimpan switch" },
      { status: 400 }
    );
  }
}