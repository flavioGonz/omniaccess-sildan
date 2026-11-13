/**
 * Cuándo llegó un vehículo a su lugar (13/11, Nico, sobre «Ver cuándo llegó»: «se va muy atrás, no
 * llega al tiempo exacto que llegó el vehículo»).
 *
 * El menú abría la grabación 90 s antes de la hora del reloj del vivo (`quietoDesde`). Dos cosas
 * estaban mal, y las dos se midieron ese día en el lab:
 *
 *  1. Los 90 s. Eran por si vision-worker tardaba un minuto en ver el auto, pero cuando algo se
 *     mueve la escena se analiza cada 2 s: para un vehículo que acaba de llegar, la hora del reloj
 *     es la de cuando quedó quieto. Se veía un minuto y medio de calle vacía antes de que entrara.
 *  2. La hora del reloj no siempre es la de llegada: es desde cuándo se lo ve SIN INTERRUPCIÓN.
 *     Cada corte del video o cada vez que su caja se corre, vuelve a empezar. De 78 lugares
 *     publicados, 35 tenían pistas del registro con el vehículo quieto ahí desde antes (mediana:
 *     2 h antes; el mayor, 54 h).
 *
 * Lo que se hace: se parte de la hora del reloj (de ahí para acá es seguro que está) y se mira el
 * registro de detecciones hacia atrás, pista por pista, mientras siga siendo EL MISMO vehículo:
 *   · una pista quieta en el lugar, y que se le parece, estira la presencia hasta su comienzo;
 *   · una que empieza afuera y termina en el lugar es la entrada, con su instante;
 *   · una que empieza en el lugar y termina afuera es el anterior yéndose: ahí se corta;
 *   · una quieta que NO se le parece es otro vehículo en ese mismo lugar: ahí se corta;
 *   · un hueco largo sin verlo, con la cámara registrando otras cosas, también corta.
 *
 * Lo que NO se pudo: encontrar la entrada misma. El registro casi no tiene pistas que recorran la
 * escena (la mayoría son de un solo cuadro): en los 78 lugares no apareció ninguna entrada. Por
 * eso, casi siempre, lo que se contesta es «desde cuándo se lo ve ahí», y se abre un poco antes.
 *
 * Sin base ni red: lo usan la ruta y las pruebas.
 */

/** Una pista del registro, con lo que hace falta: cuándo y por dónde. `recorrido`: [x, y, segundos desde `desde`]. */
export type PistaLugar = { desde: number; hasta: number; caja?: number[] | null; recorrido: number[][];
    /** Cuánto se parece al vehículo que está ahora (coseno de las huellas). Null = no se sabe (esa pista no tiene huella). */
    parecido?: number | null };
export type Papel = "llega" | "quieta" | "se-va" | "ajena";
export type ComoLlego =
    /** Se encontró la pista que entra al lugar: `ms` es cuando quedó adentro; `entra`, cuando apareció en la escena. */
    | "llegada"
    /** No quedó la entrada: `ms` es la primera vez que se lo ve en su lugar. */
    | "primera-vez"
    /** Está ahí desde antes de lo que guarda el registro. */
    | "antes-del-registro"
    /** El registro no tiene nada anterior de este vehículo: `ms` es la hora del reloj (desde que se lo ve sin interrupción). */
    | "reloj";
export type Llegada = { ms: number; como: ComoLlego; entra?: number;
    /** Por qué se dejó de mirar hacia atrás: se encontró la entrada, el anterior se fue, hubo un hueco, o se acabó el registro. */
    corte?: "entrada" | "se-fue-el-anterior" | "otro-vehiculo" | "hueco" | "fin" };

/**
 * De cuánto parecido para arriba una pista quieta en el lugar es EL MISMO vehículo. Medido el 13/11
 * con las huellas de 61 lugares: el mismo auto consigo mismo, mediana 0,966 (el 5 % más bajo,
 * 0,915); autos distintos de una misma cámara, mediana 0,789 (el 5 % más alto, 0,922). Con 0,90
 * quedaba afuera el 3 % de los mismos y pasaba el 10 % de los otros. Se pide 0,92 —más exigente
 * que lo medido— porque el caso que importa es peor que el de la medición: otro auto en el MISMO
 * lugar comparte encuadre y fondo. Equivocarse para este lado sólo hace que se mire menos atrás.
 */
export const MISMO_VEHICULO = 0.92;
/** Sin ver el vehículo en su lugar más que esto (con la cámara registrando otras cosas), se da por otro. */
export const HUECO_MS = 6 * 60_000;
/**
 * Cuánto antes de la llegada arranca la grabación, según qué tan cierta es: con la entrada
 * encontrada, unos segundos (se lo ve entrar); con la hora del reloj, un poco más (es cuando quedó
 * quieto en su lugar: venía entrando); con sólo «la primera vez que se lo ve» en el registro, un
 * minuto (una escena quieta se analiza cada minuto: entró en ese minuto anterior).
 */
export const ANTES_DE = { llegada: 6_000, "primera-vez": 60_000, "antes-del-registro": 0, reloj: 12_000 } as const;
/** Menos que esto más atrás que el reloj no es «desde antes»: es la misma hora. */
export const GANANCIA_MIN_MS = 20_000;
/** Cuánto después de la hora del reloj puede terminar la pista de entrada y seguir siendo la suya. */
export const MARGEN_MS = 45_000;
/** Si entre que apareció en la escena y quedó en su lugar pasó menos que esto, la grabación arranca cuando apareció. */
export const ENTRADA_MAX_MS = 25_000;

/**
 * ¿El punto de apoyo de un vehículo (el medio de su borde de abajo) está en este lugar? El lugar
 * es una caja [x1, y1, x2, y2]; su punto de apoyo es el medio de su borde de abajo. Se mide contra
 * ESE punto y no «adentro de la caja»: un auto que pasa por detrás tiene el apoyo más arriba, y
 * uno que pasa por delante, más abajo.
 */
export function enElLugar(p: number[], lugar: number[], holgura = 1): boolean {
    const w = lugar[2] - lugar[0], h = lugar[3] - lugar[1], cx = (lugar[0] + lugar[2]) / 2;
    return Math.abs(p[0] - cx) <= w * 0.3 * holgura && Math.abs(p[1] - lugar[3]) <= h * 0.22 * holgura;
}

/** Qué hizo una pista respecto del lugar. */
export function papelDe(p: PistaLugar, lugar: number[]): Papel {
    const r = p.recorrido;
    if (!Array.isArray(r) || !r.length) return "ajena";
    const pri = r[0], ult = r[r.length - 1];
    const empieza = enElLugar(pri, lugar), termina = enElLugar(ult, lugar);
    // «Afuera» tiene que ser bien afuera (una vez y media la holgura): una caja que tiembla no es un auto que se va.
    const lejos = (q: number[]) => !enElLugar(q, lugar, 1.6);
    if (termina && lejos(pri)) return "llega";
    if (empieza && lejos(ult)) return "se-va";
    if (empieza && termina) return r.filter((q) => enElLugar(q, lugar, 1.3)).length >= r.length * 0.8 ? "quieta" : "ajena";
    return "ajena";
}

/** De una pista que llega: el instante desde el que ya no volvió a salir del lugar. */
export function instanteDeLlegada(p: PistaLugar, lugar: number[]): number {
    const r = p.recorrido;
    let k = r.length - 1;
    while (k > 0 && enElLugar(r[k - 1], lugar, 1.3)) k--;
    return p.desde + (Number(r[k][2]) || 0) * 1000;
}

/**
 * Recorre hacia atrás desde la hora del reloj. Se le dan las pistas de la cámara que tocan el
 * lugar, en tandas de más nuevas a más viejas (`sumar`), y contesta cuando encuentra la llegada o
 * dónde se corta; `cerrar` dice lo que se sabe cuando no hay más para mirar.
 *
 * Por qué arranca en el reloj y no en «ahora»: de ahí para acá vision-worker lo vio en cada cuadro
 * que analizó, y eso es más firme que el registro, que para un auto quieto tiene baches (medido:
 * con el reloj en 08:21, el registro no tenía ninguna pista de ese lugar entre las 08:35 y las
 * 15:37). Nunca se contesta una hora posterior a la del reloj.
 *
 * `huboOtraCosa(a, b)`: ¿la cámara registró algo entre esos dos instantes? Decide si un hueco es
 * «no estaba» o «no se miró».
 */
export function buscadorDeLlegada(lugar: number[], op: { ahora: number; reloj?: number | null; huecoMs?: number; parecidoMin?: number; huboOtraCosa: (a: number, b: number) => Promise<boolean> | boolean }) {
    const hueco = op.huecoMs ?? HUECO_MS, parecidoMin = op.parecidoMin ?? MISMO_VEHICULO;
    const reloj = op.reloj != null && op.reloj <= op.ahora ? op.reloj : null;
    // Hasta dónde hacia atrás se sabe que está.
    let inicio = reloj ?? op.ahora;
    // Si no se ganó nada hacia atrás (o unos segundos: la pista del mismo cuadro), lo que vale es la hora del reloj.
    const base = reloj ?? op.ahora;
    const corte = (c: NonNullable<Llegada["corte"]>): Llegada => (inicio > base - GANANCIA_MIN_MS ? { ms: base, como: "reloj", corte: c } : { ms: inicio, como: "primera-vez", corte: c });
    return {
        get inicio() { return inicio; },
        async sumar(pistas: PistaLugar[]): Promise<Llegada | null> {
            for (const p of [...pistas].sort((a, b) => b.hasta - a.hasta)) {
                const papel = papelDe(p, lugar);
                if (papel === "ajena") continue;
                // La entrada puede terminar un poco después de la hora del reloj (la pista sigue abierta mientras se acomoda).
                const t = papel === "llega" ? instanteDeLlegada(p, lugar) : papel === "se-va" ? p.hasta : p.desde;
                if (t > inicio + MARGEN_MS) continue; // es de después de lo que ya se sabe
                // Un hueco largo antes de lo que se sabe: si la cámara siguió registrando, el lugar estuvo sin él.
                if (inicio - p.hasta > hueco && (await op.huboOtraCosa(p.hasta, inicio))) return corte("hueco");
                if (papel === "se-va") return corte("se-fue-el-anterior");
                // Sin huella no se sabe de quién es esa pista: no estira ni corta.
                if (p.parecido == null) continue;
                if (p.parecido < parecidoMin) return corte("otro-vehiculo");
                if (papel === "llega") return { ms: Math.min(t, inicio), como: "llegada", entra: p.desde, corte: "entrada" };
                inicio = Math.min(inicio, p.desde);
            }
            return null;
        },
        /** No hay más pistas. `tope`: hasta dónde llega el registro (lo más viejo que guarda). */
        cerrar(tope: number): Llegada {
            return inicio - tope < HUECO_MS ? { ms: inicio, como: "antes-del-registro", corte: "fin" } : corte("fin");
        },
    };
}

/** Desde dónde se abre la grabación para ver esa llegada. */
export function grabacionDesde(l: Llegada): number {
    if (l.como === "llegada" && l.entra != null && l.ms - l.entra <= ENTRADA_MAX_MS) return l.entra - 2000;
    return l.ms - ANTES_DE[l.como];
}

/** Lo que se le dice al operador cuando no se abrió justo en la entrada. Null si se encontró: no hace falta decir nada. */
export function avisoDeLlegada(l: Llegada, hora: (ms: number) => string): string | null {
    if (l.como === "llegada") return null;
    if (l.como === "primera-vez") return `Se lo ve en ese lugar desde las ${hora(l.ms)}, antes de lo que marca el reloj. La grabación arranca un minuto antes: la entrada misma no quedó registrada.`;
    if (l.como === "antes-del-registro") return `Está ahí desde antes de lo que guarda el registro de detecciones (${hora(l.ms)}).`;
    // La hora del reloj, sin nada anterior en el registro: casi siempre ES la llegada. No hace falta decir nada.
    return null;
}
