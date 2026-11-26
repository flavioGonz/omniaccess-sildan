/**
 * La tasa de lectura, las reglas (26/11). Nico: «cambiar lo de seguimiento por las cámaras LPR
 * interiores, las que ve OmniVision y las ANPR también; este medidor debe ser más pro: exportar la
 * tasa claramente para ver qué cámara está capturando mal, poder sugerir correcciones, horas de
 * fallos más habituales».
 *
 * Sin base ni red: las horas peores, el diagnóstico y las sugerencias se calculan acá para que la
 * pantalla, el Excel y las pruebas digan lo mismo. Cada sugerencia sale de un número medido y lo
 * dice: «de noche lee 31% contra 88% de día» se puede verificar; «revisar la cámara» no.
 */

export const TASA_BIEN = 90;
export const TASA_AVISO = 75;
/** Una hora con menos intentos que esto no se juzga: dos ráfagas no son una tendencia. */
export const MIN_POR_HORA = 5;
/** Horas de noche (hora del barrio): de 19 a 6. Es donde se ve la falta de infrarrojo. */
export const NOCHE = new Set([19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6]);

export const pct = (parte: number, total: number): number | null => (total ? Math.round((parte / total) * 1000) / 10 : null);

export type Hora = { hour: number; total: number; read: number; ratePct: number | null };

/** Las horas con peor tasa (y suficientes intentos), de la peor a la menos mala. */
export function peoresHoras(horas: Hora[], cuantas = 3): Hora[] {
    return horas.filter((h) => h.total >= MIN_POR_HORA && h.ratePct != null && h.ratePct < TASA_BIEN)
        .sort((a, b) => (a.ratePct! - b.ratePct!) || b.total - a.total).slice(0, cuantas);
}

/** La tasa de día y de noche por separado (null si no hay intentos suficientes en esa franja). */
export function diaYNoche(horas: Hora[]): { dia: number | null; noche: number | null } {
    const suma = (f: (h: Hora) => boolean) => horas.filter(f).reduce((a, h) => ({ t: a.t + h.total, r: a.r + h.read }), { t: 0, r: 0 });
    const n = suma((h) => NOCHE.has(h.hour)), d = suma((h) => !NOCHE.has(h.hour));
    return { dia: d.t >= MIN_POR_HORA * 2 ? pct(d.r, d.t) : null, noche: n.t >= MIN_POR_HORA * 2 ? pct(n.r, n.t) : null };
}

export type Gravedad = "mal" | "aviso" | "info";
export type Sugerencia = { gravedad: Gravedad; titulo: string; detalle: string };

/** Lo que se sabe de una cámara para diagnosticarla. Todo opcional menos el método. */
export type CamaraMedida = {
    metodo: "anpr" | "omnivision";
    total: number; read: number; ratePct: number | null;
    horas: Hora[];
    /** ANPR: de las que la cámara no leyó, cuántas leyó OmniVision después. */
    recuperadas?: number;
    /** OmniVision: lecturas buenas descartadas por la zona o la línea, ráfagas frenadas por cuota,
     *  qué parte de los minutos disparó por escena (respaldo) y reconexiones del flujo de avisos. */
    fueraDeLinea?: number; frenados?: number; descartes?: number; minutosEscenaPct?: number | null; reconexiones?: number;
    /** Minutos desde la última vez que la cámara dio algo (null = nunca en el rango). */
    silencioMin?: number | null;
};

const f1 = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n)}%`);
const horaTxt = (h: number) => `${String(h).padStart(2, "0")}–${String((h + 1) % 24).padStart(2, "0")} h`;

/**
 * Qué conviene corregir en una cámara, de lo más grave a lo menos. Las reglas están escritas con lo
 * que se aprendió en San Nicolás: la tasa baja de noche es casi siempre luz/IR; una tasa baja todo el
 * día es encuadre o zona; una cámara en «escena» lee casi nada aunque se vea en línea (medido: 20%
 * del tiempo en respaldo dio el 2% de las lecturas).
 */
export function sugerencias(c: CamaraMedida): Sugerencia[] {
    const out: Sugerencia[] = [];
    if (c.silencioMin != null && c.silencioMin > 6 * 60 && c.total > 0) out.push({ gravedad: "mal", titulo: "Dejó de reportar", detalle: `No da nada hace ${Math.round(c.silencioMin / 60)} h. Antes de mirar la tasa, revisar que la cámara esté en línea y mandando.` });
    if (c.total < MIN_POR_HORA * 2) { out.push({ gravedad: "info", titulo: "Pocos datos", detalle: `Sólo ${c.total} ${c.metodo === "anpr" ? "capturas" : "ráfagas"} en el período: todavía no se puede juzgar.` }); return out; }

    const { dia, noche } = diaYNoche(c.horas);
    if (dia != null && noche != null && dia - noche >= 20) out.push({ gravedad: noche < TASA_AVISO ? "mal" : "aviso", titulo: "Cae de noche", detalle: `De noche lee ${f1(noche)} contra ${f1(dia)} de día. Revisar el infrarrojo, la obturación (1/1000 o más rápida para chapas) y que no encandile el reflejo de la chapa.` });

    if (c.metodo === "omnivision") {
        if ((c.minutosEscenaPct ?? 0) >= 30) out.push({ gravedad: "mal", titulo: "Dispara por escena", detalle: `El ${f1(c.minutosEscenaPct)} del tiempo disparó por cambio de imagen (respaldo), que lee casi nada. Configurar el cruce de línea o la zona en la cámara para que avise ella.` });
        if ((c.fueraDeLinea ?? 0) > Math.max(5, c.read * 0.3)) out.push({ gravedad: "aviso", titulo: "La zona descarta lecturas buenas", detalle: `${c.fueraDeLinea} lecturas buenas cayeron afuera de la zona o la línea. Ampliar la zona en el calibrador.` });
        if ((c.frenados ?? 0) > c.total * 0.05) out.push({ gravedad: "aviso", titulo: "Se queda sin cuota", detalle: `${c.frenados} ráfagas no se abrieron por el presupuesto de inferencias. Bajar la sensibilidad de la escena o subir la cuota.` });
        if ((c.reconexiones ?? 0) > 20) out.push({ gravedad: "aviso", titulo: "El flujo de avisos se corta", detalle: `${c.reconexiones} reconexiones en el período: la cámara rechaza la suscripción o la red se corta.` });
        if (c.ratePct != null && c.ratePct < TASA_AVISO && (c.descartes ?? 0) > c.read) out.push({ gravedad: "aviso", titulo: "Ve la chapa pero no la lee", detalle: `${c.descartes} ráfagas sin lectura confiable contra ${c.read} leídas. Acercar o cerrar el encuadre (la chapa debería medir 130 px o más) y usar el flujo principal.` });
    } else {
        if ((c.recuperadas ?? 0) > 0 && c.total - c.read > 0) {
            const r = Math.round(((c.recuperadas || 0) / (c.total - c.read)) * 100);
            if (r >= 30) out.push({ gravedad: "aviso", titulo: "OmniVision lee lo que la cámara no", detalle: `De las ${c.total - c.read} que la cámara no leyó, OmniVision leyó ${c.recuperadas} (${r}%). Revisar el ANPR de la cámara (región, tamaño de chapa, zona) o activarle la doble verificación.` });
        }
    }

    if (c.ratePct != null && c.ratePct < TASA_AVISO && !out.some((s) => s.titulo === "Cae de noche")) {
        out.push({ gravedad: "mal", titulo: "Lee poco todo el día", detalle: `Tasa ${f1(c.ratePct)} sin diferencia entre día y noche: es encuadre, distancia o zona, no luz. Revisar con el calibrador.` });
    }
    const peores = peoresHoras(c.horas);
    if (peores.length && !out.some((s) => s.titulo === "Cae de noche")) out.push({ gravedad: "info", titulo: "Horas con más fallas", detalle: peores.map((h) => `${horaTxt(h.hour)}: ${f1(h.ratePct)}`).join(" · ") + ". Mirar las capturas de esas horas: sol de frente, sombra, tránsito." });
    const orden: Record<Gravedad, number> = { mal: 0, aviso: 1, info: 2 };
    return out.sort((a, b) => orden[a.gravedad] - orden[b.gravedad]);
}

/** El estado de una cámara en una palabra, para ordenar y para la columna del Excel. */
export const estadoTasa = (r: number | null): "sin datos" | "bien" | "regular" | "mal" => (r == null ? "sin datos" : r >= TASA_BIEN ? "bien" : r >= TASA_AVISO ? "regular" : "mal");
export { horaTxt };
