/**
 * Doble verificación de rostros: lo que dijo el EQUIPO contra lo que dijimos NOSOTROS.
 *
 * Pedido de Nico (18/11): «aquí debemos poder ver qué reconoció el portero y qué reconocimiento
 * facial reconocemos nosotros, intentando dar una doble verificación opcional».
 *
 * Por qué hace falta, medido antes de escribir nada. En el lab, sobre los dos equipos de la
 * instalación: 42 pasadas nuestras en el portero y 0 del equipo; 515 del equipo en el terminal y
 * 2 nuestras; **cero pares**. Y todas las nuestras dicen «Rostro: Desconocido, Similitud: 19-25 %»
 * — no porque el motor falle, sino porque las caras de la gente están adentro del equipo y no en
 * nuestro motor. Así que esto es, antes que una pantalla, el mecanismo que pone a los dos lados a
 * hablar de la MISMA pasada: con eso se puede comparar, y más adelante aprender (si el equipo dice
 * quién es y nosotros capturamos su cara en ese instante, esa cara tiene nombre).
 *
 * Las dos fuentes viven en la misma tabla (`AccessEvent`) y se distinguen por lo que dejan escrito
 * en `details`:
 *
 *   · NOSOTROS  — `Source: OmniVision` (lo escribe vision-rostros.js), con `Rostro`, `Similitud`,
 *                 `RostroId` e `Identidad`.
 *   · EL EQUIPO — lo que trae su bitácora (`#acs<serie>`, lib/acs-importar) o lo que empuja por
 *                 webhook. Trae el nombre y el legajo que tiene cargados adentro.
 *
 * No hay tabla nueva: emparejar al leer cuesta una consulta y no deja un registro que pueda
 * quedar viejo o mentir. Si algún día el volumen lo pide, se materializa.
 */

/** Hasta cuántos milisegundos de diferencia se considera que hablan de la misma pasada. */
export const VENTANA_MS = 20_000;

export type Lado = {
    id: string;
    cuando: number;
    /** A quién nombró ese lado, o null si no reconoció a nadie. */
    nombre: string | null;
    /** El legajo o número de empleado, cuando el lado lo dice (el equipo casi siempre). */
    legajo: string | null;
    /** El usuario del padrón, si el evento quedó atado a uno. */
    userId: string | null;
    /** 0 a 100. */
    similitud: number | null;
    /** El recorte de la cara, si lo hay (sólo el nuestro, por ahora). */
    cara: string | null;
    /** La línea cruda, para poder mostrar de dónde salió cada cosa. */
    detalle: string | null;
};

export type Evento = {
    id: string;
    deviceId: string | null;
    timestamp: Date | string;
    details?: string | null;
    accessType?: string | null;
    userId?: string | null;
    snapshotPath?: string | null;
};

export type Veredicto = "coinciden" | "discrepan" | "solo-equipo" | "solo-nosotros" | "nadie";

export type Par = {
    cuando: number;
    deviceId: string | null;
    equipo: Lado | null;
    nuestro: Lado | null;
    veredicto: Veredicto;
};

const campo = (d: string | null | undefined, re: RegExp): string | null => {
    const m = re.exec(String(d ?? ""));
    return m ? m[1].trim() : null;
};

/** Lo escribió nuestro motor de rostros (vision-rostros.js lo firma). */
export const esNuestro = (e: Evento): boolean => /Source:\s*OmniVision/i.test(String(e.details ?? ""));

/**
 * Lo escribió el equipo: su bitácora (`#acs<serie>`) o su webhook. Un evento con rostro que NO
 * está firmado por OmniVision es del equipo — la firma la pusimos nosotros justamente para poder
 * separar los dos lados sin adivinar.
 */
export const esDelEquipo = (e: Evento): boolean => !esNuestro(e);

/** Un nombre que no nombra a nadie. El equipo escribe el número de unidad; «Desconocido» es el nuestro. */
const SIN_NOMBRE = /^(desconocido|unknown|sin\s*nombre|-)?$/i;
export const nombreSirve = (n: string | null): n is string => !!n && !SIN_NOMBRE.test(n.trim());

/** Lo que dejó escrito nuestro motor. */
export function ladoNuestro(e: Evento): Lado {
    const d = e.details ?? "";
    return {
        id: e.id,
        cuando: new Date(e.timestamp).getTime(),
        nombre: campo(d, /Rostro:\s*([^,]+)/),
        legajo: null,
        userId: e.userId ?? null,
        similitud: Number(campo(d, /Similitud:\s*([\d.]+)\s*%/)) || null,
        cara: campo(d, /FaceImage:\s*([^,\s]+)/),
        detalle: e.details ?? null,
    };
}

/**
 * Lo que dejó escrito el equipo. Su detalle es de la forma
 * `Rostro reconocido · «1108» · legajo 1108 · #acs16272`, que es como lo arma lib/acs-importar.
 */
export function ladoEquipo(e: Evento): Lado {
    const d = e.details ?? "";
    return {
        id: e.id,
        cuando: new Date(e.timestamp).getTime(),
        nombre: campo(d, /«([^»]+)»/) || campo(d, /Rostro:\s*([^,]+)/),
        legajo: campo(d, /legajo\s+([^\s·,]+)/i),
        userId: e.userId ?? null,
        similitud: Number(campo(d, /Similitud:\s*([\d.]+)\s*%/)) || null,
        cara: null,
        detalle: e.details ?? null,
    };
}

/** ¿Los dos lados están hablando de la misma persona? Por el padrón primero; si no, por el nombre. */
export function mismaPersona(a: Lado, b: Lado): boolean {
    if (a.userId && b.userId) return a.userId === b.userId;
    const na = (a.nombre || "").trim().toLowerCase(), nb = (b.nombre || "").trim().toLowerCase();
    if (nombreSirve(a.nombre) && nombreSirve(b.nombre) && na === nb) return true;
    // El equipo nombra por legajo y nosotros por nombre: si el legajo aparece en el nombre, es el mismo.
    if (a.legajo && nombreSirve(b.nombre) && nb.includes(a.legajo.toLowerCase())) return true;
    if (b.legajo && nombreSirve(a.nombre) && na.includes(b.legajo.toLowerCase())) return true;
    return false;
}

export function veredictoDe(equipo: Lado | null, nuestro: Lado | null): Veredicto {
    const e = equipo && nombreSirve(equipo.nombre), n = nuestro && nombreSirve(nuestro.nombre);
    if (e && n) return mismaPersona(equipo!, nuestro!) ? "coinciden" : "discrepan";
    if (e) return "solo-equipo";
    if (n) return "solo-nosotros";
    return "nadie";
}

/**
 * Empareja los dos lados de un mismo equipo. Cada evento se usa UNA vez, y se arma primero el par
 * MÁS CERCANO de todos, no el primero en el tiempo: recorriendo en orden, una pasada vieja se
 * quedaba con una captura que estaba a catorce segundos mientras la pasada de al lado, a uno,
 * se quedaba sin nada — y el resultado decía «discrepan» donde no había discrepancia.
 */
export function emparejar(eventos: Evento[], ventanaMs = VENTANA_MS): Par[] {
    const porEquipo = new Map<string, { equipo: Lado[]; nuestro: Lado[] }>();
    for (const e of eventos) {
        const k = e.deviceId || "";
        if (!porEquipo.has(k)) porEquipo.set(k, { equipo: [], nuestro: [] });
        const g = porEquipo.get(k)!;
        if (esNuestro(e)) g.nuestro.push(ladoNuestro(e)); else g.equipo.push(ladoEquipo(e));
    }
    const pares: Par[] = [];
    for (const [deviceId, g] of porEquipo) {
        const candidatos: { eq: Lado; n: Lado; dist: number }[] = [];
        for (const eq of g.equipo) for (const n of g.nuestro) {
            const dist = Math.abs(n.cuando - eq.cuando);
            if (dist <= ventanaMs) candidatos.push({ eq, n, dist });
        }
        candidatos.sort((a, b) => a.dist - b.dist);
        const deEquipo = new Map<string, Lado>(), deNuestro = new Set<string>();
        for (const c of candidatos) {
            if (deEquipo.has(c.eq.id) || deNuestro.has(c.n.id)) continue;
            deEquipo.set(c.eq.id, c.n); deNuestro.add(c.n.id);
        }
        for (const eq of [...g.equipo].sort((a, b) => a.cuando - b.cuando)) {
            const n = deEquipo.get(eq.id) || null;
            pares.push({ cuando: eq.cuando, deviceId: deviceId || null, equipo: eq, nuestro: n, veredicto: veredictoDe(eq, n) });
        }
        for (const n of g.nuestro) {
            if (deNuestro.has(n.id)) continue;
            pares.push({ cuando: n.cuando, deviceId: deviceId || null, equipo: null, nuestro: n, veredicto: veredictoDe(null, n) });
        }
    }
    return pares.sort((a, b) => b.cuando - a.cuando);
}

/** El resumen que va arriba de la lista: cuántos de cada clase. */
export function resumen(pares: Par[]): Record<Veredicto, number> & { total: number; acuerdo: number | null } {
    const c = { coinciden: 0, discrepan: 0, "solo-equipo": 0, "solo-nosotros": 0, nadie: 0 } as Record<Veredicto, number>;
    for (const p of pares) c[p.veredicto]++;
    const conLosDos = c.coinciden + c.discrepan;
    return { ...c, total: pares.length, acuerdo: conLosDos ? Math.round((100 * c.coinciden) / conLosDos) : null };
}
