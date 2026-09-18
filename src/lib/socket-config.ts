/**
 * De donde y por donde se conecta Socket.IO.
 *
 * El servidor de eventos (server.js, puerto 10000) se publica SIEMPRE a traves de
 * la aplicacion: Next reescribe /io/:path* a localhost:10000/:path*, y next-server
 * hace lo mismo con el upgrade. Por eso el cliente habla con el mismo origen que
 * le sirvio la pagina y con el path /io/socket.io, nunca con el puerto 10000 a mano
 * ni con el path por defecto /socket.io, que ahi no existe y devuelve 404.
 */
export const RUTA_SOCKET = "/io/socket.io";

export function getSocketUrl() {
    if (typeof window === "undefined") return "";
    return window.location.origin;
}

/** Opciones comunes. El transporte queda en polling a proposito: por el dominio el
 *  upgrade a WebSocket pasa por doble proxy y falla con "Invalid frame header". */
export function opcionesSocket(extra: Record<string, any> = {}) {
    return { path: RUTA_SOCKET, transports: ["polling"], upgrade: false, ...extra };
}
