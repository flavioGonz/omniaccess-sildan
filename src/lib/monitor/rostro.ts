/**
 * Un acceso por reconocimiento facial, como lo ve el Monitor Face (openspec pared-vms). Sin nada de
 * servidor: lo usan la ruta y las pruebas.
 *
 * Las terminales Hikvision (server.js) dejan en `details` algo como
 *   «Rostro: Ana Pérez, FaceImage: <ruta>, Similitud: 87% (Modo: WHITELIST)».
 * De ahí salen el nombre que reconoció la terminal, el recorte de la cara y la similitud.
 */

export type MotivoRostro = "permitido" | "desconocido" | "lista-negra" | "denegado";

/** Qué decidió el modo face con una cara (vision-rostros.js): alguien del padrón, alguien ya visto, una cara nueva, o no alcanzó. */
export type IdentidadRostro = "padron" | "misma" | "nueva" | "sin-cara";

export type DetalleRostro = {
    nombre: string | null; recorte: string | null; similitud: number | null; deteccion: number | null; caraFrac: number | null;
    /** Identidad por rostro (desde el 13/11): el id del Rostro, las visitas que llevaba en ese momento y qué se decidió. */
    rostroId: string | null; veces: number | null; identidad: IdentidadRostro | null;
    /** Alto de la cara en px del cuadro que miró el motor, y por qué quedó sin identidad cuando no alcanzó. */
    caraPx: number | null; sinIdentidad: string | null;
    /** Dónde está la cara en la escena, en fracciones [x1, y1, x2, y2], y la escena del stream principal si se guardó. */
    caja: [number, number, number, number] | null; escena: string | null;
};

export function leerDetalleRostro(d: string | null | undefined): DetalleRostro {
    const t = d || "";
    const uno = (re: RegExp) => re.exec(t)?.[1]?.trim() || null;
    const num = (re: RegExp) => { const v = re.exec(t)?.[1]; return v != null && Number.isFinite(Number(v)) ? Number(v) : null; };
    const identidad = uno(/Identidad:\s*([a-z-]+)/);
    const c = uno(/CaraCaja:\s*([\d.-]+)/)?.split("-").map(Number);
    return {
        nombre: uno(/Rostro:\s*([^,]+)/), recorte: uno(/FaceImage:\s*([^,\s]+)/), similitud: num(/Similitud:\s*([\d.]+)\s*%/),
        // Calidad de la captura (OmniVision): confianza de detección de CompreFace y qué tan grande
        // entró el rostro en el cuadro (alto del box sobre el alto del cuadro, en %).
        deteccion: num(/Deteccion:\s*([\d.]+)\s*%/), caraFrac: num(/CaraFrac:\s*([\d.]+)/),
        rostroId: uno(/RostroId:\s*([a-z0-9]+)/), veces: num(/Veces:\s*(\d+)/),
        identidad: identidad === "padron" || identidad === "misma" || identidad === "nueva" || identidad === "sin-cara" ? identidad : null,
        caraPx: num(/CaraPx:\s*(\d+)/), sinIdentidad: uno(/SinIdentidad:\s*([^,]+)/),
        caja: c && c.length === 4 && c.every((x) => Number.isFinite(x) && x >= 0 && x <= 1) && c[2] > c[0] && c[3] > c[1] ? (c as [number, number, number, number]) : null,
        escena: uno(/Escena:\s*([^,\s]+)/),
    };
}

/**
 * Un puntaje 0–100 de qué tan buena es la captura del rostro, con lo que es REAL y medible:
 * la confianza de detección (CompreFace) y el tamaño con que entró el rostro (un rostro grande
 * y bien detectado reconoce mejor que uno lejano y dudoso). Si no hay datos, `null` (no se inventa).
 * El tamaño se satura a ~22% del alto del cuadro: de ahí para arriba ya es un primer plano.
 */
export function calidadRostro(deteccion: number | null, caraFrac: number | null): number | null {
    const tam = caraFrac != null ? Math.max(0, Math.min(100, Math.round((caraFrac / 22) * 100))) : null;
    if (deteccion != null && tam != null) return Math.round(0.55 * deteccion + 0.45 * tam);
    if (deteccion != null) return deteccion;
    if (tam != null) return tam;
    return null;
}

/**
 * Por qué se abrió o no. «Desconocido»: la terminal negó y no hay persona del padrón. «Lista negra»:
 * la persona está marcada así, o el modo de la terminal era lista negra.
 */
export function motivoDeRostro(e: { decision: string; userId?: string | null; rol?: string | null; detalles?: string | null }): MotivoRostro {
    if (e.decision === "GRANT") return "permitido";
    if (e.rol === "BLACKLISTED" || /Modo:\s*BLACKLIST/i.test(e.detalles || "")) return "lista-negra";
    if (!e.userId) return "desconocido";
    return "denegado";
}

export const TEXTO_MOTIVO: Record<MotivoRostro, string> = {
    permitido: "Permitido", desconocido: "Desconocido", "lista-negra": "Lista negra", denegado: "Denegado",
};

/**
 * El `details` de un acceso FACE después de que alguien le dio identidad A MANO (13/11: «agregar un
 * rostro conocido» desde el monitor, sobre una pasada que la compuerta había dejado sin identidad).
 * Cambia quién es y qué se decidió, suma el Rostro y saca el «no se pudo comparar». Lo demás —la
 * foto, la calidad, dónde estaba la cara— queda como lo escribió el proceso de visión.
 */
export function detallesConIdentidad(details: string | null | undefined, r: { rostroId: string; nombre: string; veces: number }): string {
    const fuera = /^(Rostro|RostroId|Veces|Identidad|SinIdentidad):/;
    const partes = String(details || "").split(/,\s+(?=[A-Za-z]+:\s)/).map((x) => x.trim()).filter((x) => x && !fuera.test(x));
    // «Source» queda al final, como lo escribe vision-rostros.js.
    const fuente = partes.filter((x) => /^Source:/.test(x)), resto = partes.filter((x) => !/^Source:/.test(x));
    return [`Rostro: ${r.nombre.replace(/,/g, " ")}`, ...resto, `RostroId: ${r.rostroId}`, `Veces: ${r.veces}`, "Identidad: nueva", ...fuente].join(", ");
}
