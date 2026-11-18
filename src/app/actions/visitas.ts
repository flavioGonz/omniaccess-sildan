"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { leerGuardia } from "@/lib/sesion-guardia";
import { leerAjustesVisitas, olvidarAjustesVisitas, CLAVE_MODO, CLAVE_TIPOS, CLAVE_AVISOS, serializarAvisos, normalizarAjustes, type Ajustes } from "@/lib/visitas/ajustes";
import { abrirVisita, cerrarVisita, extenderVisita, atenderAviso, chapa, esChapa, visitaEnCurso, asignarLoteVisita, prorrogarSeguimiento } from "@/lib/visitas/registro";
import { esPaseLibre, NOMBRE_PASE_LIBRE } from "@/lib/visitas/ajustes-base";

/**
 * Las acciones de la consola del guardia y del panel sobre visitas y avisos.
 *
 * Exigen sesión con el permiso `guardia` (o `ajustes`), o un guardia identificado en la consola
 * con su PIN (cookie firmada, lib/sesion-guardia). El nombre que
 * queda como "registró / cerró / extendió / atendió" es el del guardia identificado en la
 * consola si lo manda, y si no el de la sesión: en la garita entra una sesión de puesto y el
 * que opera es el guardia que se identificó con su PIN.
 */

async function exigirGuardia(): Promise<string> {
    const s: any = await getSession();
    if (s) {
        const perms = permisosDeSesion(s);
        if (perms.includes("guardia") || perms.includes("ajustes")) return String(s.name || s.sub || "panel");
    }
    // La consola de la garita no tiene sesión del panel: vale el guardia identificado con su PIN.
    const guardia = await leerGuardia();
    if (guardia) return guardia;
    throw new Error(s ? "Tu rol no puede operar visitas." : "Identificate en la consola (Cambiar guardia) o iniciá sesión.");
}
const quien = (guardia: string | null | undefined, sesion: string) => (guardia && guardia.trim()) || sesion;

export type VisitaFila = {
    id: string; plate: string | null; tipo: string; tipoNombre: string; loteNombre: string | null; nombre: string | null; empresa: string | null;
    origen: string; registradaPor: string | null; entra: string; vence: string; sale: string | null; cierre: string | null; cerradaPor: string | null;
    minutosTipo: number; extensiones: number;
    /** Visita sin lote en seguimiento (change visita-sin-lote): hasta cuándo, y dónde se la vio. */
    seguimientoVence: string | null; vistoEn: string | null; vistoAt: string | null; foto: string | null; cierreMotivo: string | null;
};

async function forma(v: any): Promise<VisitaFila> {
    const aj = await leerAjustesVisitas();
    const t = aj.tipos.find((x) => x.clave === v.tipo);
    return {
        id: v.id, plate: v.plate, tipo: v.tipo, tipoNombre: t?.nombre || (esPaseLibre(v.tipo) ? NOMBRE_PASE_LIBRE : v.tipo), loteNombre: v.loteNombre, nombre: v.nombre, empresa: v.empresa,
        origen: v.origen, registradaPor: v.registradaPor, entra: v.entra.toISOString(), vence: v.vence.toISOString(), sale: v.sale ? v.sale.toISOString() : null,
        cierre: v.cierre, cerradaPor: v.cerradaPor, minutosTipo: esPaseLibre(v.tipo) ? 0 : t?.minutos ?? Math.round((v.vence - v.entra) / 60000), extensiones: Array.isArray(v.extensiones) ? v.extensiones.length : 0,
        seguimientoVence: v.seguimientoVence ? v.seguimientoVence.toISOString() : null, vistoEn: v.vistoEnCamara || null, vistoAt: v.vistoAdentroAt ? v.vistoAdentroAt.toISOString() : null,
        foto: v._foto || null, cierreMotivo: v.cierreMotivo || null,
    };
}

/** Los tipos activos y los lotes del barrio, para el formulario de la consola. */
export async function datosParaRegistrar() {
    await exigirGuardia();
    const aj = await leerAjustesVisitas();
    const unidades = await prisma.unit.findMany({ select: { id: true, name: true, number: true, lot: true, contactName: true }, orderBy: { name: "asc" } });
    // Orden natural: "Lote 2" antes que "Lote 10".
    unidades.sort((a, b) => a.name.localeCompare(b.name, "es", { numeric: true }));
    return {
        modo: aj.modo, tipos: aj.tipos.filter((t) => t.activo), sinLoteMin: aj.sinLoteMin, sinLoteProrrogaMin: aj.sinLoteProrrogaMin,
        // El titular, para buscar el lote por el nombre del residente («va a lo de Pérez»).
        lotes: unidades.map((u) => ({ id: u.id, nombre: u.name, numero: u.number || u.lot || null, titular: u.contactName || null })),
    };
}

export async function registrarVisita(d: { tipo: string; unitId?: string | null; plate?: string | null; nombre?: string | null; empresa?: string | null; guardia?: string | null }): Promise<{ ok: true; visita: VisitaFila } | { ok: false; error: string }> {
    try {
        const sesion = await exigirGuardia();
        const aj = await leerAjustesVisitas();
        const tipo = aj.tipos.find((t) => t.clave === d.tipo && t.activo);
        if (!tipo) return { ok: false, error: "Ese tipo de visita no existe o está desactivado." };
        const p = chapa(d.plate);
        if (d.plate && !esChapa(p)) return { ok: false, error: "La matrícula no es válida." };
        if (p) {
            const previa = await visitaEnCurso(p);
            if (previa) return { ok: false, error: `${p} ya tiene una visita en curso (${previa.loteNombre || "sin lote"}).` };
        }
        const unidad = d.unitId ? await prisma.unit.findUnique({ where: { id: d.unitId }, select: { id: true, name: true } }) : null;
        if (d.unitId && !unidad) return { ok: false, error: "Ese lote no existe." };
        const v = await abrirVisita({ plate: p, tipo: tipo.clave, minutos: tipo.minutos, unitId: unidad?.id || null, loteNombre: unidad?.name || null, nombre: d.nombre, empresa: d.empresa, origen: "GUARDIA", registradaPor: quien(d.guardia, sesion) });
        return { ok: true, visita: await forma(v) };
    } catch (e: any) { return { ok: false, error: e?.message || "No se pudo registrar" }; }
}

export async function cerrarVisitaAMano(id: string, guardia?: string | null) {
    try {
        const sesion = await exigirGuardia();
        const v = await cerrarVisita(id, { cierre: "GUARDIA", por: quien(guardia, sesion) });
        return v ? { ok: true as const } : { ok: false as const, error: "La visita ya estaba cerrada." };
    } catch (e: any) { return { ok: false as const, error: e?.message || "No se pudo cerrar" }; }
}

export async function extenderVisitaAMano(id: string, minutos: number, guardia?: string | null) {
    try {
        const sesion = await exigirGuardia();
        const m = Math.round(Number(minutos));
        if (!Number.isFinite(m) || m < 1 || m > 24 * 60) return { ok: false as const, error: "Minutos fuera de rango." };
        const v = await extenderVisita(id, m, quien(guardia, sesion));
        return v ? { ok: true as const, visita: await forma(v) } : { ok: false as const, error: "La visita ya estaba cerrada." };
    } catch (e: any) { return { ok: false as const, error: e?.message || "No se pudo extender" }; }
}

export async function visitasEnCurso(): Promise<VisitaFila[]> {
    await exigirGuardia();
    const filas: any[] = await prisma.visita.findMany({ where: { sale: null }, orderBy: { vence: "asc" }, take: 300 });
    // La foto de la lectura de entrada, para la tarjeta de seguimiento.
    const ids = filas.filter((v) => v.seguimientoVence && v.accessEventEntradaId).map((v) => v.accessEventEntradaId);
    if (ids.length) {
        const ev = await prisma.accessEvent.findMany({ where: { id: { in: ids } }, select: { id: true, imagePath: true, snapshotPath: true } }).catch(() => []);
        const m = new Map(ev.map((e) => [e.id, e.imagePath || e.snapshotPath || null]));
        for (const v of filas) if (v.accessEventEntradaId) v._foto = m.get(v.accessEventEntradaId) || null;
    }
    return Promise.all(filas.map(forma));
}

// ─────────────────── Visita sin lote, con seguimiento (change visita-sin-lote) ───────────────────

/** La última lectura de una cámara de Entrada (3 min), para precargar la matrícula en la tablet. */
export async function ultimaEntradaParaSeguimiento(): Promise<{ id: string; plate: string; foto: string | null; camara: string | null; ts: string } | null> {
    await exigirGuardia();
    const e = await prisma.accessEvent.findFirst({
        where: { direction: "ENTRY", isDuplicate: false, timestamp: { gte: new Date(Date.now() - 3 * 60_000) }, plateDetected: { not: null }, device: { deviceType: "LPR_CAMERA" as any } },
        orderBy: { timestamp: "desc" }, select: { id: true, plateDetected: true, imagePath: true, snapshotPath: true, timestamp: true, device: { select: { name: true } } },
    }).catch(() => null);
    const p = chapa(e?.plateDetected);
    if (!e || !esChapa(p)) return null;
    return { id: e.id, plate: p, foto: e.imagePath || e.snapshotPath || null, camara: e.device?.name || null, ts: e.timestamp.toISOString() };
}

export async function registrarVisitaSinLote(d: { tipo: string; plate?: string | null; nombre?: string | null; guardia?: string | null; accessEventId?: string | null }): Promise<{ ok: true; visita: VisitaFila } | { ok: false; error: string }> {
    try {
        const sesion = await exigirGuardia();
        const aj = await leerAjustesVisitas();
        const tipo = aj.tipos.find((t) => t.clave === d.tipo && t.activo);
        if (!tipo) return { ok: false, error: "Ese tipo de visita no existe o está desactivado." };
        const p = chapa(d.plate);
        if (d.plate && !esChapa(p)) return { ok: false, error: "La matrícula no es válida." };
        if (p) {
            const previa = await visitaEnCurso(p);
            if (previa) return { ok: false, error: `${p} ya tiene una visita en curso (${previa.loteNombre || "sin lote"}).` };
        }
        // La lectura de entrada sólo se enlaza si es de esa matrícula.
        let accessEventEntradaId: string | null = null;
        if (d.accessEventId && p) {
            const e = await prisma.accessEvent.findUnique({ where: { id: d.accessEventId }, select: { id: true, plateDetected: true } }).catch(() => null);
            if (e && chapa(e.plateDetected) === p) accessEventEntradaId = e.id;
        }
        // La visita no vence antes que el plazo para asignarle el lote.
        const minutos = Math.max(tipo.minutos, aj.sinLoteMin);
        const v = await abrirVisita({ plate: p, tipo: tipo.clave, minutos, nombre: d.nombre, origen: "GUARDIA", registradaPor: quien(d.guardia, sesion), seguimientoMin: aj.sinLoteMin, accessEventEntradaId });
        return { ok: true, visita: await forma(v) };
    } catch (e: any) { return { ok: false, error: e?.message || "No se pudo registrar" }; }
}

export async function asignarLoteAMano(id: string, unitId: string, guardia?: string | null) {
    try {
        const sesion = await exigirGuardia();
        const aj = await leerAjustesVisitas();
        const unidad = await prisma.unit.findUnique({ where: { id: unitId }, select: { id: true, name: true } });
        if (!unidad) return { ok: false as const, error: "Ese lote no existe." };
        const actual = await prisma.visita.findUnique({ where: { id }, select: { tipo: true } });
        const minutos = aj.tipos.find((t) => t.clave === actual?.tipo)?.minutos ?? 30;
        const v = await asignarLoteVisita(id, unidad, minutos, quien(guardia, sesion));
        return v ? { ok: true as const, visita: await forma(v) } : { ok: false as const, error: "La visita ya estaba cerrada." };
    } catch (e: any) { return { ok: false as const, error: e?.message || "No se pudo asignar el lote" }; }
}

export async function prorrogarSeguimientoAMano(id: string, guardia?: string | null) {
    try {
        const sesion = await exigirGuardia();
        const aj = await leerAjustesVisitas();
        const v = await prorrogarSeguimiento(id, aj.sinLoteProrrogaMin, quien(guardia, sesion));
        return v ? { ok: true as const, visita: await forma(v), minutos: aj.sinLoteProrrogaMin } : { ok: false as const, error: "La visita ya no está en seguimiento." };
    } catch (e: any) { return { ok: false as const, error: e?.message || "No se pudo prorrogar" }; }
}

const MOTIVOS_CIERRE = new Set(["SALIO_SIN_LOTE", "NO_INGRESO", "SE_EQUIVOCO", "OTRO"]);
export async function cerrarSinLoteAMano(id: string, motivo: string, guardia?: string | null) {
    try {
        const sesion = await exigirGuardia();
        const m = MOTIVOS_CIERRE.has(motivo) ? motivo : "OTRO";
        const v = await cerrarVisita(id, { cierre: "GUARDIA", por: quien(guardia, sesion), motivo: m });
        return v ? { ok: true as const } : { ok: false as const, error: "La visita ya estaba cerrada." };
    } catch (e: any) { return { ok: false as const, error: e?.message || "No se pudo cerrar" }; }
}

/** Las visitas de un día del barrio (por defecto hoy), abiertas o cerradas. */
export async function visitasDelDia(desdeISO?: string): Promise<VisitaFila[]> {
    await exigirGuardia();
    const desde = desdeISO ? new Date(desdeISO) : new Date(Date.now() - 24 * 3600_000);
    const filas = await prisma.visita.findMany({ where: { OR: [{ entra: { gte: desde } }, { sale: null }] }, orderBy: { entra: "desc" }, take: 1000 });
    return Promise.all(filas.map(forma));
}

export type AvisoFila = { id: string; tipo: string; plate: string | null; visitaId: string | null; camara: string | null; motivo: string; creado: string; atendidoPor: string | null; atendidoAt: string | null; nota: string | null };
const formaAviso = (a: any): AvisoFila => ({ id: a.id, tipo: a.tipo, plate: a.plate, visitaId: a.visitaId, camara: a.camara, motivo: a.motivo, creado: a.creado.toISOString(), atendidoPor: a.atendidoPor, atendidoAt: a.atendidoAt ? a.atendidoAt.toISOString() : null, nota: a.nota });

export async function avisosPendientes(): Promise<AvisoFila[]> {
    await exigirGuardia();
    return (await prisma.avisoGuardia.findMany({ where: { atendidoAt: null }, orderBy: { creado: "desc" }, take: 200 })).map(formaAviso);
}

export async function avisosDelDia(desdeISO?: string): Promise<AvisoFila[]> {
    await exigirGuardia();
    const desde = desdeISO ? new Date(desdeISO) : new Date(Date.now() - 24 * 3600_000);
    return (await prisma.avisoGuardia.findMany({ where: { OR: [{ creado: { gte: desde } }, { atendidoAt: null }] }, orderBy: { creado: "desc" }, take: 1000 })).map(formaAviso);
}

export async function atenderAvisoAMano(id: string, nota?: string | null, guardia?: string | null) {
    try {
        const sesion = await exigirGuardia();
        const a = await atenderAviso(id, quien(guardia, sesion), nota);
        return a ? { ok: true as const } : { ok: false as const, error: "Ya estaba atendido." };
    } catch (e: any) { return { ok: false as const, error: e?.message || "No se pudo atender" }; }
}

// ───────────────────────────── Ajustes ─────────────────────────────

export async function getAjustesVisitas(): Promise<Ajustes> {
    await exigirGuardia();
    return leerAjustesVisitas(true);
}

/** Guarda desde Ajustes → Visitas y patrones. Sólo `ajustes`: cambiar el modo cambia el barrio entero. */
export async function guardarAjustesVisitas(a: Ajustes): Promise<{ ok: true; ajustes: Ajustes } | { ok: false; error: string }> {
    try {
        const s: any = await getSession();
        if (!s || !permisosDeSesion(s).includes("ajustes")) return { ok: false, error: "Sólo quien tiene Ajustes puede cambiar esto." };
        // Se pasa por la misma validación que la lectura: lo que se guarda es lo que se va a leer.
        const limpio = normalizarAjustes({ modo: a.modo, tipos: JSON.stringify(a.tipos), avisos: serializarAvisos(a) });
        // Un tipo con visitas abiertas no se borra: se desactiva (spec "Tipos de visita").
        const enUso = await prisma.visita.findMany({ where: { sale: null }, distinct: ["tipo"], select: { tipo: true } });
        const faltan = enUso.map((v) => v.tipo).filter((t) => !limpio.tipos.some((x) => x.clave === t));
        if (faltan.length) return { ok: false, error: `No se puede borrar ${faltan.join(", ")}: tiene visitas en curso. Desactivalo.` };
        const upsert = (key: string, value: string) => prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
        await prisma.$transaction([upsert(CLAVE_MODO, limpio.modo), upsert(CLAVE_TIPOS, JSON.stringify(limpio.tipos)), upsert(CLAVE_AVISOS, serializarAvisos(limpio))]);
        olvidarAjustesVisitas();
        return { ok: true, ajustes: limpio };
    } catch (e: any) { return { ok: false, error: e?.message || "No se pudo guardar" }; }
}
