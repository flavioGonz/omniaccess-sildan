import { prisma } from "@/lib/prisma";
import { coincide, deClipGrabado, deDespachos, ordenarEvidencias, type Evidencia, type FilaDespacho } from "@/lib/evidencias";

/**
 * Las evidencias, de la base (la forma y el porqué: lib/evidencias). Dos fuentes hoy: los clips
 * grabados (ClipGrabado) y lo mandado desde el panel (DispatchJob: tipo CLIP, o un evento
 * «compartido»). No hay tabla propia todavía: primero se junta lo que ya se guarda.
 */
const LIMITE = 60, LIMITE_MAX = 200;
const CAMPOS = { id: true, type: true, channel: true, status: true, payload: true, deviceId: true, lastError: true, createdAt: true } as const;

export async function listarEvidencias(op: { origen?: "grabado" | "enviado" | null; q?: string | null; antes?: number | null; limite?: number } = {}): Promise<{ evidencias: Evidencia[]; hayMas: boolean; total: { grabado: number; enviado: number } }> {
    const limite = Math.max(1, Math.min(LIMITE_MAX, op.limite || LIMITE));
    const antes = op.antes && Number.isFinite(op.antes) ? new Date(op.antes) : null;
    // Con búsqueda se trae más y se filtra acá: lo que se busca (cámara, destino) vive adentro de un JSON.
    const traer = op.q?.trim() ? LIMITE_MAX * 2 : limite + 1;
    const deEnvio = { OR: [{ type: "CLIP" }, { type: "ALERT", payload: { path: ["evento"], equals: "compartido" } }] };
    const [clips, envios, nClips, nEnvios] = await Promise.all([
        op.origen === "enviado" ? [] : prisma.clipGrabado.findMany({ where: { estado: "listo", ...(antes ? { creado: { lt: antes } } : {}) }, orderBy: { creado: "desc" }, take: traer }),
        op.origen === "grabado" ? [] : prisma.dispatchJob.findMany({ where: { ...deEnvio, ...(antes ? { createdAt: { lt: antes } } : {}) }, orderBy: { createdAt: "desc" }, take: traer * 3, select: CAMPOS }),
        prisma.clipGrabado.count({ where: { estado: "listo" } }),
        prisma.dispatchJob.count({ where: { type: "CLIP" } }),
    ]);
    // Los envíos de los clips grabados que se listan (pueden ser más viejos o más nuevos que la página).
    const nombres = clips.map((c) => c.nombre).filter((n): n is string => !!n);
    const deEsos: FilaDespacho[] = nombres.length
        ? await prisma.dispatchJob.findMany({ where: { OR: nombres.map((n) => ({ payload: { path: ["clipHecho"], equals: n } })) }, select: CAMPOS, orderBy: { createdAt: "asc" } })
        : [];
    const todas = ordenarEvidencias([...clips.map((c) => deClipGrabado(c, deEsos)), ...deDespachos(envios, new Set(nombres))]).filter((e) => coincide(e, op.q || ""));
    return { evidencias: todas.slice(0, limite), hayMas: todas.length > limite, total: { grabado: nClips, enviado: nEnvios } };
}
