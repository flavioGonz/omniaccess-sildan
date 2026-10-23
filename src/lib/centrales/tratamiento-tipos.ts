/**
 * Tratar un evento de central de alarma (22/10, Nico: «un botón TRATAR EVENTO que obligue a anotar
 * algo —usuario probando, falsa alarma; robo confirmado, se llamó a la policía—. Un evento de
 * intrusión de una alarma es más importante que el resto: necesita una intervención humana».
 * Pidió además: asignación exclusiva, escalar si nadie lo toma, pasos del procedimiento y tiempos
 * medidos).
 *
 * Lo que configura el administrador (Ajustes › Centrales de alarma), sin base de datos: lo usan la
 * pantalla y el servidor. Cada parte vive en su ajuste y lo inválido vuelve a lo de fábrica.
 */

export const AJUSTE_CIERRES = "CENTRALES_CIERRES";
export const AJUSTE_PROCEDIMIENTO = "CENTRALES_PROCEDIMIENTO";
/** El procedimiento de cada clase de evento (openspec alarmas-como-funciones); sin uno, vale el de su prioridad. */
export const AJUSTE_PROCEDIMIENTOS_CLASE = "CENTRALES_PROCEDIMIENTOS";
export const AJUSTE_ESCALADO = "CENTRALES_ESCALADO";

/** Cómo se cerró: el resultado cuenta para los informes (cuántas falsas, cuántas reales). */
export type ResultadoCierre = "real" | "falsa" | "otro";
export type Cierre = { id: string; texto: string; resultado: ResultadoCierre; activo: boolean };

export const CIERRES_DEFECTO: Cierre[] = [
    { id: "prueba-usuario", texto: "Usuario probando — Falsa alarma", resultado: "falsa", activo: true },
    { id: "error-usuario", texto: "Error del usuario al armar o desarmar", resultado: "falsa", activo: true },
    { id: "falla-sensor", texto: "Sensor, mascota o viento — Falsa alarma", resultado: "falsa", activo: true },
    { id: "verificado-sin-novedad", texto: "Verificado con cámaras o guardia — Sin novedad", resultado: "falsa", activo: true },
    { id: "robo-policia", texto: "Robo confirmado — Se llamó a la policía", resultado: "real", activo: true },
    { id: "robo-guardia", texto: "Robo confirmado — Se envió a la guardia", resultado: "real", activo: true },
    { id: "panico-policia", texto: "Pánico o coacción real — Se llamó a la policía", resultado: "real", activo: true },
    { id: "medica", texto: "Emergencia médica — Se llamó a emergencias", resultado: "real", activo: true },
    { id: "incendio", texto: "Incendio — Se llamó a bomberos", resultado: "real", activo: true },
    { id: "sin-contacto", texto: "No se pudo contactar al titular", resultado: "otro", activo: true },
];

/**
 * Un paso del procedimiento. `obligatorio`: TRATAR exige tildarlo o saltearlo escribiendo por qué
 * (23/10, Nico: «tener sus procedimientos de actuación marcados»). Cada tilde y cada salteo quedan
 * con hora y quién.
 */
export type Paso = { texto: string; obligatorio: boolean };
/** El procedimiento de cada prioridad (1 a 5): el respaldo de las clases que no tienen uno propio. */
export type Procedimiento = Record<"1" | "2" | "3" | "4" | "5", Paso[]>;
const p = (texto: string, obligatorio = false): Paso => ({ texto, obligatorio });
export const PROCEDIMIENTO_DEFECTO: Procedimiento = {
    "1": [p("Mirar las cámaras de la zona"), p("Llamar al titular o a sus contactos"), p("Llamar a la policía (911)"), p("Enviar a la guardia")],
    "2": [p("Mirar las cámaras de la zona"), p("Llamar al titular"), p("Enviar a la guardia si no contesta")],
    "3": [p("Llamar al titular")],
    "4": [],
    "5": [],
};
/** Hasta cuántos pasos tiene un procedimiento. */
export const PASOS_MAX = 12;
/** Lo mínimo que hay que escribir para saltear un paso obligatorio. */
export const MOTIVO_SALTEO_MINIMO = 4;

/** Las clases de evento que pueden tener procedimiento propio (las de lib/centrales/prioridades que son alarmas o fallas). */
export const CLASES_CON_PROCEDIMIENTO = ["ROBO", "PANICO", "COACCION", "INCENDIO", "MEDICA", "SABOTAJE", "TECNICA", "FALLA"] as const;
export type ClaseConProcedimiento = (typeof CLASES_CON_PROCEDIMIENTO)[number];
/** `null` (o ausente) = usa el de su prioridad. */
export type ProcedimientosClase = Partial<Record<ClaseConProcedimiento, Paso[] | null>>;

/** El procedimiento que le toca a un evento, y de dónde sale (para decirlo en la ficha y en la auditoría). */
export type ProcedimientoResuelto = { pasos: Paso[]; origen: { tipo: "clase"; clase: string; nombre: string } | { tipo: "prioridad"; prioridad: number } };

/**
 * Hasta qué prioridad salta la ventana con sonido (`ventanaHasta`) y en qué prioridad entra la pila
 * de avisos (`avisoHasta`); cuándo se escala: si nadie lo tomó en `tomarMin`, o si quien lo tomó no
 * lo trató en `tratarMin`. Escalar es avisar a las reglas de notificación (evento «Alarma de central
 * sin atender») y volver a hacer sonar las pantallas.
 */
export type Escalado = { ventanaHasta: number; avisoHasta: number; tomarMin: number; tratarMin: number; escalarHasta: number };
export const ESCALADO_DEFECTO: Escalado = { ventanaHasta: 2, avisoHasta: 3, tomarMin: 2, tratarMin: 10, escalarHasta: 2 };

const json = (v: unknown) => { if (typeof v !== "string") return v; try { return JSON.parse(v); } catch { return null; } };
const entero = (v: unknown, min: number, max: number, def: number) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : def; };
const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "cierre";

export function leerCierres(v: unknown): Cierre[] {
    const g = json(v);
    if (!Array.isArray(g)) return CIERRES_DEFECTO;
    const vistos = new Set<string>();
    const out: Cierre[] = [];
    for (const c of g) {
        const texto = String(c?.texto || "").trim().slice(0, 120);
        if (!texto) continue;
        let id = String(c?.id || slug(texto)).slice(0, 40);
        while (vistos.has(id)) id = `${id}-2`;
        vistos.add(id);
        out.push({ id, texto, resultado: c?.resultado === "real" || c?.resultado === "falsa" ? c.resultado : "otro", activo: c?.activo !== false });
    }
    return out.length ? out : CIERRES_DEFECTO;
}

/** Un paso guardado: el texto suelto de antes (no obligatorio) o { texto, obligatorio }. */
export function leerPaso(x: unknown): Paso | null {
    const texto = String((x && typeof x === "object" ? (x as any).texto : x) || "").trim().slice(0, 100);
    if (!texto) return null;
    return { texto, obligatorio: !!(x && typeof x === "object" && (x as any).obligatorio) };
}
/** Una lista de pasos: sin vacíos, sin repetidos (el texto es su clave en la bitácora), hasta PASOS_MAX. */
export function leerPasos(v: unknown): Paso[] {
    if (!Array.isArray(v)) return [];
    const vistos = new Set<string>();
    const out: Paso[] = [];
    for (const x of v) { const q = leerPaso(x); if (q && !vistos.has(q.texto)) { vistos.add(q.texto); out.push(q); } }
    return out.slice(0, PASOS_MAX);
}

export function leerProcedimiento(v: unknown): Procedimiento {
    const g = json(v) as any;
    const out = { ...PROCEDIMIENTO_DEFECTO };
    if (g && typeof g === "object") {
        for (const k of ["1", "2", "3", "4", "5"] as const) if (Array.isArray(g[k])) out[k] = leerPasos(g[k]);
    }
    return out;
}

/** Lo guardado por clase: cada clase con su lista, o null (= la de su prioridad). Lo desconocido se descarta. */
export function leerProcedimientosClase(v: unknown): ProcedimientosClase {
    const g = json(v) as any;
    const out: ProcedimientosClase = {};
    if (g && typeof g === "object") {
        for (const c of CLASES_CON_PROCEDIMIENTO) if (Array.isArray(g[c])) out[c] = leerPasos(g[c]);
    }
    return out;
}

/**
 * El procedimiento de un evento: el de su clase si tiene uno (aunque esté vacío a propósito: una clase
 * con lista vacía no tiene pasos), y si no, el de su prioridad.
 */
export function resolverProcedimiento(clase: string, nombreClase: string, prioridad: number, porPrioridad: Procedimiento, porClase: ProcedimientosClase): ProcedimientoResuelto {
    const propio = (porClase as Record<string, Paso[] | null | undefined>)[clase];
    if (Array.isArray(propio)) return { pasos: propio, origen: { tipo: "clase", clase, nombre: nombreClase } };
    const k = String(Math.min(5, Math.max(1, prioridad))) as keyof Procedimiento;
    return { pasos: porPrioridad[k] || [], origen: { tipo: "prioridad", prioridad: Number(k) } };
}
export const origenProcedimiento = (r: ProcedimientoResuelto) => r.origen.tipo === "clase" ? `Procedimiento de ${r.origen.nombre}` : `Procedimiento de prioridad ${r.origen.prioridad}`;

/** Los obligatorios que todavía no están ni hechos ni salteados: lo que le falta a TRATAR. */
export function obligatoriosFaltantes(pasos: Paso[], hechos: Record<string, unknown>, salteados: Record<string, unknown>): string[] {
    return pasos.filter((x) => x.obligatorio && !hechos[x.texto] && !salteados[x.texto]).map((x) => x.texto);
}

export function leerEscalado(v: unknown): Escalado {
    const g = (json(v) || {}) as any;
    const ventanaHasta = entero(g.ventanaHasta, 0, 5, ESCALADO_DEFECTO.ventanaHasta);
    return {
        ventanaHasta,
        avisoHasta: Math.max(ventanaHasta, entero(g.avisoHasta, 0, 5, ESCALADO_DEFECTO.avisoHasta)),
        tomarMin: entero(g.tomarMin, 0, 120, ESCALADO_DEFECTO.tomarMin),
        tratarMin: entero(g.tratarMin, 0, 240, ESCALADO_DEFECTO.tratarMin),
        escalarHasta: entero(g.escalarHasta, 0, 5, ESCALADO_DEFECTO.escalarHasta),
    };
}

/** Un texto de tratamiento que dice algo: no «.», no «ok». */
export const TEXTO_MINIMO = 8;

/** Lo que se ve de un evento de central (la ventana, la pila, la ficha). */
export type EventoCentral = {
    id: string; clave: string; ts: string; tipo: string; titulo: string; prioridad: number;
    central: { id: string; deviceId: string; nombre: string; cuenta: string; prueba: boolean };
    zona: { zona: number; nombre: string | null; camaras: string[] } | null;
    particion: number | null; area: string | null;
    operador: { nombre: string | null; desde: string | null; soyYo: boolean };
    tratado: { por: string | null; ts: string; cierre: string; resultado: string | null; texto: string | null } | null;
    /** Pasos del procedimiento ya hechos: { paso: { por, ts } }. */
    pasos: Record<string, { por: string | null; ts: string }>;
    /** Pasos salteados con su motivo: { paso: { por, ts, motivo } }. */
    salteos: Record<string, { por: string | null; ts: string; motivo: string }>;
    /** El procedimiento con que se abrió el evento (guardado con él) y de dónde salió. */
    procedimiento: ProcedimientoResuelto;
    escalado: string | null;
    tiempos: { tomarSeg: number | null; tratarSeg: number | null };
};

export const segATexto = (s: number | null | undefined) => {
    if (s == null) return "—";
    const m = Math.floor(s / 60), r = Math.round(s % 60);
    return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : m ? `${m} min ${r} s` : `${r} s`;
};
