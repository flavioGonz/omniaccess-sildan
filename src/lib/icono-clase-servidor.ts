import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import { ICONO_LADO, PREFIJO_ICONO_IMAGEN } from "@/lib/detector-propio";

/**
 * El ícono que se sube para una clase entrenada. Queda en public/branding, que es donde vive lo
 * que se sube para mostrar (los logos de Ajustes › Marca) y lo sirve /api/branding/<archivo> sin
 * sesión: el vivo también se ve en las pantallas de la pared, que no tienen sesión del panel, y
 * un ícono no es un dato reservado.
 *
 * Se guarda SIEMPRE como PNG achicado, sea lo que sea lo que se subió: un SVG no se sirve nunca
 * tal cual (puede traer scripts), y un ícono de 4000 px no viaja a cada pantalla.
 */
const CARPETA = path.join(process.cwd(), "public", "branding");
const RUTA_PUBLICA = "/api/branding/";
const NOMBRE = /^icono-clase-[\w-]+\.png$/;

/** Achica y guarda la imagen; devuelve lo que va en ClasePropia.icono («img:<url>»). */
export async function guardarIconoSubido(claseId: string, datos: Buffer): Promise<string> {
    const png = await sharp(datos, { failOn: "error", density: 300 })
        .resize(ICONO_LADO, ICONO_LADO, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png({ compressionLevel: 9 }).toBuffer();
    await fs.mkdir(CARPETA, { recursive: true });
    // El nombre cambia en cada subida: el navegador y el vivo no se quedan con la imagen anterior en caché.
    const nombre = `icono-clase-${claseId.replace(/[^\w-]/g, "")}-${Date.now()}.png`;
    await fs.writeFile(path.join(CARPETA, nombre), png);
    return `${PREFIJO_ICONO_IMAGEN}${RUTA_PUBLICA}${nombre}`;
}

/** Borra el archivo de un ícono subido. Si no era una imagen subida por acá, no hace nada. */
export async function borrarIconoSubido(icono: string | null | undefined): Promise<void> {
    if (!icono?.startsWith(`${PREFIJO_ICONO_IMAGEN}${RUTA_PUBLICA}`)) return;
    const nombre = path.basename(icono.slice(PREFIJO_ICONO_IMAGEN.length + RUTA_PUBLICA.length));
    if (!NOMBRE.test(nombre)) return;
    await fs.unlink(path.join(CARPETA, nombre)).catch(() => null);
}
