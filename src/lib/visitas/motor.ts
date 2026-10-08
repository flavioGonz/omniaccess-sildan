import { prisma } from "@/lib/prisma";
import { ZONA } from "@/lib/fechas";
import { leerAjustesVisitas, TIPO_INVITACION } from "./ajustes";
import { enZona, fueraDeRutina, enFranja, describirRutina, hhmm, type Rutina } from "./calculos";
import { motivo } from "./presentacion";
import { chapa, esChapa, visitaEnCurso, abrirVisita, cerrarVisita, crearAviso, registradas } from "./registro";

/**
 * El motor de visitas y patrones: lo que se decide en el momento de cada lectura LPR.
 *
 * Se llama desde los dos únicos lugares por donde entran las lecturas a Next —la ruta
 * /api/notifications/event (las lectoras de server.js) y paso-por-acceso.ts (la cámara
 * interior)— y NUNCA puede frenar ni romper una lectura: corre aparte, con su propio
 * try/catch, y si falla queda en el log y nada más.
 *
 * Qué hace según la cámara:
 *  · SALIDA: si la matrícula tiene una visita en curso, la cierra.
 *  · ENTRADA: si trae una invitación vigente, le abre la visita; y mira los patrones (fuera de
 *    rutina, primera vez de noche, entró sin registrarse, da vueltas).
 *  · INTERIOR: marca la visita como vista adentro y cuenta para "da vueltas".
 * Lo que necesita el paso del tiempo (vencimientos, permanencias, cierre del día) lo hace el tick.
 */

export type Lectura = {
    modulo: string; evento: string; deviceId?: string | null; deviceName?: string | null;
    plate?: string | null; direction?: string | null; instante?: string | number | null;
    accessEventId?: string | null;
};

type Camara = "entrada" | "salida" | "interior";

/** Qué cámara es cada equipo: cambia cuando alguien edita un equipo, no en cada lectura. */
const CAMARAS_MS = 60_000;
let camaras: { mapa: Map<string, { tipo: Camara; nombre: string }>; hasta: number } | null = null;
async function camaraDe(deviceId: string | null | undefined, direccion: string | null | undefined): Promise<{ tipo: Camara; nombre: string | null }> {
    if (!camaras || camaras.hasta < Date.now()) {
        const devs = await prisma.device.findMany({ where: { deviceType: { in: ["LPR_CAMERA", "LPR_INTERIOR"] as any } }, select: { id: true, name: true, deviceType: true, direction: true } });
        camaras = { mapa: new Map(devs.map((d) => [d.id, { tipo: (d.deviceType === "LPR_INTERIOR" ? "interior" : d.direction === "EXIT" ? "salida" : "entrada") as Camara, nombre: d.name }])), hasta: Date.now() + CAMARAS_MS };
    }
    const c = deviceId ? camaras.mapa.get(deviceId) : null;
    if (c) return c;
    return { tipo: direccion === "EXIT" ? "salida" : "entrada", nombre: null };
}

/**
 * Lecturas de la misma matrícula separadas por menos que esto son UNA pasada (el auto frenado o
 * lento delante de la cámara). 2 min: más que una ráfaga, menos que dar la vuelta a una manzana.
 */
const PASADA_SEG = 120;

/** Las decisiones de una lectura que el motor procesa. "WATCHLIST" es un segundo aviso de la MISMA lectura. */
const EVENTOS_DE_LECTURA = new Set(["ALLOW", "DENY", "UNKNOWN"]);

export async function alLeerMatricula(l: Lectura): Promise<void> {
    try {
        if (l.modulo !== "LPR" || !EVENTOS_DE_LECTURA.has(String(l.evento).toUpperCase())) return;
        const plate = chapa(l.plate);
        if (!esChapa(plate)) return;
        const instante = l.instante != null && !Number.isNaN(new Date(l.instante as any).getTime()) ? new Date(l.instante as any) : new Date();
        const aj = await leerAjustesVisitas();
        const cam = await camaraDe(l.deviceId, l.direction);
        const camaraNombre = l.deviceName || cam.nombre;
        // server.js no manda el id de la lectura: se busca la que acaba de guardar.
        const accessEventId = l.accessEventId || (await prisma.accessEvent.findFirst({
            where: { plateDetected: { in: [plate, String(l.plate || "")] }, ...(l.deviceId ? { deviceId: l.deviceId } : {}), timestamp: { gte: new Date(instante.getTime() - 120_000) } },
            orderBy: { timestamp: "desc" }, select: { id: true },
        }).catch(() => null))?.id || null;

        const enCurso = await visitaEnCurso(plate);

        if (cam.tipo === "salida") {
            if (enCurso) await cerrarVisita(enCurso.id, { cierre: "CAMARA_SALIDA", accessEventId, sale: instante });
            return;
        }
        if (cam.tipo === "interior" && enCurso) {
            await prisma.visita.update({ where: { id: enCurso.id }, data: { vistoAdentroAt: instante } }).catch(() => { });
        }

        // Entrada con invitación vigente y sin visita: se abre sola, con el lote del pase.
        if (cam.tipo === "entrada" && !enCurso) {
            const inv = await prisma.guestPlate.findFirst({
                where: { plate, guest: { invitation: { status: "ACTIVE" as any, validFrom: { lte: instante }, validTo: { gte: instante } } } },
                select: { guest: { select: { name: true, invitation: { select: { id: true, hostName: true, hostLabel: true, hostUnitId: true, validTo: true } } } } },
            }).catch(() => null);
            if (inv) {
                const i = inv.guest.invitation;
                await abrirVisita({
                    plate, tipo: TIPO_INVITACION, minutos: 0, vence: i.validTo, entra: instante, origen: "INVITACION",
                    unitId: i.hostUnitId, loteNombre: i.hostLabel || null, nombre: inv.guest.name || null,
                    registradaPor: i.hostName ? `Invitación de ${i.hostName}` : "Invitación", invitationId: i.id, accessEventEntradaId: accessEventId,
                });
            }
        }

        // ── Patrones ──
        const [perfil, reg] = await Promise.all([
            prisma.perfilMatricula.findUnique({ where: { plate } }).catch(() => null),
            registradas([plate]),
        ]);
        const registrada = reg.has(plate) || !!enCurso;
        const zona = enZona(instante, ZONA);
        const hora = hhmm(zona.minuto);
        const ventana = aj.antirreboteMin;
        const rutina = (perfil?.rutina as Rutina | null) || null;

        if (cam.tipo === "entrada") {
            if (aj.avisos.FUERA_DE_RUTINA.activo && rutina && perfil?.clase !== "RESIDENTE") {
                const fuera = fueraDeRutina(rutina, zona, aj.avisos.FUERA_DE_RUTINA.margenMin);
                if (fuera) await crearAviso({ tipo: "FUERA_DE_RUTINA", plate, accessEventId, camara: camaraNombre, motivo: motivo.fueraDeRutina({ hora, rutina: describirRutina(rutina), por: fuera.por }), datos: { ...fuera, rutina } }, ventana);
            }
            if (aj.avisos.PRIMERA_VEZ_NOCHE.activo && !registrada && enFranja(zona.minuto, aj.avisos.PRIMERA_VEZ_NOCHE.desde, aj.avisos.PRIMERA_VEZ_NOCHE.hasta)) {
                // "Nunca vista": ninguna lectura anterior a esta. Se mira la base y no el perfil,
                // que se recalcula cada 10 min y no sabe de lo que pasó recién.
                const antes = await prisma.accessEvent.count({ where: { plateDetected: plate, timestamp: { lt: new Date(instante.getTime() - 60_000) } } }).catch(() => 1);
                if (antes === 0) await crearAviso({ tipo: "PRIMERA_VEZ_NOCHE", plate, accessEventId, camara: camaraNombre, motivo: motivo.primeraVezNoche({ hora, camara: camaraNombre }) }, ventana);
            }
            if (aj.modo === "ABIERTO" && aj.avisos.SIN_REGISTRAR.activo && !registrada) {
                await crearAviso({ tipo: "SIN_REGISTRAR", plate, accessEventId, camara: camaraNombre, motivo: motivo.sinRegistrar({ hora, camara: camaraNombre }) }, ventana);
            }
        }

        // "Da vueltas": lecturas en cualquier cámara LPR. No cuenta a residentes, visitas en
        // curso, rutinas ni frecuentes (vistos 4 días o más): un ómnibus que cruza el barrio
        // varias veces por hora se lee en Entrada y Salida y no está dando vueltas.
        const dv = aj.avisos.DA_VUELTAS;
        if (dv.activo && !registrada && !rutina && perfil?.clase !== "RESIDENTE" && perfil?.clase !== "FRECUENTE") {
            // Se cuentan PASADAS, no lecturas: un auto que frena delante de la cámara se lee cuatro
            // veces en un minuto (medido el 8/10: NAX6384, 4 lecturas en 72 s en Entrada) y eso no
            // es dar vueltas. Lecturas a menos de PASADA_SEG de la anterior son la misma pasada.
            const lecturas = await prisma.accessEvent.findMany({ where: { plateDetected: plate, timestamp: { gte: new Date(instante.getTime() - dv.minutos * 60_000) } }, select: { timestamp: true }, orderBy: { timestamp: "asc" } }).catch(() => []);
            let n = 0, anterior = 0;
            for (const x of lecturas) { const t = x.timestamp.getTime(); if (t - anterior > PASADA_SEG * 1000) n++; anterior = t; }
            if (n >= dv.lecturas) await crearAviso({ tipo: "DA_VUELTAS", plate, accessEventId, camara: camaraNombre, motivo: motivo.daVueltas({ lecturas: n, minutos: dv.minutos }), datos: { lecturas: n, minutos: dv.minutos } }, ventana);
        }
    } catch (e: any) {
        console.error("[visitas] no se pudo procesar la lectura:", e?.message || e);
    }
}
