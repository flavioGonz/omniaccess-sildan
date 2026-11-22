import { SATS_MIN } from "@/lib/gps-recorrido";
import { viajesYParadas, type Viaje } from "@/lib/gps-viajes";
import { excesosDe, jornadaDe } from "@/lib/gps-jornada";
import { aplicaA, dentroDe, enHorario, type FormaDeCerca, type HorarioCerca } from "@/lib/gps-geocerca";
import { demoraLegible, tituloDeEventoGps } from "@/lib/gps-eventos";
import { IDIOMA, ZONA } from "@/lib/fechas";
import { REPORTES_GPS, type Celda, type ClaveReporte, type Columna, type Lugar, type TablaReporte, type TotalesDeReporte } from "@/lib/gps-reportes-catalogo";

/**
 * La cuenta de los reportes de rastreo (22/11). Pura: entra lo que reportó cada vehículo, salen
 * tablas. Sin base ni pantalla, así se prueba con datos inventados.
 *
 * Tres decisiones que ordenan todo lo demás:
 *
 *  · **Los números son los de la pantalla.** Viajes, kilómetros y excesos salen de las mismas
 *    cuentas que el recorrido del mapa (gps-viajes, gps-jornada). Un reporte que dijera 41 km donde
 *    el mapa dijo 37 obligaría a explicar cuál de los dos miente.
 *
 *  · **Se suma de a un vehículo.** Un mes de un rastreador son cientos de miles de posiciones;
 *    treinta rastreadores a la vez no entran en memoria. El informe se arma como un acumulador:
 *    `sumar(vehículo)` deja sus filas y suelta sus posiciones.
 *
 *  · **Lo que no se sabe, se dice.** Un equipo sin el cable de contacto conectado no tiene horas
 *    de motor: la tabla lo avisa en vez de mostrar ceros que parecen un dato.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports -- el lugar en palabras lo dice el mismo archivo que usa el receptor
const { lugarDe } = require("../../lib-gps-eventos.js") as { lugarDe(lat: number, lon: number, cercas: (FormaDeCerca & { nombre: string })[]): string | null };

export type PuntoRep = { lat: number; lon: number; cuando: string; velocidad: number; rumbo?: number | null; sat: number; enc?: boolean | null };
export type EventoRep = { tipo: string; cuando: string; detalle: string | null; lugar: string | null; prioridad: number | null; tarde: number | null; lat: number | null; lon: number | null };
export type CercaRep = FormaDeCerca & { id: string; nombre: string; imeis: string[] };
export type VehiculoRep = { imei: string; nombre: string; matricula: string | null; puntos: PuntoRep[]; eventos: EventoRep[] };
export type ContextoRep = {
    desde: string; hasta: string;
    /** El período llega hasta ahora: lo que sigue estacionado o encendido, sigue. */
    hastaAhora: boolean;
    limite: number; cercas: CercaRep[];
    /** El horario laboral. Null = no se cargó: el reporte de uso fuera de horario lo dice. */
    horario: HorarioCerca | null;
    zona?: string;
};

const ms = (iso: string) => new Date(iso).getTime();
const minutosEntre = (a: number, b: number) => Math.max(0, Math.round((b - a) / 60_000));

/* ---------- Visitas a una geocerca ---------- */

export type Visita = { /** Null = ya estaba adentro en el primer reporte del período. */ desde: string | null; /** Null = sigue adentro. */ hasta: string | null; minutos: number };
/**
 * Cuántos reportes seguidos del otro lado hacen falta para creer que cruzó. La misma regla que usa
 * el receptor para avisar: con uno solo, un auto estacionado en el borde entra y sale con cada
 * salto del GPS y el reporte se llena de visitas de diez segundos que nadie hizo.
 */
const CONFIRMA = 2;
/**
 * Las veces que estuvo adentro de una zona, sacadas de las posiciones y no de los avisos: así el
 * reporte vale también para una geocerca dibujada DESPUÉS («¿cuántas veces fue al taller el mes
 * pasado?») y para una que tiene los avisos apagados.
 */
export function visitasDe(cerca: FormaDeCerca, p: { lat: number; lon: number; cuando: string }[], hasta: string): Visita[] {
    if (!p.length) return [];
    const visitas: Visita[] = [];
    let dentro = dentroDe(cerca, p[0].lat, p[0].lon);
    let entro: string | null = null, tEntro = ms(p[0].cuando);     // si arranca adentro, «ya estaba»: se cuenta desde el primer reporte
    let racha = 0, iRacha = 0;
    for (let i = 1; i < p.length; i++) {
        if (dentroDe(cerca, p[i].lat, p[i].lon) === dentro) { racha = 0; continue; }
        if (racha++ === 0) iRacha = i;
        if (racha < CONFIRMA) continue;
        /* El cruce fue en el primer reporte de la racha, no en el que la confirmó. */
        const cruce = p[iRacha].cuando;
        if (dentro) visitas.push({ desde: entro, hasta: cruce, minutos: minutosEntre(tEntro, ms(cruce)) });
        else { entro = cruce; tEntro = ms(cruce); }
        dentro = !dentro; racha = 0;
    }
    if (dentro) visitas.push({ desde: entro, hasta: null, minutos: minutosEntre(tEntro, Math.max(ms(hasta), ms(p[p.length - 1].cuando))) });
    return visitas;
}

/* ---------- Horas de motor ---------- */

export type Motor = { desde: string; hasta: string; minutos: number; /** Sigue encendido al final del período. */ sigue: boolean };
/** Sin noticias del contacto por este tiempo, no se supone que siguió encendido: el período se cierra en lo último que se supo. */
const MOTOR_HUECO_MS = 10 * 60_000;
/**
 * Los ratos en que el motor estuvo encendido, según el cable de contacto (ACC) del equipo.
 *
 * `informa` es falso si ninguna posición trae el dato: no es «motor apagado todo el mes», es un
 * equipo que no lo sabe (cable sin conectar), y son dos reportes distintos.
 */
export function periodosDeMotor(p: { cuando: string; enc?: boolean | null }[], fin: { hasta: string; hastaAhora: boolean }): { informa: boolean; periodos: Motor[] } {
    const periodos: Motor[] = [];
    let informa = false, i0 = -1, ult = -1;
    const cerrar = (tHasta: number, sigue = false) => {
        const minutos = minutosEntre(ms(p[i0].cuando), tHasta);
        if (minutos >= 1) periodos.push({ desde: p[i0].cuando, hasta: new Date(tHasta).toISOString(), minutos, sigue });
        i0 = -1; ult = -1;
    };
    for (let i = 0; i < p.length; i++) {
        const e = p[i].enc;
        if (e === null || e === undefined) continue;
        informa = true;
        if (i0 >= 0 && ms(p[i].cuando) - ms(p[ult].cuando) > MOTOR_HUECO_MS) cerrar(ms(p[ult].cuando));
        if (e) { if (i0 < 0) i0 = i; ult = i; }
        else if (i0 >= 0) cerrar(ms(p[i].cuando));      // se apagó entre el reporte anterior y este: se toma este
    }
    if (i0 >= 0) {
        const tFin = ms(fin.hasta), tUlt = ms(p[ult].cuando), sigue = fin.hastaAhora && tFin - tUlt <= MOTOR_HUECO_MS;
        cerrar(sigue ? Math.max(tFin, tUlt) : tUlt, sigue);
    }
    return { informa, periodos };
}

/** Cuántos minutos de [a, b] caen dentro de algún viaje. */
function minutosEnViaje(a: number, b: number, viajes: Viaje[]): number {
    let total = 0;
    for (const v of viajes) total += Math.max(0, Math.min(b, ms(v.hasta)) - Math.max(a, ms(v.desde)));
    return Math.round(total / 60_000);
}

/* ---------- El informe ---------- */

/** El listado crudo tiene tope: más que esto no es una planilla que se pueda abrir. */
export const POSICIONES_MAX = 200_000;

const C = (rotulo: string, formato: Columna["formato"], ancho: number): Columna => ({ rotulo, formato, ancho });
const COLUMNAS: Record<ClaveReporte, Columna[]> = {
    resumen: [C("Vehículo", "texto", 24), C("Matrícula", "texto", 12), C("Días con uso", "entero", 13), C("Viajes", "entero", 9), C("Recorrió", "km", 11), C("Andando", "dur", 12), C("Estacionado", "dur", 13), C("Ralentí", "dur", 11), C("Vel. máxima", "kmh", 13), C("Vel. media", "kmh", 12), C("Excesos", "entero", 10), C("Alarmas", "entero", 10)],
    dias: [C("Vehículo", "texto", 24), C("Día", "texto", 17), C("Viajes", "entero", 9), C("Recorrió", "km", 11), C("Andando", "dur", 12), C("Vel. máxima", "kmh", 13), C("Primera salida", "texto", 15), C("Última llegada", "texto", 15), C("Excesos", "entero", 10), C("Alarmas", "entero", 10)],
    viajes: [C("Vehículo", "texto", 24), C("Día", "texto", 17), C("Salida", "texto", 10), C("Llegada", "texto", 10), C("Duró", "dur", 10), C("Recorrió", "km", 11), C("Vel. máxima", "kmh", 13), C("Vel. media", "kmh", 12), C("Salió de", "lugar", 26), C("Llegó a", "lugar", 26), C("Excesos", "entero", 10), C("Horario", "texto", 17)],
    paradas: [C("Vehículo", "texto", 24), C("Día", "texto", 17), C("Desde", "texto", 10), C("Hasta", "texto", 19), C("Duró", "dur", 11), C("Dónde", "lugar", 28)],
    excesos: [C("Vehículo", "texto", 24), C("Día", "texto", 17), C("Hora", "texto", 10), C("Duró", "seg", 10), C("Tramo", "metros", 10), C("Llegó a", "kmh", 11), C("Sobre el límite", "kmh", 15), C("Dónde", "lugar", 28)],
    geocercas: [C("Vehículo", "texto", 24), C("Geocerca", "texto", 24), C("Día", "texto", 17), C("Entró", "texto", 12), C("Salió", "texto", 19), C("Se quedó", "dur", 12)],
    motor: [C("Vehículo", "texto", 24), C("Día", "texto", 17), C("Encendió", "texto", 10), C("Apagó", "texto", 19), C("En marcha", "dur", 12), C("De eso, en ralentí", "dur", 18), C("Recorrió", "km", 11)],
    fuera: [C("Vehículo", "texto", 24), C("Día", "texto", 17), C("Salida", "texto", 10), C("Llegada", "texto", 10), C("Duró", "dur", 10), C("Recorrió", "km", 11), C("Salió de", "lugar", 26), C("Llegó a", "lugar", 26)],
    eventos: [C("Vehículo", "texto", 24), C("Día", "texto", 17), C("Hora", "texto", 10), C("Evento", "texto", 34), C("Detalle", "texto", 30), C("Lugar", "texto", 22), C("Prioridad", "entero", 10), C("Llegó tarde", "texto", 13), C("Dónde", "lugar", 24)],
    posiciones: [C("Vehículo", "texto", 24), C("Día", "texto", 17), C("Hora", "texto", 10), C("Latitud", "coord", 13), C("Longitud", "coord", 13), C("Velocidad", "kmh", 11), C("Rumbo", "entero", 8), C("Satélites", "entero", 10), C("Contacto", "texto", 11)],
};
const VACIO: Record<ClaveReporte, string> = {
    resumen: "Ningún vehículo reportó en el período.", dias: "No hubo viajes ni alarmas en el período.", viajes: "No hubo viajes en el período.",
    paradas: "No quedó estacionado en el período: o no hubo viajes, o no paró.", excesos: "No pasó la velocidad permitida en el período.",
    geocercas: "No estuvo dentro de ninguna geocerca en el período.", motor: "El motor no se encendió en el período.", fuera: "Todos los viajes fueron dentro del horario laboral.",
    eventos: "No hubo eventos en el período.", posiciones: "No hay posiciones en el período.",
};

function formatos(zona: string) {
    const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(IDIOMA, { timeZone: zona, hourCycle: "h23", ...o });
    const dia = f({ weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" }), hora = f({ hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const diaCorto = f({ day: "2-digit", month: "2-digit" }), clave = new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" });
    const d = (iso: string) => new Date(iso);
    return {
        dia: (iso: string) => dia.format(d(iso)), hora: (iso: string) => hora.format(d(iso)), clave: (iso: string) => clave.format(d(iso)),
        /** La hora de `iso`; con el día adelante si no es el mismo día que `ref`: un estacionamiento que empezó el lunes y terminó el martes. */
        horaDesde: (iso: string, ref: string) => (clave.format(d(iso)) === clave.format(d(ref)) ? hora.format(d(iso)) : `${diaCorto.format(d(iso))} ${hora.format(d(iso))}`),
    };
}

export type InformeGps = ReturnType<typeof nuevoInforme>;

export function nuevoInforme(ctx: ContextoRep, claves: ClaveReporte[]) {
    const zona = ctx.zona || ZONA, f = formatos(zona), quiere = new Set(claves);
    const filas = Object.fromEntries(REPORTES_GPS.map((r) => [r.clave, [] as Celda[][]])) as Record<ClaveReporte, Celda[][]>;
    const t: TotalesDeReporte = { vehiculos: 0, viajes: 0, km: 0, andandoMin: 0, estacionadoMin: 0, ralentiMin: null, velMax: 0, excesos: 0, alarmas: 0, fuera: ctx.horario ? 0 : null };
    /* Los totales de las tablas que no salen del resumen. */
    const suma = { paradasMin: 0, visitasMin: 0, motorMin: 0, motorRalenti: 0, motorKm: 0, fueraMin: 0, fueraKm: 0, posicionesDeMas: 0 };
    let informanContacto = 0, cercasQueAplican = 0;

    function sumar(v: VehiculoRep) {
        const buenos = v.puntos.filter((p) => p.sat >= SATS_MIN);
        const { viajes } = viajesYParadas(buenos);
        const cercas = ctx.cercas.filter((c) => aplicaA(c, v.imei));
        cercasQueAplican += cercas.length;
        const donde = (lat: number, lon: number): Lugar => ({ lugar: lugarDe(lat, lon, cercas), lat, lon });

        /* Los puntos de cada viaje: los dos están ordenados, se recorren juntos. */
        const deViaje: PuntoRep[][] = [];
        let k = 0;
        for (const vj of viajes) {
            const tramo: PuntoRep[] = [];
            while (k < buenos.length && buenos[k].cuando < vj.desde) k++;
            while (k < buenos.length && buenos[k].cuando <= vj.hasta) tramo.push(buenos[k++]);
            deViaje.push(tramo);
        }
        const excesos = viajes.flatMap((_, n) => excesosDe(deViaje[n], ctx.limite).map((e) => {
            let pico = deViaje[n][e.i0];
            for (let i = e.i0; i <= e.i1; i++) if (deViaje[n][i].velocidad > pico.velocidad) pico = deViaje[n][i];
            return { ...e, viaje: n, pico };
        }));

        /* Estacionado: lo que hay entre viajes. Un vehículo que no salió en todo el período estuvo
           estacionado todo el período, aunque la jornada —que se arma con viajes— no tenga nada. */
        const primero = buenos[0], ultimo = buenos[buenos.length - 1];
        const jornada = jornadaDe(viajes, { desde: primero?.cuando ?? null, hasta: ctx.hasta, hastaAhora: ctx.hastaAhora });
        const quieto = jornada.flatMap((tr) => (tr.tipo === "estacionado" ? [tr] : []));
        if (!viajes.length && primero) quieto.push({ tipo: "estacionado", desde: primero.cuando, hasta: ctx.hasta, minutos: minutosEntre(ms(primero.cuando), ms(ctx.hasta)), lat: ultimo.lat, lon: ultimo.lon, sigue: ctx.hastaAhora });

        const motor = periodosDeMotor(v.puntos, { hasta: ctx.hasta, hastaAhora: ctx.hastaAhora });
        if (motor.informa) informanContacto++;
        const motorFilas = motor.periodos.map((m) => {
            const a = ms(m.desde), b = ms(m.hasta), enViaje = minutosEnViaje(a, b, viajes);
            return { ...m, ralenti: Math.max(0, m.minutos - enViaje), km: viajes.reduce((s, vj) => s + (ms(vj.desde) >= a - 60_000 && ms(vj.desde) <= b ? vj.km : 0), 0) };
        });
        const ralenti = motor.informa ? motorFilas.reduce((s, m) => s + m.ralenti, 0) : null;

        const fueraDe = (vj: Viaje) => !!ctx.horario && (!enHorario(ctx.horario, new Date(vj.desde), zona) || !enHorario(ctx.horario, new Date(vj.hasta), zona));
        const alarmas = v.eventos.filter((e) => e.prioridad !== null);

        const km = viajes.reduce((s, vj) => s + vj.km, 0), andando = viajes.reduce((s, vj) => s + vj.minutos, 0);
        const estacionado = quieto.reduce((s, q) => s + q.minutos, 0), velMax = viajes.reduce((s, vj) => Math.max(s, vj.velMax), 0);
        const nFuera = viajes.filter(fueraDe).length;

        /* Por día: cada cosa cuenta en el día en que EMPEZÓ, en la hora del sitio. */
        const dias = new Map<string, { rotulo: string; viajes: number; km: number; min: number; velMax: number; salida: string | null; llegada: string | null; excesos: number; alarmas: number }>();
        const dia = (iso: string) => {
            const c = f.clave(iso);
            if (!dias.has(c)) dias.set(c, { rotulo: f.dia(iso), viajes: 0, km: 0, min: 0, velMax: 0, salida: null, llegada: null, excesos: 0, alarmas: 0 });
            return dias.get(c)!;
        };
        for (const vj of viajes) { const d = dia(vj.desde); d.viajes++; d.km += vj.km; d.min += vj.minutos; d.velMax = Math.max(d.velMax, vj.velMax); d.salida ||= f.hora(vj.desde); d.llegada = f.hora(vj.hasta); }
        for (const e of excesos) dia(e.desde).excesos++;
        for (const e of alarmas) dia(e.cuando).alarmas++;
        const diasConUso = [...dias.values()].filter((d) => d.viajes > 0).length;

        t.vehiculos++; t.viajes += viajes.length; t.km += km; t.andandoMin += andando; t.estacionadoMin += estacionado; t.velMax = Math.max(t.velMax, velMax);
        t.excesos += excesos.length; t.alarmas += alarmas.length;
        if (ralenti !== null) t.ralentiMin = (t.ralentiMin || 0) + ralenti;
        if (t.fuera !== null) t.fuera += nFuera;

        const quien = v.nombre;
        if (quiere.has("resumen")) filas.resumen.push([quien, v.matricula, diasConUso, viajes.length, km, andando, estacionado, ralenti, velMax || null, andando ? Math.round(km / (andando / 60)) : null, excesos.length, alarmas.length]);
        if (quiere.has("dias")) for (const c of [...dias.keys()].sort()) { const d = dias.get(c)!; filas.dias.push([quien, d.rotulo, d.viajes, d.km, d.min, d.velMax || null, d.salida, d.llegada, d.excesos, d.alarmas]); }
        if (quiere.has("viajes")) viajes.forEach((vj, n) => filas.viajes.push([quien, f.dia(vj.desde), f.hora(vj.desde), f.hora(vj.hasta), vj.minutos, vj.km, vj.velMax, vj.velMedia, donde(vj.inicio.lat, vj.inicio.lon), donde(vj.fin.lat, vj.fin.lon),
            excesos.filter((e) => e.viaje === n).length, ctx.horario ? (fueraDe(vj) ? "Fuera de horario" : "En horario") : null]));
        if (quiere.has("paradas")) for (const q of quieto) { suma.paradasMin += q.minutos; filas.paradas.push([quien, f.dia(q.desde), f.hora(q.desde), q.sigue ? "sigue ahí" : f.horaDesde(q.hasta, q.desde), q.minutos, donde(q.lat, q.lon)]); }
        if (quiere.has("excesos")) for (const e of excesos) filas.excesos.push([quien, f.dia(e.desde), f.hora(e.desde), e.segundos, e.metros, e.velMax, e.velMax - ctx.limite, donde(e.pico.lat, e.pico.lon)]);
        if (quiere.has("geocercas")) {
            const del: { cuando: string; fila: Celda[] }[] = [];
            for (const c of cercas) for (const vis of visitasDe(c, buenos, ctx.hasta)) {
                const ref = vis.desde || primero.cuando;
                suma.visitasMin += vis.minutos;
                del.push({ cuando: ref, fila: [quien, c.nombre, f.dia(ref), vis.desde ? f.hora(vis.desde) : "ya estaba", vis.hasta ? f.horaDesde(vis.hasta, ref) : "sigue adentro", vis.minutos] });
            }
            del.sort((a, b) => a.cuando.localeCompare(b.cuando)).forEach((x) => filas.geocercas.push(x.fila));
        }
        if (quiere.has("motor")) for (const m of motorFilas) { suma.motorMin += m.minutos; suma.motorRalenti += m.ralenti; suma.motorKm += m.km; filas.motor.push([quien, f.dia(m.desde), f.hora(m.desde), m.sigue ? "sigue encendido" : f.horaDesde(m.hasta, m.desde), m.minutos, m.ralenti, m.km]); }
        if (quiere.has("fuera") && ctx.horario) for (const vj of viajes.filter(fueraDe)) { suma.fueraMin += vj.minutos; suma.fueraKm += vj.km; filas.fuera.push([quien, f.dia(vj.desde), f.hora(vj.desde), f.hora(vj.hasta), vj.minutos, vj.km, donde(vj.inicio.lat, vj.inicio.lon), donde(vj.fin.lat, vj.fin.lon)]); }
        if (quiere.has("eventos")) for (const e of v.eventos) {
            const { titulo, resto } = tituloDeEventoGps(e);
            /* Hay equipos que mandan como detalle el mismo nombre del evento («Vibración»): repetido no dice nada. */
            filas.eventos.push([quien, f.dia(e.cuando), f.hora(e.cuando), titulo, resto && resto.trim().toLowerCase() !== titulo.toLowerCase() ? resto : null, e.lugar, e.prioridad, demoraLegible(e.tarde), e.lat !== null && e.lon !== null ? { lugar: null, lat: e.lat, lon: e.lon } : null]);
        }
        if (quiere.has("posiciones")) for (const p of v.puntos) {
            if (filas.posiciones.length >= POSICIONES_MAX) { suma.posicionesDeMas++; continue; }
            filas.posiciones.push([quien, f.dia(p.cuando), f.hora(p.cuando), p.lat, p.lon, p.velocidad, p.rumbo ?? null, p.sat, p.enc === true ? "encendido" : p.enc === false ? "apagado" : null]);
        }
    }

    function tablas(): TablaReporte[] {
        const n = (c: ClaveReporte) => filas[c].length;
        const total: Partial<Record<ClaveReporte, Celda[] | null>> = {
            resumen: t.vehiculos > 1 ? ["Total", `${t.vehiculos} vehículos`, null, t.viajes, t.km, t.andandoMin, t.estacionadoMin, t.ralentiMin, t.velMax || null, t.andandoMin ? Math.round(t.km / (t.andandoMin / 60)) : null, t.excesos, t.alarmas] : null,
            dias: n("dias") > 1 ? ["Total", null, t.viajes, t.km, t.andandoMin, t.velMax || null, null, null, t.excesos, t.alarmas] : null,
            viajes: n("viajes") > 1 ? ["Total", `${t.viajes} viajes`, null, null, t.andandoMin, t.km, t.velMax || null, null, null, null, t.excesos, null] : null,
            paradas: n("paradas") > 1 ? ["Total", `${n("paradas")} paradas`, null, null, suma.paradasMin, null] : null,
            geocercas: n("geocercas") > 1 ? ["Total", `${n("geocercas")} visitas`, null, null, null, suma.visitasMin] : null,
            motor: n("motor") > 1 ? ["Total", `${n("motor")} encendidos`, null, null, suma.motorMin, suma.motorRalenti, suma.motorKm] : null,
            fuera: n("fuera") > 1 ? ["Total", `${n("fuera")} viajes`, null, null, suma.fueraMin, suma.fueraKm, null, null] : null,
        };
        const nota: Partial<Record<ClaveReporte, string | null>> = {
            resumen: `Velocidad permitida: ${ctx.limite} km/h. El ralentí es el tiempo con el motor encendido y sin viajar${t.ralentiMin === null && t.vehiculos ? "; ningún equipo del período informa el contacto, por eso no figura" : ""}.`,
            viajes: "Un viaje es un tramo en que se alejó más de 250 m de donde salió; una espera de menos de 4 minutos no lo corta.",
            paradas: "Los lugares llevan nombre cuando caen dentro de una geocerca o cerca de una; si no, las coordenadas.",
            excesos: `Velocidad permitida: ${ctx.limite} km/h. Un exceso es una racha de reportes seguidos por encima.`,
            geocercas: !ctx.cercas.length ? "No hay geocercas dibujadas: se dibujan en el mapa, con el botón derecho."
                : !cercasQueAplican && t.vehiculos ? "Las geocercas que hay no les valen a estos vehículos." : "Sale de las posiciones, no de los avisos: vale también para las geocercas dibujadas después y para las que no avisan.",
            motor: t.vehiculos && !informanContacto ? "Ningún rastreador del período informa el contacto (el cable ACC no está conectado): no hay horas de motor que contar."
                : "Sale del cable de contacto (ACC) de cada equipo. En ralentí: encendido y sin viajar.",
            fuera: ctx.horario ? null : "No hay un horario laboral cargado: cargalo en la pantalla de reportes para ver qué viajes quedaron afuera.",
            posiciones: suma.posicionesDeMas ? `Se listan las primeras ${POSICIONES_MAX.toLocaleString("es-UY")} posiciones; quedaron ${suma.posicionesDeMas.toLocaleString("es-UY")} afuera. Acortá el período o elegí menos vehículos.` : "Todas las posiciones, también las de mala señal (menos de 8 satélites), que los demás reportes no usan.",
        };
        return REPORTES_GPS.filter((r) => quiere.has(r.clave)).map((r) => ({
            clave: r.clave, titulo: r.titulo, hoja: r.hoja, ayuda: r.ayuda, columnas: COLUMNAS[r.clave], filas: filas[r.clave],
            total: total[r.clave] ?? null, nota: nota[r.clave] ?? null, vacio: VACIO[r.clave], filasTotales: filas[r.clave].length,
        }));
    }

    return { sumar, tablas, totales: (): TotalesDeReporte => ({ ...t, km: Math.round(t.km * 10) / 10 }) };
}
