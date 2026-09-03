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
        badge: "bg-red-500/10 text-red-400 border-red-500/20",
        text: "text-red-400",
        dot: "bg-red-500",
    },
    WHITELISTED: {
        value: "WHITELISTED",
        label: "VIP / Autorizado",
        iconKey: "star",
        ring: "ring-2 ring-violet-500/70 shadow-[0_0_0_2px_rgba(139,92,246,0.35)]",
        badge: "bg-violet-500/10 text-violet-400 border-violet-500/20",
        text: "text-violet-400",
        dot: "bg-violet-500",
    },
    SEARCH: {
        value: "SEARCH",
        label: "En búsqueda",
        iconKey: "search",
        ring: "ring-2 ring-amber-500/70 shadow-[0_0_0_2px_rgba(245,158,11,0.35)]",
        badge: "bg-amber-500/10 text-amber-400 border-amber-500/20",
        text: "text-amber-400",
        dot: "bg-amber-500",
    },
};

/** Normaliza cualquier valor viejo/nuevo a la categoría canónica */
export function normalizeWatchCat(x: string | null | undefined): WatchCategory {
    const s = (x || "").toString().toUpperCase();
    if (s === "NEGRA" || s === "BLACKLIST" || s === "BLACKLISTED") return "BLACKLISTED";
    if (s === "VIP" || s === "WHITELIST" || s === "WHITELISTED") return "WHITELISTED";
    if (s === "BUSCA" || s === "SEARCH") return "SEARCH";
    return "BLACKLISTED";
}

export function watchCatMeta(x: string | null | undefined): WatchCatMeta {
    return WATCH_CATEGORIES[normalizeWatchCat(x)];
}

export const WATCH_CATEGORY_LIST: WatchCatMeta[] = [
    WATCH_CATEGORIES.BLACKLISTED,
    WATCH_CATEGORIES.WHITELISTED,
    WATCH_CATEGORIES.SEARCH,
];
