/**
 * La permanencia de cada empleado de la planilla de un proveedor, a partir de SUS lecturas.
 *
 * Cada empleado entra con su credencial propia (tarjeta, PIN, rostro, su matrícula): cada pasada
 * es un AccessEvent con su userId y la dirección del equipo (ENTRY / EXIT). De ahí salen las
 * estadías. Lo que no se puede saber no se inventa:
 *
 *  · Una entrada sin salida leída no tiene fin conocido. Si vuelve a entrar más tarde, o si pasó
 *    más de ESTADIA_MAX_H, la estadía queda «sin salida» y NO suma al total: sumarle hasta la
 *    hora de corte sería inventar horas trabajadas.
 *  · Una salida sin entrada leída (entró por donde no hay equipo, o la lectura falló) se cuenta
 *    aparte, como aviso de que el total puede quedarse corto.
 *  · Dos entradas seguidas a menos de REBOTE_MIN son la misma pasada (el terminal leyó dos veces).
 *  · Sólo cuentan las pasadas concedidas (GRANT): un rechazo no es haber entrado.
 *
 * Archivo sin base ni red: lo usan la acción de servidor y las pruebas.
 */

export type Pasada = { userId: string; t: Date; direccion: "ENTRY" | "EXIT"; concedida: boolean };
export type Estadia = { entra: Date; sale: Date | null; sinSalida: boolean; minutos: number | null };
export type Permanencia = {
    estadias: Estadia[];
    /** Adentro ahora: desde cuándo. */
    adentroDesde: Date | null;
    /** Suma de las estadías con entrada Y salida, en minutos. */
    totalMin: number;
    /** Días distintos (del barrio) en que entró. */
    dias: number;
    sinSalida: number;
    salidasSinEntrada: number;
    ultima: Date | null;
};

/** Una entrada sin salida más vieja que esto ya no es «adentro ahora»: es una salida que no se leyó. */
export const ESTADIA_MAX_H = 14;
/** Dos entradas a menos de esto son la misma pasada leída dos veces. */
export const REBOTE_MIN = 2;

export function permanencia(pasadas: Pasada[], ahora: Date, diaDe: (d: Date) => string): Permanencia {
    const orden = pasadas.filter((p) => p.concedida).sort((a, b) => +a.t - +b.t);
    const estadias: Estadia[] = [];
    let abierta: { entra: Date; ultimaEntrada: Date } | null = null;
    let salidasSinEntrada = 0;
    const max = ESTADIA_MAX_H * 3_600_000;
    const cerrarSinSalida = () => { if (abierta) estadias.push({ entra: abierta.entra, sale: null, sinSalida: true, minutos: null }); abierta = null; };

    for (const p of orden) {
        if (abierta && +p.t - +abierta.entra > max) cerrarSinSalida();
        if (p.direccion === "ENTRY") {
            if (abierta && +p.t - +abierta.ultimaEntrada < REBOTE_MIN * 60_000) { abierta.ultimaEntrada = p.t; continue; }
            if (abierta) cerrarSinSalida();
            abierta = { entra: p.t, ultimaEntrada: p.t };
        } else if (abierta) {
            estadias.push({ entra: abierta.entra, sale: p.t, sinSalida: false, minutos: Math.max(0, (+p.t - +abierta.entra) / 60_000) });
            abierta = null;
        } else {
            salidasSinEntrada++;
        }
    }
    let adentroDesde: Date | null = null;
    if (abierta) {
        const a = abierta as { entra: Date };
        if (+ahora - +a.entra > max) cerrarSinSalida();
        else adentroDesde = a.entra;
    }
    const cerradas = estadias.filter((e) => e.minutos != null);
    const entradas = [...estadias.map((e) => e.entra), ...(adentroDesde ? [adentroDesde] : [])];
    return {
        estadias, adentroDesde,
        totalMin: Math.round(cerradas.reduce((s, e) => s + (e.minutos || 0), 0)),
        dias: new Set(entradas.map(diaDe)).size,
        sinSalida: estadias.filter((e) => e.sinSalida).length,
        salidasSinEntrada,
        ultima: orden.length ? orden[orden.length - 1].t : null,
    };
}
