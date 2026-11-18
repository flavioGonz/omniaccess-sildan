import { prisma } from "@/lib/prisma";
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
    let unidad = await prisma.unit.findFirst({ where: { OR: [{ lot: s.lote }, { name: nombreUnidad }] }, select: { id: true, name: true } });
    if (!unidad) unidad = await prisma.unit.create({ data: { name: nombreUnidad, lot: s.lote, type: "CASA" }, select: { id: true, name: true } });

    // ── La persona ──
    const nombre = [s.nombre, s.apellido].filter(Boolean).join(" ").trim() || s.apellido;
    let persona = await prisma.user.findFirst({ where: { phone: s.telefono }, select: { id: true, name: true, observations: true } });
    const anotacion = [
        `Censo ${new Date(s.createdAt).toLocaleDateString("es-UY")}: ${s.tenencia === "INQUILINO" ? "inquilino" : "propietario"}.`,
        ...servicios.map((x) => `Servicio: ${lineaDeServicio(x)}`),
        s.comentario ? `Dijo: ${s.comentario}` : "",
    ].filter(Boolean).join("\n");

    if (persona) {
        await prisma.user.update({
            where: { id: persona.id },
            data: { unitId: unidad.id, email: s.email || undefined, observations: [persona.observations, anotacion].filter(Boolean).join("\n") },
        });
        avisos.push(`Ya existía ${persona.name} con ese teléfono: se le sumó el lote y lo que cargó.`);
    } else {
        persona = await prisma.user.create({
            data: { name: nombre, phone: s.telefono, email: s.email || null, unitId: unidad.id, role: "RESIDENT", observations: anotacion, createdBy: quien },
            select: { id: true, name: true, observations: true },
        });
    }

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
    return { ok: true, unidad: unidad.name, persona: persona.name, matriculas, avisos };
}

export async function rechazarSolicitud(id: string, quien: string, motivo: string): Promise<{ ok: boolean; error?: string }> {
    const s = await prisma.solicitudPadron.findUnique({ where: { id }, select: { estado: true } });
    if (!s) return { ok: false, error: "No existe esa carga." };
    if (s.estado !== "pendiente") return { ok: false, error: "Esa carga ya estaba resuelta." };
    await prisma.solicitudPadron.update({ where: { id }, data: { estado: "rechazada", revisadaPor: quien, revisadaAt: new Date(), nota: motivo.slice(0, 300) || null } });
    return { ok: true };
}
