/**
 * Las empresas que entran al barrio sin ser de nadie: deliveries, envíos y taxis.
 *
 * Hasta acá la empresa de un proveedor o de una visita era texto libre: "PedidosYa",
 * "pedidos ya", "Pedidos Ya!" eran tres empresas distintas para el sistema, y no había dónde
 * colgar un logo. Ahora hay un catálogo (Ajustes → Empresas), y el texto se compara contra
 * él con el nombre normalizado: lo ya cargado sigue andando, y lo nuevo se elige de una lista.
 *
 * El logo lo sube el administrador (PNG con fondo transparente) y se pinta encima de la
 * captura cuando la matrícula es de esa empresa. No se trae ni se dibuja ningún logo desde
 * acá: son marcas de terceros, y el archivo que se usa tiene que ser el que el barrio decida.
 *
 * Este archivo no toca la base: lo usan el servidor y el navegador.
 */

export const CLAVE_EMPRESAS = "EMPRESAS_PROVEEDORES";

export type Rubro = "delivery" | "envios" | "taxi" | "otro";

export const RUBROS: { clave: Rubro; nombre: string; ayuda: string }[] = [
    { clave: "delivery", nombre: "Delivery", ayuda: "Comida y súper a domicilio. Entra, deja y sale en minutos." },
    { clave: "envios", nombre: "Envíos", ayuda: "Paquetería y correo. Suele recorrer varios lotes en una pasada." },
    { clave: "taxi", nombre: "Taxi", ayuda: "Taxis y autos de aplicación: traen o buscan a alguien." },
    { clave: "otro", nombre: "Otro", ayuda: "Cualquier otra empresa que entre seguido." },
];

export type Empresa = {
    /** Identificador estable (no cambia si se corrige el nombre). */
    clave: string;
    nombre: string;
    rubro: Rubro;
    /** Otras formas en que aparece escrita ("Pedidos Ya", "PYA"). */
    alias: string[];
    /** `/api/files/marcas/<clave>-<n>.png`, o null si todavía no se subió. */
    logo: string | null;
    /** Si el PNG tiene canal alfa. Sin él, el logo se ve con su recuadro encima de la foto. */
    transparente: boolean;
    activa: boolean;
};

/**
 * El catálogo con el que arranca un barrio que nunca lo tocó. Relevado el 8/10/2026:
 * deliveries y envíos que operan en Montevideo, y los radio taxis y aplicaciones que lista
 * la Intendencia (descubrimontevideo.uy/taxis). Es un punto de partida, no una verdad: el
 * mercado cambia (Uber anunció en julio la compra de la dueña de PedidosYa; Uber Eats dejó
 * Uruguay en 2020) y cada barrio ve entrar a otras. Se edita en Ajustes → Empresas.
 */
export const EMPRESAS_INICIALES: Omit<Empresa, "logo" | "transparente" | "activa">[] = [
    { clave: "pedidosya", nombre: "PedidosYa", rubro: "delivery", alias: ["Pedidos Ya", "PYA"] },
    { clave: "rappi", nombre: "Rappi", rubro: "delivery", alias: [] },
    { clave: "mercadolibre", nombre: "Mercado Libre", rubro: "envios", alias: ["Mercado Envíos", "Mercado Envios", "MeLi"] },
    { clave: "dac", nombre: "DAC", rubro: "envios", alias: [] },
    { clave: "ues", nombre: "UES", rubro: "envios", alias: [] },
    { clave: "correo", nombre: "Correo Uruguayo", rubro: "envios", alias: ["Correo", "ANC"] },
    { clave: "rt141", nombre: "Radio Taxi 141", rubro: "taxi", alias: ["141", "Radio Taxi Patronal", "Taxi 141"] },
    { clave: "celeritas", nombre: "Celeritas", rubro: "taxi", alias: ["1919"] },
    { clave: "puntagorda", nombre: "Radio Taxi Punta Gorda", rubro: "taxi", alias: ["1771", "Punta Gorda"] },
    { clave: "rtcarrasco", nombre: "Radio Taxi Carrasco", rubro: "taxi", alias: [] },
    { clave: "taxiaeropuerto", nombre: "Taxi Aeropuerto de Carrasco", rubro: "taxi", alias: ["Taxi Aeropuerto"] },
    { clave: "teletaxi", nombre: "Tele Taxi", rubro: "taxi", alias: ["Teletaxi"] },
    { clave: "laespanola", nombre: "La Española", rubro: "taxi", alias: ["La Espanola"] },
    { clave: "rtcooperativo", nombre: "Radio Taxi Cooperativo", rubro: "taxi", alias: [] },
    { clave: "rtscot", nombre: "Radio Taxi Scot", rubro: "taxi", alias: ["Scot"] },
    { clave: "uber", nombre: "Uber", rubro: "taxi", alias: [] },
    { clave: "voyentaxi", nombre: "Voy en Taxi", rubro: "taxi", alias: ["Voy"] },
    { clave: "taxisat", nombre: "TaxiSat", rubro: "taxi", alias: [] },
    { clave: "cabify", nombre: "Cabify", rubro: "taxi", alias: ["Easy Taxi"] },
];

/** "Pedidos Ya!" → "pedidosya". Lo que se compara, nunca lo que se muestra. */
export function normalizarNombre(s: string | null | undefined): string {
    return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** La empresa del catálogo que corresponde a un texto libre, por nombre o alias. */
export function empresaDe(texto: string | null | undefined, catalogo: Empresa[]): Empresa | null {
    const n = normalizarNombre(texto);
    if (!n) return null;
    return catalogo.find((e) => normalizarNombre(e.nombre) === n || e.clave === n || e.alias.some((a) => normalizarNombre(a) === n)) || null;
}

/** De lo guardado (o de nada) a un catálogo válido: lo que se lee es lo que se guarda. */
export function normalizarCatalogo(crudo: unknown): Empresa[] {
    const lista = Array.isArray(crudo) ? crudo : null;
    if (!lista) return EMPRESAS_INICIALES.map((e) => ({ ...e, logo: null, transparente: false, activa: true }));
    const vistas = new Set<string>();
    const out: Empresa[] = [];
    for (const x of lista as any[]) {
        const nombre = String(x?.nombre || "").trim().slice(0, 60);
        const clave = normalizarNombre(x?.clave || nombre).slice(0, 40);
        if (!nombre || !clave || vistas.has(clave)) continue;
        vistas.add(clave);
        out.push({
            clave, nombre,
            rubro: RUBROS.some((r) => r.clave === x?.rubro) ? x.rubro : "otro",
            alias: Array.isArray(x?.alias) ? x.alias.map((a: any) => String(a).trim()).filter(Boolean).slice(0, 8) : [],
            logo: typeof x?.logo === "string" && x.logo.startsWith("/api/files/") ? x.logo : null,
            transparente: !!x?.transparente,
            activa: x?.activa !== false,
        });
    }
    return out;
}
