import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { versionApp } from "@/lib/version-app";

/**
 * La versión que sirve el servidor y si la sesión del panel sigue vigente.
 *
 * Es pública (middleware): una pantalla con la sesión vencida tiene que poder preguntar
 * justamente eso. No devuelve nada más que un id de compilación y un sí/no.
 *
 * `sesion`: la sesión dura 24 h y no avisa al vencerse; las pantallas que consultan solas
 * (monitor LPR, dispositivos, historial) seguían dibujadas pero cada consulta volvía
 * rechazada, sin un solo mensaje. Con esto el panel lleva al login en lugar de congelarse.
 */
export const dynamic = "force-dynamic";

const secretKey = process.env.JWT_SECRET;
const key = secretKey ? new TextEncoder().encode(secretKey) : null;

export async function GET() {
    let sesion = false;
    try {
        const token = (await cookies()).get("session")?.value;
        if (token && key) { await jwtVerify(token, key, { algorithms: ["HS256"] }); sesion = true; }
    } catch { sesion = false; }
    return NextResponse.json({ version: versionApp(), sesion }, { headers: { "Cache-Control": "no-store" } });
}
