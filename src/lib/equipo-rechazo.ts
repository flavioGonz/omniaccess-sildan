/**
 * Cuando un Hikvision empieza a rechazarnos, dejar de intentar.
 *
 * El 20/11 pasó esto, en dos actos. Primero una pantalla pidió 71 fotos a la vez y el terminal de
 * San Nicolás **bloqueó al usuario `admin` 26 minutos**. Después, ya desbloqueado, el equipo
 * empezó a rechazar la clave y a contar: `retryLoginTime: 3`, y cada consulta nuestra lo bajaba
 * en uno. Tres intentos más y se bloqueaba otra vez, sin que nadie hubiera hecho nada raro — sólo
 * por abrir una pantalla.
 *
 * Un equipo que nos rechaza no se arregla insistiendo: o la clave cambió, o el equipo está en un
 * estado del que hay que sacarlo a mano. Lo único que logra reintentar es gastar los intentos que
 * quedan. Por eso acá, en vez de un reintento, hay un freno.
 *
 * Hikvision avisa en el cuerpo del 401, y es información valiosa que estábamos tirando:
 *
 * ```xml
 * <userCheck><statusValue>401</statusValue><lockStatus>unlock</lockStatus>
 *   <unlockTime>0</unlockTime><retryLoginTime>2</retryLoginTime></userCheck>
 * ```
 */

export type Rechazo = {
    /** El equipo nos tiene bloqueados ahora mismo. */
    bloqueado: boolean;
    /** Cuántos intentos quedan antes de que bloquee. `null` si no lo dice. */
    quedan: number | null;
    /** Segundos que faltan para que se desbloquee, si está bloqueado. */
    faltan: number | null;
};

const num = (x: string, etiqueta: string): number | null => {
    const m = x.match(new RegExp(`<${etiqueta}>\\s*(\\d+)\\s*</${etiqueta}>`, "i"));
    return m ? Number(m[1]) : null;
};

/** Lee el aviso del equipo. `null` si ese cuerpo no es un `userCheck` (o sea: no nos está contando nada). */
export function leerUserCheck(cuerpo: string): Rechazo | null {
    if (!cuerpo || !/<userCheck/i.test(cuerpo)) return null;
    const bloqueado = /<lockStatus>\s*lock\s*<\/lockStatus>/i.test(cuerpo);
    return { bloqueado, quedan: num(cuerpo, "retryLoginTime"), faltan: num(cuerpo, "unlockTime") };
}

/** Cómo contárselo a una persona, en una línea. */
export function comoSeCuenta(r: Rechazo, equipo: string): string {
    if (r.bloqueado) {
        const m = r.faltan ? Math.ceil(r.faltan / 60) : null;
        return `${equipo} bloqueó al usuario${m ? ` por ${m} ${m === 1 ? "minuto" : "minutos"}` : ""}: no acepta ninguna consulta hasta que se le pase.`;
    }
    if (r.quedan !== null) {
        return `${equipo} está rechazando la clave y le quedan ${r.quedan} ${r.quedan === 1 ? "intento" : "intentos"} antes de bloquearse. No se vuelve a intentar: hay que revisar la clave del equipo.`;
    }
    return `${equipo} rechazó la clave.`;
}

/**
 * El registro de los equipos que nos están rechazando. La espera es larga a propósito: el daño de
 * esperar de más es una pantalla que avisa, y el de esperar de menos es un equipo bloqueado.
 */
const ESPERA_BLOQUEADO_MS = 2 * 60_000;
const ESPERA_RECHAZO_MS = 15 * 60_000;
const frenos = new Map<string, { hasta: number; motivo: string }>();

export function anotarRechazo(clave: string, r: Rechazo, equipo: string, ahora = Date.now()): void {
    /* Si está bloqueado, el propio equipo dice cuánto falta y no hay nada que decidir. Si nos
       está rechazando la clave, la espera es nuestra: no hay nada que esperar que lo arregle, se
       frena hasta que alguien mire. */
    const hasta = r.bloqueado
        ? ahora + Math.max(ESPERA_BLOQUEADO_MS, (r.faltan || 0) * 1000)
        : ahora + ESPERA_RECHAZO_MS;
    frenos.set(clave, { hasta, motivo: comoSeCuenta(r, equipo) });
}

/** Si este equipo está frenado, por qué. `null` si se le puede hablar. */
export function frenado(clave: string, ahora = Date.now()): string | null {
    const f = frenos.get(clave);
    if (!f) return null;
    if (ahora >= f.hasta) { frenos.delete(clave); return null; }
    return f.motivo;
}

/** Una respuesta buena borra el freno: el equipo volvió. */
export function limpiarRechazo(clave: string): void { frenos.delete(clave); }

/** Sólo para las pruebas. */
export function olvidarTodo(): void { frenos.clear(); }
