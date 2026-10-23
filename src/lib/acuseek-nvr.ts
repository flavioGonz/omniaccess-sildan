import { prisma } from "@/lib/prisma";
import { getAcuSeekCapabilities, type AcuSeekCapabilities, type AcuSeekDevice } from "@/lib/acuseek";
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
type Sondeo = { nvr: NvrAcu; caps: AcuSeekCapabilities };

/*
 * 21/10: con el NVR VPro de Otto Villa dado de alta, la búsqueda seguía yendo al NVR 6 de San
 * Nicolás y decía «Este NVR no soporta AcuSeek». El criterio era «el primero que tenga algo»:
 * el NVR 6 (DS-7616NXI-K2) trae <AcuSearchCap> —la búsqueda por imagen— pero no la de texto,
 * y como se creó antes ganaba siempre. Ahora se pregunta a TODOS (en paralelo, con tope corto)
 * y se elige según lo que se va a hacer:
 *  · texto (AcuSeek): un grabador que busque por texto;
 *  · imagen (AcuSearch): primero uno que tenga las dos (un VPro), si no cualquiera con AcuSearch.
 * La lista se vuelve a sondear si cambian los grabadores dados de alta (uno nuevo se ve al toque).
 */
const VIGENCIA_MS = 15 * 60_000;
const TOPE_MS = 7000;
let cache: { firma: string; lista: Sondeo[]; t: number } | null = null;

const buscaTexto = (c: AcuSeekCapabilities) => c.asyncSearchByText || c.searchTarget;

async function sondear(): Promise<Sondeo[]> {
    const nvrs = await prisma.device.findMany({
        where: { deviceType: "NVR" }, orderBy: { createdAt: "asc" },
        select: { id: true, name: true, ip: true, username: true, password: true, authType: true, updatedAt: true },
    });
    const firma = nvrs.map((n) => `${n.id}:${n.updatedAt.getTime()}`).join("|");
    if (cache && cache.firma === firma && Date.now() - cache.t < VIGENCIA_MS) return cache.lista;
    const lista = (await Promise.all(nvrs.filter((n) => n.ip).map(async (n): Promise<Sondeo | null> => {
        const dev: AcuSeekDevice = { ip: n.ip, username: n.username || "admin", password: n.password || "", authType: n.authType || "DIGEST" };
        try {
            const caps = await Promise.race([
                getAcuSeekCapabilities(dev),
                new Promise<never>((_, no) => setTimeout(() => no(new Error("tiempo")), TOPE_MS)),
            ]);
            return caps.acuSearchCapPresent || buscaTexto(caps) ? { nvr: { id: n.id, nombre: n.name, dev }, caps } : null;
        } catch { return null; /* no contesta: no cuenta */ }
    }))).filter((x): x is Sondeo => !!x);
    cache = { firma, lista, t: Date.now() };
    return lista;
}

/** El grabador para buscar por texto (AcuSeek) o por imagen (AcuSearch). */
export async function nvrConAcuSeek(para: "texto" | "imagen" = "texto"): Promise<NvrAcu | null> {
    const l = await sondear();
    if (para === "texto") return l.find((s) => buscaTexto(s.caps))?.nvr ?? null;
    return (l.find((s) => buscaTexto(s.caps) && s.caps.acuSearchCapPresent) || l.find((s) => s.caps.acuSearchCapPresent))?.nvr ?? null;
}

/** El grabador dueño de una imagen de resultado (por el host de su URL), entre los que tienen AcuSearch. */
export async function nvrPorHost(host: string): Promise<NvrAcu | null> {
    const h = String(host || "").toLowerCase();
    return (await sondear()).find((s) => s.nvr.dev.ip.replace(/^https?:\/\//, "").split(":")[0].toLowerCase() === h)?.nvr ?? null;
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
