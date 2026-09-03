/** Parser de consultas en lenguaje natural para los eventos de acceso LPR.
 *  Traduce "camioneta blanca ayer a la tarde por P7" → filtros sobre AccessEvent
 *  (color / tipo / marca / dirección / cámara / rango horario / matrícula parcial).
 *  Sin IA: diccionario español → valores que escribe el driver Hikvision en `details`.
 */

export interface ParsedQuery {
    colors: string[];        // valores tal como los guarda el driver: "Blanco", "Negro", ...
    types: string[];         // "SUVMPV", "pickupTruck", ...
    brands: string[];        // "Toyota", "BYD", ...
    direction?: "ENTRY" | "EXIT";
    decision?: "GRANT" | "DENY";
    plate?: string;          // fragmento de matrícula (>=3 alfanuméricos)
    cameraHint?: string;     // "P7", "P1", ...
    from?: Date; to?: Date;  // rango absoluto derivado de "ayer", "esta semana", ...
    hourFrom?: number; hourTo?: number; // franja del día ("a la tarde", "de noche")
    chips: string[];         // etiquetas legibles de lo que se entendió
    unmatched: string[];     // palabras que no se pudieron interpretar
}

/* ── diccionarios ── */
const COLORS: Record<string, string[]> = {
    Blanco: ["blanco", "blanca", "blancos", "blancas", "white"],
    Negro: ["negro", "negra", "negros", "negras", "black"],
    Gris: ["gris", "grises", "gray", "grey", "plomo"],
    Azul: ["azul", "azules", "blue", "celeste"],
    Rojo: ["rojo", "roja", "rojos", "rojas", "red", "bordo", "bordó"],
    Amarillo: ["amarillo", "amarilla", "yellow", "dorado", "dorada"],
    Verde: ["verde", "verdes", "green"],
    Cian: ["cian", "cyan", "turquesa"],
    Silver: ["plateado", "plateada", "plata", "silver"],
    Marron: ["marron", "marrón", "brown", "beige", "cafe", "café"],
};
const TYPES: Record<string, string[]> = {
    SUVMPV: ["suv", "suvs", "camioneta", "camionetas", "4x4", "todoterreno", "utilitario deportivo", "monovolumen", "minivan"],
    pickupTruck: ["pickup", "pick up", "pick-up", "chata", "chatas", "camioneta de caja", "hilux", "ranger"],
    vehicle: ["auto", "autos", "coche", "coches", "carro", "carros", "sedan", "sedán", "vehiculo", "vehículo", "vehiculos", "vehículos"],
    van: ["van", "vans", "furgon", "furgón", "furgoneta", "utilitario"],
    truck: ["camion", "camión", "camiones", "truck", "carga"],
    bus: ["bus", "buses", "omnibus", "ómnibus", "colectivo", "micro"],
    buggy: ["buggy", "buggies", "carrito", "carrito de golf", "golf cart", "cuatriciclo"],
    motorcycle: ["moto", "motos", "motocicleta", "motocicletas", "ciclomotor"],
};
const BRANDS = ["Toyota", "Ford", "Volkswagen", "Chevrolet", "Fiat", "Renault", "Peugeot", "Citroen", "Citroën", "Honda", "Hyundai", "Kia", "Nissan",
    "Mercedes-Benz", "Mercedes", "Benz", "BMW", "Audi", "Jeep", "Dodge", "RAM", "Volvo", "Mitsubishi", "Suzuki", "Mazda", "Subaru", "Chery",
    "BYD", "Tesla", "Land Rover", "Porsche", "Lexus", "Isuzu", "Opel", "Geely", "Haval", "JAC", "Foton", "Great Wall", "Seat", "Skoda", "Iveco", "Scania"];
const DIRECTION: Record<"ENTRY" | "EXIT", string[]> = {
    ENTRY: ["entrada", "entradas", "entrando", "entro", "entró", "ingreso", "ingresó", "ingresaron", "que entraron", "in"],
    EXIT: ["salida", "salidas", "saliendo", "salio", "salió", "salieron", "egreso", "out"],
};
const DECISION: Record<"GRANT" | "DENY", string[]> = {
    DENY: ["denegado", "denegados", "denegada", "denegadas", "rechazado", "rechazados", "rechazada", "rechazadas", "no autorizado", "no autorizados", "no autorizada", "no autorizadas", "sin autorizar", "desconocido", "desconocidos", "desconocida", "desconocidas", "no registrado", "no registrados", "visita", "visitas", "ajeno", "ajenos", "extraño", "extraños"],
    GRANT: ["autorizado", "autorizados", "autorizada", "autorizadas", "permitido", "permitidos", "permitida", "permitidas", "residente", "residentes", "vecino", "vecinos", "propietario", "propietarios"],
};
const DAYPARTS: { k: string[]; from: number; to: number; label: string }[] = [
    { k: ["madrugada", "de madrugada"], from: 0, to: 6, label: "madrugada (00–06 h)" },
    { k: ["mañana", "manana", "a la mañana", "de mañana", "temprano"], from: 6, to: 12, label: "mañana (06–12 h)" },
    { k: ["mediodia", "mediodía", "al mediodia", "al mediodía"], from: 11, to: 15, label: "mediodía (11–15 h)" },
    { k: ["tarde", "a la tarde", "de tarde", "por la tarde"], from: 12, to: 20, label: "tarde (12–20 h)" },
    { k: ["noche", "de noche", "a la noche", "nocturno", "nocturnos"], from: 20, to: 24, label: "noche (20–24 h)" },
];

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

/** Reconoce fechas relativas frecuentes; devuelve rango + etiqueta + longitud consumida. */
function parseDates(q: string): { from?: Date; to?: Date; label?: string; hit?: string } {
    const now = new Date();
    const tests: { re: RegExp; f: () => { from: Date; to: Date; label: string } }[] = [
        { re: /\bhoy\b/, f: () => ({ from: startOfDay(now), to: now, label: "hoy" }) },
        { re: /\bayer\b/, f: () => { const a = startOfDay(new Date(now.getTime() - 86400000)); return { from: a, to: new Date(a.getTime() + 86399999), label: "ayer" }; } },
        { re: /\banteayer\b|\bantes de ayer\b/, f: () => { const a = startOfDay(new Date(now.getTime() - 2 * 86400000)); return { from: a, to: new Date(a.getTime() + 86399999), label: "anteayer" }; } },
        { re: /\besta semana\b|\bsemana\b/, f: () => ({ from: startOfDay(new Date(now.getTime() - 7 * 86400000)), to: now, label: "últimos 7 días" }) },
        { re: /\beste mes\b|\bmes\b|\b30 dias\b|\b30 días\b/, f: () => ({ from: startOfDay(new Date(now.getTime() - 30 * 86400000)), to: now, label: "últimos 30 días" }) },
        { re: /\bfin de semana\b/, f: () => ({ from: startOfDay(new Date(now.getTime() - 7 * 86400000)), to: now, label: "fin de semana (últimos 7 días)" }) },
        { re: /\bultimas? (\d{1,3}) ?(h|hs|horas)\b|\búltimas? (\d{1,3}) ?(h|hs|horas)\b/, f: () => { const m = q.match(/(\d{1,3}) ?(h|hs|horas)/); const n = m ? parseInt(m[1]) : 24; return { from: new Date(now.getTime() - n * 3600000), to: now, label: `últimas ${n} h` }; } },
        { re: /\bultimos? (\d{1,3}) ?(d|dias|días)\b|\búltimos? (\d{1,3}) ?(d|dias|días)\b/, f: () => { const m = q.match(/(\d{1,3}) ?(d|dias|días)/); const n = m ? parseInt(m[1]) : 7; return { from: startOfDay(new Date(now.getTime() - n * 86400000)), to: now, label: `últimos ${n} días` }; } },
    ];
    for (const t of tests) if (t.re.test(q)) { const r = t.f(); return { ...r, hit: t.re.source }; }
    return {};
}

export function parseLprQuery(raw: string): ParsedQuery {
    const q = norm(raw || "");
    const out: ParsedQuery = { colors: [], types: [], brands: [], chips: [], unmatched: [] };
    const consumed: string[] = [];
    const take = (words: string[]) => words.forEach(w => consumed.push(norm(w)));

    for (const [val, keys] of Object.entries(COLORS)) {
        const hit = keys.find(k => new RegExp(`\\b${k}\\b`).test(q));
        if (hit) { out.colors.push(val); out.chips.push(`color ${val.toLowerCase()}`); take([hit]); }
    }
    for (const [val, keys] of Object.entries(TYPES)) {
        const hit = keys.find(k => new RegExp(`\\b${k.replace(/ /g, "\\s+")}\\b`).test(q));
        if (hit) { out.types.push(val); out.chips.push(hit); take(hit.split(" ")); }
    }
    for (const b of BRANDS) {
        if (new RegExp(`\\b${norm(b).replace(/[-\s]/g, "[-\\s]?")}\\b`).test(q)) { out.brands.push(b); out.chips.push(b); take(b.split(/[\s-]/)); }
    }
    for (const [dir, keys] of Object.entries(DIRECTION)) {
        const hit = keys.find(k => new RegExp(`\\b${k.replace(/ /g, "\\s+")}\\b`).test(q));
        if (hit && !out.direction) { out.direction = dir as any; out.chips.push(dir === "ENTRY" ? "entradas" : "salidas"); take(hit.split(" ")); }
    }
    for (const [dec, keys] of Object.entries(DECISION)) {
        const hit = keys.find(k => new RegExp(`\\b${k.replace(/ /g, "\\s+")}\\b`).test(q));
        if (hit && !out.decision) { out.decision = dec as any; out.chips.push(dec === "DENY" ? "no autorizados" : "autorizados"); take(hit.split(" ")); }
    }
    for (const d of DAYPARTS) {
        const hit = d.k.find(k => new RegExp(`\\b${k.replace(/ /g, "\\s+")}\\b`).test(q));
        if (hit && out.hourFrom == null) { out.hourFrom = d.from; out.hourTo = d.to; out.chips.push(d.label); take(hit.split(" ")); }
    }
    const dates = parseDates(q);
    if (dates.from) { out.from = dates.from; out.to = dates.to; out.chips.push(dates.label!); take(["hoy", "ayer", "anteayer", "semana", "mes", "dias", "días", "horas", "ultimas", "últimas", "ultimos", "últimos", "fin", "de", "esta", "este", "30"]); }

    // cámara / acceso: "P7", "por P1", "porton 3"
    const cam = q.match(/\bp\s?(\d{1,2})\b/);
    if (cam) { out.cameraHint = `P${cam[1]}`; out.chips.push(`acceso P${cam[1]}`); take([cam[0]]); }

    // matrícula: token alfanumérico de 5-8 con letras Y números (evita "P7" o "30")
    const plate = raw.toUpperCase().match(/\b(?=[A-Z0-9]{5,8}\b)(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]{5,8}\b/);
    if (plate) { out.plate = plate[0]; out.chips.push(`matrícula ${plate[0]}`); take([plate[0]]); }

    const stop = new Set(["", "el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del", "al", "a", "en", "por", "con", "que", "y", "o", "para", "buscar", "busca", "mostrar", "muestra", "todos", "todas", "hubo", "paso", "pasaron", "vino", "vinieron", "ultimo", "ultima"]);
    out.unmatched = q.split(/[\s,.;]+/).filter(w => w && !stop.has(w) && !consumed.some(c => c && (w === c || w.includes(c) || c.includes(w))));
    return out;
}

/** Etiqueta legible del tipo Hikvision. */
export const TYPE_ES: Record<string, string> = {
    SUVMPV: "SUV / camioneta", pickupTruck: "pickup", vehicle: "auto", van: "van",
    truck: "camión", bus: "ómnibus", buggy: "buggy", motorcycle: "moto", unknown: "sin clasificar",
};
