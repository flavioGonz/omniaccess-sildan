/**
 * Un acceso por reconocimiento facial, como lo ve el Monitor Face (openspec pared-vms). Sin nada de
 * servidor: lo usan la ruta y las pruebas.
 *
 * Las terminales Hikvision (server.js) dejan en `details` algo como
 *   «Rostro: Ana Pérez, FaceImage: <ruta>, Similitud: 87% (Modo: WHITELIST)».
 * De ahí salen el nombre que reconoció la terminal, el recorte de la cara y la similitud.
 */

export type MotivoRostro = "permitido" | "desconocido" | "lista-negra" | "denegado";

export function leerDetalleRostro(d: string | null | undefined): { nombre: string | null; recorte: string | null; similitud: number | null } {
    const t = d || "";
    const nombre = /Rostro:\s*([^,]+)/.exec(t)?.[1]?.trim() || null;
    const recorte = /FaceImage:\s*([^,\s]+)/.exec(t)?.[1] || null;
    const s = /Similitud:\s*([\d.]+)\s*%/.exec(t)?.[1];
    return { nombre, recorte, similitud: s != null ? Number(s) : null };
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
