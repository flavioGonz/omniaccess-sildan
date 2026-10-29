/**
 * Los avisos de salud que se pueden prender y apagar por equipo (29/10, Nico: «no me queda claro
 * dónde activar las alertas de la cámara, imagen movida etc.; poder activar individualmente o no»).
 *
 * Puro: lo usan la ficha del equipo (los interruptores), la acción que guarda y `ensureAlert`, que es
 * el único lugar donde nace una alerta de salud. Lo que no está en el ajuste de un equipo vale
 * PRENDIDO: así un equipo que nadie tocó se comporta como siempre.
 *
 * Una clave por aviso y no por tipo de alerta: «imagen» es una sola alerta (una cámara no está tapada
 * y movida a la vez), pero se puede querer saber si se tapa y no si se mueve.
 */
export type ClaveAviso = "offline" | "tapada" | "borrosa" | "movida" | "drift" | "silencio" | "vca" | "disk";
export type AjusteAvisos = Partial<Record<ClaveAviso | "telegram", boolean>>;

const CAMARAS = ["LPR_CAMERA", "LPR_INTERIOR", "CAMERA", "QUEUE_COUNTER"];

export const AVISOS: { clave: ClaveAviso; rotulo: string; ayuda: string; tipos: string[] }[] = [
    { clave: "offline", rotulo: "Sin respuesta", ayuda: "El equipo deja de contestar.", tipos: ["LPR_CAMERA", "NVR"] },
    { clave: "tapada", rotulo: "Imagen tapada o negra", ayuda: "El cuadro casi no tiene variación: lente tapado, cámara negra o cuadro de error.", tipos: CAMARAS },
    { clave: "borrosa", rotulo: "Imagen borrosa", ayuda: "Mucha menos nitidez que lo habitual en esta cámara: foco, lente sucio, lluvia o niebla.", tipos: CAMARAS },
    { clave: "movida", rotulo: "Cámara movida", ayuda: "Lo que se ve ya no coincide con su encuadre habitual.", tipos: CAMARAS },
    { clave: "silencio", rotulo: "Deja de reportar", ayuda: "Hace mucho que no manda lecturas o eventos de analítica, aunque conteste.", tipos: CAMARAS },
    { clave: "drift", rotulo: "Hora corrida", ayuda: "Su reloj se aleja más de dos minutos del servidor.", tipos: ["LPR_CAMERA", "NVR"] },
    { clave: "vca", rotulo: "ANPR apagado", ayuda: "El recurso inteligente de la cámara dejó de estar en lectura de matrículas.", tipos: ["LPR_CAMERA"] },
    { clave: "disk", rotulo: "Disco degradado", ayuda: "Un disco del grabador falla o su SMART no da bien.", tipos: ["NVR"] },
];

/** La clave del ajuste que gobierna un tipo de alerta. Las de imagen las decide quien conoce el problema. */
export const claveDeAlerta = (tipoAlerta: string): ClaveAviso | null =>
    (AVISOS.some((a) => a.clave === tipoAlerta) ? tipoAlerta as ClaveAviso : null);

export const avisosDe = (deviceType: string) => AVISOS.filter((a) => a.tipos.includes(deviceType));

export function leerAjuste(v: unknown): AjusteAvisos {
    if (!v || typeof v !== "object") return {};
    const out: AjusteAvisos = {};
    for (const [k, b] of Object.entries(v as Record<string, unknown>)) if (typeof b === "boolean" && (k === "telegram" || AVISOS.some((a) => a.clave === k))) (out as any)[k] = b;
    return out;
}

export const prendido = (aj: AjusteAvisos, clave: ClaveAviso | "telegram") => aj[clave] !== false;
