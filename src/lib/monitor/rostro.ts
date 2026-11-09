/**
 * Un acceso por reconocimiento facial, como lo ve el Monitor Face (openspec pared-vms). Sin nada de
 * servidor: lo usan la ruta y las pruebas.
 *
 * Las terminales Hikvision (server.js) dejan en `details` algo como
 *   «Rostro: Ana Pérez, FaceImage: <ruta>, Similitud: 87% (Modo: WHITELIST)».
 * De ahí salen el nombre que reconoció la terminal, el recorte de la cara y la similitud.
 */

export type MotivoRostro = "permitido" | "desconocido" | "lista-negra" | "denegado";

export function leerDetalleRostro(d: string | null | undefined): { nombre: string | null; recorte: string | null; similitud: number | null; deteccion: number | null; caraFrac: number | null } {
    const t = d || "";
    const nombre = /Rostro:\s*([^,]+)/.exec(t)?.[1]?.trim() || null;
    const recorte = /FaceImage:\s*([^,\s]+)/.exec(t)?.[1] || null;
    const s = /Similitud:\s*([\d.]+)\s*%/.exec(t)?.[1];
    // Calidad de la captura (OmniVision): confianza de detección de CompreFace y qué tan grande
    // entró el rostro en el cuadro (alto del box sobre el alto del cuadro, en %).
    const det = /Deteccion:\s*([\d.]+)\s*%/.exec(t)?.[1];
    const cf = /CaraFrac:\s*([\d.]+)/.exec(t)?.[1];
    return { nombre, recorte, similitud: s != null ? Number(s) : null, deteccion: det != null ? Number(det) : null, caraFrac: cf != null ? Number(cf) : null };
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
