import sharp from "sharp";
import { DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/prisma";
import { getS3Client } from "@/lib/s3";
import { BUCKET, cuadroDeCamara, guardarFoto, nombresDeCamaras } from "@/lib/detector-propio-servidor";
import {
    CLAVE_LATIDO, HUELLA_ALTO, HUELLA_ANCHO, LATIDO_VIEJO_MS, VUELTA_COLGADA_MS, comparar, cupoDe, esRepetida, queHacer,
    type CamaraDePrograma, type EstadoCamara, type EstadoPrograma, type Horario, type Programa, type ProgramaFila,
} from "@/lib/capturas-programadas";

/**
 * Capturas programadas, del lado del servidor (openspec capturas-programadas-entrenamiento): la
 * vuelta que toma las fotos, y lo que arma la pantalla. Las reglas (cuándo toca, qué es repetida,
 * los frenos) están en lib/capturas-programadas.ts, sin base, para poder probarlas.
 */

/** Cuántas comparaciones se guardan por cámara para revisar los umbrales con datos del lugar. */
const DIFS_GUARDADAS = 24;
const LARGO_ERROR = 160;

/** La escena en gris y chica: lo que se compara para saber si cambió (ver `comparar`). */
export async function huellaDe(jpeg: Buffer): Promise<Uint8Array> {
    return new Uint8Array(await sharp(jpeg).greyscale().resize(HUELLA_ANCHO, HUELLA_ALTO, { fit: "fill" }).raw().toBuffer());
}
const aTexto = (h: Uint8Array) => Buffer.from(h).toString("base64");
const deTexto = (s: string | undefined | null): Uint8Array | null => (s ? new Uint8Array(Buffer.from(s, "base64")) : null);

const aPrograma = (p: any): Programa => ({
    id: p.id, nombre: p.nombre, camaras: p.camaras, cadaMin: p.cadaMin, horario: (p.horario as Horario) || null, tope: p.tope,
    hasta: p.hasta ? p.hasta.toISOString() : null, activa: p.activa, forzarAt: p.forzarAt ? p.forzarAt.toISOString() : null,
    proximaAt: p.proximaAt.toISOString(), guardadas: p.guardadas, salteadas: p.salteadas, terminada: p.terminada,
    creadaPor: p.creadaPor, createdAt: p.createdAt.toISOString(),
});

export const sinDibujar = () => prisma.fotoEntrenamiento.count({ where: { revisada: false } });

export type ResultadoVuelta = { que: string; guardadas: number; salteadas: number; fallos: number; ms: number };

/**
 * Una vuelta de una programación: una foto por cámara, de a una, salteando las escenas que no
 * cambiaron. La llama el reloj (vision-capturas.js) por la ruta interna.
 *
 * De a una cámara y no todas juntas: abrir el stream principal de veinte cámaras de un grabador a
 * la vez es justo la carga que se quiere evitar. Medido el 12/11 en el lab: un cuadro del
 * principal tarda entre 0,3 y 0,7 s, así que treinta cámaras son menos de medio minuto.
 */
export async function darVuelta(id: string, ahora = new Date()): Promise<ResultadoVuelta | null> {
    const fila = await prisma.capturaProgramada.findUnique({ where: { id } });
    if (!fila) return null;
    const t0 = Date.now();
    const estado: EstadoPrograma = { ...((fila.estado as EstadoPrograma) || {}) };
    const sit = queHacer(aPrograma(fila), { ahora, sinDibujar: await sinDibujar() });

    if (sit.que !== "tomar") {
        // Lo que no es «tomar» igual deja la base al día: terminada con su motivo, y la próxima hora
        // para que el reloj no vuelva a preguntar cada minuto por una que espera la cola o la franja.
        const data: any = {};
        if (sit.que === "terminada" && fila.terminada !== sit.motivo) data.terminada = sit.motivo;
        if (sit.que === "cola" || sit.que === "franja") { data.proximaAt = new Date(sit.proxima); data.forzarAt = null; }
        if (Object.keys(data).length) await prisma.capturaProgramada.update({ where: { id }, data });
        return { que: sit.que, guardadas: 0, salteadas: 0, fallos: 0, ms: Date.now() - t0 };
    }
    // Otra vuelta de la misma programación todavía corre (o murió hace poco): no se pisa.
    if (estado.enVueltaDesde && ahora.getTime() - Date.parse(estado.enVueltaDesde) < VUELTA_COLGADA_MS) {
        return { que: "en-curso", guardadas: 0, salteadas: 0, fallos: 0, ms: Date.now() - t0 };
    }
    estado.enVueltaDesde = ahora.toISOString();
    // La próxima hora se fija al empezar: si la vuelta falla a la mitad, no se repite al minuto.
    await prisma.capturaProgramada.update({ where: { id }, data: { estado: estado as any, forzarAt: null, proximaAt: new Date(ahora.getTime() + fila.cadaMin * 60_000) } });

    const camaras: Record<string, EstadoCamara> = { ...(estado.camaras || {}) };
    let cupo = cupoDe(fila), guardadas = 0, salteadas = 0, fallos = 0;
    try {
        for (const cam of fila.camaras) {
            if (cupo <= 0) break;
            const e: EstadoCamara = { ...(camaras[cam] || {}) };
            try {
                const c = await cuadroDeCamara(cam);
                if ("error" in c) throw new Error(c.error);
                const h = await huellaDe(c.bytes);
                const d = comparar(h, deTexto(e.huella) || new Uint8Array(0));
                const repetida = esRepetida(d);
                if (d) e.difs = [...(e.difs || []), [Math.round(d.media * 100) / 100, Math.round(d.bloque * 100) / 100, repetida ? 0 : 1] as [number, number, number]].slice(-DIFS_GUARDADAS);
                if (repetida) { e.salteadas = (e.salteadas || 0) + 1; salteadas++; }
                else {
                    await guardarFoto(c.bytes, "CAMARA", c.deviceId, id);
                    e.huella = aTexto(h); e.ultimaAt = new Date().toISOString(); e.guardadas = (e.guardadas || 0) + 1;
                    guardadas++; cupo--;
                }
                e.fallos = 0; e.error = null; e.errorDesde = null;
            } catch (x: any) {
                // Una cámara sin cuadro no frena a las demás, y nunca se guarda otra cosa en su lugar.
                e.fallos = (e.fallos || 0) + 1;
                e.error = String(x?.message || "No dio cuadro").slice(0, LARGO_ERROR);
                e.errorDesde = e.errorDesde || new Date().toISOString();
                fallos++;
            }
            camaras[cam] = e;
        }
    } finally {
        // Las cámaras que ya no están en la programación no arrastran su huella para siempre.
        for (const k of Object.keys(camaras)) if (!fila.camaras.includes(k)) delete camaras[k];
        const total = fila.guardadas + guardadas;
        await prisma.capturaProgramada.update({
            where: { id },
            data: {
                guardadas: { increment: guardadas }, salteadas: { increment: salteadas },
                terminada: total >= fila.tope ? "tope" : fila.terminada,
                estado: { enVueltaDesde: null, ultimaVueltaAt: new Date().toISOString(), ultimaMs: Date.now() - t0, camaras } as any,
            },
        }).catch(() => null);
    }
    return { que: "tomar", guardadas, salteadas, fallos, ms: Date.now() - t0 };
}

/** Las programaciones como las muestra la pantalla: con su situación, sus cámaras y lo que queda sin dibujar. */
export async function listarProgramas(ahora = new Date()): Promise<{ programas: ProgramaFila[]; sinDibujar: number; relojVivo: boolean | null }> {
    const [filas, cola, pendientes, latido] = await Promise.all([
        prisma.capturaProgramada.findMany({ orderBy: { createdAt: "desc" } }),
        sinDibujar(),
        prisma.fotoEntrenamiento.groupBy({ by: ["programaId"], where: { revisada: false, programaId: { not: null } }, _count: { _all: true } }),
        prisma.setting.findUnique({ where: { key: CLAVE_LATIDO } }),
    ]);
    const nombres = await nombresDeCamaras([...new Set(filas.flatMap((f) => f.camaras))]);
    const pend = new Map(pendientes.map((p) => [p.programaId, p._count._all]));
    const programas = filas.map((f): ProgramaFila => {
        const p = aPrograma(f);
        const est = (f.estado as EstadoPrograma) || {};
        const camarasEstado: CamaraDePrograma[] = f.camaras.map((id) => {
            const e = est.camaras?.[id] || {};
            return { id, nombre: nombres.get(id) || "Cámara que ya no existe", guardadas: e.guardadas || 0, salteadas: e.salteadas || 0, ultimaAt: e.ultimaAt || null, fallos: e.fallos || 0, error: e.error || null, errorDesde: e.errorDesde || null };
        });
        return { ...p, situacion: queHacer(p, { ahora, sinDibujar: cola }), camarasEstado, pendientes: pend.get(f.id) || 0, ultimaVueltaAt: est.ultimaVueltaAt || null };
    });
    // ¿El reloj está pasando? Sólo importa si hay alguna que debería estar tomando; si no, no se dice nada.
    const algunaCorre = programas.some((p) => ["tomar", "esperar", "cola", "franja"].includes(p.situacion.que));
    const visto = latido?.value ? Date.parse(latido.value) : NaN;
    const relojVivo = algunaCorre ? Number.isFinite(visto) && ahora.getTime() - visto < LATIDO_VIEJO_MS : null;
    return { programas, sinDibujar: cola, relojVivo };
}

/** Descarta las fotos SIN DIBUJAR de una programación (fila y objeto). Las dibujadas no se tocan. */
export async function descartarPendientes(programaId: string): Promise<{ descartadas: number; sinBorrarDelDisco: number }> {
    const fotos = await prisma.fotoEntrenamiento.findMany({ where: { programaId, revisada: false }, select: { id: true, clave: true } });
    if (!fotos.length) return { descartadas: 0, sinBorrarDelDisco: 0 };
    // Sólo las que siguen sin dibujar en este instante: alguien pudo dibujar una mientras se confirmaba.
    const { count } = await prisma.fotoEntrenamiento.deleteMany({ where: { id: { in: fotos.map((f) => f.id) }, revisada: false } });
    const quedan = new Set((await prisma.fotoEntrenamiento.findMany({ where: { id: { in: fotos.map((f) => f.id) } }, select: { id: true } })).map((f) => f.id));
    const claves = fotos.filter((f) => !quedan.has(f.id) && f.clave).map((f) => ({ Key: f.clave }));
    let sinBorrar = 0;
    const s3 = await getS3Client();
    for (let i = 0; i < claves.length; i += 500) {
        // La fila ya no está aunque falle el bucket; se cuenta, para que nadie crea que se liberó el espacio.
        try { await s3.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: claves.slice(i, i + 500), Quiet: true } })); }
        catch { sinBorrar += Math.min(500, claves.length - i); }
    }
    return { descartadas: count, sinBorrarDelDisco: sinBorrar };
}
