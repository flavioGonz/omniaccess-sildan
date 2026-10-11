/**
 * Categorías del Watchlist alineadas al enum UserRole de /admin/users.
 * Fuente única de labels, colores e iconos, compartida por WatchlistDialog y Monitor LPR.
 * Valores canónicos: BLACKLISTED | WHITELISTED | SEARCH (SEARCH no es un UserRole, es un flag de alerta).
 */
export type WatchCategory = "BLACKLISTED" | "WHITELISTED" | "SEARCH";

export interface WatchCatMeta {
    value: WatchCategory;
    label: string;      // etiqueta corta (coincide con el vocabulario de roles)
    iconKey: "ban" | "star" | "search";
    ring: string;       // borde/resplandor de la card en el monitor
    badge: string;      // chip (bg + text + border)
    text: string;       // color de texto
    dot: string;        // punto/acento
}

export const WATCH_CATEGORIES: Record<WatchCategory, WatchCatMeta> = {
    BLACKLISTED: {
        value: "BLACKLISTED",
        label: "Lista negra",
        iconKey: "ban",
        ring: "ring-2 ring-red-500/70 shadow-[0_0_0_2px_rgba(239,68,68,0.35)]",
        badge: "chip-mal",
        text: "tono-mal",
        dot: "bg-red-500",
    },
    WHITELISTED: {
        value: "WHITELISTED",
        label: "VIP / Autorizado",
        iconKey: "star",
        // Verde y no violeta: es PERMITIDO, y el verde es el tono de "salió bien / pasa". El
        // violeta no decía nada y se confundía con un aviso.
        ring: "ring-2 ring-emerald-500/70 shadow-[0_0_0_2px_rgba(16,185,129,0.35)]",
        badge: "chip-bien",
        text: "tono-bien",
        dot: "bg-emerald-500",
    },
    SEARCH: {
        value: "SEARCH",
        label: "En búsqueda",
        iconKey: "search",
        ring: "ring-2 ring-amber-500/70 shadow-[0_0_0_2px_rgba(245,158,11,0.35)]",
        badge: "chip-aviso",
        text: "tono-aviso",
        dot: "bg-amber-500",
    },
};

/**
 * Normaliza cualquier valor viejo/nuevo a la categoría canónica, o `null` si no es ninguna.
 *
 * Antes lo desconocido se convertía en BLACKLISTED. Eso es lo contrario de lo que se quiere:
 * un valor mal escrito no puede poner un auto en lista negra en silencio. Quien escribe
 * rechaza el `null`; quien muestra usa `watchCatMeta`, que para `null` devuelve una meta
 * gris de "sin categoría" en vez de inventar una.
 */
export function normalizeWatchCat(x: string | null | undefined): WatchCategory | null {
    const s = (x || "").toString().trim().toUpperCase();
    if (s === "NEGRA" || s === "BLACKLIST" || s === "BLACKLISTED") return "BLACKLISTED";
    if (s === "VIP" || s === "WHITELIST" || s === "WHITELISTED") return "WHITELISTED";
    if (s === "BUSCA" || s === "SEARCH") return "SEARCH";
    return null;
}

/** Meta neutra para una categoría que no se reconoce: se ve, pero no se pinta de nada. */
export const WATCH_SIN_CATEGORIA: WatchCatMeta = {
    value: "SEARCH",
    label: "Sin categoría",
    iconKey: "search",
    ring: "",
    badge: "bg-muted text-muted-foreground border-border",
    text: "text-muted-foreground",
    dot: "bg-muted-foreground",
};

export function watchCatMeta(x: string | null | undefined): WatchCatMeta {
    const c = normalizeWatchCat(x);
    return c ? WATCH_CATEGORIES[c] : WATCH_SIN_CATEGORIA;
}

/**
 * Qué hace cada categoría, en palabras del operador. Es la explicación que ve quien carga una
 * matrícula (tooltip en el diálogo del monitor, bloque en la pestaña de Usuarios), y tiene que
 * decir la verdad de lo que el sistema hace, no lo que uno desearía que hiciera.
 */
/* `monitores` es la pantalla Control LPR del centro de monitoreo (/monitores), distinta del
   «monitor» de la consola de accesos: el operador las mira a las dos y hacen cosas distintas. */
export type EfectoCategoria = { barrera: string; camaras: string; monitor: string; monitores: string; avisos: string };
export const WATCH_EFECTOS: Record<WatchCategory, EfectoCategoria> = {
    BLACKLISTED: {
        barrera: "Toda lectura de esta matrícula se registra DENEGADA, aunque tenga credencial, aunque el modo LPR la permita y aunque la cámara la haya devuelto como permitida.",
        camaras: "Se saca de la lista blanca de las lectoras LPR y se carga en su lista negra, en el momento. Si una lectora no responde, se avisa: la barrera la deniega igual por servidor.",
        monitor: "La tarjeta aparece en rojo y en la pila de alertas críticas, con sonido urgente, también al recargar la pantalla.",
        monitores: "En Control LPR la lectura sale en grande como LISTA NEGRA con su motivo, queda 24 h en la fila de atención y suena si la vista tiene el sonido prendido.",
        avisos: "Dispara el evento WATCHLIST del motor de notificaciones (WhatsApp, Telegram) con la foto.",
    },
    WHITELISTED: {
        barrera: "No cambia la decisión: sigue mandando la credencial y el modo LPR. Es una marca para el operador, no un permiso.",
        camaras: "No toca las listas de la cámara.",
        monitor: "La tarjeta se destaca en verde como VIP.",
        monitores: "Las pantallas de Monitores no la distinguen: se ve como una lectura más.",
        avisos: "Aviso suave en el monitor; no dispara alertas críticas.",
    },
    SEARCH: {
        barrera: "No cambia la decisión: sigue mandando la credencial y el modo LPR.",
        camaras: "No toca las listas de la cámara.",
        monitor: "La tarjeta se destaca en ámbar con el motivo y, si está prendido «Sonido al pasar» en la pestaña Lista negra, suena el aviso corto.",
        monitores: "En Control LPR queda 24 h en la fila de atención como EN BÚSQUEDA, con su motivo, y suena el aviso corto si la pantalla tiene sonido y «Sonido al pasar» está prendido.",
        avisos: "Dispara el evento WATCHLIST del motor de notificaciones si hay una regla que lo escuche.",
    },
};

/**
 * Lo que se ofrece al CARGAR: los dos niveles de la lista negra. VIP ya no se carga por
 * matrícula —es una marca de la persona (Residentes, Personal)—; las filas VIP que quedaron
 * siguen valiendo en el monitor y se ven con `watchCatMeta`.
 */
export const WATCH_CATEGORY_LIST: WatchCatMeta[] = [
    WATCH_CATEGORIES.BLACKLISTED,
    WATCH_CATEGORIES.SEARCH,
];
