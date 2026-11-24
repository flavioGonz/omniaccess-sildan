/**
 * Monitor Face: lo que se calcula sobre las capturas sin tocar la base (24/11). Lo usan la acción
 * del servidor, la pantalla y las pruebas.
 *
 * Nico, sobre la pantalla que se llamaba «Bitácora de equipos»: «está mal nombrada. Es un historial
 * de Face, capturas de rostros, no tiene que ver con bitácora… debe ser Monitor Face… debemos
 * depurar más esa sección, mejorar el reco facial y datos analizados de capturas».
 *
 * Lo que había que depurar salió de medir el lab (17 al 24/11, el portero DS-KV9503):
 *   · 3.409 capturas en 7 días, y 1.890 (55 %) «sin comparar» porque la cara medía menos de lo que
 *     pide el motor. Ocupaban la pantalla con baldosas de «Sin identificar» que no dicen nada.
 *   · De las 8.331 sin comparar de todas las cámaras, 3.783 caían a menos de 20 s de otra captura
 *     del mismo equipo: es la misma persona partida en varias pistas, no varias personas.
 * De ahí la ráfaga (`agruparRafagas`): las capturas seguidas de un mismo equipo que pueden ser la
 * misma persona se muestran como UNA, con la mejor cara al frente y las demás adentro.
 */

/** Qué se decidió con la cara: las cuatro de OmniVision (vision-rostros.js) y lo que contó el propio equipo. */
export type IdentidadPaso = "padron" | "misma" | "nueva" | "sin-cara" | "equipo";

/** El filtro de arriba. «tarjeta» son las pasadas con tarjeta, clave o huella: en un Monitor Face no van por defecto mezcladas con las caras, pero tampoco se esconden. */
export type QueMostrar = "todas" | "identificadas" | "sin-comparar" | "negadas" | "tarjeta";
export const QUE_MOSTRAR: { id: QueMostrar; rotulo: string; ayuda: string }[] = [
    { id: "todas", rotulo: "Todas", ayuda: "Cada captura, con las ráfagas de una misma persona juntas." },
    { id: "identificadas", rotulo: "Identificadas", ayuda: "Las que el motor comparó: del padrón, ya vistas antes o nuevas. Y las que reconoció el propio equipo." },
    { id: "sin-comparar", rotulo: "Sin comparar", ayuda: "La cara no alcanzaba (chica o dudosa): quedó la foto, pero no se sabe quién es." },
    { id: "negadas", rotulo: "Negadas", ayuda: "El equipo no abrió." },
    { id: "tarjeta", rotulo: "Tarjeta y clave", ayuda: "Pasadas sin cara: tarjeta, clave o huella, contadas por el equipo." },
];

/** Dos capturas del mismo equipo más juntas que esto pueden ser la misma persona partida en dos pistas (ver arriba: 3.783 de 8.331). */
export const VENTANA_RAFAGA_MS = 20_000;

/** Lo mínimo de una captura para agruparla. */
export type PasoAgrupable = {
    id: string; cuando: string; deviceId: string | null; fuente: "equipo" | "omnivision";
    identidad: IdentidadPaso; rostroId: string | null; caraPx: number | null;
};

export type Rafaga<T> = { cabeza: T; resto: T[] };

/** Cuál de dos capturas va al frente de la ráfaga: la que dice quién es, y entre iguales la cara más grande. */
const PESO: Record<IdentidadPaso, number> = { equipo: 5, padron: 4, misma: 3, nueva: 2, "sin-cara": 1 };
function mejor<T extends PasoAgrupable>(a: T, b: T): T {
    if (PESO[a.identidad] !== PESO[b.identidad]) return PESO[a.identidad] > PESO[b.identidad] ? a : b;
    return (b.caraPx ?? -1) > (a.caraPx ?? -1) ? b : a;
}

/**
 * Junta las capturas seguidas de un mismo equipo que pueden ser una sola persona. `pasos` viene del
 * más nuevo al más viejo, y las ráfagas salen en ese mismo orden.
 *
 * Qué NO se junta nunca, y por qué:
 *   · lo que contó el equipo: es una decisión de la puerta (abrió o no), y cada una cuenta;
 *   · dos identidades distintas: son dos personas, aunque pasen juntas;
 *   · capturas separadas por más de `ventana` de la anterior de la ráfaga.
 * Una captura sin comparar sí se suma a la ráfaga de una identificada: es lo que se midió (la misma
 * persona, partida en pistas, con la cara buena en una sola).
 */
export function agruparRafagas<T extends PasoAgrupable>(pasos: T[], ventana = VENTANA_RAFAGA_MS): Rafaga<T>[] {
    type Abierta = { r: Rafaga<T>; ultima: number; rostro: string | null };
    const salida: Rafaga<T>[] = [];
    const abiertas = new Map<string, Abierta>();
    for (const p of pasos) {
        const t = new Date(p.cuando).getTime();
        const clave = p.deviceId || "—";
        const a = abiertas.get(clave);
        const junta = !!a && p.fuente === "omnivision" && a.r.cabeza.fuente === "omnivision" && a.ultima - t <= ventana
            && (!p.rostroId || !a.rostro || p.rostroId === a.rostro);
        if (a && junta) {
            const nueva = mejor(a.r.cabeza, p);
            if (nueva !== a.r.cabeza) { a.r.resto.unshift(a.r.cabeza); a.r.cabeza = nueva; } else a.r.resto.push(p);
            a.ultima = t;
            a.rostro = a.rostro || p.rostroId;
            continue;
        }
        const r: Rafaga<T> = { cabeza: p, resto: [] };
        salida.push(r);
        abiertas.set(clave, { r, ultima: t, rostro: p.rostroId });
    }
    return salida;
}

export type UmbralesFace = { misma: number; parecida: number; padron: number; pxMin: number };

/** El tono de cada identidad, con las clases de estado de la casa (no de acción). */
export const TONO_IDENTIDAD: Record<IdentidadPaso, "bien" | "info" | "quieto" | "aviso"> = {
    padron: "bien", misma: "info", nueva: "quieto", "sin-cara": "aviso", equipo: "bien",
};

/** El rótulo corto de una captura: lo que va en el chip de la baldosa. */
export function rotuloIdentidad(p: { identidad: IdentidadPaso; veces: number | null; sinIdentidad: string | null; tipo: string | null; decision: string | null }): string {
    switch (p.identidad) {
        case "padron": return "Del padrón";
        case "misma": return p.veces && p.veces > 1 ? `Vista ${p.veces} veces` : "Ya vista";
        case "nueva": return "Primera vez";
        case "sin-cara": return /cara chica/.test(p.sinIdentidad || "") ? "Cara chica" : /dudosa/.test(p.sinIdentidad || "") ? "Cara dudosa" : "Sin comparar";
        default: return p.decision === "DENY" ? "Negado por el equipo" : p.tipo === "FACE" ? "Reconoció el equipo" : "Lo contó el equipo";
    }
}

const pct = (v: number) => `${Math.round(v * 100)} %`;

/**
 * Por qué se decidió lo que se decidió, en una frase, con los números. Es la diferencia entre «R-0012»
 * y «se parece 84 % a R-0012; desde el 80 % se suma sola»: lo segundo deja juzgar si está bien.
 */
export function explicarIdentidad(p: { identidad: IdentidadPaso; similitud: number | null; persona: string | null; caraPx: number | null; sinIdentidad: string | null }, u: UmbralesFace): string {
    const s = p.similitud != null ? p.similitud / 100 : null;
    switch (p.identidad) {
        case "padron":
            return `Se parece ${s != null ? pct(s) : "lo suficiente"} a ${p.persona || "alguien del padrón"}; el padrón pide ${pct(u.padron)} o más.`;
        case "misma":
            return `Se parece ${s != null ? pct(s) : "lo suficiente"} a ${p.persona || "una cara ya vista"}; desde el ${pct(u.misma)} se suma sola a esa identidad.`;
        case "nueva":
            if (s != null && s >= u.parecida) return `Se parece ${pct(s)} a otra cara: entre ${pct(u.parecida)} y ${pct(u.misma)} no se decide solo. Nació ${p.persona || "una identidad nueva"} con la sugerencia de unirlas.`;
            return `No se parece a nadie${s != null ? ` (lo más parecido, ${pct(s)})` : ""}: nació ${p.persona || "una identidad nueva"}, que se va a reconocer la próxima vez.`;
        case "sin-cara": {
            const m = p.sinIdentidad || "";
            if (/cara chica/.test(m)) return `La cara mide ${p.caraPx ?? "?"} px y el motor pide ${u.pxMin}: con menos confunde personas distintas. Quedó la foto, sin saber quién es.`;
            if (/dudosa/.test(m)) return `El motor no estaba seguro de que fuera una cara (${m.replace(/^cara dudosa\s*/, "").replace(/[()]/g, "")}). Quedó la foto, sin comparar.`;
            if (m) return `${m[0].toUpperCase()}${m.slice(1)}: quedó la foto, sin comparar.`;
            return "La cara no alcanzaba para comparar.";
        }
        default:
            return "Lo decidió el propio equipo con su base: OmniAccess lo registra tal como lo contó.";
    }
}

/** Tramos del tamaño de cara para el resumen, armados alrededor del mínimo que pide el motor. */
export function tramosDeTamano(pxMin: number): { hasta: number; rotulo: string }[] {
    const mitad = Math.round(pxMin / 2);
    return [
        { hasta: mitad, rotulo: `menos de ${mitad} px` },
        { hasta: pxMin, rotulo: `${mitad} a ${pxMin - 1} px` },
        { hasta: pxMin * 2, rotulo: `${pxMin} a ${pxMin * 2 - 1} px` },
        { hasta: Infinity, rotulo: `${pxMin * 2} px o más` },
    ];
}

/** La identidad de una fila, leída de su `details` (lo de OmniVision) o de quién la contó. */
export function identidadDe(nuestro: boolean, identidad: string | null): IdentidadPaso {
    if (!nuestro) return "equipo";
    return identidad === "padron" || identidad === "misma" || identidad === "nueva" ? identidad : "sin-cara";
}
