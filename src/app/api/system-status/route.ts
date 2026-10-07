import { NextRequest, NextResponse } from "next/server";
import { autorizarMonitor } from "@/lib/monitor/servidor";
import { estadoDelSistema } from "@/lib/estado-sistema";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    // Era pública (estaba en la lista blanca del middleware) y devolvía host, versión y tamaño
    // de la base, y el endpoint del MinIO, a quien preguntara. Exige sesión, o el enlace de
    // pantalla de la vista Salud, que es la única que la consume sin usuario.
    const puerta = await autorizarMonitor("/api/system-status");
    if (puerta.error) return puerta.error;
    return NextResponse.json(await estadoDelSistema());
}
