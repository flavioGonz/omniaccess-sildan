"use server";

import { prisma } from "@/lib/prisma";
import { comoAbre, type ComoAbre, type Puerta } from "@/lib/aperturas";
import { soporteDe, QUE_ES, type Capacidad } from "@/lib/drivers/catalogo";

/*
 * La ficha de un portero (13/11, Nico: «no tiene drawer, llama al modal viejo; debe ser el drawer
 * típico pero adaptado a porteros… explorá las aperturas»). Un portero se mira distinto que una
 * cámara: lo que importa es qué puertas maneja, si se le puede pedir que abra una y qué contestó
 * la última vez. El formulario viejo de cuatro fases («Sincronizar nodo») no mostraba nada de eso.
 */

async function sesionCon(permiso: string) {
    const { getSession } = await import("@/app/actions/auth");
    const { permisosDeSesion } = await import("@/lib/permisos");
    const s: any = await getSession().catch(() => null);
    if (!s || !permisosDeSesion(s).includes(permiso)) throw new Error("Tu rol no puede hacer esto con los dispositivos.");
    return s;
}

/** La acción con la que queda en Auditoría cada apertura pedida desde la ficha. */
const ACCION_ABRIR = "portero.abrir";
/** Cuántas aperturas pasadas se muestran en la ficha. */
const APERTURAS_EN_FICHA = 6;
/** Sin noticias del equipo por más de esto, la ficha no dice «en línea». */
const EN_LINEA_MAX_MS = 10 * 60_000;

export type AperturaPasada = { cuando: string; quien: string; ok: boolean; detalle: string | null };

export type FichaPortero = {
    id: string; name: string; ip: string; httpPort: number | null; location: string | null; username: string | null; authType: string;
    deviceModel: string | null; brand: string; deviceType: string; direction: string; mac: string | null;
    /** Última vez que el equipo contestó o avisó algo. */
    ultimaVez: string | null; enLinea: boolean;
    como: ComoAbre;
    /** Lo que se le leyó al equipo sobre sus puertas (o la lista asumida, con `leidas: false`). */
    puertas: Puerta[]; puertasLeidas: boolean; puertasError: string | null;
    /** Este servidor no puede abrirle nada a ese equipo (OMNI_EQUIPOS_SOLO_LECTURA). */
    soloLectura: boolean;
    /** Lo que OmniAccess hace de verdad con esta marca (drivers/catalogo). */
    hace: { clave: Capacidad; que: string }[]; notaMarca: string | null;
    aperturas: AperturaPasada[];
    /** Los grupos de acceso que incluyen a este portero. */
    grupos: string[];
};

export async function fichaPortero(id: string): Promise<FichaPortero> {
    await sesionCon("dispositivos");
    const d = await prisma.device.findUnique({ where: { id }, include: { accessGroups: { select: { name: true } } } });
    if (!d) throw new Error("No existe ese equipo.");
    const { leerPuertas } = await import("@/lib/aperturas-servidor");
    const { esSoloLectura } = await import("@/lib/solo-lectura");
    const [lectura, pasadas] = await Promise.all([
        leerPuertas(d),
        prisma.accionSistema.findMany({ where: { accion: ACCION_ABRIR, objetivo: d.id }, orderBy: { cuando: "desc" }, take: APERTURAS_EN_FICHA }).catch(() => []),
    ]);
    // Si el equipo contestó recién, está en línea aunque el latido de fondo todavía no haya pasado.
    const visto = Math.max(d.lastOnlinePull?.getTime() || 0, d.lastOnlinePush?.getTime() || 0, lectura.leidas ? Date.now() : 0);
    const soporte = soporteDe(String(d.brand));
    return {
        id: d.id, name: d.name, ip: d.ip, httpPort: d.httpPort, location: d.location, username: d.username, authType: String(d.authType),
        deviceModel: d.deviceModel, brand: String(d.brand), deviceType: String(d.deviceType), direction: String(d.direction), mac: d.mac,
        ultimaVez: visto ? new Date(visto).toISOString() : null, enLinea: !!visto && Date.now() - visto < EN_LINEA_MAX_MS,
        como: comoAbre(String(d.brand)),
        puertas: lectura.puertas, puertasLeidas: lectura.leidas, puertasError: lectura.error || null,
        soloLectura: esSoloLectura(d.ip || ""),
        hace: (soporte?.hace || []).map((c) => ({ clave: c, que: QUE_ES[c] })), notaMarca: soporte?.nota || null,
        aperturas: pasadas.map((a) => ({ cuando: a.cuando.toISOString(), quien: a.quien, ok: a.ok, detalle: a.detalle })),
        grupos: d.accessGroups.map((g) => g.name),
    };
}

/**
 * Pide abrir una puerta del portero. Queda en Auditoría quién la pidió y qué contestó el equipo,
 * haya abierto o no: una puerta es una acción física y tiene que poder reconstruirse.
 */
export async function abrirPuertaPortero(id: string, puerta: number, nombrePuerta?: string): Promise<{ ok: boolean; mensaje: string }> {
    const { getSession } = await import("@/app/actions/auth");
    const s: any = await getSession().catch(() => null);
    const d = await prisma.device.findUnique({ where: { id } });
    if (!d) return { ok: false, mensaje: "No existe ese equipo." };
    const { abrirPuerta } = await import("@/lib/aperturas-servidor");
    const r = await abrirPuerta(d, Number(puerta));
    const cual = (nombrePuerta || `Puerta ${puerta}`).slice(0, 60);
    await prisma.accionSistema.create({
        data: { quien: String(s?.name || s?.sub || "panel"), accion: ACCION_ABRIR, objetivo: d.id, ok: r.ok, detalle: `${d.name} · ${cual}${r.ok ? "" : ` · ${r.error || "no abrió"}`}`.slice(0, 500) },
    }).catch(() => { });
    return r.ok ? { ok: true, mensaje: `${d.name} aceptó abrir ${cual}.` } : { ok: false, mensaje: r.error || "El equipo no abrió." };
}

/**
 * Antes de dar de alta: ¿contesta el equipo con esos datos, y qué puertas declara? No guarda nada
 * ni cambia nada en el equipo. La clave viaja sólo en este pedido.
 */
export async function probarPortero(datos: { ip: string; httpPort?: number | null; brand: string; username?: string; password?: string; authType?: string; id?: string }): Promise<{ ok: boolean; puertas: Puerta[]; leidas: boolean; error: string | null }> {
    await sesionCon("dispositivos.editar");
    const { leerPuertas } = await import("@/lib/aperturas-servidor");
    // Editando, la clave vacía es «la guardada»: se toma de la base, no vuelve al navegador.
    const guardado = datos.id ? await prisma.device.findUnique({ where: { id: datos.id }, select: { password: true, username: true } }) : null;
    const d: any = {
        ip: String(datos.ip || "").trim(), httpPort: datos.httpPort || null, brand: datos.brand,
        username: datos.username || guardado?.username || "admin", password: datos.password || guardado?.password || "", authType: datos.authType || "DIGEST",
    };
    if (!comoAbre(d.brand).puede) return { ok: false, puertas: [], leidas: false, error: comoAbre(d.brand).nota };
    const l = await leerPuertas(d);
    // Akuvox no informa sus relés: no hay forma de saber desde acá si contestó. Se dice así.
    if (String(d.brand).toUpperCase() === "AKUVOX") return { ok: true, puertas: l.puertas, leidas: false, error: null };
    return { ok: l.leidas, puertas: l.puertas, leidas: l.leidas, error: l.error || null };
}
