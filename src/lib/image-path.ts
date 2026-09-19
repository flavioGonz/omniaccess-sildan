/**
 * De cómo quedó guardada una imagen, a la URL con la que se la pide.
 *
 * Conviven dos formas de guardar, y esta función existe para que el resto de la aplicación
 * no tenga que saber cuál le tocó:
 *
 *   **Un camino de archivo** — `capturas/abc.jpg` — que sirve el endpoint de archivos.
 *   **Una URL de la propia aplicación** — `/api/tracking/shot/SDM1707-1789…jpg` — que es lo
 *   que guarda el seguimiento, porque esas capturas no son archivos sueltos: las arma una
 *   ruta a pedido.
 *
 * El segundo caso NO estaba contemplado y por eso las capturas de seguimiento daban 404: se
 * les anteponía el prefijo de archivos y terminaban pidiéndose como
 * `/api/files/api/tracking/shot/…`. Se notó recién cuando el padrón de vehículos empezó a
 * mostrar la última foto sacándola también del seguimiento, pero el defecto estaba acá
 * desde antes — esperando a que alguien le pasara una URL en vez de un camino.
 *
 * La regla es una sola y se lee sola: **si ya es una ruta de la aplicación, se devuelve tal
 * cual.** Cualquier endpoint que se agregue mañana entra sin tocar nada.
 */
export const getImagePath = (path: string | null | undefined) => {
    if (!path) return null;
    if (path.startsWith('http')) return path;

    // Normalizar: sin la barra inicial, para poder comparar el prefijo.
    const cleanPath = path.startsWith('/') ? path.substring(1) : path;

    // Bucket muerto: 'lpr' nunca existio (el real es 'lpr-prod'). Esas imagenes
    // se perdieron -> devolver null para no disparar 404 (el UI muestra placeholder).
    if (cleanPath.startsWith('api/files/lpr/')) {
        return null;
    }

    // Ya es una ruta de la aplicación — de archivos o de cualquier otra. Se pide así.
    if (cleanPath.startsWith('api/')) {
        return `/${cleanPath}`;
    }

    return `/api/files/${cleanPath}`;
};
