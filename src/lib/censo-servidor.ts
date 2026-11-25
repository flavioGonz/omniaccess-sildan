import { prisma } from "@/lib/prisma";
import { anotarEnLote, auditarLotes } from "@/lib/lote-auditoria";
import { personaDeLaCarga } from "@/lib/censo-por-lote";
import { DIAS, TIPOS_SERVICIO, TIPOS_VEHICULO, type ServicioCargado, type VehiculoCargado } from "@/lib/registro-padron";

/**
 * Aprobar una carga del censo: pasarla de la bandeja al padrón.
 *
 * Lo que hace y lo que NO hace, dicho acá porque es lo que la pantalla tiene que poder prometer:
 *
 *  · Busca el lote entre las unidades y lo crea si no está.
 *  · Busca a la persona por su teléfono (es el dato único que cargó) y la crea si no está; si ya
 *    estaba, se le completa lo que falte y se la deja en su lote.
 *  · Da de alta cada matrícula como credencial PLATE de esa persona, más su ficha de vehículo.
 *    Una matrícula que YA es de otra persona no se le saca a nadie: se informa y se deja como
 *    estaba. Dos lotes que declaran la misma chapa es exactamente el caso que hay que mirar a
 *    mano, no resolver solo.
 *  · Los servicios (jardinero, piscinero…) quedan escritos en la ficha de la persona. **No** se
 *    convierten todavía en autorizaciones automáticas: eso son las visitas por patrón, y
 *    convertirlas sin que alguien las mire sería abrirle el portón a un nombre escrito en un
 *    formulario público.
 */

export type ResultadoAprobar = {
    ok: boolean;
    unidad: string;
    persona: string;
    matriculas: number;
    /** Lo que no se pudo hacer, en palabras: matrículas de otra persona, sobre todo. */
    avisos: string[];
    error?: string;
};

const rotuloVehiculo = (t: string) => TIPOS_VEHICULO.find((x) => x.id === t)?.rotulo || t;
const rotuloServicio = (t: string) => TIPOS_SERVICIO.find((x) => x.id === t)?.rotulo || t;

/** «Jardinero Ramón · mar y vie · 08:00 a 12:00 · ABC1234», para dejarlo legible en la ficha. */
export function lineaDeServicio(s: ServicioCargado): string {
    const partes = [rotuloServicio(s.tipo)];
    if (s.nombre) partes.push(s.nombre);
    if (s.dias?.length) partes.push([...s.dias].sort((a, b) => DIAS.indexOf(a) - DIAS.indexOf(b)).join(", "));
    if (s.desde || s.hasta) partes.push(`${s.desde || "?"} a ${s.hasta || "?"}`);
    if (s.chapa) partes.push(s.chapa);
    return partes.join(" · ");
}

export async function aprobarSolicitud(id: string, quien: string): Promise<ResultadoAprobar> {
    const s = await prisma.solicitudPadron.findUnique({ where: { id } });
    if (!s) return { ok: false, unidad: "", persona: "", matriculas: 0, avisos: [], error: "No existe esa carga." };
    if (s.estado !== "pendiente") return { ok: false, unidad: "", persona: "", matriculas: 0, avisos: [], error: "Esa carga ya estaba resuelta." };

    const vehiculos = (s.vehiculos as unknown as VehiculoCargado[]) || [];
    const servicios = (s.servicios as unknown as ServicioCargado[]) || [];
    const avisos: string[] = [];

    // ── El lote ──
    const nombreUnidad = `Lote ${s.lote}`;
    // El punto que marcó la persona, en el formato en que el resto del sistema guarda coordenadas.
    const punto = s.lat != null && s.lng != null ? `${s.lat}, ${s.lng}` : null;
    /* Si la carga vino por una invitación, el lote ya es uno del padrón y se usa ÉSE: con lotes
       que se repiten entre etapas («A 2» está en dos), buscarlo por el texto traería cualquiera. */
    let unidad = s.unitId ? await prisma.unit.findUnique({ where: { id: s.unitId }, select: { id: true, name: true, coordinates: true } }) : null;
    if (!unidad) unidad = await prisma.unit.findFirst({ where: { OR: [{ name: s.lote }, { lot: s.lote }, { name: nombreUnidad }] }, select: { id: true, name: true, coordinates: true } });
    if (!unidad) unidad = await prisma.unit.create({ data: { name: nombreUnidad, lot: s.lote, type: "CASA", coordinates: punto }, select: { id: true, name: true, coordinates: true } });
    else if (punto && !unidad.coordinates?.trim()) {
        // Se completa la que falta, nunca se pisa la que ya está: la del mapa la dibujó la
        // administración sobre el plano y vale más que un GPS tomado desde el living.
        await prisma.unit.update({ where: { id: unidad.id }, data: { coordinates: punto } });
        avisos.push("Se guardó la ubicación del lote.");
    } else if (punto && unidad.coordinates?.trim() && unidad.coordinates.trim() !== punto) {
        avisos.push("El lote ya tenía ubicación: la del censo quedó sin usar.");
    }

    // ── La persona ──
    const nombre = [s.nombre, s.apellido].filter(Boolean).join(" ").trim() || s.apellido;
    /* La persona: alguien del lote si se la reconoce (el padrón ya la tiene, cargada desde la
       planilla de la administración, sin teléfono todavía); si no, por el teléfono, como siempre.
       Sin esto cada aprobación creaba una segunda ficha de alguien que ya estaba.
       Desde el 25/11 el código del lote le llega a TODOS sus residentes: «la persona de la
       invitación» ya no dice quién cargó. Se la reconoce entre la gente del lote por lo que
       escribió de sí misma (ver personaDeLaCarga). */
    const SEL = { id: true, name: true, observations: true, phone: true } as const;
    const inv = s.clave ? await prisma.invitacionCenso.findUnique({ where: { clave: s.clave }, select: { userId: true } }).catch(() => null) : null;
    const delLote = (await prisma.userUnidad.findMany({ where: { unitId: unidad.id }, select: { user: { select: { id: true, name: true, email: true, phone: true } } } })).map((v) => v.user);
    const suId = personaDeLaCarga(delLote, { email: s.email || "", telefono: s.telefono, nombre, paraUserId: s.paraUserId }, inv?.userId);
    let persona = suId ? await prisma.user.findUnique({ where: { id: suId }, select: SEL }) : null;
    const porInvitacion = !!persona;
    if (!persona) persona = await prisma.user.findFirst({ where: { phone: s.telefono }, select: SEL });
    const anotacion = [
        `Censo ${new Date(s.createdAt).toLocaleDateString("es-UY")}: ${s.tenencia === "INQUILINO" ? "inquilino" : "propietario"}.`,
        ...servicios.map((x) => `Servicio: ${lineaDeServicio(x)}`),
        s.comentario ? `Dijo: ${s.comentario}` : "",
    ].filter(Boolean).join("\n");

    if (persona) {
        await prisma.user.update({
            where: { id: persona.id },
            data: {
                /* A quien vino por su invitación no se le cambia el lote principal (puede tener
                   varios): se le completa el teléfono, que es lo que el padrón no tenía. */
                ...(porInvitacion ? (!persona.phone?.trim() ? { phone: s.telefono } : {}) : { unitId: unidad.id }),
                email: s.email || undefined, observations: [persona.observations, anotacion].filter(Boolean).join("\n"),
            },
        });
        avisos.push(porInvitacion ? `${persona.name} ya estaba en el padrón: se le sumó lo que cargó.` : `Ya existía ${persona.name} con ese teléfono: se le sumó el lote y lo que cargó.`);
    } else {
        persona = await prisma.user.create({
            data: { name: nombre, phone: s.telefono, email: s.email || null, unitId: unidad.id, role: "RESIDENT", observations: anotacion, createdBy: quien },
            select: { id: true, name: true, observations: true, phone: true },
        });
    }
    /* Que esa persona figure en ese lote, con lo que dijo que es (si ya figuraba, no se toca). */
    await prisma.userUnidad.upsert({
        where: { userId_unitId: { userId: persona.id, unitId: unidad.id } }, update: {},
        create: { userId: persona.id, unitId: unidad.id, vinculo: s.tenencia === "INQUILINO" ? "INQUILINO" : "PROPIETARIO" },
    }).catch(() => { });

    // ── Las matrículas ──
    let matriculas = 0;
    for (const v of vehiculos) {
        const nota = `${rotuloVehiculo(v.tipo)}${v.quien ? ` · ${v.quien}` : ""}`;
        const yaCred = await prisma.credential.findFirst({ where: { type: "PLATE", value: v.chapa }, select: { userId: true } });
        if (yaCred && yaCred.userId && yaCred.userId !== persona.id) {
            const dueno = await prisma.user.findUnique({ where: { id: yaCred.userId }, select: { name: true } });
            avisos.push(`${v.chapa} ya es de ${dueno?.name || "otra persona"}: se dejó como estaba.`);
            continue;
        }
        if (!yaCred) await prisma.credential.create({ data: { type: "PLATE", value: v.chapa, userId: persona.id, notes: nota } });
        else if (!yaCred.userId) await prisma.credential.updateMany({ where: { type: "PLATE", value: v.chapa }, data: { userId: persona.id, notes: nota } });

        const yaVeh = await prisma.vehicle.findUnique({ where: { plate: v.chapa }, select: { id: true, userId: true } });
        if (!yaVeh) await prisma.vehicle.create({ data: { plate: v.chapa, userId: persona.id, brand: v.marca || null, color: v.color || null, notes: nota } });
        matriculas++;
    }

    await prisma.solicitudPadron.update({
        where: { id },
        data: { estado: "aprobada", revisadaPor: quien, revisadaAt: new Date(), nota: avisos.join(" ") || null },
    });
    /* El historial del lote. Lo que cambió —matrículas, gente— lo firma el residente, que es quien
       lo declaró; quién lo aprobó queda en el renglón de la aprobación. */
    await auditarLotes({ quien: persona.name, origen: "censo", personas: [persona.id] });
    await anotarEnLote([unidad.id], { que: "CENSO_APROBADA", persona: persona.name, userId: persona.id, detalle: `${matriculas} ${matriculas === 1 ? "matrícula" : "matrículas"} en la carga.${avisos.length ? ` ${avisos.join(" ")}` : ""}` }, { quien, origen: "panel" });
    return { ok: true, unidad: unidad.name, persona: persona.name, matriculas, avisos };
}

export async function rechazarSolicitud(id: string, quien: string, motivo: string): Promise<{ ok: boolean; error?: string }> {
    const s = await prisma.solicitudPadron.findUnique({ where: { id }, select: { estado: true, unitId: true, nombre: true, apellido: true } });
    if (!s) return { ok: false, error: "No existe esa carga." };
    if (s.estado !== "pendiente") return { ok: false, error: "Esa carga ya estaba resuelta." };
    await prisma.solicitudPadron.update({ where: { id }, data: { estado: "rechazada", revisadaPor: quien, revisadaAt: new Date(), nota: motivo.slice(0, 300) || null } });
    await anotarEnLote([s.unitId], { que: "CENSO_RECHAZADA", persona: [s.nombre, s.apellido].filter(Boolean).join(" ").trim(), detalle: motivo.slice(0, 300) || undefined }, { quien, origen: "panel" });
    return { ok: true };
}
