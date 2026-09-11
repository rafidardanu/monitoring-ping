import { NextResponse } from "next/server";
import { deleteAp, setApEnabled, updateAp } from "@/lib/monitoring";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = (await request.json()) as {
      enabled?: boolean;
      controller?: string;
      name?: string;
      model?: string;
      mac?: string;
      host?: string;
      switchId?: number | null;
    };

  if (typeof body.enabled === "boolean") {
    setApEnabled(Number(id), body.enabled);
    return NextResponse.json({ ok: true });
  }

  if (
    typeof body.controller === "string" &&
    typeof body.name === "string" &&
    typeof body.model === "string" &&
    typeof body.mac === "string" &&
    typeof body.host === "string"
  ) {
    if (!body.controller.trim() || !body.name.trim() || !body.model.trim() || !body.mac.trim() || !body.host.trim()) {
      return NextResponse.json(
        { error: "Controller, nama, model, MAC, dan IP address wajib diisi" },
        { status: 400 }
      );
    }

    updateAp(
          Number(id),
          {
            controller: body.controller,
            name: body.name,
            model: body.model,
            mac: body.mac,
            host: body.host,
            switchName: ""
          },
          body.switchId ?? null
        );
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json(
    { error: "Kirim enabled boolean, atau controller, name, model, mac, dan host string" },
    { status: 400 }
  );
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  deleteAp(Number(id));
  return NextResponse.json({ ok: true });
}