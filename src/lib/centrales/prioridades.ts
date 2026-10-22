/**
 * La prioridad de lo que manda una central de alarma (22/10, Nico: «clasificar los eventos en grado
 * de importancia, editables: robo y pánico prioridad 1, sabotaje 2, fallos del sistema 4, y que esto
 * sea editable del lado del administrador»).
 *
 * No se le pone prioridad a cada código de Contact ID o SIA (son cientos): se le pone a la CLASE del
 * evento, que es lo que ya sale del traductor (lib-dc09-codigos: categoría + tipo). Así «Robo
 * perimetral» (131) y «Robo interior» (132) son la misma decisión, y la lista que edita el
 * administrador entra en una pantalla.
 *
 * 1 es lo más urgente. Lo guardado vive en el ajuste CENTRALES_PRIORIDADES ({ clase: n }); una clase
 * que no está guardada usa su valor por defecto. Sin prisma: lo importan la pantalla y el servidor.
 */

export const AJUSTE_PRIORIDADES = "CENTRALES_PRIORIDADES";

export type ClaseEvento =
    | "ROBO" | "PANICO" | "COACCION" | "INCENDIO" | "MEDICA" | "SABOTAJE" | "TECNICA"
    | "FALLA" | "RESTAURACION" | "ARMADO" | "PRUEBA" | "OTRO";

export const CLASES: { clase: ClaseEvento; nombre: string; ejemplos: string; defecto: number }[] = [
    { clase: "ROBO", nombre: "Robo", ejemplos: "Robo, perimetral, interior, entrada/salida, 24 h", defecto: 1 },
    { clase: "PANICO", nombre: "Pánico", ejemplos: "Pánico audible y silencioso", defecto: 1 },
    { clase: "COACCION", nombre: "Coacción", ejemplos: "Desarmado bajo amenaza", defecto: 1 },
    { clase: "INCENDIO", nombre: "Incendio", ejemplos: "Humo, calor, pulsador, rociadores", defecto: 1 },
    { clase: "MEDICA", nombre: "Emergencia médica", ejemplos: "Médica, personal", defecto: 1 },
    { clase: "SABOTAJE", nombre: "Sabotaje", ejemplos: "Sabotaje de zona, de sensor, de expansor", defecto: 2 },
    { clase: "TECNICA", nombre: "Alarmas técnicas", ejemplos: "Gas, pérdida de agua, temperatura, alarma general", defecto: 3 },
    { clase: "FALLA", nombre: "Fallos del sistema", ejemplos: "Corte de corriente, batería, comunicación, sensor, sirena", defecto: 4 },
    { clase: "RESTAURACION", nombre: "Restauraciones", ejemplos: "La zona volvió a normal, la falla se resolvió", defecto: 5 },
    { clase: "ARMADO", nombre: "Armado y desarmado", ejemplos: "Armado, desarmado, remoto, alarma cancelada", defecto: 5 },
    { clase: "PRUEBA", nombre: "Pruebas", ejemplos: "Prueba manual y periódica", defecto: 5 },
    { clase: "OTRO", nombre: "Programación y otros", ejemplos: "Entró/salió de programación, cambio de hora, acceso remoto", defecto: 5 },
];

export const NIVELES: { n: number; nombre: string; tono: "mal" | "aviso" | "info" | "quieto" }[] = [
    { n: 1, nombre: "Crítica", tono: "mal" },
    { n: 2, nombre: "Alta", tono: "aviso" },
    { n: 3, nombre: "Media", tono: "aviso" },
    { n: 4, nombre: "Baja", tono: "info" },
    { n: 5, nombre: "Informativa", tono: "quieto" },
];
export const nivel = (n: number) => NIVELES.find((x) => x.n === n) || NIVELES[NIVELES.length - 1];

export type Prioridades = Record<ClaseEvento, number>;

export const PRIORIDADES_DEFECTO: Prioridades = Object.fromEntries(CLASES.map((c) => [c.clase, c.defecto])) as Prioridades;

/** Lo guardado sobre lo de fábrica, descartando lo que no sea una clase conocida con un nivel de 1 a 5. */
export function leerPrioridades(guardado: unknown): Prioridades {
    const out = { ...PRIORIDADES_DEFECTO };
    let g: any = guardado;
    if (typeof g === "string") { try { g = JSON.parse(g); } catch { g = null; } }
    if (g && typeof g === "object") {
        for (const c of CLASES) {
            const n = Number(g[c.clase]);
            if (Number.isInteger(n) && n >= 1 && n <= 5) out[c.clase] = n;
        }
    }
    return out;
}

const TIPO_ALARMA: Record<string, ClaseEvento> = { ROBO: "ROBO", PANICO: "PANICO", COACCION: "COACCION", INCENDIO: "INCENDIO", MEDICA: "MEDICA", SABOTAJE: "SABOTAJE" };

/** La clase de un evento traducido ({ categoria, tipo } de lib-dc09-codigos). */
export function claseDe(e: { categoria?: string | null; tipo?: string | null } | null | undefined): ClaseEvento {
    if (!e) return "OTRO";
    switch (e.categoria) {
        case "ALARMA": return TIPO_ALARMA[e.tipo || ""] || "TECNICA";
        case "FALLA": return "FALLA";
        case "RESTAURACION": case "FALLA_FIN": return "RESTAURACION";
        case "ARMADO": case "DESARMADO": return "ARMADO";
        case "PRUEBA": return "PRUEBA";
        default: return "OTRO";
    }
}

/** La clase de una ALARMA de central (Detection type CENTRAL): su eventType es el tipo del evento. */
export const claseDeAlarma = (eventType: string | null | undefined): ClaseEvento => TIPO_ALARMA[eventType || ""] || "TECNICA";

export const prioridadDe = (p: Prioridades, e: { categoria?: string | null; tipo?: string | null } | null | undefined) => p[claseDe(e)];
