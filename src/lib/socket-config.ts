export function getSocketUrl() {
    if (typeof window === 'undefined') return '';

    const protocol = window.location.protocol === 'https:' ? 'https' : 'http';
    const hostname = window.location.hostname;
    const port = window.location.port;

    // If we are on a standard port (80/443), we assume the socket is proxied via the main domain
    const isStandardPort = port === '' || port === '80' || port === '443';

    if (isStandardPort) {
        return `${protocol}://${hostname}`;
    }

    // If we are on a non-standard port (like 10001 during dev or local direct access),
    // we assume the socket is on its dedicated port (10000).
    return `${protocol}://${hostname}:10000`;
}

export function getApiUrl() {
    // Return empty string to use relative paths. 
    // This allows Next.js next.config.ts rewrites to proxy requests to port 10000
    // and avoids hydration mismatches/CORS/mixed-content issues.
    return '';
}

/** Path del socket a traves de la aplicacion (Next reescribe /io/* a server.js). */
export const RUTA_SOCKET = "/io/socket.io";
/** Opciones comunes (de san-nicolas): polling por el doble proxy del dominio. */
export function opcionesSocket(extra: Record<string, any> = {}) {
    return { path: RUTA_SOCKET, transports: ["polling"], upgrade: false, ...extra };
}
