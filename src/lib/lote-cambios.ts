/**
 * Qué cambió en un lote: la mitad que se puede probar sin base.
 *
 * Pedido de Nico (21/11): «auditoría de cambios en cada lote; el objetivo es saber cuándo un
 * residente cambia sus matrículas».
 *
 * La decisión de fondo: las altas y bajas NO se anotan en cada lugar que toca una matrícula. Son
 * más de veinte —el cajón del residente, la pantalla de vehículos, la de credenciales, el censo, la
 * planilla del padrón, WhatsApp, Telegram, la importación desde una cámara, una restauración— y el
 * día que alguien agregue el veintiuno se va a olvidar de anotar. En cambio se COMPARA: lo que el
 * lote tiene ahora contra la última foto que se le sacó. Lo que difiere es lo que cambió, lo haya
 * cambiado quien lo haya cambiado.
 *
 * Los caminos conocidos piden la comparación apenas terminan y la firman (quién fue, por dónde). Lo
 * que se escape lo encuentra la pasada de cada minuto, sin firma: se sabe que cambió y cuándo, con
 * un minuto de margen, y se dice que no se sabe quién.
 *
 * Nada de acá toca la base ni usa nada de Node: lo importan las pantallas.
 */

export type EstadoLote = {
    personas: { id: string; nombre: string }[];
    chapas: { chapa: string; userId: string }[];
};

export type QueCambio =
    | "MATRICULA_ALTA" | "MATRICULA_BAJA" | "PERSONA_ALTA" | "PERSONA_BAJA"
    | "CENSO_CARGA" | "CENSO_APROBADA" | "CENSO_RECHAZADA" | "CODIGO_CAMBIADO"
    /* Lo que se corrige a mano desde el cajón del lote (25/11, Nico: «se debe poder editar a mano, y
       quedar en el historial el cambio, para llevar un registro de cambios en cada info del lote»). */
    | "DATO_CAMBIADO" | "PERSONA_EDITADA"
    /* Los proveedores de servicio del lote (26/11): jardinero, piscinero, limpieza. */
    | "SERVICIO_ALTA" | "SERVICIO_BAJA" | "SERVICIO_EDITADO";

export type Cambio = { que: QueCambio; chapa?: string; persona?: string; userId?: string; detalle?: string };

export const ESTADO_VACIO: EstadoLote = { personas: [], chapas: [] };

/** La matrícula como se guarda: mayúsculas, sin guiones ni espacios. */
export const limpiarChapa = (v: unknown): string => String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Lo que vino guardado como JSON, llevado a su forma: lo que no la tenga se descarta, no rompe. */
export function leerEstado(personas: unknown, chapas: unknown): EstadoLote {
    const p = Array.isArray(personas) ? personas : [], c = Array.isArray(chapas) ? chapas : [];
    return {
        personas: p.filter((x) => x && typeof x.id === "string").map((x) => ({ id: String(x.id), nombre: String(x.nombre ?? "") })),
        chapas: c.filter((x) => x && typeof x.chapa === "string" && x.chapa).map((x) => ({ chapa: String(x.chapa), userId: String(x.userId ?? "") })),
    };
}

export type PersonaConLotes = {
    id: string; nombre: string;
    /** Los lotes en los que figura: su unidad y los del padrón (puede tener varios). */
    lotes: string[];
    /** Sus matrículas, de donde sea que estén: como vehículo o como credencial. */
    chapas: string[];
};

/**
 * La foto de hoy de cada lote, a partir de la gente.
 *
 * Una matrícula vive en dos lados —como vehículo y como credencial— y acá es UNA: lo que importa es
 * con qué chapas entra la gente del lote, no en cuántas tablas está anotada. Quien tiene dos lotes
 * lleva sus matrículas a los dos.
 *
 * Todo sale ordenado para que dos fotos iguales sean iguales también como texto.
 */
export function estadoDeLotes(personas: PersonaConLotes[]): Map<string, EstadoLote> {
    const lotes = new Map<string, EstadoLote>();
    for (const p of [...personas].sort((a, b) => a.id.localeCompare(b.id))) {
        const chapas = [...new Set(p.chapas.map(limpiarChapa).filter(Boolean))].sort();
        for (const unitId of new Set(p.lotes.filter(Boolean))) {
            const e = lotes.get(unitId) ?? { personas: [], chapas: [] };
            e.personas.push({ id: p.id, nombre: p.nombre });
            for (const chapa of chapas) if (!e.chapas.some((c) => c.chapa === chapa)) e.chapas.push({ chapa, userId: p.id });
            lotes.set(unitId, e);
        }
    }
    for (const e of lotes.values()) e.chapas.sort((a, b) => a.chapa.localeCompare(b.chapa));
    return lotes;
}

/**
 * Lo que cambió entre dos fotos del mismo lote.
 *
 * Primero la gente y después las matrículas, y las bajas antes que las altas: así, quien cambia de
 * auto se lee «baja ABC 1234, alta DEF 5678», en ese orden.
 *
 * Una matrícula que sigue en el lote pero pasó de una persona a otra de la misma casa NO es un
 * cambio del lote: sigue entrando la misma chapa a la misma casa.
 */
export function compararLote(antes: EstadoLote, ahora: EstadoLote): Cambio[] {
    const cambios: Cambio[] = [];
    const nombreAntes = new Map(antes.personas.map((p) => [p.id, p.nombre])), nombreAhora = new Map(ahora.personas.map((p) => [p.id, p.nombre]));
    const chapasDe = (e: EstadoLote, id: string) => e.chapas.filter((c) => c.userId === id).map((c) => c.chapa);
    const con = (chapas: string[]) => (chapas.length ? `Con ${chapas.length === 1 ? "la matrícula" : "las matrículas"} ${chapas.join(", ")}.` : undefined);

    for (const p of antes.personas) if (!nombreAhora.has(p.id)) cambios.push({ que: "PERSONA_BAJA", persona: p.nombre, userId: p.id, detalle: con(chapasDe(antes, p.id)) });
    for (const p of ahora.personas) if (!nombreAntes.has(p.id)) cambios.push({ que: "PERSONA_ALTA", persona: p.nombre, userId: p.id, detalle: con(chapasDe(ahora, p.id)) });

    const habia = new Map(antes.chapas.map((c) => [c.chapa, c.userId])), hay = new Map(ahora.chapas.map((c) => [c.chapa, c.userId]));
    for (const c of antes.chapas) if (!hay.has(c.chapa)) cambios.push({ que: "MATRICULA_BAJA", chapa: c.chapa, userId: c.userId || undefined, persona: nombreAntes.get(c.userId) || nombreAhora.get(c.userId) });
    for (const c of ahora.chapas) if (!habia.has(c.chapa)) cambios.push({ que: "MATRICULA_ALTA", chapa: c.chapa, userId: c.userId || undefined, persona: nombreAhora.get(c.userId) });
    return cambios;
}

/**
 * Lo que un residente acaba de declarar en el censo, contra lo que su lote ya tenía.
 *
 * Es lo que contesta la pregunta del pedido en el momento en que pasa: el residente todavía no
 * cambió nada en el padrón —su carga espera que la administración la apruebe— pero ya dijo qué
 * quiere cambiar. `faltan` son las que el lote tiene y él no nombró: el censo no las da de baja
 * solo, y por eso mismo conviene que queden a la vista.
 */
export function diferenciaDeCarga(delLote: string[], declaradas: string[]): { nuevas: string[]; siguen: string[]; faltan: string[] } {
    const tiene = new Set(delLote.map(limpiarChapa).filter(Boolean)), dijo = [...new Set(declaradas.map(limpiarChapa).filter(Boolean))];
    return { nuevas: dijo.filter((c) => !tiene.has(c)), siguen: dijo.filter((c) => tiene.has(c)), faltan: [...tiene].filter((c) => !dijo.includes(c)).sort() };
}

/** La frase que resume una carga del censo en el historial del lote. */
export function fraseDeCarga(d: { nuevas: string[]; siguen: string[]; faltan: string[] }): string {
    const total = d.nuevas.length + d.siguen.length;
    if (!total) return d.faltan.length ? `No declaró ninguna matrícula. El lote tiene ${d.faltan.join(", ")}.` : "No declaró ninguna matrícula.";
    const partes = [`Declaró ${total} ${total === 1 ? "matrícula" : "matrículas"}.`];
    if (d.nuevas.length) partes.push(`${d.nuevas.length === 1 ? "Nueva" : "Nuevas"}: ${d.nuevas.join(", ")}.`);
    if (d.faltan.length) partes.push(`No nombró ${d.faltan.join(", ")}, que el lote tiene.`);
    if (!d.nuevas.length && !d.faltan.length) partes.push("Las mismas que ya tenía.");
    return partes.join(" ");
}

/* ---------- Cómo se lee en pantalla ---------- */

export type TonoCambio = "bien" | "mal" | "info" | "aviso" | "quieto";
export type ClaseCambio = "matriculas" | "personas" | "censo" | "datos" | "servicios";
export const CAMBIOS: Record<QueCambio, { rotulo: string; tono: TonoCambio; clase: ClaseCambio }> = {
    MATRICULA_ALTA: { rotulo: "Matrícula nueva", tono: "bien", clase: "matriculas" },
    MATRICULA_BAJA: { rotulo: "Matrícula quitada", tono: "mal", clase: "matriculas" },
    PERSONA_ALTA: { rotulo: "Entró al lote", tono: "info", clase: "personas" },
    PERSONA_BAJA: { rotulo: "Salió del lote", tono: "aviso", clase: "personas" },
    CENSO_CARGA: { rotulo: "Cargó en el censo", tono: "info", clase: "censo" },
    CENSO_APROBADA: { rotulo: "Carga aprobada", tono: "bien", clase: "censo" },
    CENSO_RECHAZADA: { rotulo: "Carga rechazada", tono: "aviso", clase: "censo" },
    CODIGO_CAMBIADO: { rotulo: "Código del censo cambiado", tono: "quieto", clase: "censo" },
    DATO_CAMBIADO: { rotulo: "Datos del lote corregidos", tono: "quieto", clase: "datos" },
    PERSONA_EDITADA: { rotulo: "Datos de una persona corregidos", tono: "quieto", clase: "personas" },
    SERVICIO_ALTA: { rotulo: "Servicio nuevo", tono: "info", clase: "servicios" },
    SERVICIO_BAJA: { rotulo: "Servicio dado de baja", tono: "aviso", clase: "servicios" },
    SERVICIO_EDITADO: { rotulo: "Servicio corregido", tono: "quieto", clase: "servicios" },
};

/**
 * Qué cambió entre dos versiones de unos datos, en palabras: «Titular: «Ana» → «Ana y Beto»». Lo
 * vacío se dice «vacío», no se omite: borrar un teléfono también es un cambio que alguien hizo.
 */
type Datos<K extends string> = Partial<Record<K, string | null | undefined>>;
export function diferenciasDeDatos<K extends string>(antes: Datos<K>, despues: Datos<K>, rotulos: Record<K, string>): string[] {
    const v = (x: string | null | undefined) => String(x ?? "").replace(/\s+/g, " ").trim();
    const dice = (x: string) => (x ? `«${x}»` : "vacío");
    const out: string[] = [];
    for (const k of Object.keys(rotulos) as K[]) {
        if (!(k in despues)) continue;
        const a = v(antes[k]), b = v(despues[k]);
        if (a !== b) out.push(`${rotulos[k]}: ${dice(a)} → ${dice(b)}`);
    }
    return out;
}

/** «por el censo», «desde el panel»… y quién, si se sabe. Sin firma se dice que no se sabe. */
export function firmaDeCambio(c: { quien: string | null; origen: string }): string {
    const por = c.origen === "censo" ? "por el censo" : c.origen === "panel" ? "desde el panel" : c.origen === "padron" ? "con la planilla del padrón" : "";
    if (c.quien) return por ? `${c.quien}, ${por}` : c.quien;
    return por || "No se sabe quién: no fue desde el panel ni por el censo";
}

/** Las clases del filtro, con las cuentas de lo que hay cargado. */
export function contarPorClase(cambios: { que: string }[]): Record<"todos" | ClaseCambio, number> {
    const n = { todos: cambios.length, matriculas: 0, personas: 0, censo: 0, datos: 0, servicios: 0 };
    for (const c of cambios) { const k = CAMBIOS[c.que as QueCambio]?.clase; if (k) n[k]++; }
    return n;
}
