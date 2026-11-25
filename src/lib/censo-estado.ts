/**
 * En qué está la invitación al censo de cada persona, para mostrarlo en el padrón.
 *
 * Vive aparte de `censo-invitaciones.ts` a propósito: aquél usa `node:crypto` para armar las claves
 * y esto lo importa una pantalla. Acá no entra nada que no pueda correr en un navegador.
 */

/** Lo que la pantalla sabe de una invitación: nada de claves, que no hacen falta para mostrar el estado. */
export type InvitacionResumen = {
    userId: string | null; email: string;
    enviadoAt: string | null; usadoAt: string | null; error: string | null;
    /** El lote de la invitación (un código por lote desde el 25/11), a quién le llega, y quiénes son del lote. */
    unitId?: string | null; lote?: string; nombre?: string; miembros?: string[];
};

export type EstadoCenso = {
    que: "sin-correo" | "sin-enviar" | "enviada" | "cargo" | "error";
    /** Cuándo salió el correo (o cuándo cargó, si ya cargó). */
    cuando: string | null;
    error: string | null;
    /**
     * Cuando el estado es el de SU LOTE y el código le llegó a otra persona (la principal): de qué lote
     * y a quién. Desde el 25/11 el código es uno por lote; el resto de la gente del lote no tiene uno.
     */
    via?: { lote: string; nombre: string } | null;
};

const conForma = (v: string | null | undefined): boolean => /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]{2,}$/.test(String(v ?? "").trim());

/**
 * Arma el buscador: dada una persona, en qué está su invitación.
 *
 * Se busca primero por la persona y, si no, por su correo: las invitaciones cargadas con la planilla
 * simple (lote, nombre, correo) no saben de quién son hasta que alguien carga.
 *
 * El orden de los estados no es arbitrario. «Cargó» gana a todo: si ya cargó, que el último reenvío
 * haya fallado no importa. Después el error, porque es lo que pide hacer algo. Recién después
 * «enviada».
 */
export function buscadorDeCenso(invitaciones: InvitacionResumen[]): (persona: { id: string; email: string | null }) => EstadoCenso {
    const porPersona = new Map<string, InvitacionResumen>(), porCorreo = new Map<string, InvitacionResumen>(), porMiembro = new Map<string, InvitacionResumen>();
    for (const i of invitaciones) {
        if (i.userId) porPersona.set(i.userId, i);
        if (i.email) porCorreo.set(i.email.trim().toLowerCase(), i);
        for (const m of i.miembros || []) if (!porMiembro.has(m)) porMiembro.set(m, i);
    }
    const estadoDe = (i: InvitacionResumen): EstadoCenso =>
        i.usadoAt ? { que: "cargo", cuando: i.usadoAt, error: null }
            : i.error ? { que: "error", cuando: i.enviadoAt, error: i.error }
                : i.enviadoAt ? { que: "enviada", cuando: i.enviadoAt, error: null }
                    : { que: "sin-enviar", cuando: null, error: null };
    return (persona) => {
        /* Primero, si es la principal de algún lote: su propio código. */
        const suya = porPersona.get(persona.id) || (conForma(persona.email) ? porCorreo.get(persona.email!.trim().toLowerCase()) : undefined);
        if (suya) return conForma(persona.email) ? estadoDe(suya) : { que: "sin-correo", cuando: null, error: null };
        /* Si no, el de su lote, que le llegó a otra persona: se muestra el estado del lote y a quién. */
        const delLote = porMiembro.get(persona.id);
        if (delLote) return { ...estadoDe(delLote), via: { lote: delLote.lote || "su lote", nombre: delLote.nombre || delLote.email } };
        if (!conForma(persona.email)) return { que: "sin-correo", cuando: null, error: null };
        return { que: "sin-enviar", cuando: null, error: null };
    };
}

/** Pone al día la lista con la invitación que acaba de salir, sin volver a pedirla entera. */
export function conInvitacion(lista: InvitacionResumen[], nueva: InvitacionResumen): InvitacionResumen[] {
    const misma = (i: InvitacionResumen) => (nueva.unitId ? i.unitId === nueva.unitId : (nueva.userId && i.userId === nueva.userId) || i.email.trim().toLowerCase() === nueva.email.trim().toLowerCase());
    return lista.some(misma) ? lista.map((i) => (misma(i) ? (i.miembros && !nueva.miembros ? { ...nueva, miembros: i.miembros } : nueva) : i)) : [...lista, nueva];
}
