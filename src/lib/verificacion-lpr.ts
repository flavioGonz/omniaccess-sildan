/**
 * Doble verificación LPR: si la chapa que leyó la cámara coincide con la que leyó OmniVision.
 * Sin base ni red: lo usan las pantallas (ChapaReleida) y la estadística de relecturas.
 *
 * Una letra de diferencia se distingue de «otra chapa»: el OCR confunde 0/O, 8/B, 1/I, y eso no
 * es lo mismo que haber leído otro auto.
 */

/** Lo que las lectoras escriben cuando no leyeron (el mismo conjunto que ChapaReleida). */
const NO_LEIDAS = new Set(["", "NO_LEIDA", "UNKNOWN", "S/P", "NOLEIDA", "SP"]);
type Releida = { plate: string | null; estado: string; confianza?: number | null } | null | undefined;

const normal = (p: string) => p.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Distancia de edición, para chapas (7 caracteres): lo simple alcanza. */
function distancia(a: string, b: string): number {
    const f = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        let prev = f[0]; f[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const t = f[j];
            f[j] = Math.min(f[j] + 1, f[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
            prev = t;
        }
    }
    return f[b.length];
}

export type Comparacion = { estado: "coincide" | "casi" | "difiere" | "sin"; omni: string | null };

/** Null si no hay nada que comparar: la cámara no leyó (eso lo muestra chapaDe) o no hubo relectura. */
export function compararLectura(plate: string | null | undefined, r: Releida): Comparacion | null {
    if (!r || NO_LEIDAS.has(String(plate || "").trim().toUpperCase())) return null;
    if (!(r.plate && (r.estado === "LEIDA" || r.estado === "DUDOSA"))) return { estado: "sin", omni: null };
    const a = normal(String(plate)), b = normal(r.plate);
    if (a === b) return { estado: "coincide", omni: r.plate };
    return { estado: distancia(a, b) <= 1 ? "casi" : "difiere", omni: r.plate };
}

