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
};

export type EstadoCenso = {
    que: "sin-correo" | "sin-enviar" | "enviada" | "cargo" | "error";
    /** Cuándo salió el correo (o cuándo cargó, si ya cargó). */
    cuando: string | null;
    error: string | null;
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
    const porPersona = new Map<string, InvitacionResumen>(), porCorreo = new Map<string, InvitacionResumen>();
    for (const i of invitaciones) {
        if (i.userId) porPersona.set(i.userId, i);
        if (i.email) porCorreo.set(i.email.trim().toLowerCase(), i);
    }
    return (persona) => {
        if (!conForma(persona.email)) return { que: "sin-correo", cuando: null, error: null };
        const i = porPersona.get(persona.id) || porCorreo.get(persona.email!.trim().toLowerCase());
        if (!i) return { que: "sin-enviar", cuando: null, error: null };
        if (i.usadoAt) return { que: "cargo", cuando: i.usadoAt, error: null };
        if (i.error) return { que: "error", cuando: i.enviadoAt, error: i.error };
        if (i.enviadoAt) return { que: "enviada", cuando: i.enviadoAt, error: null };
        return { que: "sin-enviar", cuando: null, error: null };
    };
}

/** Pone al día la lista con la invitación que acaba de salir, sin volver a pedirla entera. */
export function conInvitacion(lista: InvitacionResumen[], nueva: InvitacionResumen): InvitacionResumen[] {
    const misma = (i: InvitacionResumen) => (nueva.userId && i.userId === nueva.userId) || i.email.trim().toLowerCase() === nueva.email.trim().toLowerCase();
    return lista.some(misma) ? lista.map((i) => (misma(i) ? nueva : i)) : [...lista, nueva];
}
