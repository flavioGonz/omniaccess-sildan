import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validarSolicitud } from "@/lib/registro-padron";
import { normalizarClave } from "@/lib/censo-invitaciones";
import { anotarEnLote, chapasDelLote } from "@/lib/lote-auditoria";
import { diferenciaDeCarga, fraseDeCarga } from "@/lib/lote-cambios";
import { exigirFuncion } from "@/lib/funcion-servidor";
import { aprobarSolicitud } from "@/lib/censo-servidor";
import { leerAjustesVisitas } from "@/lib/visitas/ajustes";

/**
 * En barrio abierto la carga del censo se aplica al GUARDARLA, entera: la persona, sus matrículas y
 * sus proveedores (27/11, Nico: «cuando cargan los propietarios sus matrículas, además de las de
 * servicios o proveedores, deben cargarse sin moderación todos los datos; no queremos frenar la
 * ingesta de datos»). Es la misma aprobación que haría la administración (lib/censo-servidor), con
 * su historial en el lote y sin duplicar lo que ya estaba.
 *
 * Sólo con invitación (la clave dice de qué lote es quien carga): una carga anónima no crea lotes
 * ni personas sin que nadie la mire. Y sólo en barrio abierto: en uno cerrado una matrícula abre la
 * barrera, y la carga sigue esperando a la administración.
 */
async function aplicarAlGuardar(id: string, conInvitacion: boolean): Promise<boolean> {
    if (!conInvitacion) return false;
    const abierto = (await leerAjustesVisitas().catch(() => null))?.modo === "ABIERTO";
    if (!abierto) return false;
    const r = await aprobarSolicitud(id, "Censo · barrio abierto, sin aprobación").catch(() => null);
    return !!r?.ok;
}

export const dynamic = "force-dynamic";

/**
 * POST /api/registro — el censo del barrio, desde el QR (src/lib/registro-padron.ts).
 *
 * Es la ÚNICA ruta de la aplicación que escribe sin sesión, así que tiene las defensas escritas
 * acá y a la vista:
 *
 *  · El cuerpo tiene tope: lo que manda el formulario entra en unos pocos kilobytes.
 *  · Hay un balde por dirección: cinco cargas cada diez minutos. Una familia que se equivoca y
 *    vuelve a mandar entra; un script que repite, no.
 *  · Lo que llega NO es padrón: es una solicitud pendiente. Nada abre un portón hasta que alguien
 *    la aprueba desde el panel.
 *  · Con la clave por lote prendida (CENSO_CON_CLAVE, 18/11), además hay que traer la clave del
 *    correo, y **el lote lo pone la invitación, no el formulario**: si el lote viniera del cuerpo,
 *    la clave del lote B4 serviría para cargar el padrón del C7.
 *  · No contesta NADA sobre lo que ya hay. Ni cuántos lotes van, ni si ese lote ya cargó, ni un
 *    apellido. Son datos de trescientas familias detrás de un QR público: el formulario escribe,
 *    no consulta.
 */

const CUERPO_MAX = 16 * 1024;
const POR_DIRECCION = 5;
const VENTANA_MS = 10 * 60 * 1000;
/** Dos envíos iguales del mismo lote en este rato son el mismo: el botón tocado dos veces. */
const REPETIDO_MS = 10 * 60 * 1000;

const baldes = new Map<string, { n: number; desde: number }>();
function hayCupo(quien: string): boolean {
    const ahora = Date.now();
    const b = baldes.get(quien);
    if (!b || ahora - b.desde > VENTANA_MS) { baldes.set(quien, { n: 1, desde: ahora }); limpiar(ahora); return true; }
    if (b.n >= POR_DIRECCION) return false;
    b.n++;
    return true;
}
function limpiar(ahora: number) {
    if (baldes.size < 5000) return;
    for (const [k, v] of baldes) if (ahora - v.desde > VENTANA_MS) baldes.delete(k);
}

export async function POST(req: NextRequest) {
    // Con la función apagada esta dirección no existe: 404, como la página.
    const no = await exigirFuncion("PADRON_CENSO"); if (no) return no;
    const quien = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "sin-direccion";
    if (!hayCupo(quien)) {
        return NextResponse.json({ error: "Ya mandaste varias cargas seguidas. Esperá unos minutos." }, { status: 429, headers: { "Retry-After": "600" } });
    }
    const crudo = await req.text().catch(() => "");
    if (crudo.length > CUERPO_MAX) return NextResponse.json({ error: "El formulario llegó demasiado grande." }, { status: 413 });

    let cuerpo: unknown = null;
    try { cuerpo = JSON.parse(crudo); } catch { return NextResponse.json({ error: "No se entendió el formulario." }, { status: 400 }); }

    const { datos, errores } = validarSolicitud(cuerpo);
    if (!datos) return NextResponse.json({ errores }, { status: 400 });

    // ── La clave del lote, si el barrio la pide ──
    let invitacion: { id: string; lote: string; clave: string } | null = null;
    let unitId: string | null = null;
    /** La copia del código del lote por la que entró (25/11: el código le llega a todos los del lote). */
    let copia: { id: string; userId: string | null } | null = null;
    const pideClave = (await prisma.setting.findUnique({ where: { key: "CENSO_CON_CLAVE" } }).catch(() => null))?.value === "true";
    if (pideClave) {
        const clave = normalizarClave((cuerpo as { clave?: string } | null)?.clave);
        // El mismo mensaje para «no mandaste clave», «no existe» y «no tiene forma»: una respuesta
        // distinta por caso le dice a quien prueba claves cuál de ellas casi acierta.
        const mal = NextResponse.json({ errores: ["Esa clave no sirve. Entrá por el enlace del correo que te llegó."] }, { status: 403 });
        if (!clave) return mal;
        const inv = await prisma.invitacionCenso.findUnique({ where: { clave }, select: { id: true, lote: true, lotes: true, clave: true } });
        if (!inv) return mal;
        invitacion = inv;
        /* La invitación es por persona y puede traer más de un lote (21/11). La carga es para UNO
           de los SUYOS: el que eligió en el formulario si es de su lista, y si no, el primero. Lo
           que venga escrito y no sea suyo no vale: la clave no sirve para el lote del vecino. */
        const suyos = (Array.isArray(inv.lotes) ? (inv.lotes as { unitId?: unknown; nombre?: unknown }[]) : []).filter((l) => typeof l?.nombre === "string");
        const pedido = String((cuerpo as { lote?: unknown } | null)?.lote ?? "").replace(/\s+/g, " ").trim();
        const elegido = suyos.find((l) => l.nombre === pedido) || suyos[0];
        datos.lote = elegido ? String(elegido.nombre) : inv.lote;
        unitId = elegido && typeof elegido.unitId === "string" ? elegido.unitId : null;
        /* Sólo vale una copia de ESTA invitación: la de otro lote no dice nada de quién carga acá. */
        const de = String((cuerpo as { de?: unknown } | null)?.de ?? "").slice(0, 40);
        if (de) copia = await prisma.copiaCenso.findFirst({ where: { id: de, invitacionId: inv.id }, select: { id: true, userId: true } }).catch(() => null);
    }

    try {
        /* Corregir la propia carga (25/11): quien vuelve a «agregar algo» REEMPLAZA su carga sin
           revisar, en vez de dejar dos. Vale sólo una pendiente de ESTA clave: la ya aprobada (o la
           de otro lote) no se toca, y entonces lo que llega es una carga nueva. */
        const reemplaza = String((cuerpo as { reemplaza?: unknown } | null)?.reemplaza ?? "").slice(0, 40);
        const previa = reemplaza && invitacion
            ? await prisma.solicitudPadron.findFirst({ where: { id: reemplaza, estado: "pendiente", clave: invitacion.clave }, select: { id: true, unitId: true } })
            : null;
        if (previa) {
            await prisma.solicitudPadron.update({ where: { id: previa.id }, data: { ...datos, vehiculos: datos.vehiculos, servicios: datos.servicios, unitId: unitId ?? previa.unitId, ...(copia ? { paraUserId: copia.userId } : {}) } });
            if (copia) await prisma.copiaCenso.update({ where: { id: copia.id }, data: { usadoAt: new Date() } }).catch(() => { });
            if (unitId) {
                const quien = [datos.nombre, datos.apellido].filter(Boolean).join(" ").trim() || datos.apellido;
                const d = diferenciaDeCarga(await chapasDelLote(unitId), datos.vehiculos.map((v) => v.chapa));
                await anotarEnLote([unitId], { que: "CENSO_CARGA", persona: quien, detalle: `Corrigió su carga. ${fraseDeCarga(d)}` }, { quien, origen: "censo" });
            }
            const aplicada = await aplicarAlGuardar(previa.id, !!invitacion);
            return NextResponse.json({ ok: true, id: previa.id, corregida: true, aplicada });
        }
        // El botón tocado dos veces no es una familia que cargó dos veces.
        const igual = await prisma.solicitudPadron.findFirst({
            where: { lote: datos.lote, telefono: datos.telefono, estado: "pendiente", createdAt: { gte: new Date(Date.now() - REPETIDO_MS) } },
            select: { id: true },
        });
        if (igual) {
            await prisma.solicitudPadron.update({ where: { id: igual.id }, data: { ...datos, vehiculos: datos.vehiculos, servicios: datos.servicios } });
            const aplicada = await aplicarAlGuardar(igual.id, !!invitacion);
            return NextResponse.json({ ok: true, id: igual.id, repetido: true, aplicada });
        }
        const fila = await prisma.solicitudPadron.create({
            data: { ...datos, vehiculos: datos.vehiculos, servicios: datos.servicios, clave: invitacion?.clave ?? null, unitId, paraUserId: copia?.userId ?? null },
        });
        // La invitación queda marcada como usada, pero NO se bloquea: un lote que se olvidó una
        // matrícula tiene que poder volver a entrar por el mismo enlace.
        /* Quien entró por su copia la marca a ella, no a la invitación de la principal: el padrón
           muestra quién cargó, persona por persona. */
        if (copia) await prisma.copiaCenso.update({ where: { id: copia.id }, data: { usadoAt: new Date() } }).catch(() => { });
        else if (invitacion) await prisma.invitacionCenso.update({ where: { id: invitacion.id }, data: { usadoAt: new Date() } }).catch(() => { });
        /* El historial del lote: qué declaró, contra lo que el lote ya tenía. Es el momento en que
           un residente «cambia sus matrículas» — todavía sin aprobar, pero ya dicho. */
        if (unitId) {
            const quien = [datos.nombre, datos.apellido].filter(Boolean).join(" ").trim() || datos.apellido;
            const d = diferenciaDeCarga(await chapasDelLote(unitId), datos.vehiculos.map((v) => v.chapa));
            await anotarEnLote([unitId], { que: "CENSO_CARGA", persona: quien, detalle: fraseDeCarga(d) }, { quien, origen: "censo" });
        }
        const aplicada = await aplicarAlGuardar(fila.id, !!invitacion);
        return NextResponse.json({ ok: true, id: fila.id, aplicada });
    } catch {
        return NextResponse.json({ error: "No se pudo guardar. Probá de nuevo en un momento." }, { status: 503 });
    }
}
