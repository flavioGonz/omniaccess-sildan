/**
 * El padrón de /admin/users: qué pestañas hay, quién cae en cada una, y cómo se comporta cada
 * clase de persona en el monitor.
 *
 * Por qué existe (pedido del 9/10): «listas de seguimiento o vigilancia» confundía. Había una
 * pestaña Personas con chips de rol, otra Lista de vigilancia por matrícula con tres categorías
 * (lista negra, VIP, en búsqueda), y el VIP podía ser un rol o una matrícula. Tres maneras de
 * decir casi lo mismo. Ahora:
 *
 *   · Una pestaña por clase — Residentes, Personal, Proveedores, Visitas, Lista negra — y cada
 *     una se crea con el mismo cajón.
 *   · La lista negra es una pestaña de FICHAS (una persona o un vehículo, con una o varias
 *     matrículas), con dos niveles: alerta máxima (se deniega) y en búsqueda (se avisa).
 *   · VIP es una marca dentro de Residentes o Personal, no una lista.
 *   · Cada pestaña dice cómo se comporta (lo fijo) y tiene unos pocos interruptores reales
 *     (`Comportamiento`) que el monitor LPR lee al cargar.
 *
 * Este archivo no habla con la base: lo usan la página, el monitor y las acciones por igual.
 */

export type ClavePestania = "residentes" | "personal" | "proveedores" | "visitas" | "listanegra";

export type Tono = "neutro" | "bien" | "aviso" | "mal" | "info" | "quieto";

export type Pestania = {
    clave: ClavePestania;
    titulo: string;
    /** Cómo se nombra a uno: «Nuevo residente», «0 proveedores». */
    singular: string;
    plural: string;
    /** El botón de alta de la pestaña. */
    nuevo: string;
    /** El encabezado de la primera columna de la tabla. */
    columna: string;
    /** Los roles que caen acá. Vacío en Lista negra: sus fichas no son usuarios. */
    roles: string[];
    /** El rol con el que nace alguien creado desde esta pestaña. */
    rolNuevo: string | null;
    tono: Tono;
};

export const PESTANIAS: Pestania[] = [
    { clave: "residentes", columna: "Residente",  nuevo: "Nuevo residente",  titulo: "Residentes", singular: "residente", plural: "residentes", roles: ["RESIDENT", "WHITELISTED"], rolNuevo: "RESIDENT", tono: "info" },
    // Administración y operadores también son gente del barrio que entra: van con el personal,
    // que es lo que el guardia espera encontrar ahí.
    { clave: "personal", columna: "Persona",  nuevo: "Nuevo en el personal",  titulo: "Personal", singular: "persona del personal", plural: "del personal", roles: ["STAFF", "SECURITY", "ADMIN", "OPERATOR"], rolNuevo: "STAFF", tono: "bien" },
    { clave: "proveedores", columna: "Proveedor",  nuevo: "Nuevo proveedor",  titulo: "Proveedores", singular: "proveedor", plural: "proveedores", roles: ["PROVIDER"], rolNuevo: "PROVIDER", tono: "aviso" },
    { clave: "visitas", columna: "Visita",  nuevo: "Nueva visita",  titulo: "Visitas", singular: "visita", plural: "visitas", roles: ["VISITOR", "TEMPORARY_VISITOR"], rolNuevo: "VISITOR", tono: "quieto" },
    { clave: "listanegra", columna: "Quién",  nuevo: "Nueva ficha",  titulo: "Lista negra", singular: "ficha", plural: "fichas", roles: [], rolNuevo: null, tono: "mal" },
];

/** La pestaña de una persona según su rol. Un rol desconocido cae en Residentes, que es el defecto del alta. */
export function pestaniaDeRol(rol: string | null | undefined): ClavePestania {
    const r = String(rol || "").toUpperCase();
    // El rol «Lista negra» (módulo facial) no es una persona del padrón: su ficha vive en Lista negra.
    if (r === "BLACKLISTED") return "listanegra";
    return PESTANIAS.find((p) => p.roles.includes(r))?.clave || "residentes";
}

/** Las pestañas donde se puede marcar a alguien como VIP. */
export const PESTANIAS_CON_VIP: ClavePestania[] = ["residentes", "personal"];

// ── Los dos niveles de la lista negra ─────────────────────────────────────────────────────

/** Los niveles se guardan como la categoría de PlateWatch, que es lo que lee la barrera. */
export type NivelListaNegra = "BLACKLISTED" | "SEARCH";

export const NIVELES: Record<NivelListaNegra, { titulo: string; corto: string; tono: Tono; resumen: string }> = {
    BLACKLISTED: { titulo: "Alerta máxima", corto: "alerta máxima", tono: "mal", resumen: "Se deniega siempre y suena la alarma." },
    SEARCH: { titulo: "En búsqueda", corto: "en búsqueda", tono: "aviso", resumen: "Pasa, pero se avisa con el motivo." },
};

/** Cómo se llama a una ficha sin nombre: el vehículo existe, la persona no se sabe. */
export const SIN_IDENTIFICAR = "Sin identificar";

// ── Cómo se ve cada clase en el monitor LPR ───────────────────────────────────────────────

/**
 * La clase con la que el monitor pinta una lectura. Es la pestaña de la persona, más las dos
 * marcas que pesan más que el rol: VIP y los dos niveles de lista negra.
 */
export type ClaseMonitor = "residentes" | "personal" | "proveedores" | "visitas" | "vip" | "alerta" | "busqueda";

/**
 * El estilo de cada clase en el monitor LPR (consola oscura). Es el mismo que tenía el monitor
 * escrito adentro; vive acá para que la pestaña muestre EXACTAMENTE la etiqueta que se va a ver
 * — una muestra que no coincide con la pantalla enseña otra cosa.
 */
export const ESTILO_MONITOR: Record<ClaseMonitor, { etiqueta: string; badge: string; ring: string; dot: string }> = {
    residentes: { etiqueta: "Residente", badge: "bg-blue-500/15 text-blue-300 border border-blue-500/40", ring: "ring-1 ring-blue-500/50", dot: "bg-blue-500" },
    personal: { etiqueta: "Personal", badge: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40", ring: "ring-1 ring-emerald-500/50", dot: "bg-emerald-500" },
    proveedores: { etiqueta: "Proveedor", badge: "bg-amber-500/15 text-amber-300 border border-amber-500/40", ring: "ring-1 ring-amber-500/50", dot: "bg-amber-500" },
    visitas: { etiqueta: "Visitante", badge: "bg-purple-500/15 text-purple-300 border border-purple-500/40", ring: "ring-1 ring-purple-500/50", dot: "bg-purple-500" },
    // VIP en verde: es PERMITIDO. Se distingue del personal por la etiqueta y por el anillo doble.
    vip: { etiqueta: "VIP", badge: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40", ring: "ring-2 ring-emerald-400/70", dot: "bg-emerald-400" },
    alerta: { etiqueta: "Lista negra", badge: "bg-red-500/15 text-red-300 border border-red-500/40", ring: "ring-2 ring-red-500/70", dot: "bg-red-500" },
    busqueda: { etiqueta: "En búsqueda", badge: "bg-amber-500/20 text-amber-200 border border-amber-500/50", ring: "ring-2 ring-amber-400/70", dot: "bg-amber-400" },
};

/** Sin color propio: la etiqueta se sigue viendo (el guardia necesita saber quién es), en gris. */
export const ESTILO_APAGADO = { badge: "bg-zinc-500/15 text-zinc-300 border border-zinc-500/40", ring: "", dot: "" };

/**
 * La clase de una lectura: primero la lista negra (por la vigilancia de la matrícula o por el
 * rol del módulo facial), después VIP, después el rol. Null = nadie conocido.
 */
export function claseDeLectura(user: { role?: string | null; vip?: boolean | null } | null | undefined, categoriaVigilancia?: string | null): ClaseMonitor | null {
    const cat = String(categoriaVigilancia || "").toUpperCase();
    if (cat === "BLACKLISTED" || cat === "NEGRA") return "alerta";
    if (cat === "SEARCH" || cat === "BUSCA") return "busqueda";
    // Una matrícula VIP suelta (de antes de que VIP fuera una marca de la persona) sigue valiendo.
    if (cat === "WHITELISTED" || cat === "BLANCA") return "vip";
    if (!user) return null;
    const rol = String(user.role || "").toUpperCase();
    if (rol === "BLACKLISTED") return "alerta";
    if (user.vip || rol === "WHITELISTED") return "vip";
    const p = pestaniaDeRol(rol);
    return p === "listanegra" ? "alerta" : p;
}

// ── Los interruptores ─────────────────────────────────────────────────────────────────────

/**
 * Lo que se puede prender y apagar por pestaña. Pocos a propósito: cada uno hace algo que se
 * ve en el monitor LPR. Lo que no se puede elegir (la barrera, las lectoras, la alarma de la
 * lista negra) se dice como fijo, no se dibuja como interruptor.
 *
 *   color  → la tarjeta lleva el color de su clase (si no, etiqueta en gris).
 *   sonido → suena el aviso corto cuando la cámara la lee (si el sonido del monitor está prendido).
 */
export type Interruptores = { color: boolean; sonido: boolean };
export type ClaveComportamiento = "residentes" | "personal" | "proveedores" | "visitas" | "vip" | "busqueda";
export type Comportamiento = Record<ClaveComportamiento, Interruptores>;

/** La clave del Setting donde se guardan los interruptores. */
export const SETTING_COMPORTAMIENTO = "PADRON_COMPORTAMIENTO";

/**
 * Los valores con los que arranca: lo que el monitor ya hacía antes de que existieran los
 * interruptores (todas las clases con color; sólo «en búsqueda» sonaba). Prender esto no
 * cambia nada de lo que el guardia está acostumbrado a ver.
 */
export const COMPORTAMIENTO_DEFECTO: Comportamiento = {
    residentes: { color: true, sonido: false },
    personal: { color: true, sonido: false },
    proveedores: { color: true, sonido: false },
    visitas: { color: true, sonido: false },
    vip: { color: true, sonido: false },
    busqueda: { color: true, sonido: true },
};

/** Lee lo guardado completando con el defecto: una clave nueva no puede quedar en `undefined`. */
export function normalizarComportamiento(x: unknown): Comportamiento {
    const o = (x && typeof x === "object" ? x : {}) as Record<string, any>;
    const out = {} as Comportamiento;
    for (const k of Object.keys(COMPORTAMIENTO_DEFECTO) as ClaveComportamiento[]) {
        const d = COMPORTAMIENTO_DEFECTO[k];
        const v = o[k] || {};
        out[k] = { color: typeof v.color === "boolean" ? v.color : d.color, sonido: typeof v.sonido === "boolean" ? v.sonido : d.sonido };
    }
    return out;
}

// ── Lo fijo de cada pestaña, en palabras del operador ─────────────────────────────────────

/**
 * Lo que pasa siempre, sin interruptor. Tiene que decir lo que el sistema hace: si cambia el
 * comportamiento, cambia el texto en el mismo commit.
 */
export const LO_FIJO: Record<Exclude<ClavePestania, "listanegra">, { barrera: string; monitores: string }> = {
    residentes: {
        barrera: "Pasa con su credencial (matrícula, tag, PIN o rostro), según sus grupos y horarios.",
        monitores: "En Control LPR se ve con su nombre y su lote.",
    },
    personal: {
        barrera: "Pasa con su credencial, según sus grupos y horarios. Administración y operadores además entran al panel.",
        monitores: "En Control LPR se ve con su nombre.",
    },
    proveedores: {
        barrera: "Pasa con su credencial. Si tiene tipo de visita, la cámara de Entrada le abre la visita sola —con su cuenta atrás y el aviso a la guardia si se pasa— y la de Salida la cierra.",
        monitores: "En Control LPR se ve con el logo de su empresa y, si tiene visita abierta, en «En el barrio».",
    },
    visitas: {
        // No decir que la «visita temporal» caduca sola: lo decía el cajón, pero nada en el
        // sistema la vence (revisado el 9/10). Hasta que exista, se la saca a mano.
        barrera: "Pasa con su credencial mientras esté cargada. No vence sola: se la saca a mano.",
        monitores: "En Control LPR se ve con su nombre.",
    },
};
