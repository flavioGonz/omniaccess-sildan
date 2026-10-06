/**
 * Cómo se leyó una matrícula y con qué confianza, a partir de `AccessEvent.details`.
 *
 * Las lectoras de barrera (ANPR de la cámara) y las cámaras que lee el contenedor por
 * RTSP dejan el mismo par en `details`: `Metodo: ANPR|RTSP Detect` y `Confianza: NN%`.
 * Se lee acá, en un solo lugar, para que el monitor, el historial y el reporte digan lo
 * mismo. Un evento anterior a esto no trae ninguno de los dos y devuelve nulls: la
 * pantalla muestra "sin dato", no un número inventado.
 */
export type MetodoLectura = { metodo: string | null; confianza: number | null };

export function metodoDeLectura(details: string | null | undefined): MetodoLectura {
    const d = String(details || "");
    const m = d.match(/Metodo:\s*([^,]+)/i);
    const c = d.match(/Confianza:\s*(\d{1,3})\s*%/i);
    return {
        metodo: m ? m[1].trim() : null,
        confianza: c ? Math.max(0, Math.min(100, Number(c[1]))) : null,
    };
}

/** Texto corto para un chip: "RTSP Detect · 87 %", "ANPR · s/d" o "" si no hay nada que decir. */
export function rotuloLectura(details: string | null | undefined): string {
    const { metodo, confianza } = metodoDeLectura(details);
    if (!metodo && confianza == null) return "";
    return `${metodo || "Lectura"} · ${confianza != null ? `${confianza} %` : "s/d"}`;
}
