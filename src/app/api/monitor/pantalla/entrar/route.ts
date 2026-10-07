import { NextRequest, NextResponse } from "next/server";
import { enlacePorToken, firmarCookiePantalla } from "@/lib/pantalla-auth";
import { COOKIE_PANTALLA, PARAM_PANTALLA, enlaceAbre, esVista } from "@/lib/monitor/vistas";

export const dynamic = "force-dynamic";

/**
 * GET /api/monitor/pantalla/entrar?pantalla=<token>&volver=/monitor/<vista>
 *
 * El único lugar donde un token de pantalla en claro toca la base: se verifica, se canjea
 * por la cookie firmada y se vuelve a la vista SIN el token en la URL (para que no quede en
 * el historial del navegador ni en una captura de pantalla). Un token malo o revocado lleva
 * a la página de enlace inválido, sin decir cuál de las dos cosas pasó.
 */
export async function GET(req: NextRequest) {
    const sp = req.nextUrl.searchParams;
    const token = sp.get(PARAM_PANTALLA) || "";
    const volver = sp.get("volver") || "/monitor";
    const destino = volver.startsWith("/monitor") ? volver : "/monitor";
    const invalido = (motivo: string) => NextResponse.redirect(new URL(`/monitor/enlace-invalido?motivo=${motivo}`, req.url));

    const enlace = await enlacePorToken(token).catch(() => null);
    if (!enlace || !esVista(enlace.vista)) return invalido("invalido");
    const vistaDestino = destino.split("/")[2] || "";
    if (vistaDestino && !enlaceAbre(enlace.vista, vistaDestino)) return invalido("otra-vista");

    const cookie = await firmarCookiePantalla(enlace);
    const res = NextResponse.redirect(new URL(vistaDestino ? destino : `/monitor/${enlace.vista}`, req.url));
    res.cookies.set(COOKIE_PANTALLA, cookie, { httpOnly: true, sameSite: "lax", secure: req.nextUrl.protocol === "https:", path: "/", maxAge: 365 * 24 * 3600 });
    return res;
}
