/**
 * Clasificar cuentas, decir de dónde viene una sesión y fusionar una lectura con lo que ya se sabía.
 * Todo puro: lo usan la tarea de lectura y las pruebas (openspec usuarios-de-equipos, specs
 * equipos-cuentas-locales y equipos-sesiones-locales).
 */
import type { CuentaLeida, SesionLeida } from "@/lib/usuarios-equipo/hikvision";

export type Clase = "servicio" | "fabrica" | "gestionada" | "no-gestionada";

/** Cómo se dice cada clase en el panel, y su tono (los cinco tonos de estado de DESIGN.md). */
export const CLASES: Record<Clase, { rotulo: string; tono: "info" | "quieto" | "bien" | "aviso"; ayuda: string }> = {
    servicio: { rotulo: "Servicio", tono: "info", ayuda: "La cuenta con la que OmniAccess maneja el equipo. Nunca se toca desde acá." },
    fabrica: { rotulo: "De fábrica", tono: "quieto", ayuda: "El equipo no la deja borrar." },
    gestionada: { rotulo: "Gestionada", tono: "bien", ayuda: "La creó OmniAccess." },
    "no-gestionada": { rotulo: "No gestionada", tono: "aviso", ayuda: "La creó alguien en el equipo, fuera de OmniAccess." },
};

/**
 * La clase de una cuenta. La de servicio va primero: casi siempre es también la `admin` de fábrica,
 * y lo que importa saber es que OmniAccess depende de ella.
 */
export function clasificar(c: { nombre: string; deFabrica: boolean; origen: string }, usuarioServicio: string | null | undefined): Clase {
    if (usuarioServicio && c.nombre.toLowerCase() === usuarioServicio.toLowerCase()) return "servicio";
    if (c.deFabrica) return "fabrica";
    if (c.origen === "omniaccess") return "gestionada";
    return "no-gestionada";
}

export type Procedencia = "servidor" | "grabador" | "equipo" | "conocida" | "desconocida";
export const PROCEDENCIAS: Record<Procedencia, { rotulo: string; tono: "info" | "quieto" | "bien" | "aviso" | "mal" }> = {
    servidor: { rotulo: "OmniAccess", tono: "info" },
    grabador: { rotulo: "Grabador", tono: "quieto" },
    equipo: { rotulo: "Otro equipo", tono: "quieto" },
    conocida: { rotulo: "IP conocida", tono: "bien" },
    desconocida: { rotulo: "IP desconocida", tono: "mal" },
};

export type Fuentes = {
    /** Las IP con las que los equipos ven al servidor (interfaces y destino de eventos). */
    servidor: Set<string>;
    /** ip → nombre de cada NVR dado de alta. */
    grabadores: Map<string, string>;
    /** ip → nombre de los demás equipos. */
    equipos: Map<string, string>;
    /** ip → nombre de las IP que alguien marcó como conocidas. */
    conocidas: Map<string, string>;
};

/** De dónde viene una sesión. El orden importa: una IP del servidor no es «otro equipo» aunque figure como tal. */
export function procedencia(ip: string, f: Fuentes): { procedencia: Procedencia; nombre: string | null } {
    if (f.servidor.has(ip)) return { procedencia: "servidor", nombre: "OmniAccess" };
    if (f.grabadores.has(ip)) return { procedencia: "grabador", nombre: f.grabadores.get(ip)! };
    if (f.equipos.has(ip)) return { procedencia: "equipo", nombre: f.equipos.get(ip)! };
    if (f.conocidas.has(ip)) return { procedencia: "conocida", nombre: f.conocidas.get(ip)! };
    return { procedencia: "desconocida", nombre: null };
}

export type CuentaPrevia = { id: string; nombre: string; desaparecida: Date | null };
export type PlanCuentas = {
    altas: CuentaLeida[];
    /** Las que siguen (se actualiza ultimaVez, el id y el nivel). */
    siguen: { id: string; leida: CuentaLeida; reaparecio: boolean }[];
    /** Ids de las que estaban y ya no están. */
    desaparecidas: string[];
};

/**
 * Fusionar una lectura de cuentas. `leidas === null` es una lectura fallida: no cambia nada, porque
 * «el equipo no contestó» no es «el equipo no tiene cuentas» (spec: «Equipo que no contesta»).
 */
export function fusionarCuentas(previas: CuentaPrevia[], leidas: CuentaLeida[] | null): PlanCuentas {
    const plan: PlanCuentas = { altas: [], siguen: [], desaparecidas: [] };
    if (!leidas) return plan;
    const porNombre = new Map(previas.map((p) => [p.nombre, p]));
    const vistos = new Set<string>();
    for (const l of leidas) {
        if (vistos.has(l.nombre)) continue;
        vistos.add(l.nombre);
        const p = porNombre.get(l.nombre);
        if (p) plan.siguen.push({ id: p.id, leida: l, reaparecio: !!p.desaparecida });
        else plan.altas.push(l);
    }
    for (const p of previas) if (!vistos.has(p.nombre) && !p.desaparecida) plan.desaparecidas.push(p.id);
    return plan;
}

export type SesionPrevia = { id: string; nombre: string; ip: string; desdeEquipo: string | null };
export type PlanSesiones = { nuevas: SesionLeida[]; siguen: string[]; cerradas: string[] };

/**
 * Fusionar una lectura de sesiones con las abiertas. Una sesión es la misma si coincide cuenta, IP y
 * hora de entrada. Puede haber varias iguales (dos sesiones de admin desde el mismo servidor): se
 * aparean de a una, como un multiconjunto. `leidas === null` (lectura fallida) no cierra nada.
 */
export function fusionarSesiones(abiertas: SesionPrevia[], leidas: SesionLeida[] | null): PlanSesiones {
    const plan: PlanSesiones = { nuevas: [], siguen: [], cerradas: [] };
    if (!leidas) return plan;
    const clave = (n: string, ip: string, d: string | null) => `${n}\u0000${ip}\u0000${d || ""}`;
    const libres = new Map<string, string[]>();
    for (const a of abiertas) {
        const k = clave(a.nombre, a.ip, a.desdeEquipo);
        libres.set(k, [...(libres.get(k) || []), a.id]);
    }
    for (const l of leidas) {
        const lista = libres.get(clave(l.nombre, l.ip, l.desde));
        if (lista && lista.length) plan.siguen.push(lista.shift()!);
        else plan.nuevas.push(l);
    }
    for (const lista of libres.values()) plan.cerradas.push(...lista);
    return plan;
}

/** El tipo de alerta de equipo (DeviceAlert.type) de cada aviso: uno por cuenta y uno por cuenta+IP. */
export const alertaCuenta = (nombre: string) => `cuenta-no-gestionada:${nombre}`;
export const alertaSesion = (nombre: string, ip: string) => `sesion-desconocida:${nombre}@${ip}`;
export const PREFIJOS_ALERTA = ["cuenta-no-gestionada:", "sesion-desconocida:"] as const;
