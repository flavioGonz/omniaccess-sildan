import { NextRequest, NextResponse } from "next/server";
import { verifyApiAuth, unauthorizedResponse } from "@/lib/api-auth";
import { dondeEstanMatriculas } from "@/lib/matricula-en-base";

export const dynamic = "force-dynamic";

/**
 * POST /api/matriculas/en-base { plates: string[], excluirUserId? } → { [chapa]: RegistroMatricula[] }
 *
 * Lo que ya hay en la base para cada chapa (padrón, vigilancia, invitados): lo pregunta toda
 * pantalla que agrega una matrícula, mientras se escribe (ver lib/matricula-en-base).
 */
export async function POST(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    const b: any = await req.json().catch(() => ({}));
    const plates = Array.isArray(b?.plates) ? b.plates.map(String) : [];
    const excluirUserId = typeof b?.excluirUserId === "string" ? b.excluirUserId : null;
    return NextResponse.json(await dondeEstanMatriculas(plates, { excluirUserId }), { headers: { "Cache-Control": "no-store" } });
}
