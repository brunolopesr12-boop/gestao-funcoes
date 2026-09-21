import { NextResponse } from "next/server";
import { settingsFromRow } from "@/lib/kds/row";
import { db, isDbConfigured } from "@/lib/server/supabase-admin";
import { SETTINGS_TABLE } from "@/lib/server/kds-repo";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!isDbConfigured) {
    return NextResponse.json({ ok: false, erro: "Banco não configurado." }, { status: 500 });
  }
  const { data, error } = await db()
    .from(SETTINGS_TABLE)
    .select("*")
    .eq("id", "default")
    .maybeSingle();
  if (error) {
    return NextResponse.json({ ok: false, erro: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, config: settingsFromRow(data) });
}

/** Só o que o operador pode mudar: tempo de atraso, som e aceite automático. */
export async function PUT(request: Request) {
  if (!isDbConfigured) {
    return NextResponse.json({ ok: false, erro: "Banco não configurado." }, { status: 500 });
  }
  let body: { late_minutes?: number; sound?: boolean; auto_confirm?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, erro: "Corpo inválido." }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.late_minutes === "number" && Number.isFinite(body.late_minutes)) {
    patch.late_minutes = Math.min(240, Math.max(1, Math.round(body.late_minutes)));
  }
  if (typeof body.sound === "boolean") patch.sound = body.sound;
  if (typeof body.auto_confirm === "boolean") patch.auto_confirm = body.auto_confirm;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, erro: "Nada para salvar." }, { status: 400 });
  }
  patch.updated_at = new Date().toISOString();

  const { data, error } = await db()
    .from(SETTINGS_TABLE)
    .update(patch)
    .eq("id", "default")
    .select("*")
    .single();
  if (error) {
    return NextResponse.json({ ok: false, erro: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, config: settingsFromRow(data) });
}
