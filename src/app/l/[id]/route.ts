import { NextResponse, type NextRequest } from "next/server";

/** URL curta impressa no QR Code da etiqueta → ficha do lote. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return NextResponse.redirect(new URL(`/lote/${id}`, _req.url));
}
