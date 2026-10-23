"use server";

import { leerArbolAreas, type AreaArbol } from "@/lib/areas-historial";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { celda, leerEsquinas, type Esquinas } from "@/lib/franja";
import { cerrarOcupacion } from "@/lib/ocupaciones";
import { asignar, estadoEnVivo, estacionamientoPrendido, olvidarEstado, OCUPAR_MS, LIBERAR_MS, type VehiculoVisto } from "@/lib/estacionamiento";
import { camarasVision } from "@/lib/vision-camaras";
import { detectar } from "@/lib/vision";

/**
 * Visión → Estacionamiento: dibujar la franja de una cámara y ver sus lugares (ver
 * lib/estacionamiento). Reemplaza al editor que vivía escondido en el calibrador del monitor de
 * intrusión, sólo para cámaras LPR interiores, y que pedía «enseñarle la calle vacía».
 *
 * Leer pide sesión; dibujar y borrar piden Ajustes (antes cualquier operador podía borrar la
 * franja o apagar el motor: la auditoría del 18/10).
 */

/** Los equipos que tienen video propio (los que pueden mirar un estacionamiento). */
const TIPOS_CON_VIDEO = ["LPR_CAMERA", "LPR_INTERIOR", "CAMERA", "QUEUE_COUNTER"];
const GO2RTC = process.env.GO2RTC_API || "http://127.0.0.1:1984";

async function exigir(permiso?: "ajustes") {
    const s: any = await getSession();
    if (!s) throw new Error("Sin sesión");
    if (permiso && !permisosDeSesion(s).includes(permiso)) throw new Error("Sólo quien tiene Ajustes puede cambiar el estacionamiento.");
    return s;
}

export type LugarAbierto = { id: string; lugar: number; plate: string | null; desde: string; hasta: string; avisado: boolean };
export type CamaraEstacionamiento = {
    id: string; nombre: string; tipo: string;
    /** El área de Dispositivos donde está (null = sin área): para elegirla agrupada por área. */
    areaId: string | null;
    /** ¿La mira OmniVision? (Visión → cámaras). Sin eso la franja está y nadie la mide. */
    mirada: boolean;
    franja: { esquinas: Esquinas; lugares: number; activa: boolean; nombre: string | null } | null;
    vivo: ReturnType<typeof estadoEnVivo>;
    abiertas: LugarAbierto[];
};

export async function listarEstacionamiento(): Promise<{
    prendida: boolean; ocuparSeg: number; liberarSeg: number;
    camaras: CamaraEstacionamiento[];
    recientes: (LugarAbierto & { camara: string })[];
    areas: AreaArbol[];
}> {
    await exigir();
    const [prendida, vision, equipos, franjas, abiertas, recientes, arbol] = await Promise.all([
        estacionamientoPrendido(),
        camarasVision(),
        // Toda cámara con video (21/10, Nico: «no deja seleccionar cualquier cámara»): antes sólo las que ya
        // miraba OmniVision, así que las de Otto Villa no aparecían. Las que no mira se ofrecen igual, avisadas.
        prisma.device.findMany({ where: { deviceType: { in: TIPOS_CON_VIDEO as any } }, select: { id: true, name: true, deviceType: true }, orderBy: { name: "asc" } }),
        prisma.franja.findMany(),
        prisma.ocupacion.findMany({ where: { cerrada: false }, orderBy: { desde: "asc" } }),
        prisma.ocupacion.findMany({ where: { cerrada: true, hasta: { gte: new Date(Date.now() - 24 * 3600_000) } }, orderBy: { hasta: "desc" }, take: 40, include: { device: { select: { name: true } } } }),
        leerArbolAreas().catch(() => ({ areas: [] as AreaArbol[], equipoArea: {} as Record<string, string> })),
    ]);
    const porEquipo = new Map(franjas.map((f) => [f.deviceId, f]));
    const fila = (o: any): LugarAbierto => ({ id: o.id, lugar: o.lugar, plate: o.plate, desde: o.desde.toISOString(), hasta: o.hasta.toISOString(), avisado: o.avisado });
    const camaras = equipos
        .map((d): CamaraEstacionamiento => {
            const f = porEquipo.get(d.id);
            const esq = f ? leerEsquinas(f.esquinas) : null;
            return {
                id: d.id, nombre: d.name, tipo: String(d.deviceType), areaId: arbol.equipoArea[d.id] || null,
                mirada: vision.todas || vision.ids.has(d.id),
                franja: f && esq ? { esquinas: esq, lugares: f.lugares, activa: f.activa, nombre: f.nombre } : null,
                vivo: estadoEnVivo(d.id),
                abiertas: abiertas.filter((o) => o.deviceId === d.id).map(fila),
            };
        });
    return {
        prendida, ocuparSeg: OCUPAR_MS / 1000, liberarSeg: LIBERAR_MS / 1000, camaras, areas: arbol.areas,
        recientes: recientes.map((o) => ({ ...fila(o), camara: o.device?.name || o.deviceId })),
    };
}

/**
 * Probar ahora: el cuadro de este momento, lo que OmniVision ve en él y en qué lugar cae cada
 * vehículo, con la franja TAL COMO ESTÁ EN PANTALLA (sin guardar). Antes «Medir ahora» medía la
 * franja guardada mientras el lienzo mostraba la que se estaba moviendo.
 */
export async function probarAhora(deviceId: string, esquinas: Esquinas, lugares: number): Promise<{
    ok: boolean; error?: string; foto?: string; ancho?: number; alto?: number;
    vehiculos?: (VehiculoVisto & { lugar: number | null })[]; ocupados?: (number | null)[];
}> {
    await exigir();
    let jpeg: Buffer | null = null;
    for (const src of [`lpr_${deviceId}`, `lpr_${deviceId}_hd`]) {
        try {
            const r = await fetch(`${GO2RTC}/api/frame.jpeg?src=${encodeURIComponent(src)}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
            if (!r.ok) continue;
            const b = Buffer.from(await r.arrayBuffer());
            if (b.length > 1000) { jpeg = b; break; }
        } catch { /* la siguiente fuente */ }
    }
    if (!jpeg) return { ok: false, error: "La cámara no entregó un cuadro (go2rtc)." };
    const { width = 0, height = 0 } = await sharp(jpeg).metadata();
    const foto = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
    let objetos: any[] = [];
    try { objetos = ((await detectar(jpeg, {})) as any).objetos || []; }
    catch (e: any) { return { ok: false, error: `OmniVision no contestó: ${e?.message || "error"}`, foto, ancho: width, alto: height }; }
    const esq = leerEsquinas(esquinas);
    const n = Math.max(1, Math.min(40, Math.round(lugares)));
    const vehiculos: VehiculoVisto[] = objetos.filter((o) => Array.isArray(o.caja_norm)).map((o) => ({ caja: o.caja_norm, clase: o.clase, confianza: o.confianza }));
    const asignados = esq ? asignar(esq, n, vehiculos) : [];
    const lugarDe = (v: VehiculoVisto) => { const i = asignados.findIndex((a) => a && a.caja === v.caja); return i >= 0 ? i : null; };
    return {
        ok: true, foto, ancho: width, alto: height,
        vehiculos: vehiculos.filter((v) => ["car", "truck", "bus", "motorcycle"].includes(v.clase)).map((v) => ({ ...v, lugar: lugarDe(v) })),
        ocupados: asignados.map((a) => (a ? Math.round(a.fraccion * 100) / 100 : null)),
    };
}

/** Cierra (con «se retiró» si correspondía) las ocupaciones abiertas de una cámara. */
async function cerrarAbiertas(deviceId: string, nombre: string) {
    const abiertas = await prisma.ocupacion.findMany({ where: { deviceId, cerrada: false } });
    for (const o of abiertas) await cerrarOcupacion(o as any, nombre).catch(() => null);
    return abiertas.length;
}

/**
 * Guardar la franja. Si se movió, cambió la cantidad de lugares o se apagó, las ocupaciones
 * abiertas se CIERRAN (con su «se retiró» si ya habían avisado «estacionó»): antes quedaban
 * abiertas para siempre, con un lugar que ya no existía, y el plano las seguía dibujando.
 */
export async function guardarEstacionamiento(deviceId: string, datos: { esquinas: Esquinas; lugares: number; activa: boolean; nombre?: string | null }) {
    await exigir("ajustes");
    const esq = leerEsquinas(datos.esquinas);
    if (!esq || esq.some((p) => p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) return { ok: false, error: "La franja está mal dibujada." };
    const lugares = Math.max(1, Math.min(40, Math.round(Number(datos.lugares) || 0)));
    const equipo = await prisma.device.findUnique({ where: { id: deviceId }, select: { name: true } });
    if (!equipo) return { ok: false, error: "No existe esa cámara." };
    const previa = await prisma.franja.findUnique({ where: { deviceId } });
    const cambio = !previa || previa.esquinas !== JSON.stringify(esq) || previa.lugares !== lugares || (previa.activa && !datos.activa);
    const cerradas = cambio && previa ? await cerrarAbiertas(deviceId, equipo.name) : 0;
    await prisma.franja.upsert({
        where: { deviceId },
        create: { deviceId, esquinas: JSON.stringify(esq), lugares, activa: datos.activa, nombre: datos.nombre?.trim() || null },
        update: { esquinas: JSON.stringify(esq), lugares, activa: datos.activa, nombre: datos.nombre?.trim() || null },
    });
    olvidarEstado(deviceId);
    return { ok: true, cerradas };
}

export async function borrarEstacionamiento(deviceId: string) {
    await exigir("ajustes");
    const equipo = await prisma.device.findUnique({ where: { id: deviceId }, select: { name: true } });
    const cerradas = await cerrarAbiertas(deviceId, equipo?.name || deviceId);
    await prisma.franja.deleteMany({ where: { deviceId } });
    olvidarEstado(deviceId);
    return { ok: true, cerradas };
}

/** Las celdas de una franja (la misma fórmula que el servidor), para quien no quiera repetirla. */
export async function celdasDeFranja(esquinas: Esquinas, lugares: number) {
    return Array.from({ length: lugares }, (_, i) => celda(esquinas, i, lugares));
}

/**
 * Que OmniVision mire esta cámara (21/10): ahora se puede dibujar una franja en cualquier cámara,
 * y en una que OmniVision no mira la franja se guarda pero nadie la mide. Esto la suma a
 * VISION_CAMARAS (la lista que lee vision-worker en cada vuelta). Con la lista vacía ya mira todas.
 * Cada cámara más es GPU: por eso es un botón, no algo que pase solo al guardar.
 */
export async function mirarConOmniVision(deviceId: string): Promise<{ ok: boolean; error?: string }> {
    const s: any = await getSession();
    if (!s) throw new Error("Sin sesión");
    if (!permisosDeSesion(s).includes("ajustes")) return { ok: false, error: "Sólo quien tiene Ajustes puede sumar cámaras a OmniVision." };
    const fila = await prisma.setting.findUnique({ where: { key: "VISION_CAMARAS" } });
    let ids: string[] = [];
    try { const l = JSON.parse(fila?.value || "[]"); ids = Array.isArray(l) ? l.map(String) : []; } catch { ids = []; }
    if (!ids.length || ids.includes(deviceId)) return { ok: true }; // vacía = todas; o ya estaba
    const value = JSON.stringify([...ids, deviceId]);
    await prisma.setting.upsert({ where: { key: "VISION_CAMARAS" }, update: { value }, create: { key: "VISION_CAMARAS", value } });
    return { ok: true };
}
