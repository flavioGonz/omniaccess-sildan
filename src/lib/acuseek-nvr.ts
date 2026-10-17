import { prisma } from "@/lib/prisma";
import { getAcuSeekCapabilities, type AcuSeekDevice } from "@/lib/acuseek";
import { getChannelMap } from "@/lib/nvr-resolve";
import { verifyApiAuth } from "@/lib/api-auth";
import { NextResponse } from "next/server";

/*
 * Con qué grabador se busca (17/10).
 *
 * Las rutas de AcuSearch tomaban «el primer NVR» de la tabla. En San Nicolás ese es el NVR 2
 * (DS-7616NI-M2), que no tiene AcuSearch: la búsqueda se le mandaba igual y el equipo cortaba la
 * conexión — el «socket hang up» que veía el operador. El único con AcuSearch es el NVR 6
 * (DS-7616NXI-K2, AcuSense). Ahora se le pregunta a cada grabador si lo tiene y se usa el que
 * sí; la respuesta se guarda media hora (no cambia), y un «ninguno» cinco minutos.
 *
 * Y los canales de los resultados se traducen a cámaras con el mapa de ESE grabador: el código
 * viejo leía NVR_CHANNEL_MAP como { ip: canal } y con el formato multi-NVR ({ nvr, ch }) no
 * encontraba ninguna cámara.
 */
export type NvrAcu = { id: string; nombre: string; dev: AcuSeekDevice };

const VIGENCIA_MS = 30 * 60_000;
const VIGENCIA_NINGUNO_MS = 5 * 60_000;
let cache: { nvr: NvrAcu | null; t: number } | null = null;

export async function nvrConAcuSeek(): Promise<NvrAcu | null> {
    if (cache && Date.now() - cache.t < (cache.nvr ? VIGENCIA_MS : VIGENCIA_NINGUNO_MS)) return cache.nvr;
    const nvrs = await prisma.device.findMany({
        where: { deviceType: "NVR" }, orderBy: { createdAt: "asc" },
        select: { id: true, name: true, ip: true, username: true, password: true, authType: true },
    });
    let elegido: NvrAcu | null = null;
    // De a uno y con tope corto: un grabador apagado (NVR 1) no debe demorar la búsqueda entera.
    for (const n of nvrs) {
        if (!n.ip) continue;
        const dev: AcuSeekDevice = { ip: n.ip, username: n.username || "admin", password: n.password || "", authType: n.authType || "DIGEST" };
        try {
            const c = await Promise.race([
                getAcuSeekCapabilities(dev),
                new Promise<never>((_, no) => setTimeout(() => no(new Error("tiempo")), 7000)),
            ]);
            if (c.acuSearchCapPresent || c.searchTarget || c.asyncSearchByText) { elegido = { id: n.id, nombre: n.name, dev }; break; }
        } catch { /* no contesta: se sigue con el próximo */ }
    }
    cache = { nvr: elegido, t: Date.now() };
    return elegido;
}

export const SIN_ACUSEEK = "Ningún grabador de este barrio tiene AcuSearch. Probá la búsqueda de OmniVision.";

/** Canal de ese grabador → cámara (id y nombre). */
export async function camarasDelNvr(nvrId: string): Promise<Record<number, { id: string; nombre: string }>> {
    const mapa = await getChannelMap();
    const porIp: Record<string, number> = {};
    for (const [ip, e] of Object.entries(mapa)) if (e.nvrId === nvrId && e.ch) porIp[ip] = e.ch;
    const ips = Object.keys(porIp);
    if (!ips.length) return {};
    const devs = await prisma.device.findMany({ where: { ip: { in: ips } }, select: { id: true, name: true, ip: true } });
    const out: Record<number, { id: string; nombre: string }> = {};
    for (const d of devs) if (d.ip && porIp[d.ip]) out[porIp[d.ip]] = { id: d.id, nombre: d.name };
    return out;
}

/** Las rutas de AcuSearch no tenían ninguna verificación: cualquiera llegaba al grabador. */
export async function conSesion(): Promise<NextResponse | null> {
    const a = await verifyApiAuth();
    if (!a.authenticated) return NextResponse.json({ ok: false, error: "Sin sesión" }, { status: 401 });
    if (a.pantalla) return NextResponse.json({ ok: false, error: "No es una vista de pantalla." }, { status: 403 });
    return null;
}
