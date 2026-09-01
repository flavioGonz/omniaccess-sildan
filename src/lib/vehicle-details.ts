/**
 * Parser de metadatos de vehículo guardados por el webhook ANPR dentro de
 * AccessEvent.details, con forma:
 *   "[ALERTA: ...] Marca: X, Modelo: Y, Color: Z, Tipo: W, Source: Server[, PlateRect: ...][, PlateCrop: ...]"
 * Retrocompatible: funciona sobre TODO el histórico ya guardado (no requiere migración).
 */
export interface VehicleMeta {
    brand: string | null;
    model: string | null;
    color: string | null;      // texto en español tal cual lo guarda el server
    type: string | null;
    source: string | null;     // "Camera" | "Server"
    unknownPlate: boolean;
    colorHex: string | null;   // swatch para la UI
    typeLabel: string;         // etiqueta normalizada
    hasAny: boolean;
}

const COLOR_HEX: Record<string, string> = {
    "blanco": "#f1f5f9", "plateado": "#cbd5e1", "gris": "#6b7280", "negro": "#1f2937",
    "rojo": "#ef4444", "azul": "#3b82f6", "azul oscuro": "#1e3a8a", "amarillo": "#eab308",
    "verde": "#22c55e", "marrón": "#92400e", "marron": "#92400e", "rosa": "#ec4899",
    "púrpura": "#a855f7", "purpura": "#a855f7", "cian": "#06b6d4", "naranja": "#f97316",
};

// claves normalizadas (sólo letras minúsculas): "SUV/MPV" y "SUVMPV" → "suvmpv"
const TYPE_LABELS: Record<string, string> = {
    "sedan": "Sedán", "saloon": "Sedán", "suv": "SUV", "suvmpv": "SUV", "mpv": "Minivan",
    "hatchback": "Hatchback", "truck": "Camión", "lorry": "Camión", "bus": "Bus",
    "van": "Van", "pickup": "Pickup", "motorcycle": "Moto", "motorbike": "Moto",
    "bicycle": "Bici", "taxi": "Taxi", "trailer": "Remolque", "largebus": "Bus",
    "largetruck": "Camión", "smalltruck": "Camión chico",
};

function grab(details: string, key: string): string | null {
    const m = details.match(new RegExp(`${key}:\\s*([^,]+?)\\s*(?:,|$)`, "i"));
    if (!m) return null;
    const v = m[1].trim();
    if (!v || /^unknown$/i.test(v) || v === "-") return null;
    return v;
}

export function parseVehicleMeta(details?: string | null): VehicleMeta {
    const empty: VehicleMeta = { brand: null, model: null, color: null, type: null, source: null, unknownPlate: false, colorHex: null, typeLabel: "", hasAny: false };
    if (!details || typeof details !== "string") return empty;
    // ignorar detalles de rostro
    if (/^Rostro:/i.test(details) && !/Marca:/i.test(details)) return empty;

    const brand = grab(details, "Marca");
    const model = grab(details, "Modelo");
    const color = grab(details, "Color");
    const type = grab(details, "Tipo");
    const source = grab(details, "Source");
    const unknownPlate = /Matr[íi]cula No Reconocida/i.test(details);
    const colorHex = color ? (COLOR_HEX[color.toLowerCase()] || "#9ca3af") : null;
    const typeKey = type ? type.toLowerCase().replace(/[^a-z]/g, "") : "";
    const typeLabel = type ? (TYPE_LABELS[typeKey] || TYPE_LABELS[type.toLowerCase()] || type) : "";
    const hasAny = !!(brand || model || color || type);
    return { brand, model, color, type, source, unknownPlate, colorHex, typeLabel, hasAny };
}

/** Valores únicos para poblar filtros (a partir de una lista de eventos) */
export function collectVehicleFacets(events: { details?: string | null }[]) {
    const colors = new Set<string>(); const types = new Set<string>();
    for (const e of events) {
        const m = parseVehicleMeta(e.details);
        if (m.color) colors.add(m.color);
        if (m.typeLabel) types.add(m.typeLabel);
    }
    return { colors: Array.from(colors).sort(), types: Array.from(types).sort() };
}
