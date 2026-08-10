import { NextResponse } from "next/server";
import { listApRecords, upsertAp } from "@/lib/monitoring";
import { parseApCsv } from "@/lib/csv";

export async function GET() {
  return NextResponse.json({ data: listApRecords() });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    controller?: string;
    name?: string;
    model?: string;
    mac?: string;
    host?: string;
  };

  if (!body.controller?.trim() || !body.name?.trim() || !body.model?.trim() || !body.mac?.trim() || !body.host?.trim()) {
    return NextResponse.json({ error: "Controller, nama, model, MAC, dan IP address wajib diisi" }, { status: 400 });
  }

  try {
    upsertAp({
      controller: body.controller,
      name: body.name,
      model: body.model,
      mac: body.mac,
      host: body.host
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Gagal menyimpan AP" },
      { status: 400 }
    );
  }
}