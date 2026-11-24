/**
 * El envío de a poco de las invitaciones del censo.
 *
 * Pedido de Nico (21/11): «contemplá el envío de invitaciones que no sean masivos y consecutivos,
 * para evitar caer en spam el lunes».
 *
 * Lo que había mandaba las que faltaban una detrás de la otra, de a 25, hasta terminar: 490
 * correos casi iguales, con el mismo enlace, saliendo de una cuenta en cinco minutos. Eso es
 * exactamente la forma que tiene el correo masivo, y es como lo lee quien lo recibe (Gmail, que es
 * donde está la mayoría de los vecinos).
 *
 * Ahora se mandan de a UNO, con una pausa entre uno y otro que no es fija (un reloj exacto también
 * es una firma), dentro de un horario, y se frena solo si el servidor de correo empieza a
 * rechazar. Con uno por minuto, 490 invitaciones salen en algo más de ocho horas.
 *
 * Acá va lo que se puede probar sin red ni base: cuándo toca mandar, cuándo es el próximo y cuándo
 * termina. Quien manda de verdad es censo-envio.ts, que lo despierta el proceso de despachos cada
 * medio minuto.
 */

export type Goteo = {
    activo: boolean;
    /** La pausa media entre un correo y el siguiente, en segundos. */
    cadaSeg: number;
    /** El horario en que se manda, en horas de 0 a 24, en la hora del barrio: de `desde` a `hasta`. */
    desde: number; hasta: number;
    /** Cuándo toca el próximo. Null = en cuanto se pueda. */
    proximo: string | null;
    /** Envíos seguidos que fallaron. */
    fallas: number;
    /** Por qué está parado, cuando se paró solo (o terminó). */
    motivo: string | null;
    /** La dirección pública con la que se arman los enlaces: la de quien lo puso en marcha. */
    origen: string;
    /**
     * Las casillas que Gmail frenó por tope de envíos, y hasta cuándo se las deja descansar (25/11).
     * Las demás siguen mandando: una administración frenada no para a las otras tres.
     */
    frenadas: Record<string, string>;
};

export const GOTEO_DEFECTO: Goteo = { activo: false, cadaSeg: 60, desde: 9, hasta: 20, proximo: null, fallas: 0, motivo: null, origen: "", frenadas: {} };
/** Los ritmos que se ofrecen. Más rápido que uno cada 30 segundos ya no es «de a poco». */
export const RITMOS: { seg: number; rotulo: string }[] = [
    { seg: 30, rotulo: "Uno cada 30 segundos" }, { seg: 60, rotulo: "Uno por minuto" }, { seg: 120, rotulo: "Uno cada 2 minutos" }, { seg: 300, rotulo: "Uno cada 5 minutos" },
];
/** Tres rechazos seguidos y se frena solo: seguir insistiendo contra un servidor que rechaza es lo que termina de quemar la cuenta. */
export const FALLAS_PARA_PAUSAR = 3;

export function leerGoteo(v: unknown): Goteo {
    let g: Record<string, unknown> = {};
    try { g = typeof v === "string" ? JSON.parse(v || "{}") : ((v as Record<string, unknown>) || {}); } catch { g = {}; }
    const num = (x: unknown, d: number, min: number, max: number) => (Number.isFinite(Number(x)) && x !== null && x !== "" ? Math.min(max, Math.max(min, Math.round(Number(x)))) : d);
    const desde = num(g.desde, GOTEO_DEFECTO.desde, 0, 23), hasta = num(g.hasta, GOTEO_DEFECTO.hasta, 1, 24);
    return {
        activo: g.activo === true,
        cadaSeg: num(g.cadaSeg, GOTEO_DEFECTO.cadaSeg, 30, 3600),
        /* Un horario al revés o vacío no se interpreta: vuelve al de fábrica. */
        ...(hasta > desde ? { desde, hasta } : { desde: GOTEO_DEFECTO.desde, hasta: GOTEO_DEFECTO.hasta }),
        proximo: typeof g.proximo === "string" && !Number.isNaN(Date.parse(g.proximo)) ? g.proximo : null,
        fallas: num(g.fallas, 0, 0, 99),
        motivo: typeof g.motivo === "string" && g.motivo ? g.motivo.slice(0, 300) : null,
        origen: typeof g.origen === "string" && /^https?:\/\/[^\s/]+$/.test(g.origen) ? g.origen : "",
        frenadas: Object.fromEntries(Object.entries(g.frenadas && typeof g.frenadas === "object" ? (g.frenadas as Record<string, unknown>) : {})
            .filter(([k, v]) => k.includes("@") && typeof v === "string" && !Number.isNaN(Date.parse(v))) as [string, string][]),
    };
}

/**
 * Cuántas invitaciones manda cada casilla por día, como mucho (25/11).
 *
 * Gmail corta a una cuenta personal que pasa de unos 500 envíos por día, y no dice si las copias
 * cuentan: cada invitación sale con tres (María, Flavio y la propia casilla). Las casillas de las
 * administraciones son nuevas y una cuenta nueva que de golpe manda cientos de correos parecidos es
 * justo lo que Gmail mira con lupa. 150 por día deja a la más cargada (Etapas 1-3, ~200) en dos días
 * y lejos de cualquier tope, con o sin copias. Las que llegan al tope esperan a mañana; las demás
 * siguen.
 */
export const TOPE_DIARIO_POR_CUENTA = 150;

/** Gmail dice que llegó al tope de envíos (o que vaya más despacio): no es un correo malo, es la casilla. */
export const esTopeDeGmail = (error: string | null | undefined): boolean =>
    /\b5\.4\.5\b|\b4\.7\.28\b|sending limit|limit exceeded|rate limit|too many (?:messages|recipients|login)/i.test(String(error || ""));

/** El comienzo del día de hoy, en la hora del barrio. */
export function inicioDelDia(ahora: Date, zona: string): Date {
    return new Date(ahora.getTime() - Math.round(horaEn(ahora, zona) * 3600_000) - ahora.getUTCSeconds() * 1000 - ahora.getUTCMilliseconds());
}
/** Mañana, a la hora de arranque del envío: hasta ahí descansa una casilla que llegó al tope. */
export const mananaAlArranque = (g: Goteo, ahora: Date, zona: string): Date => new Date(inicioDelDia(ahora, zona).getTime() + (24 + g.desde) * 3600_000);

/** La hora del día (0 a 23,99) en una zona. */
export function horaEn(ahora: Date, zona: string): number {
    const p = new Intl.DateTimeFormat("en-GB", { timeZone: zona, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(ahora);
    const de = (t: string) => Number(p.find((x) => x.type === t)?.value || 0);
    return (de("hour") % 24) + de("minute") / 60;
}
export const enHorario = (g: Goteo, ahora: Date, zona: string): boolean => { const h = horaEn(ahora, zona); return h >= g.desde && h < g.hasta; };

export type QueHacer = "apagado" | "fuera-de-hora" | "espera" | "enviar";
/** Qué toca en este instante. Es toda la decisión, en un solo lugar. */
export function queToca(g: Goteo, ahora: Date, zona: string): QueHacer {
    if (!g.activo) return "apagado";
    if (!enHorario(g, ahora, zona)) return "fuera-de-hora";
    if (g.proximo && Date.parse(g.proximo) > ahora.getTime()) return "espera";
    return "enviar";
}

/**
 * Cuándo va el siguiente: la pausa media, corrida hasta un 30 % para un lado o para el otro. Un
 * correo exactamente cada 60,000 segundos es tan reconocible como 490 juntos.
 */
export function proximoEnvio(g: Goteo, ahora: Date, azar: () => number = Math.random): Date {
    return new Date(ahora.getTime() + Math.round(g.cadaSeg * 1000 * (0.7 + 0.6 * azar())));
}

/**
 * Cuándo termina, a este ritmo y respetando el horario: lo que no entra hoy sigue mañana a la hora
 * de arranque. Null si no hay nada pendiente.
 */
export function estimarFin(g: Goteo, pendientes: number, ahora: Date, zona: string): Date | null {
    if (pendientes <= 0) return null;
    let falta = pendientes * g.cadaSeg;                           // segundos de envío que quedan
    let t = ahora.getTime();
    for (let dias = 0; dias < 60; dias++) {
        const h = horaEn(new Date(t), zona);
        if (h < g.desde) t += (g.desde - h) * 3600_000;            // todavía no abrió: se espera a la hora de arranque
        else if (h >= g.hasta) { t += (24 - h + g.desde) * 3600_000; continue; }   // ya cerró: mañana
        const hoy = (g.hasta - Math.max(h, g.desde)) * 3600;       // segundos que quedan de ventana hoy
        if (falta <= hoy) return new Date(t + falta * 1000);
        falta -= hoy;
        t += hoy * 1000 + (24 - g.hasta + g.desde) * 3600_000;     // hasta el arranque de mañana
    }
    return null;
}
