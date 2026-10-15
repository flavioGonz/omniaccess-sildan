import fs from "fs";
import path from "path";

/**
 * La versión que está sirviendo este servidor: el BUILD_ID que Next escribe al compilar.
 *
 * Por qué existe (15/10): una pantalla abierta antes de un despliegue sigue corriendo el
 * JavaScript viejo, y cada acción que llama lleva un id que el servidor nuevo ya no tiene
 * («Failed to find Server Action»). San Nicolás juntó más de 120.000 de esos rechazos entre
 * el 2 y el 14 de octubre: monitores y el historial congelados hasta que alguien recargara,
 * que desde la garita se ve como «el sistema anda lento» o «no aparecen las lecturas».
 * Comparando esta versión con la que trajo la página, la pantalla sabe que quedó vieja.
 *
 * Se lee una vez por proceso: el BUILD_ID no cambia mientras el servidor vive.
 */
let cache: string | null = null;

export function versionApp(): string {
    if (cache !== null) return cache;
    try {
        cache = fs.readFileSync(path.join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim();
    } catch {
        // `next dev` no escribe BUILD_ID: sin versión, la vigilancia no recarga nunca.
        cache = "";
    }
    return cache;
}
