import { NextResponse } from "next/server";
import { deleteSwitch, setSwitchEnabled, updateSwitch } from "@/lib/monitoring";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = (await request.json()) as {
    enabled?: boolean;
    building?: string;
    name?: string;
    host?: string;
  };

  if (typeof body.enabled === "boolean") {
    setSwitchEnabled(Number(id), body.enabled);
    return NextResponse.json({ ok: true });
  }

  if (typeof body.building === "string" && typeof body.name === "string" && typeof body.host === "string") {
    if (!body.building.trim() || !body.name.trim() || !body.host.trim()) {
      return NextResponse.json({ error: "Gedung, nama, dan IP address wajib diisi" }, { status: 400 });
    }

    updateSwitch(Number(id), {
      building: body.building,
      name: body.name,
      host: body.host
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json(
    { error: "Kirim enabled boolean, atau building, name, dan host string" },
    { status: 400 }
  );
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  deleteSwitch(Number(id));
  return NextResponse.json({ ok: true });
}