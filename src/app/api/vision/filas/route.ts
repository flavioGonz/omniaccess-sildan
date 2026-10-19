import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse, forbiddenResponse } from "@/lib/api-auth";
import { leerAjuste } from "@/lib/ajustes-db";
import { leerInterruptores } from "@/lib/vision";
import { camarasVision } from "@/lib/vision-camaras";
import { CLAVE_REGLAS, FILA, bandaFila, enHorario, validarReglas, type ReglaVision } from "@/lib/vision-reglas";

export const dynamic = "force-dynamic";

/**
 * GET /api/vision/filas — las filas de OmniVision (reglas «Conteo de fila»), como las muestra el
 * modo Filas para las cámaras Bosch, pero leídas de lo que escribe vision-reglas.js en EventoVision:
 *  · el aforo ahora y su banda contra el límite (bien < 70 % ≤ aviso < 100 % ≤ llena);
 *  · la curva del día, el máximo, las entradas y salidas desde que abrió, y por hora;
 *  · la espera estimada, con la cuenta del kiosco de Filas: aforo × (15 min ÷ salidas de los
 *    últimos 15 min);
 *  · los avisos de fila llena y de supervisor, con su foto.
 * «Desde que abrió»: con horario de atención, desde la última apertura (el reinicio del modo Filas
 * al abrir); sin horario, desde la medianoche.
 */
const ZONA = "America/Montevideo";
/** Uruguay no tiene horario de verano desde 2015: el corrimiento es fijo. */
const CORRIMIENTO = "-03:00";
const VENTANA_ESPERA_MIN = 15;
/** La espera medida: cuánto estuvieron adentro los que salieron en esta ventana (mediana). */
const VENTANA_MEDIDA_MIN = 30;
const SERIE_MAX = 3000;
const AVISOS_MAX = 12;
const AVISOS_DIAS = 7;

function ahoraLocal(d = new Date()) {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
        .formatToParts(d).map((x) => [x.type, x.value]));
    return { dia: `${p.year}-${p.month}-${p.day}`, minuto: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}

/** Desde cuándo se cuentan las entradas y salidas: la última apertura, o la medianoche. */
function inicioDe(r: ReglaVision, ahora: Date): Date {
    const { dia, minuto } = ahoraLocal(ahora);
    if (!r.horario) return new Date(`${dia}T00:00:00${CORRIMIENTO}`);
    const [h, m] = r.horario.desde.split(":").map(Number);
    const hoy = new Date(`${dia}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00${CORRIMIENTO}`);
    return minuto >= h * 60 + m ? hoy : new Date(hoy.getTime() - 86_400_000);
}

/** EventoVision.ts es un timestamp sin zona (UTC): en SQL crudo se compara así, como en Reglas. */
const sinZona = (d: Date) => d.toISOString().replace("T", " ").replace("Z", "");

export async function GET() {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    if (auth.pantalla) return forbiddenResponse("No es una vista de pantalla.");
    const [crudo, inter, enVision] = await Promise.all([leerAjuste(CLAVE_REGLAS), leerInterruptores().catch(() => null), camarasVision()]);
    let reglas: ReglaVision[] = [];
    try { reglas = validarReglas(JSON.parse(crudo?.value || "[]")).reglas.filter((r) => r.tipo === "fila"); } catch { reglas = []; }
    const prendida = inter?.analiticas?.fila !== false;
    const ahora = new Date();
    const { minuto } = ahoraLocal(ahora);
    const desdeEspera = new Date(ahora.getTime() - VENTANA_ESPERA_MIN * 60_000);
    const desdeAvisos = new Date(ahora.getTime() - AVISOS_DIAS * 86_400_000);

    const filas = await Promise.all(reglas.map(async (r) => {
        const inicio = inicioDe(r, ahora);
        const [ultimo, previo, serie, flujo, salidasRecientes, avisos, estadias] = await Promise.all([
            prisma.eventoVision.findFirst({ where: { reglaId: r.id, tipo: "FILA" }, orderBy: { ts: "desc" }, select: { valor: true, ts: true } }),
            prisma.eventoVision.findFirst({ where: { reglaId: r.id, tipo: "FILA", ts: { lt: inicio } }, orderBy: { ts: "desc" }, select: { valor: true } }),
            prisma.eventoVision.findMany({ where: { reglaId: r.id, tipo: "FILA", ts: { gte: inicio } }, orderBy: { ts: "asc" }, select: { valor: true, ts: true }, take: SERIE_MAX }),
            prisma.$queryRaw<{ h: number; tipo: string; n: number }[]>`
                SELECT extract(hour FROM ts AT TIME ZONE 'UTC' AT TIME ZONE ${ZONA})::int AS h, tipo, count(*)::int AS n
                  FROM "EventoVision" WHERE "reglaId" = ${r.id} AND tipo IN ('FILA_ENTRA', 'FILA_SALE') AND ts >= ${sinZona(inicio)}::timestamp GROUP BY 1, 2`.catch(() => []),
            prisma.eventoVision.count({ where: { reglaId: r.id, tipo: "FILA_SALE", ts: { gte: desdeEspera } } }),
            prisma.eventoVision.findMany({ where: { reglaId: r.id, tipo: { in: ["FILA_LLENA", "FILA_ESCALADA"] }, ts: { gte: desdeAvisos } }, orderBy: { ts: "desc" }, take: AVISOS_MAX, select: { id: true, tipo: true, valor: true, foto: true, ts: true, avisoId: true } }),
            prisma.eventoVision.findMany({ where: { reglaId: r.id, tipo: "FILA_SALE", valor: { not: null }, ts: { gte: new Date(ahora.getTime() - VENTANA_MEDIDA_MIN * 60_000) } }, select: { valor: true } }),
        ]);
        const aforo = Math.round(ultimo?.valor ?? 0);
        const limite = r.maximo ?? null;
        const porHora = Array.from({ length: 24 }, () => ({ entran: 0, salen: 0 }));
        let entradas = 0, salidas = 0;
        for (const x of flujo as any[]) {
            if (x.h < 0 || x.h > 23) continue;
            if (x.tipo === "FILA_ENTRA") { porHora[x.h].entran += x.n; entradas += x.n; } else { porHora[x.h].salen += x.n; salidas += x.n; }
        }
        const valores = serie.map((s) => Math.round(s.valor ?? 0));
        const puntos = [{ t: inicio.getTime(), v: Math.round(previo?.valor ?? 0) }, ...serie.map((s) => ({ t: s.ts.getTime(), v: Math.round(s.valor ?? 0) }))];
        // Desde cuándo está llena: el comienzo de la racha actual en el límite o más.
        let llenaDesde: string | null = null;
        if (limite && aforo >= limite) {
            let k = puntos.length - 1;
            while (k > 0 && puntos[k - 1].v >= limite) k--;
            llenaDesde = new Date(Math.max(puntos[k].t, inicio.getTime())).toISOString();
        }
        // El aforo por hora, como los reportes de Filas: el promedio pesado por el tiempo y el máximo.
        const aforoPorHora = Array.from({ length: 24 }, () => ({ suma: 0, ms: 0, max: 0 }));
        const horaDe = (ms: number) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: ZONA, hour: "2-digit", hour12: false }).format(ms)) % 24;
        for (let k = 0; k < puntos.length; k++) {
            let a = puntos[k].t;
            const b = k + 1 < puntos.length ? puntos[k + 1].t : ahora.getTime(), v = puntos[k].v;
            while (a < b) {
                // Se corta en cada hora en punto para repartir el tramo entre las horas que pisa.
                const fin = Math.min(b, (Math.floor(a / 3_600_000) + 1) * 3_600_000);
                const h = aforoPorHora[horaDe(a)];
                h.suma += v * (fin - a); h.ms += fin - a; h.max = Math.max(h.max, v);
                a = fin;
            }
        }
        const medidas = estadias.map((e) => e.valor as number).filter((v) => v > 0).sort((a, b) => a - b);
        return {
            id: r.id, nombre: r.nombre, deviceId: r.deviceId, activa: r.activa, analiza: enVision.todas || enVision.ids.has(r.deviceId),
            zona: r.zona, limite, rebote: r.rebote ?? FILA.rebote.defecto, escalarMin: r.escalarMin ?? FILA.escalarMin.defecto, enfrioMin: r.enfrioMin ?? FILA.enfrioMin.defecto,
            avisar: r.avisar, horario: r.horario ?? null, abierta: enHorario(r.horario ?? null, minuto), inicio: inicio.toISOString(),
            aforo, desde: ultimo?.ts.toISOString() ?? null, banda: bandaFila(aforo, limite),
            maximo: Math.max(aforo, previo?.valor ?? 0, ...valores, 0),
            entradas, salidas, porHora, llenaDesde, permanencia: r.permanencia ?? FILA.permanencia.defecto,
            aforoPorHora: aforoPorHora.map((h) => (h.ms ? { prom: Math.round((h.suma / h.ms) * 10) / 10, max: h.max } : null)),
            // La espera medida: la mediana de cuánto estuvieron adentro los que salieron hace poco.
            esperaMedidaMin: medidas.length >= 3 ? Math.round((medidas[Math.floor(medidas.length / 2)] / 60) * 10) / 10 : null, esperaMedidaN: medidas.length,
            // Sin salidas en los últimos 15 min no se puede estimar: la fila no avanza (o no se ve).
            esperaMin: salidasRecientes > 0 ? Math.round(aforo * (VENTANA_ESPERA_MIN / salidasRecientes)) : null,
            serie: [{ t: inicio.toISOString(), v: Math.round(previo?.valor ?? 0) }, ...serie.map((s) => ({ t: s.ts.toISOString(), v: Math.round(s.valor ?? 0) }))],
            avisos: avisos.map((a) => ({ id: a.id, tipo: a.tipo, valor: a.valor, ts: a.ts.toISOString(), foto: a.foto ? `/api/vision/imagen/${a.foto}` : null })),
        };
    }));
    const nombres = new Map((await prisma.device.findMany({ where: { id: { in: reglas.map((r) => r.deviceId) } }, select: { id: true, name: true } })).map((d) => [d.id, d.name]));
    return NextResponse.json({
        prendida, ventanaEsperaMin: VENTANA_ESPERA_MIN, ventanaMedidaMin: VENTANA_MEDIDA_MIN,
        filas: filas.map((f) => ({ ...f, camara: nombres.get(f.deviceId) || f.deviceId })),
    }, { headers: { "Cache-Control": "no-store" } });
}
