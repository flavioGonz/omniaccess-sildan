import { prisma } from "@/lib/prisma";
import { avisarPorSocket } from "@/lib/avisar";
import { registrarGestion } from "@/lib/gestion-alarma";
import { leerArbolAreas } from "@/lib/areas-historial";
import { leerPrioridadesGuardadas } from "./prioridades-servidor";
import { claseDeAlarma, type Prioridades } from "./prioridades";
import {
    AJUSTE_CIERRES, AJUSTE_ESCALADO, AJUSTE_PROCEDIMIENTO, TEXTO_MINIMO,
    leerCierres, leerEscalado, leerProcedimiento, segATexto,
    type Cierre, type Escalado, type EventoCentral, type Procedimiento,
} from "./tratamiento-tipos";

/**
 * Los eventos de las centrales de alarma, de punta a punta (22/10, Nico: «tratar evento, obligando a
 * anotar algo; tomar el evento con mejor lógica de asignación y auditoría»; ver tratamiento-tipos).
 *
 * El evento es la alarma que crea alarm-receiver (Detection type CENTRAL) y su clave es la de toda la
 * gestión de alarmas, `d:<id>`: quién la tiene (AlarmaAtendida.operador), la bitácora (AlarmaGestion)
 * y cómo terminó (AlarmaAtendida.resultado/nota). Lo nuevo:
 *
 *  · EXCLUSIVO: sólo quien lo tiene lo trata o tilda pasos. Quitárselo a otro pide escribir por qué,
 *    y queda en la bitácora con el nombre del anterior. Tratar uno que nadie tomó lo toma primero.
 *  · TRATAR pide un cierre del catálogo y un texto (TEXTO_MINIMO). Es lo único que lo da por terminado:
 *    la intrusión de las cámaras ya no lo acepta (ackAlarms deja afuera a las de central).
 *  · PASOS del procedimiento de su prioridad, cada uno con hora y quién.
 *  · ESCALAR si nadie lo tomó o nadie lo trató a tiempo (lo corre la vuelta de salud, cada minuto).
 *  · TIEMPOS: cuánto tardó en tomarse y en tratarse, desde la hora del evento.
 */

export const ACCION_PASO = "PASO_PROC";
export const ACCION_DESPASO = "PASO_PROC_NO";
export const ACCION_TRATO = "TRATO";
export const ACCION_ESCALO = "ESCALO";
const ESCALO_TOMAR = "Nadie lo tomó";
const ESCALO_TRATAR = "Tomado y sin tratar";

export async function leerConfigTratamiento(): Promise<{ prioridades: Prioridades; cierres: Cierre[]; procedimiento: Procedimiento; escalado: Escalado }> {
    const filas = await prisma.setting.findMany({ where: { key: { in: [AJUSTE_CIERRES, AJUSTE_PROCEDIMIENTO, AJUSTE_ESCALADO] } } }).catch(() => []);
    const v = (k: string) => filas.find((f) => f.key === k)?.value;
    return { prioridades: await leerPrioridadesGuardadas(), cierres: leerCierres(v(AJUSTE_CIERRES)), procedimiento: leerProcedimiento(v(AJUSTE_PROCEDIMIENTO)), escalado: leerEscalado(v(AJUSTE_ESCALADO)) };
}

const TITULO: Record<string, string> = { ROBO: "Robo", PANICO: "Pánico", COACCION: "Coacción", INCENDIO: "Incendio", MEDICA: "Emergencia médica", SABOTAJE: "Sabotaje", GAS: "Gas", AGUA: "Pérdida de agua", TEMPERATURA: "Temperatura", GENERAL: "Alarma" };
const detallesDe = (s: string | null) => { try { return JSON.parse(s || "{}") || {}; } catch { return {}; } };

type Det = { id: string; deviceId: string | null; eventType: string | null; label: string | null; timestamp: Date; details: string | null; acknowledged: boolean; ackKind: string | null };

/** Arma la vista de varios eventos con lo que hace falta leer una sola vez. */
async function armar(dets: Det[], yo: string | null): Promise<EventoCentral[]> {
    if (!dets.length) return [];
    const claves = dets.map((d) => `d:${d.id}`);
    const devIds = [...new Set(dets.map((d) => d.deviceId).filter(Boolean))] as string[];
    const [centrales, atendidas, gestion, arbol, prioridades, cfg] = await Promise.all([
        prisma.centralAlarma.findMany({ where: { deviceId: { in: devIds } }, select: { id: true, deviceId: true, cuenta: true, prueba: true, device: { select: { name: true } }, zonas: { select: { zona: true, nombre: true, camaras: true, areaId: true } } } }),
        prisma.alarmaAtendida.findMany({ where: { clave: { in: claves } } }),
        prisma.alarmaGestion.findMany({ where: { clave: { in: claves } }, orderBy: { ts: "asc" } }),
        leerArbolAreas().catch(() => ({ areas: [], equipoArea: {} as Record<string, string> })),
        leerPrioridadesGuardadas(),
        leerConfigTratamiento(),
    ]);
    // «Cierre — texto»: el cierre puede llevar su propio « — » («Usuario probando — Falsa alarma»), así
    // que se reconoce por el catálogo (el más largo que calce) y no cortando en el primer guion.
    const separar = (detalle: string): [string, string | null] => {
        const c = [...cfg.cierres].sort((a, b) => b.texto.length - a.texto.length).find((x) => detalle === x.texto || detalle.startsWith(`${x.texto} — `));
        if (c) return [c.texto, detalle.slice(c.texto.length + 3) || null];
        const i = detalle.lastIndexOf(" — ");
        return i > 0 ? [detalle.slice(0, i), detalle.slice(i + 3)] : [detalle, null];
    };
    const porDev = new Map(centrales.map((c) => [c.deviceId, c]));
    const nombreArea = new Map(arbol.areas.map((a) => [a.id, a.nombre]));
    return dets.map((d) => {
        const clave = `d:${d.id}`;
        const x = detallesDe(d.details);
        const c = d.deviceId ? porDev.get(d.deviceId) : undefined;
        const z = x.zona != null ? c?.zonas.find((q) => q.zona === Number(x.zona)) : undefined;
        const at = atendidas.find((a) => a.clave === clave);
        const pasosG = gestion.filter((g) => g.clave === clave);
        const pasos: EventoCentral["pasos"] = {};
        for (const g of pasosG) {
            if (g.accion === ACCION_PASO && g.detalle) pasos[g.detalle] = { por: g.por, ts: g.ts.toISOString() };
            if (g.accion === ACCION_DESPASO && g.detalle) delete pasos[g.detalle];
        }
        const primeraToma = pasosG.find((g) => g.accion === "TOMO");
        const trato = [...pasosG].reverse().find((g) => g.accion === ACCION_TRATO);
        const escalo = [...pasosG].reverse().find((g) => g.accion === ACCION_ESCALO);
        const t0 = d.timestamp.getTime();
        const areaId = (z?.areaId as string | null) || x.areaId || (d.deviceId ? arbol.equipoArea[d.deviceId] : null) || null;
        const [cierre, textoTrato] = separar(trato?.detalle || "");
        return {
            id: d.id, clave, ts: d.timestamp.toISOString(), tipo: d.eventType || "GENERAL",
            titulo: `${TITULO[d.eventType || ""] || "Alarma"}${x.zona ? ` · Zona ${x.zona}${z?.nombre ? ` · ${z.nombre}` : ""}` : ""}`,
            prioridad: prioridades[claseDeAlarma(d.eventType)],
            central: { id: c?.id || "", deviceId: d.deviceId || "", nombre: c?.device?.name || x.central || "Central", cuenta: c?.cuenta || x.cuenta || "", prueba: !!c?.prueba },
            zona: x.zona != null ? { zona: Number(x.zona), nombre: z?.nombre || null, camaras: ((z?.camaras as string[] | undefined) || x.camaras || []).map(String) } : null,
            particion: x.particion ?? null, area: areaId ? nombreArea.get(areaId) || null : null,
            operador: { nombre: at?.operador || null, desde: at?.operadorDesde?.toISOString() || null, soyYo: !!yo && at?.operador === yo },
            tratado: d.acknowledged ? { por: trato?.por || at?.por || null, ts: (trato?.ts || at?.ts || d.timestamp).toISOString(), cierre: trato ? cierre : at?.nota || (d.ackKind === "false" ? "Falsa alarma" : "Aceptada sin tratar"), resultado: at?.resultado || (d.ackKind === "false" ? "falsa" : d.ackKind ? "real" : null), texto: trato ? textoTrato : null } : null,
            pasos, escalado: escalo && !d.acknowledged ? escalo.detalle : null,
            tiempos: {
                tomarSeg: primeraToma ? Math.max(0, Math.round((primeraToma.ts.getTime() - t0) / 1000)) : null,
                tratarSeg: trato ? Math.max(0, Math.round((trato.ts.getTime() - t0) / 1000)) : null,
            },
        };
    });
}

const SELECT_DET = { id: true, deviceId: true, eventType: true, label: true, timestamp: true, details: true, acknowledged: true, ackKind: true } as const;

/** Los eventos de central sin tratar de las últimas `horas` (por defecto un día). */
export async function eventosPendientes(yo: string | null, horas = 24): Promise<EventoCentral[]> {
    const dets = await prisma.detection.findMany({ where: { type: "CENTRAL", acknowledged: false, timestamp: { gte: new Date(Date.now() - horas * 3600_000) } }, orderBy: { timestamp: "desc" }, take: 100, select: SELECT_DET });
    const evs = await armar(dets, yo);
    return evs.sort((a, b) => a.prioridad - b.prioridad || (a.ts < b.ts ? 1 : -1));
}

/** Un evento, con lo que pasaba en su central alrededor (armados, restauraciones, otras zonas). */
export async function eventoCentral(id: string, yo: string | null) {
    const d = await prisma.detection.findFirst({ where: { id, type: "CENTRAL" }, select: SELECT_DET });
    if (!d) return null;
    const [ev] = await armar([d], yo);
    const t = d.timestamp.getTime();
    const contexto = ev.central.id ? await prisma.mensajeCentral.findMany({
        where: { centralId: ev.central.id, recibido: { gte: new Date(t - 30 * 60_000), lte: new Date(t + 30 * 60_000) }, error: null, NOT: { idMensaje: "NULL" } },
        orderBy: { recibido: "asc" }, take: 60, select: { id: true, recibido: true, eventos: true, detectionId: true },
    }) : [];
    return {
        evento: ev,
        contexto: contexto.map((m) => ({ id: m.id, ts: m.recibido.toISOString(), eventos: (Array.isArray(m.eventos) ? m.eventos : []) as any[], esEste: m.detectionId === d.id })),
    };
}

type Resultado = { ok: true } | { ok: false, error: string, status?: number };
const no = (error: string, status = 400): Resultado => ({ ok: false, error, status });

async function pendiente(id: string) {
    return prisma.detection.findFirst({ where: { id, type: "CENTRAL" }, select: { id: true, deviceId: true, acknowledged: true } });
}

/** Tomarlo. Si lo tiene otro, hace falta `motivo`: queda en la bitácora con el nombre del anterior. */
export async function tomarEvento(id: string, por: string, motivo?: string | null): Promise<Resultado> {
    const d = await pendiente(id);
    if (!d) return no("No existe ese evento", 404);
    if (d.acknowledged) return no("Ese evento ya se trató.", 409);
    const clave = `d:${id}`;
    const previa = await prisma.alarmaAtendida.findUnique({ where: { clave }, select: { operador: true } });
    if (previa?.operador === por) return { ok: true };
    const m = String(motivo || "").trim();
    if (previa?.operador && m.length < 4) return no(`Lo tiene ${previa.operador}. Para quitárselo, escribí por qué.`, 409);
    const ahora = new Date();
    await prisma.alarmaAtendida.upsert({ where: { clave }, update: { operador: por, operadorDesde: ahora }, create: { clave, atendida: false, operador: por, operadorDesde: ahora, por } });
    await registrarGestion(clave, "TOMO", por, { deviceId: d.deviceId, detalle: previa?.operador ? `se lo quitó a ${previa.operador}: «${m.slice(0, 300)}»` : null });
    return { ok: true };
}

export async function pasarEvento(id: string, por: string, nota?: string | null): Promise<Resultado> {
    const d = await pendiente(id);
    if (!d) return no("No existe ese evento", 404);
    const clave = `d:${id}`;
    const a = await prisma.alarmaAtendida.findUnique({ where: { clave }, select: { operador: true } });
    if (a?.operador !== por) return no("Sólo lo puede pasar quien lo tiene.", 409);
    await prisma.alarmaAtendida.update({ where: { clave }, data: { operador: null, operadorDesde: null } });
    await registrarGestion(clave, "PASO", por, { deviceId: d.deviceId, detalle: String(nota || "").trim().slice(0, 500) || null });
    return { ok: true };
}

export async function marcarPaso(id: string, por: string, paso: string, hecho: boolean): Promise<Resultado> {
    const d = await pendiente(id);
    if (!d) return no("No existe ese evento", 404);
    if (d.acknowledged) return no("Ese evento ya se trató.", 409);
    const a = await prisma.alarmaAtendida.findUnique({ where: { clave: `d:${id}` }, select: { operador: true } });
    if (a?.operador !== por) return no(a?.operador ? `Lo tiene ${a.operador}: tomalo para seguir el procedimiento.` : "Tomalo primero.", 409);
    const p = String(paso || "").trim().slice(0, 100);
    if (!p) return no("Falta el paso.");
    await registrarGestion(`d:${id}`, (hecho ? ACCION_PASO : ACCION_DESPASO) as any, por, { deviceId: d.deviceId, detalle: p });
    return { ok: true };
}

/**
 * Tratarlo: un cierre del catálogo y un texto que diga algo. Si nadie lo tenía, lo toma; si lo tiene
 * otro, no (primero hay que quitárselo, con motivo). Lo da por terminado en todas las pantallas.
 */
export async function tratarEvento(id: string, por: string, cierreId: string, texto: string): Promise<Resultado> {
    const d = await pendiente(id);
    if (!d) return no("No existe ese evento", 404);
    if (d.acknowledged) return no("Ese evento ya se trató.", 409);
    const { cierres } = await leerConfigTratamiento();
    const cierre = cierres.find((c) => c.id === cierreId && c.activo);
    if (!cierre) return no("Elegí cómo se cerró.");
    const t = String(texto || "").trim();
    if (t.length < TEXTO_MINIMO) return no(`Contá qué se hizo (al menos ${TEXTO_MINIMO} letras).`);
    const clave = `d:${id}`;
    const a = await prisma.alarmaAtendida.findUnique({ where: { clave }, select: { operador: true } });
    if (a?.operador && a.operador !== por) return no(`Lo tiene ${a.operador}. Para tratarlo, primero quitáselo (con motivo).`, 409);
    if (!a?.operador) { const r = await tomarEvento(id, por); if (!r.ok) return r; }
    const ahora = new Date();
    await prisma.detection.update({ where: { id }, data: { acknowledged: true, ackKind: cierre.resultado === "falsa" ? "false" : "real", ackAt: ahora } });
    await prisma.alarmaAtendida.update({ where: { clave }, data: { atendida: true, resultado: cierre.resultado === "otro" ? null : cierre.resultado, nota: `${cierre.texto} — ${t.slice(0, 1000)}`, por, ts: ahora, operador: null, operadorDesde: null } });
    await registrarGestion(clave, ACCION_TRATO as any, por, { deviceId: d.deviceId, detalle: `${cierre.texto} — ${t.slice(0, 400)}` });
    avisarPorSocket("alarma_atendida", { id: clave, resultado: cierre.resultado === "otro" ? undefined : cierre.resultado, por });
    avisarPorSocket("central_tratado", { id, por });
    return { ok: true };
}

/**
 * Escalar (cada minuto, desde la vuelta de salud). Una vez por motivo y por evento: si nadie lo tomó en
 * `tomarMin`, y si quien lo tomó no lo trató en `tratarMin`. Avisa a las reglas de notificación (evento
 * CENTRAL_ESCALADO: quien quiera recibirlo arma su regla) y a las pantallas. Una central de prueba no escala.
 */
export async function evaluarEscalado(): Promise<number> {
    const { escalado: e } = await leerConfigTratamiento();
    if (!e.escalarHasta) return 0;
    const evs = (await eventosPendientes(null, 6)).filter((x) => x.prioridad <= e.escalarHasta && !x.central.prueba);
    if (!evs.length) return 0;
    const ya = await prisma.alarmaGestion.findMany({ where: { clave: { in: evs.map((x) => x.clave) }, accion: ACCION_ESCALO }, select: { clave: true, detalle: true } });
    const hecho = (clave: string, motivo: string) => ya.some((y) => y.clave === clave && (y.detalle || "").startsWith(motivo));
    const { notificarEvento } = await import("@/lib/reglas-notificacion");
    let n = 0;
    for (const x of evs) {
        const edad = (Date.now() - new Date(x.ts).getTime()) / 60_000;
        let motivo: string | null = null;
        if (!x.operador.nombre && edad >= e.tomarMin && !hecho(x.clave, ESCALO_TOMAR)) motivo = `${ESCALO_TOMAR} en ${e.tomarMin} min`;
        else if (x.operador.nombre && x.operador.desde && (Date.now() - new Date(x.operador.desde).getTime()) / 60_000 >= e.tratarMin && !hecho(x.clave, ESCALO_TRATAR)) motivo = `${ESCALO_TRATAR}: lo tiene ${x.operador.nombre} hace ${segATexto((Date.now() - new Date(x.operador.desde).getTime()) / 1000)}`;
        if (!motivo) continue;
        await registrarGestion(x.clave, ACCION_ESCALO as any, null, { deviceId: x.central.deviceId, detalle: motivo });
        avisarPorSocket("central_escalado", { id: x.id, motivo });
        await notificarEvento({ modulo: "INTRUSION", evento: "CENTRAL_ESCALADO", deviceId: x.central.deviceId, deviceName: `${x.central.nombre} · ${x.titulo}`, extra: { eventType: x.tipo, motivo, prioridad: x.prioridad, detectionId: x.id } } as any).catch(() => null);
        n++;
    }
    return n;
}

/** Tiempos por operador en las últimas `horas`: cuántos trató, en cuánto los tomó y en cuánto los cerró (medianas). */
export async function informeTiempos(horas = 168) {
    const dets = await prisma.detection.findMany({ where: { type: "CENTRAL", timestamp: { gte: new Date(Date.now() - horas * 3600_000) } }, orderBy: { timestamp: "desc" }, take: 2000, select: SELECT_DET });
    const evs = await armar(dets, null);
    const mediana = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
    const porOp = new Map<string, { tratados: number; reales: number; falsas: number; tomar: number[]; tratar: number[] }>();
    for (const x of evs) {
        if (!x.tratado) continue;
        // Las aceptadas antes del 22/10 desde la ventana de intrusión no tienen tratamiento ni nombre.
        const k = x.tratado.por || "Aceptadas sin tratar (antes del 22/10)";
        const o = porOp.get(k) || { tratados: 0, reales: 0, falsas: 0, tomar: [], tratar: [] };
        o.tratados++; if (x.tratado.resultado === "real") o.reales++; if (x.tratado.resultado === "falsa") o.falsas++;
        if (x.tiempos.tomarSeg != null) o.tomar.push(x.tiempos.tomarSeg);
        if (x.tiempos.tratarSeg != null) o.tratar.push(x.tiempos.tratarSeg);
        porOp.set(k, o);
    }
    return {
        total: evs.length, sinTratar: evs.filter((x) => !x.tratado).length,
        operadores: [...porOp.entries()].map(([nombre, o]) => ({ nombre, tratados: o.tratados, reales: o.reales, falsas: o.falsas, tomarSeg: mediana(o.tomar), tratarSeg: mediana(o.tratar) })).sort((a, b) => b.tratados - a.tratados),
    };
}
