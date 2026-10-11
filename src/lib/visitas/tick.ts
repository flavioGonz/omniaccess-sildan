import { prisma } from "@/lib/prisma";
import { ZONA } from "@/lib/fechas";
import { leerAjustesVisitas } from "./ajustes";
import { TIPO_PASE_LIBRE } from "./ajustes-base";
import { enZona, aMinutos, duracion } from "./calculos";
import { motivo } from "./presentacion";
import { cerrarVisita, crearAviso } from "./registro";
import { recalcularPerfiles } from "./perfiles";

/**
 * Lo que depende del paso del tiempo y no de una lectura. Corre cada minuto (cron del CT):
 *  · visitas vencidas sin aviso → VISITA_EXCEDIDA (una sola vez por visita);
 *  · visitas con matrícula que superan el p90 de su perfil → PERMANENCIA_INUSUAL;
 *  · a la hora de corte, las visitas abiertas se cierran como FIN_DEL_DIA, sin aviso;
 *  · cada PERFILES_CADA_MIN minutos, los perfiles.
 */

/** Cada cuánto se recalculan los perfiles. Medido: la consulta tarda < 1 s con 25 mil lecturas. */
const PERFILES_CADA_MIN = 10;
let ultimoPerfil = 0;
/** El último día (del barrio) en que se hizo el cierre, para hacerlo una vez por día. */
let ultimoCorte = "";

export async function tick(opts: { forzarPerfiles?: boolean } = {}) {
    const aj = await leerAjustesVisitas(true);
    const ahora = new Date();
    const r = { excedidas: 0, permanencias: 0, cerradasFinDelDia: 0, perfiles: null as null | { matriculas: number; escritas: number; ms: number } };
    const nombreTipo = new Map(aj.tipos.map((t) => [t.clave, t]));

    // ── Excedidas ──
    if (aj.avisos.VISITA_EXCEDIDA.activo) {
        // El pase libre no vence: no se lo trae aunque haya pasado su vence técnico (ver PASE_LIBRE_HORAS).
        const vencidas = await prisma.visita.findMany({ where: { sale: null, vence: { lt: ahora }, avisadaExcedidaAt: null, tipo: { not: TIPO_PASE_LIBRE } }, take: 200 });
        for (const v of vencidas) {
            const tipo = nombreTipo.get(v.tipo);
            const minutos = Math.round((v.vence.getTime() - v.entra.getTime()) / 60_000);
            const aviso = await crearAviso({
                tipo: "VISITA_EXCEDIDA", plate: v.plate, visitaId: v.id,
                motivo: motivo.excedida({ tipoNombre: tipo?.nombre || v.tipo, lote: v.loteNombre, minutos, excedidoMin: Math.max(1, Math.round((ahora.getTime() - v.vence.getTime()) / 60_000)) }),
                datos: { tipo: v.tipo, lote: v.loteNombre, vence: v.vence },
            }, aj.antirreboteMin);
            await prisma.visita.update({ where: { id: v.id }, data: { avisadaExcedidaAt: ahora } }).catch(() => { });
            if (aviso) r.excedidas++;
        }
    }

    // ── Permanencia mayor a la habitual (sólo visitas con matrícula y perfil con p90) ──
    if (aj.avisos.PERMANENCIA_INUSUAL.activo) {
        const abiertas = await prisma.visita.findMany({ where: { sale: null, plate: { not: null } }, select: { id: true, plate: true, entra: true } });
        const perfiles = abiertas.length ? await prisma.perfilMatricula.findMany({ where: { plate: { in: abiertas.map((v) => v.plate!) }, permanenciaP90Min: { not: null } }, select: { plate: true, permanenciaP90Min: true } }) : [];
        const p90 = new Map(perfiles.map((p) => [p.plate, p.permanenciaP90Min!]));
        for (const v of abiertas) {
            const tope = p90.get(v.plate!);
            const lleva = (ahora.getTime() - v.entra.getTime()) / 60_000;
            if (tope && lleva > tope) {
                const a = await crearAviso({ tipo: "PERMANENCIA_INUSUAL", plate: v.plate, visitaId: v.id, motivo: motivo.permanencia({ lleva: duracion(lleva), p90: duracion(tope) }), datos: { llevaMin: Math.round(lleva), p90Min: tope } }, aj.antirreboteMin);
                if (a) r.permanencias++;
            }
        }
    }

    // ── Cierre del día ──
    const zona = enZona(ahora, ZONA);
    const dia = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA }).format(ahora);
    const corte = aMinutos(aj.horaCorte);
    // Desde la hora de corte hasta una hora después (por si el cron se saltea un minuto), una vez por día.
    if (zona.minuto >= corte && zona.minuto < corte + 60 && ultimoCorte !== dia) {
        ultimoCorte = dia;
        // Sólo las que entraron antes del corte de hoy: una visita registrada a las 05:10 no es de ayer.
        const desdeCorte = new Date(ahora.getTime() - (zona.minuto - corte) * 60_000);
        const viejas = await prisma.visita.findMany({ where: { sale: null, entra: { lt: desdeCorte } }, select: { id: true } });
        for (const v of viejas) if (await cerrarVisita(v.id, { cierre: "FIN_DEL_DIA", por: "sistema" })) r.cerradasFinDelDia++;
    }

    // ── Perfiles ──
    if (opts.forzarPerfiles || Date.now() - ultimoPerfil > PERFILES_CADA_MIN * 60_000) {
        ultimoPerfil = Date.now();
        r.perfiles = await recalcularPerfiles();
    }
    return r;
}
