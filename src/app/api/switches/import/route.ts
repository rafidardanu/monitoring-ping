import { NextResponse } from "next/server";
import { importSwitchCsv } from "@/lib/monitoring";
import { parseSwitchCsv } from "@/lib/csv";

export async function POST(request: Request) {
  const body = (await request.json()) as { csvText?: string };

  if (!body.csvText?.trim()) {
    return NextResponse.json({ error: "CSV wajib diisi" }, { status: 400 });
  }

  try {
    const rows = parseSwitchCsv(body.csvText);

    if (rows.length === 0) {
      return NextResponse.json({ error: "Tidak ada baris switch yang valid" }, { status: 400 });
    }

    const result = importSwitchCsv(rows);
    return NextResponse.json({ ok: true, ...result, total: rows.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Gagal mengimpor CSV" },
      { status: 400 }
    );
  }
}