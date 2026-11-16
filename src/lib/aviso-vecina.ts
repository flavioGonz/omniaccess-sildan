/**
 * Qué aviso de lista mostrar en una cámara vecina del seguimiento visual.
 *
 * Pedido del 16/11 (Nico): «las minicámaras, cuando detectan una matrícula en lista negra o
 * amarilla y al hacerle clic abrir animado "Lista Negra Detectada" / "Alerta Amarilla
 * Detectada", con un badge indicando el color. Debe indicar si lo sigue viendo o ya no lo ve
 * con la fecha exacta y captura en últimas capturas» — «y así enriquecer el visual track».
 *
 * Está acá y no en el componente por dos cosas que se eligieron a propósito y conviene poder
 * probar sin navegador:
 *
 *  · **La negra manda sobre la amarilla.** Si la vecina leyó las dos, el aviso es el de la
 *    negra: es la que hay que atender. No se muestran las dos ni se promedia nada.
 *  · **Un aviso vence, salvo que todavía la esté viendo.** Las lecturas que trae cada canal
 *    son las últimas, no las de ahora: sin corte, una minicámara quedaba encendida por una
 *    chapa que pasó hace seis horas, que es ruido con aspecto de alarma. Si la cámara tiene
 *    la estadía abierta (`sigue`), el aviso no vence nunca mientras siga ahí.
 */

/** Lo que de una lectura necesita el aviso (es un subconjunto de `Lectura` de piezas.tsx). */
export type LecturaDeLista = {
    id: string;
    ts: string;
    plate: string | null;
    foto?: string | null;
    lista?: "negra" | "amarilla";
    requerida?: boolean;
    sigue?: boolean;
    vistaHasta?: string | null;
};

export type AvisoVecina = {
    lista: "negra" | "amarilla";
    plate: string;
    requerida: boolean;
    /** Si esa cámara todavía la ve (estadía abierta). */
    sigue: boolean;
    /** La última vez que la vio, exacta: es la fecha que pidió el pedido. */
    vistaHasta: string;
    foto: string | null;
    lecturaId: string;
};

/** Cuánto vale un aviso de una chapa que ya no se ve. Medio cuarto de hora: lo que tarda alguien en llegar. */
export const VIGENTE_MS = 15 * 60_000;

/** El título del cartel. El de la amarilla dice lo mismo que la silueta del vivo. */
export function tituloDeAviso(a: AvisoVecina): string {
    return a.lista === "negra" ? "Lista negra detectada" : "Alerta Amarilla detectada";
}

export function avisoDeVecina(lecturas: LecturaDeLista[] | null | undefined, ahora = Date.now()): AvisoVecina | null {
    let mejor: AvisoVecina | null = null;
    for (const l of lecturas || []) {
        if (!l.lista || !l.plate) continue;
        const visto = Math.max(Date.parse(l.ts) || 0, l.vistaHasta ? Date.parse(l.vistaHasta) || 0 : 0);
        if (!visto) continue;
        const sigue = !!l.sigue;
        if (!sigue && ahora - visto > VIGENTE_MS) continue;
        const cand: AvisoVecina = {
            lista: l.lista, plate: l.plate, requerida: !!l.requerida, sigue,
            vistaHasta: new Date(visto).toISOString(), foto: l.foto || null, lecturaId: l.id,
        };
        if (!mejor) { mejor = cand; continue; }
        // Negra sobre amarilla; dentro de la misma lista, la que se vio más tarde.
        const pesa = (x: AvisoVecina) => (x.lista === "negra" ? 1 : 0);
        if (pesa(cand) > pesa(mejor) || (pesa(cand) === pesa(mejor) && visto > Date.parse(mejor.vistaHasta))) mejor = cand;
    }
    return mejor;
}
