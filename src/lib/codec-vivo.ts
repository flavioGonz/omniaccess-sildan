/**
 * Qué códecs pedirle a go2rtc para el vivo en ESTE navegador.
 *
 * go2rtc entrega el video tal como llega de la cámara o del grabador si el navegador lo
 * reproduce; si no, recurre a la fuente de respaldo que convierte a H.264 con ffmpeg (CPU). En
 * los grabadores Dahua y en muchas cámaras el flujo es H.265: pedir sólo `h264` obligaba a
 * convertir SIEMPRE, aunque el navegador supiera mostrar H.265 (Chrome/Edge con decodificación
 * por hardware, Safari). Con `h264,h265` go2rtc elige el original y el servidor no convierte.
 */
let _h265: boolean | null = null;

export function aceptaH265(): boolean {
    if (_h265 !== null) return _h265;
    try {
        const tipos = ['video/mp4; codecs="hvc1.1.6.L120.90"', 'video/mp4; codecs="hev1.1.6.L120.90"'];
        const ms = typeof MediaSource !== "undefined" && tipos.some((t) => MediaSource.isTypeSupported(t));
        const v = typeof document !== "undefined" ? document.createElement("video") : null;
        _h265 = !!(ms || (v && tipos.some((t) => v.canPlayType(t) === "probably")));
    } catch { _h265 = false; }
    return _h265;
}

/** Si un vivo en H.265 no arrancó, el resto de la sesión se pide H.264. */
export function olvidarH265() { _h265 = false; }

/** El valor de `video=` para stream.mp4 / stream.m3u8 de go2rtc. */
export const codecsVivo = () => (typeof window !== "undefined" && aceptaH265() ? "h264,h265" : "h264");
