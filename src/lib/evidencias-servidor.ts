import { prisma } from "@/lib/prisma";
import fs from "fs";
import path from "path";
import { Prisma } from "@prisma/client";
import { coincide, deClipGrabado, deDespachos, esCompartido, ordenarEvidencias, type Evidencia, type FilaDespacho } from "@/lib/evidencias";
import { getChannelMap } from "@/lib/nvr-resolve";
import { DIR_CLIPS } from "@/lib/clip-instante";
import { prepararParaEnviar, quitarDelAlmacen, traerDelAlmacen } from "@/lib/clips-grabados";

/**
 * Las evidencias, de la base (la forma y el porqué: lib/evidencias). Dos fuentes hoy: los clips
 * grabados (ClipGrabado) y lo mandado desde el panel (DispatchJob: tipo CLIP, o un evento
 * «compartido»). No hay tabla propia todavía: primero se junta lo que ya se guarda.
 */
const LIMITE = 60, LIMITE_MAX = 200;
const CAMPOS = { id: true, type: true, channel: true, status: true, payload: true, deviceId: true, lastError: true, createdAt: true } as const;

export async function listarEvidencias(op: { origen?: "grabado" | "enviado" | null; q?: string | null; antes?: number | null; limite?: number } = {}): Promise<{ evidencias: Evidencia[]; hayMas: boolean; total: { grabado: number } }> {
    const limite = Math.max(1, Math.min(LIMITE_MAX, op.limite || LIMITE));
    const antes = op.antes && Number.isFinite(op.antes) ? new Date(op.antes) : null;
    // Con búsqueda se trae más y se filtra acá: lo que se busca (cámara, destino) vive adentro de un JSON.
    const traer = op.q?.trim() ? LIMITE_MAX * 2 : limite + 1;
    const deEnvio = { OR: [{ type: "CLIP" }, { type: "ALERT", payload: { path: ["evento"], equals: "compartido" } }] };
    const [clips, envios, nClips] = await Promise.all([
        op.origen === "enviado" ? [] : prisma.clipGrabado.findMany({ where: { estado: "listo", ...(antes ? { creado: { lt: antes } } : {}) }, orderBy: { creado: "desc" }, take: traer }),
        op.origen === "grabado" ? [] : prisma.dispatchJob.findMany({ where: { ...deEnvio, ...(antes ? { createdAt: { lt: antes } } : {}) }, orderBy: { createdAt: "desc" }, take: traer * 3, select: CAMPOS }),
        // Sólo los grabados se cuentan: lo enviado es un despacho por destino y contarlo daría un número que no es el de la lista.
        prisma.clipGrabado.count({ where: { estado: "listo" } }),
    ]);
    // Los envíos de los clips grabados que se listan (pueden ser más viejos o más nuevos que la página).
    const nombres = clips.map((c) => c.nombre).filter((n): n is string => !!n);
    const deEsos: FilaDespacho[] = nombres.length
        ? await prisma.dispatchJob.findMany({ where: { OR: nombres.map((n) => ({ payload: { path: ["clipHecho"], equals: n } })) }, select: CAMPOS, orderBy: { createdAt: "asc" } })
        : [];
    // Y al revés: los clips grabados que mandaron los envíos que se listan, para que cada envío muestre su video.
    const mandados = [...new Set(envios.map((j) => (j.payload as { clipHecho?: unknown } | null)?.clipHecho).filter((n): n is string => typeof n === "string" && !nombres.includes(n)))];
    const suyos = mandados.length ? await prisma.clipGrabado.findMany({ where: { nombre: { in: mandados } }, select: { nombre: true, guardado: true, foto: true, segundos: true } }) : [];
    const grabados = new Map(suyos.map((c) => [c.nombre as string, { guardado: c.guardado, foto: c.foto, segundos: c.segundos }]));
    const todas = ordenarEvidencias([...clips.map((c) => deClipGrabado(c, deEsos)), ...deDespachos(envios, new Set(nombres), grabados)]).filter((e) => coincide(e, op.q || ""));
    return { evidencias: await completarFuentes(todas.slice(0, limite)), hayMas: todas.length > limite, total: { grabado: nClips } };
}

/**
 * En qué grabador y canal graba cada cámara de la evidencia. Un tramo grabado desde la pared ya
 * trae grabador y canal; uno que trae sólo la cámara se busca en el mapa de canales (por su IP),
 * que es de donde sale la grabación al armar el clip. Si la cámara no graba en ningún grabador,
 * queda sin grabador: no se inventa.
 */
async function completarFuentes(lista: Evidencia[]): Promise<Evidencia[]> {
    const fuentes = lista.flatMap((e) => e.fuentes);
    if (!fuentes.length) return lista;
    const ids = [...new Set(fuentes.map((f) => f.deviceId).filter((x): x is string => !!x))];
    const [camaras, mapa] = await Promise.all([
        ids.length ? prisma.device.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, ip: true } }) : [],
        getChannelMap().catch(() => ({} as Awaited<ReturnType<typeof getChannelMap>>)),
    ]);
    const deCamara = new Map(camaras.map((c) => [c.id, c]));
    for (const f of fuentes) {
        const c = f.deviceId ? deCamara.get(f.deviceId) : undefined;
        if (c && !f.camara) f.camara = c.name;
        const canal = c?.ip ? mapa[c.ip] : undefined;
        if (!f.nvrId && canal?.ch) { f.nvrId = canal.nvrId; f.canal = canal.ch; }
    }
    const nvrs = [...new Set(fuentes.map((f) => f.nvrId).filter((x): x is string => !!x))];
    const nombres = new Map((nvrs.length ? await prisma.device.findMany({ where: { id: { in: nvrs } }, select: { id: true, name: true } }) : []).map((n) => [n.id, n.name]));
    for (const f of fuentes) {
        if (f.nvrId) f.grabador = nombres.get(f.nvrId) || "Grabador";
        if (!f.origen && f.nvrId) f.origen = "grabador";
    }
    return lista;
}

type Resultado = { ok: true } | { ok: false; motivo: string };

/**
 * Borrar una evidencia (16/11, Nico: «permite eliminar evidencias»).
 *  · Un clip grabado: se van el video y la portada del almacén, y el registro.
 *  · Algo enviado: se va el video guardado y deja de listarse acá. El despacho NO se borra: que se
 *    mandó, a quién y cuándo es un hecho, y sigue en Despachos. La foto de un evento compartido es
 *    la del evento (vive en el Historial) y no se toca.
 * Devuelve qué se borró, para dejarlo en la auditoría.
 */
export async function borrarEvidencia(id: string, despachos: string[], por: string): Promise<Resultado & { detalle?: string }> {
    if (id.startsWith("clip-")) {
        const f = await prisma.clipGrabado.findUnique({ where: { id: id.slice(5) } });
        if (!f) return { ok: false, motivo: "Ese clip ya no existe." };
        if (f.estado !== "listo" && f.estado !== "fallo") return { ok: false, motivo: "Ese clip se está armando: esperá a que termine." };
        await quitarDelAlmacen(f.guardado); await quitarDelAlmacen(f.foto);
        if (f.nombre) { try { fs.unlinkSync(path.join(DIR_CLIPS, path.basename(f.nombre))); } catch { /* ya no estaba */ } }
        await prisma.clipGrabado.delete({ where: { id: f.id } });
        return { ok: true, detalle: `clip grabado por ${f.usuario || f.usuarioId} (${f.segundos ?? "?"} s, ${f.camaras ?? 1} cámaras)` };
    }
    const ids = [...new Set([id.replace(/^envio-/, ""), ...despachos])].slice(0, 40);
    const filas = (await prisma.dispatchJob.findMany({ where: { id: { in: ids } } })).filter((j) => j.type === "CLIP" || esCompartido(j as FilaDespacho));
    if (!filas.length) return { ok: false, motivo: "Ese envío ya no existe." };
    for (const j of filas) {
        const p = (j.payload && typeof j.payload === "object" ? j.payload : {}) as Record<string, unknown>;
        if (j.type === "CLIP") { await quitarDelAlmacen(p.guardado as string | null); await quitarDelAlmacen(p.foto as string | null); }
        const { guardado: _g, foto: _f, ...resto } = j.type === "CLIP" ? p : { ...p, guardado: undefined, foto: undefined };
        void _g; void _f;
        await prisma.dispatchJob.update({ where: { id: j.id }, data: { payload: { ...resto, evidenciaBorrada: { por, cuando: new Date().toISOString() } } as Prisma.InputJsonObject } });
    }
    return { ok: true, detalle: `${filas.length} ${filas.length === 1 ? "envío" : "envíos"} (${filas[0].channel})` };
}

/** Dejar a mano el archivo para volver a mandarlo: el de un clip grabado, o el de un clip enviado que quedó guardado. */
export async function prepararEnvio(id: string): Promise<{ ok: true; nombre: string } | { ok: false; motivo: string }> {
    if (id.startsWith("clip-")) return prepararParaEnviar(null, id.slice(5));
    const j = await prisma.dispatchJob.findUnique({ where: { id: id.replace(/^envio-/, "") }, select: { type: true, payload: true } });
    const p = (j?.payload && typeof j.payload === "object" ? j.payload : {}) as Record<string, unknown>;
    if (j?.type !== "CLIP" || typeof p.guardado !== "string" || typeof p.clip !== "string") return { ok: false, motivo: "Ese envío no dejó el video guardado." };
    return traerDelAlmacen(p.guardado, p.clip);
}
