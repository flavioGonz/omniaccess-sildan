import { prisma } from "@/lib/prisma";
import { getAppBranding } from "@/app/actions/settings";
import { correoDeInvitacion } from "@/lib/censo-invitaciones";
import { enviarCorreo } from "@/lib/correo";
import { ZONA } from "@/lib/fechas";
import { estimarFin, FALLAS_PARA_PAUSAR, leerGoteo, proximoEnvio, queToca, enHorario, type Goteo } from "@/lib/censo-goteo";

/**
 * Mandar las invitaciones del censo: una, y de a poco (ver censo-goteo.ts para el porqué).
 *
 * El envío de a poco no lo empuja el navegador de quien lo puso en marcha —si cierra la pestaña
 * se cortaría a la mitad— sino el servidor: el proceso de despachos llama a `vueltaDeGoteo` cada
 * medio minuto, y esa vuelta manda UNA si toca. El estado vive en el ajuste CENSO_GOTEO.
 */

const AJUSTE = "CENSO_GOTEO";
/** Con tres intentos fallidos una invitación se deja: su correo está mal, y reintentarla frena a las demás. */
export const INTENTOS_MAX = 3;

type Inv = { id: string; lote: string; lotes: unknown; nombre: string; email: string; clave: string };

/** Manda una invitación y anota en su fila cómo le fue. */
export async function mandarInvitacion(inv: Inv, origen: string): Promise<{ ok: boolean; error?: string }> {
    const marca = await getAppBranding();
    const { asunto, texto, html } = correoDeInvitacion({
        barrio: marca.barrio || marca.name, lote: inv.lote, nombre: inv.nombre || undefined,
        lotes: (Array.isArray(inv.lotes) ? (inv.lotes as { nombre?: unknown }[]) : []).map((l) => String(l?.nombre || "")).filter(Boolean),
        clave: inv.clave, url: `${origen}/registro/${inv.clave}`,
    });
    const r = await enviarCorreo({ para: inv.email, asunto, texto, html });
    if (r.ok) await prisma.invitacionCenso.update({ where: { id: inv.id }, data: { enviadoAt: new Date(), intentos: { increment: 1 }, error: null } });
    else await prisma.invitacionCenso.update({ where: { id: inv.id }, data: { intentos: { increment: 1 }, error: r.error || "no se pudo" } });
    return r;
}

export async function leerGoteoGuardado(): Promise<Goteo> {
    return leerGoteo((await prisma.setting.findUnique({ where: { key: AJUSTE } }).catch(() => null))?.value);
}
export async function guardarGoteo(g: Goteo): Promise<void> {
    const value = JSON.stringify(g);
    await prisma.setting.upsert({ where: { key: AJUSTE }, create: { key: AJUSTE, value }, update: { value } });
}

/** Las que todavía se pueden mandar: sin enviar y sin haber fallado tres veces. */
const PENDIENTES = { enviadoAt: null, intentos: { lt: INTENTOS_MAX } } as const;

export type EstadoGoteo = Goteo & { pendientes: number; conError: number; enHorario: boolean; terminaAt: string | null };
export async function estadoDeGoteo(): Promise<EstadoGoteo> {
    const [g, pendientes, conError] = await Promise.all([
        leerGoteoGuardado(), prisma.invitacionCenso.count({ where: PENDIENTES }), prisma.invitacionCenso.count({ where: { enviadoAt: null, intentos: { gte: INTENTOS_MAX } } }),
    ]);
    const ahora = new Date();
    return { ...g, pendientes, conError, enHorario: enHorario(g, ahora, ZONA), terminaAt: estimarFin(g, pendientes, ahora, ZONA)?.toISOString() || null };
}

let enVuelta = false;
/** Una vuelta: manda UNA si toca. La llama el proceso de despachos cada medio minuto. */
export async function vueltaDeGoteo(): Promise<{ que: string; lote?: string; error?: string }> {
    if (enVuelta) return { que: "ocupado" };
    enVuelta = true;
    try {
        const g = await leerGoteoGuardado();
        const ahora = new Date();
        const que = queToca(g, ahora, ZONA);
        if (que !== "enviar") return { que };
        /* El orden es el de la clave, que es al azar: así no salen seguidos los dos del mismo lote
           ni toda una manzana en fila, y el orden no cambia entre una vuelta y la otra. */
        const inv = await prisma.invitacionCenso.findFirst({ where: PENDIENTES, orderBy: { clave: "asc" } });
        if (!inv) {
            const conError = await prisma.invitacionCenso.count({ where: { enviadoAt: null } });
            await guardarGoteo({ ...g, activo: false, proximo: null, fallas: 0, motivo: conError ? `Terminó. Quedaron ${conError} sin poder enviarse: mirá el motivo de cada una en la lista.` : "Terminó: se enviaron todas." });
            return { que: "terminado" };
        }
        if (!g.origen) { await guardarGoteo({ ...g, activo: false, motivo: "No se sabe con qué dirección armar los enlaces: volvé a ponerlo en marcha desde esta pantalla." }); return { que: "sin-origen" }; }
        /* El próximo se anota ANTES de mandar: si esta vuelta tarda, la siguiente no manda otro encima. */
        await guardarGoteo({ ...g, proximo: proximoEnvio(g, ahora).toISOString() });
        const r = await mandarInvitacion(inv, g.origen);
        const ahoraG = await leerGoteoGuardado();                 // pudieron pausarlo mientras se mandaba
        if (r.ok) { await guardarGoteo({ ...ahoraG, fallas: 0, motivo: null }); return { que: "enviado", lote: inv.lote }; }
        const fallas = ahoraG.fallas + 1;
        await guardarGoteo(fallas >= FALLAS_PARA_PAUSAR
            ? { ...ahoraG, activo: false, fallas, proximo: null, motivo: `Se frenó solo: ${fallas} envíos seguidos fallaron. El último dijo: «${r.error || "sin detalle"}».` }
            : { ...ahoraG, fallas });
        return { que: "fallo", lote: inv.lote, error: r.error };
    } finally { enVuelta = false; }
}
