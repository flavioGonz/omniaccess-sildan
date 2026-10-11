/**
 * La misma foto, pedida al ancho en que se va a ver.
 *
 * Las capturas de intrusión pesan 350-400 KB (medido el 8/10: 387 KB, 1,6 s cada una) y se
 * mostraban así en miniaturas de 64 px: sesenta renglones eran 23 MB. `/api/files` ya sabe
 * achicarlas y guarda la miniatura en disco; faltaba pedírselo. Este patrón estaba escrito
 * a mano en seis pantallas (`foto.includes("?") ? …&w= : …?w=`).
 */
export function conAncho(url: string | null | undefined, ancho: number): string | null {
    if (!url) return null;
    return url.includes("?") ? `${url}&w=${ancho}` : `${url}?w=${ancho}`;
}
