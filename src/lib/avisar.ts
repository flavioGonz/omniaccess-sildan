/**
 * Mandar un aviso por socket desde el lado de Next.
 *
 * Next y el servidor de sockets son dos procesos distintos: `omniaccess-web` corre
 * next-server.js y `omniaccess-webhooks` corre server.js, que es donde vive `global.io`.
 * Por eso una ruta de API no puede emitir directamente — el puente es `/internal/emit`,
 * que ya existía para el polling ONVIF y hace exactamente esto.
 *
 * Es a propósito que no espera respuesta ni rompe nada si falla. Un aviso es una cortesía
 * para las pantallas que están abiertas: si no llega, el dato igual quedó guardado y la
 * próxima carga lo trae. Hacer que una lectura de matrícula dependa de que un socket
 * conteste sería poner lo importante detrás de lo accesorio.
 */
export function avisarPorSocket(evento: string, datos: Record<string, any>) {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const http = require("http");
        const cuerpo = JSON.stringify({ __event: evento, ...datos });
        const req = http.request({
            hostname: "127.0.0.1",
            port: Number(process.env.WEBHOOK_PORT || 10000),
            path: "/internal/emit",
            method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(cuerpo) },
            timeout: 2000,
        });
        req.on("error", () => { });
        req.on("timeout", () => req.destroy());
        req.write(cuerpo);
        req.end();
    } catch { /* ver el comentario de arriba */ }
}
