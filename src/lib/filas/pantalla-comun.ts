/**
 * Lo de las pantallas de fila que usan tanto el servidor como el navegador (la pantalla pública
 * y su administración). Sin prisma ni crypto: esto viaja al navegador.
 */

/** Desde qué fracción del límite la fila se muestra "en aviso" (ámbar). */
export const FRACCION_AVISO = 0.7;

/** Cada cuánto la pantalla vuelve a preguntar. Lo que dura un paso en la fila, no menos. */
export const REFRESCO_PANTALLA_MS = 5_000;

/** Lo que admite un slug: letras, números y guiones; lo que se tipea cómodo en un televisor. */
export const SLUG_RX = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

/** Pasa un nombre a slug: «Sala de espera 2» → «sala-de-espera-2». */
export function aSlug(texto: string): string {
    return texto
        .normalize("NFD").replace(/[̀-ͯ]/g, "")
        .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "");
}

/** El camino de la pantalla pública. Una sola definición: la usan la tabla, el QR y el cajón. */
export const caminoPantalla = (slug: string, token: string) => `/k/${slug}?t=${token}`;

export type EstadoPantalla = "bien" | "aviso" | "mal" | "quieto";

export type FilaEnPantalla = {
    id: string;
    nombre: string;
    aforo: number | null;
    limite: number;
    esperaMin: number | null;
    estado: EstadoPantalla;
    /** null si la fila no tiene horario; si lo tiene, si está atendiendo ahora. */
    abierta: boolean | null;
};

export function estadoDe(aforo: number | null, limite: number, abierta: boolean | null): EstadoPantalla {
    if (abierta === false || aforo == null) return "quieto";
    if (aforo >= limite) return "mal";
    if (aforo >= limite * FRACCION_AVISO) return "aviso";
    return "bien";
}

/**
 * Lo que dice la pantalla en cada estado. Son las palabras que ya tenía el kiosco: la gente de la
 * sala las lee de lejos, y un cartel que cambia de texto cada semana deja de leerse.
 */
export function rotuloDe(f: Pick<FilaEnPantalla, "estado" | "abierta">): { titulo: string; sub: string } {
    switch (f.estado) {
        case "bien": return { titulo: "PASE", sub: "Hay lugar disponible" };
        case "aviso": return { titulo: "AGUARDE", sub: "Fila moderada" };
        case "mal": return { titulo: "AFORO COMPLETO", sub: "Por favor espere su turno" };
        default: return f.abierta === false
            ? { titulo: "CERRADA", sub: "Fuera del horario de atención" }
            : { titulo: "SIN DATOS", sub: "Esperando la cámara de la fila" };
    }
}

/** La espera en palabras cortas: «<1», «~8». */
export const esperaTexto = (min: number | null) => (min == null ? "—" : min < 1 ? "<1" : `~${min}`);
