"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/app/actions/auth";
import { esAdministrador, permisosDeSesion } from "@/lib/permisos";

/**
 * Ajustes › Merodeo: cuándo una matrícula que pasa varias veces se marca como merodeo
 * (bitácora, monitor y Telegram). Lo aplica checkMerodeo en server.js, que relee estos
 * valores cada 30 s: no hace falta reiniciar nada.
 */
export type AjustesMerodeo = { activo: boolean; pasadas: number; ventanaMin: number; agruparSeg: number; silencioMin: number; excluirResidentes: boolean };
const CLAVES = { activo: "MERODEO_ENABLED", pasadas: "MERODEO_THRESHOLD", ventanaMin: "MERODEO_WINDOW_MIN", agruparSeg: "MERODEO_GROUP_SEC", silencioMin: "MERODEO_COOLDOWN_MIN", excluirResidentes: "MERODEO_EXCLUDE_RESIDENTS" } as const;
const DEFECTO: AjustesMerodeo = { activo: true, pasadas: 4, ventanaMin: 30, agruparSeg: 120, silencioMin: 30, excluirResidentes: true };

async function sesion(admin: boolean) {
    const s: any = await getSession();
    if (!s) throw new Error("Hace falta una sesión del panel.");
    if (admin && !esAdministrador(permisosDeSesion(s))) throw new Error("Solo un administrador puede cambiar esto.");
}
function limpiar(a: Partial<AjustesMerodeo>): AjustesMerodeo {
    const n = (v: any, d: number, min: number, max: number) => { const x = Math.round(Number(v)); return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : d; };
    return {
        activo: a.activo !== false,
        pasadas: n(a.pasadas, DEFECTO.pasadas, 2, 50),
        ventanaMin: n(a.ventanaMin, DEFECTO.ventanaMin, 5, 720),
        agruparSeg: n(a.agruparSeg, DEFECTO.agruparSeg, 0, 900),
        silencioMin: n(a.silencioMin, DEFECTO.silencioMin, 0, 1440),
        excluirResidentes: a.excluirResidentes !== false,
    };
}

export async function getAjustesMerodeo(): Promise<AjustesMerodeo> {
    await sesion(false);
    const filas = await prisma.setting.findMany({ where: { key: { in: Object.values(CLAVES) } } });
    const m = Object.fromEntries(filas.map((f) => [f.key, f.value]));
    return limpiar({
        activo: m[CLAVES.activo] == null ? true : m[CLAVES.activo] === "true",
        pasadas: m[CLAVES.pasadas] ?? DEFECTO.pasadas, ventanaMin: m[CLAVES.ventanaMin] ?? DEFECTO.ventanaMin,
        agruparSeg: m[CLAVES.agruparSeg] ?? DEFECTO.agruparSeg, silencioMin: m[CLAVES.silencioMin] ?? DEFECTO.silencioMin,
        excluirResidentes: m[CLAVES.excluirResidentes] == null ? true : m[CLAVES.excluirResidentes] === "true",
    } as any);
}

export async function guardarAjustesMerodeo(a: AjustesMerodeo): Promise<{ ok: true; ajustes: AjustesMerodeo } | { ok: false; error: string }> {
    try { await sesion(true); } catch (e: any) { return { ok: false, error: e.message }; }
    const v = limpiar(a);
    await prisma.$transaction(Object.entries(CLAVES).map(([k, key]) => {
        const value = String((v as any)[k]);
        return prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
    }));
    return { ok: true, ajustes: v };
}

/**
 * Qué habría pasado en las últimas N horas con estos valores: cuántos avisos de merodeo y de qué
 * matrículas. Repite la misma cuenta que server.js (pasadas agrupadas, silencio por matrícula,
 * residentes afuera) sobre las lecturas reales, para calibrar antes de guardar.
 */
export async function simularMerodeo(a: AjustesMerodeo, horas = 24) {
    await sesion(false);
    const c = limpiar(a);
    const desde = new Date(Date.now() - horas * 3600_000 - c.ventanaMin * 60_000);
    const ev = await prisma.accessEvent.findMany({
        where: { accessType: "PLATE" as any, timestamp: { gte: desde }, plateDetected: { not: null } },
        select: { plateDetected: true, timestamp: true, decision: true, userId: true },
        orderBy: { timestamp: "asc" },
    });
    const inicio = Date.now() - horas * 3600_000;
    const porPlaca = new Map<string, number[]>();
    const silencio = new Map<string, number>();
    const avisos: { placa: string; hora: string; pasadas: number; lecturas: number }[] = [];
    let avisosLecturas = 0;
    const silencioLect = new Map<string, number>();
    for (const e of ev) {
        const placa = String(e.plateDetected || "").toUpperCase().trim();
        if (!placa || ["NO_LEIDA", "UNKNOWN", "S/P", "DOOR_OPEN", "DOOR_CLOSE"].includes(placa)) continue;
        const t = new Date(e.timestamp).getTime();
        const lista = porPlaca.get(placa) || []; lista.push(t); porPlaca.set(placa, lista);
        if (t < inicio || !c.activo) continue;
        if (c.excluirResidentes && e.decision === "GRANT" && e.userId) continue;
        const enVentana = lista.filter((x) => x >= t - c.ventanaMin * 60_000);
        // Cómo contaba antes (lecturas sueltas, umbral 3): para comparar.
        const ul = silencioLect.get(placa);
        if (enVentana.length >= 3 && !(ul && t - ul < 30 * 60_000)) { avisosLecturas++; silencioLect.set(placa, t); }
        const us = silencio.get(placa);
        if (us && t - us < c.silencioMin * 60_000) continue;
        let pasadas = 0, ultima = 0;
        for (const x of enVentana) { if (!ultima || x - ultima > c.agruparSeg * 1000) pasadas++; ultima = x; }
        if (pasadas < c.pasadas) continue;
        silencio.set(placa, t);
        avisos.push({ placa, hora: new Date(t).toISOString(), pasadas, lecturas: enVentana.length });
    }
    return { horas, total: avisos.length, matriculas: new Set(avisos.map((x) => x.placa)).size, antes: avisosLecturas, avisos: avisos.slice(-40).reverse() };
}
