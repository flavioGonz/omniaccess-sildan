/**
 * Los proveedores, reunidos (28/11). Nico: «Proveedores y servicios de cada residente, lote, también
 * deben figurar en Usuarios › Proveedores, indicando a qué lote pertenece. Las administraciones
 * tienen sus propios servicios, y los residentes también: ese panel debe juntarlos y distinguirlos».
 *
 * Había tres lugares donde vive «alguien que viene a trabajar», y cada uno se miraba por separado:
 *
 *   · **Del barrio** — una persona o empresa del padrón con rol de proveedor: tiene credenciales y
 *     entra con ellas. Se carga en Usuarios.
 *   · **De una administración** — lo que contrata una comisión para sus lotes o sus áreas comunes
 *     (jardinería, recolección). Se carga en Administraciones › Servicios. Es informativo: dice a
 *     quién espera la guardia.
 *   · **De un lote** — el jardinero o el piscinero de una casa. Lo carga el residente (censo, portal)
 *     o la administración en el cajón del lote. Identifica, y si se le habilita la entrada, entra por
 *     su matrícula en sus días y horario.
 *
 * La guardia no piensa en tres tablas: piensa «¿quién es el de la camioneta blanca y a qué casa
 * viene?». Acá se arman las tres como una sola lista, cada fila diciendo de quién es.
 *
 * Este archivo no habla con la base: lo usan la acción, la página y las pruebas.
 */
import { cuandoViene, rotuloServicio } from "@/lib/servicios-lote";

export type OrigenProveedor = "barrio" | "administracion" | "lote";

/** Qué pasa en el portón con esta fila. Es estado, y por eso es lo único de la tabla que lleva color. */
export type EntradaProveedor =
    /** Del padrón, con alguna credencial: entra con ella. */
    | "credencial"
    /** Del padrón, sin nada cargado. */
    | "sin-credencial"
    /** De un lote, con la entrada habilitada: entra por matrícula en sus días y horario. */
    | "horario"
    /** De un lote, sin habilitar: se lo reconoce, pero no entra solo. */
    | "identifica"
    /** De una administración: dice a quién se espera; no abre nada. */
    | "informativo"
    /** De un lote, dado de baja: dejó de venir. */
    | "baja";

export type ProveedorReunido = {
    /** Única entre las tres fuentes: «lote:…», «adm:…», «barrio:…». */
    clave: string;
    origen: OrigenProveedor;
    id: string;
    /** Quién es: la persona o la empresa. Puede venir vacío (un «Jardinero» sin nombre). */
    nombre: string;
    /** Qué hace: «Jardinero», «Recolección de residuos», la empresa del proveedor del barrio. */
    rubro: string;
    /** JARDINERO | PISCINERO | LIMPIEZA | OTRO en los de lote; null en el resto. Elige el dibujo. */
    tipo: string | null;
    /** De quién es: el lote o la administración. Null en los del barrio, que son de todos. */
    de: { id: string; nombre: string } | null;
    /** La administración a la que pertenece el lote, para ubicarlo («6ª»). */
    etapa: string | null;
    contacto: string | null;
    telefono: string | null;
    email: string | null;
    documento: string | null;
    chapas: string[];
    /** Cuándo viene, en una línea. */
    cuando: string;
    notas: string | null;
    entrada: EntradaProveedor;
    /** Lo declaró el residente en el censo o en el portal (no lo cargó la administración). */
    declarado: "censo" | "portal" | null;
    /** Otros lotes a los que viene el mismo vehículo: el jardinero de media cuadra. */
    tambienEn: string[];
};

/** Lo que trae la acción de un servicio de lote. */
export type ServicioDeLoteCrudo = {
    id: string; tipo: string; nombre: string; telefono: string | null; documento: string | null; chapa: string | null;
    dias: unknown; desde: string | null; hasta: string | null; notas: string | null; estado: string; origen: string; autorizado: boolean;
    lote: { id: string; nombre: string; etapa: string | null };
};
/** Lo que trae la acción de un servicio de administración. */
export type ServicioDeAdmCrudo = {
    id: string; rubro: string; proveedor: string | null; contacto: string | null; telefono: string | null; email: string | null;
    horario: string | null; notas: string | null;
    administracion: { id: string; nombre: string; sigla: string };
};
/** Lo que hace falta de una persona del padrón con rol de proveedor. */
export type ProveedorDelPadron = {
    id: string; name: string; empresa?: string | null; phone?: string | null; email?: string | null; dni?: string | null;
    credentials?: { type: string; value: string }[]; vehicles?: { plate: string }[]; cara?: string | null;
    empleador?: { name: string; empresa?: string | null } | null;
};

const limpia = (v: unknown) => String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const sinTildes = (v: unknown) => String(v || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function deLote(s: ServicioDeLoteCrudo): ProveedorReunido {
    const activo = s.estado === "ACTIVO";
    return {
        clave: `lote:${s.id}`, origen: "lote", id: s.id,
        nombre: s.nombre || "", rubro: rotuloServicio(s.tipo), tipo: s.tipo,
        de: { id: s.lote.id, nombre: s.lote.nombre }, etapa: s.lote.etapa,
        contacto: null, telefono: s.telefono, email: null, documento: s.documento,
        chapas: s.chapa ? [limpia(s.chapa)] : [],
        cuando: cuandoViene(s), notas: s.notas,
        entrada: !activo ? "baja" : s.autorizado ? "horario" : "identifica",
        declarado: s.origen === "censo" || s.origen === "portal" ? s.origen : null,
        tambienEn: [],
    };
}

export function deAdministracion(s: ServicioDeAdmCrudo): ProveedorReunido {
    return {
        clave: `adm:${s.id}`, origen: "administracion", id: s.id,
        // La empresa es «quién»; si sólo cargaron a la persona de contacto, es ella.
        nombre: s.proveedor || s.contacto || "", rubro: s.rubro, tipo: null,
        de: { id: s.administracion.id, nombre: s.administracion.nombre }, etapa: s.administracion.sigla,
        contacto: s.proveedor ? s.contacto : null, telefono: s.telefono, email: s.email, documento: null,
        chapas: [], cuando: s.horario || "", notas: s.notas,
        entrada: "informativo", declarado: null, tambienEn: [],
    };
}

export function delPadron(u: ProveedorDelPadron): ProveedorReunido {
    const creds = u.credentials || [];
    const chapas = creds.filter((c) => c.type === "PLATE").map((c) => limpia(c.value));
    for (const v of u.vehicles || []) { const p = limpia(v.plate); if (p && !chapas.includes(p)) chapas.push(p); }
    // Un rostro, un tag o un PIN también abren: no hace falta matrícula para «entra con su credencial».
    const algo = chapas.length > 0 || creds.some((c) => c.type !== "PLATE") || !!u.cara;
    const empresa = u.empleador ? (u.empleador.empresa || u.empleador.name) : u.empresa;
    return {
        clave: `barrio:${u.id}`, origen: "barrio", id: u.id,
        nombre: u.name || "", rubro: empresa || "Proveedor del barrio", tipo: null,
        de: null, etapa: null,
        contacto: null, telefono: u.phone || null, email: u.email || null, documento: u.dni || null,
        chapas, cuando: "", notas: null,
        entrada: algo ? "credencial" : "sin-credencial", declarado: null, tambienEn: [],
    };
}

/**
 * Las tres fuentes, en una lista. Primero lo del barrio, después las administraciones y después los
 * lotes, cada grupo por nombre: quien abre la pestaña sin filtrar ve arriba lo que ya conocía.
 *
 * `tambienEn` sale de la matrícula y de nada más. El nombre lo escribe cada residente a su manera
 * («Ramón», «Ramon jardinero», «el de Verde Sur») y juntar por parecido inventaría personas; la
 * matrícula, en cambio, es la misma camioneta.
 */
export function reunirProveedores(padron: ProveedorDelPadron[], adm: ServicioDeAdmCrudo[], lotes: ServicioDeLoteCrudo[]): ProveedorReunido[] {
    const filas = [...padron.map(delPadron), ...adm.map(deAdministracion), ...lotes.map(deLote)];
    const porChapa = new Map<string, Set<string>>();
    for (const f of filas) if (f.origen === "lote" && f.entrada !== "baja" && f.de) for (const c of f.chapas) {
        if (!porChapa.has(c)) porChapa.set(c, new Set());
        porChapa.get(c)!.add(f.de.nombre);
    }
    for (const f of filas) if (f.origen === "lote" && f.de) {
        const otros = new Set<string>();
        for (const c of f.chapas) for (const l of porChapa.get(c) || []) if (l !== f.de.nombre) otros.add(l);
        f.tambienEn = [...otros].sort((a, b) => a.localeCompare(b, "es", { numeric: true }));
    }
    const ORDEN: Record<OrigenProveedor, number> = { barrio: 0, administracion: 1, lote: 2 };
    const rotulo = (f: ProveedorReunido) => f.nombre || f.rubro;
    return filas.sort((a, b) => ORDEN[a.origen] - ORDEN[b.origen] || rotulo(a).localeCompare(rotulo(b), "es", { sensitivity: "base", numeric: true }));
}

export type FiltroOrigen = "todos" | OrigenProveedor;

/** Sigue viniendo: todo menos los servicios de lote dados de baja. */
export const vigente = (f: ProveedorReunido) => f.entrada !== "baja";

/**
 * Lo que se ve: por origen, por si sigue viniendo, y por lo escrito en el buscador. Se busca por
 * quién es, qué hace, de quién es (el lote o la administración), teléfono, documento y matrícula —
 * la matrícula sin guiones ni espacios, que es como la dicta alguien por radio.
 */
export function filtrarProveedores(filas: ProveedorReunido[], f: { origen: FiltroOrigen; bajas: boolean; q: string }): ProveedorReunido[] {
    const q = sinTildes(f.q.trim()), qChapa = limpia(f.q);
    return filas.filter((x) => {
        if (f.origen !== "todos" && x.origen !== f.origen) return false;
        if (f.bajas ? vigente(x) : !vigente(x)) return false;
        if (!q) return true;
        if (qChapa.length >= 3 && x.chapas.some((c) => c.includes(qChapa))) return true;
        return [x.nombre, x.rubro, x.de?.nombre, x.etapa, x.contacto, x.telefono, x.email, x.documento, x.notas].some((v) => v && sinTildes(v).includes(q));
    });
}

/** Cuántos hay de cada origen entre los que siguen viniendo: el número de cada pestaña. */
export function contarProveedores(filas: ProveedorReunido[]): Record<FiltroOrigen, number> & { bajas: number } {
    const c = { todos: 0, barrio: 0, administracion: 0, lote: 0, bajas: 0 };
    for (const f of filas) { if (!vigente(f)) { c.bajas++; continue; } c.todos++; c[f.origen]++; }
    return c;
}
