/** El nombre del stream go2rtc del vivo de un contador de fila. Las pantallas de Filas lo arman con la IP. */
export function nombreStreamFila(ip: string): string {
    return `bosch_${ip.replace(/\./g, "_")}`;
}
