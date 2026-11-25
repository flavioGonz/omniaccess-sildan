/**
 * El menú del panel, declarado (23/11).
 *
 * Hasta acá el menú era el JSX del armazón: unas treinta entradas escritas una por una, cada una con
 * su condición al lado. Funcionaba, y tenía tres problemas que se veían al usarlo:
 *  · una sola lista larga, con secciones armadas por el orden en que se fueron agregando las
 *    pantallas («Gestión» juntaba personas, mapa, dispositivos y calendario);
 *  · Lista negra y Lista amarilla como entradas sueltas, aunque son pestañas de Usuarios;
 *  · OmniVision, Auditoría y Manuales escondidos adentro de Configuración.
 *
 * Nico pidió rehacerlo con el estilo del menú de Cloudflare y lo fue decidiendo en una maqueta
 * (claude/menu-nuevo-plan-2026-11-23.md). Sus decisiones, que este archivo cumple:
 *  · **por módulo**: cada módulo es una entrada que se abre y muestra sus pantallas;
 *  · lo que es de todos (alarmas, mapa, **historial**, evidencias) va arriba, sin módulo;
 *  · Pared de monitores es de Video;
 *  · el Padrón y el Sistema, en secciones propias al final.
 *
 * Está acá, como dato, y no en el JSX, por dos razones. La primera: del mismo árbol van a salir el
 * menú y el buscador (Ctrl K), y dos listas de pantallas escritas a mano se desencuentran a la
 * primera pantalla nueva. La segunda: así se puede probar. tests/menu.test.ts arma el menú de un
 * barrio, de una instalación de rostro y de una de filas, y comprueba que cada entrada lleva a una
 * pantalla que existe.
 *
 * Este paso NO cambia a qué pantalla lleva nada: todas las direcciones son las de antes. Cambian el
 * orden, los nombres de los grupos y dónde se busca cada cosa.
 *
 * No importa nada de React ni del servidor: lo que cambia de una instalación a otra (qué modo corre,
 * qué funciones tiene prendidas, qué puede ver el rol) le llega en `ContextoMenu`.
 */

export type TonoInsignia = "mal" | "aviso";
export type Insignia = { n: number; tono: TonoInsignia };

/** Qué dibujo lleva una entrada. El menú los traduce a íconos; acá son sólo nombres. */
export type IconoMenu =
    | "alarmas" | "mapa" | "historial" | "evidencias" | "matriculas" | "rostro" | "intrusion" | "video" | "gps" | "guardia" | "vision" | "filas"
    | "personas" | "unidades" | "tags" | "grupos" | "calendario" | "equipos" | "ajustes";

export type HojaMenu = {
    id: string;
    rotulo: string;
    /** A dónde lleva. Puede traer una consulta (`?tab=…`): es una pestaña de esa pantalla. */
    href: string;
    insignia?: Insignia;
    /** También está activa en las pantallas que cuelgan de la suya (`/admin/devices/…`). */
    prefijo?: boolean;
    /** Otras rutas en las que esta entrada es la que corresponde marcar. */
    tambien?: string[];
    /** Cómo se llama cuando es la única de su grupo y el grupo se muestra como una entrada sola. */
    unico?: string;
};
export type EntradaMenu = { id: string; rotulo: string; icono: IconoMenu; nuevo?: boolean } & (
    /** Una pantalla. */
    | { href: string; insignia?: Insignia; prefijo?: boolean; tambien?: string[]; hijos?: undefined }
    /** Un grupo que se abre. */
    | { hijos: HojaMenu[]; href?: undefined }
);
export type SeccionMenu = { id: string; titulo: string | null; entradas: EntradaMenu[] };

export type ContextoMenu = {
    /** Los modos que corre la instalación. */
    modos: { lpr: boolean; rostro: boolean; filas: boolean; guardia: boolean };
    /** Las funciones prendidas que cambian el menú. */
    func: { intrusion: boolean; recepcion: boolean; amarilla: boolean; censo: boolean; plazas: boolean;
        /** Las características Face y Rastreo GPS (25/11). Sin dato, prendidas: es como era antes de existir el interruptor. */
        face?: boolean; gps?: boolean };
    /** Lo que sólo aparece si hay de eso en la instalación. */
    hay: { accesos: boolean; gps: boolean };
    /** Las cuentas de las insignias. */
    cuentas: { negra: number; amarilla: number; censo: number };
    /** ¿El rol puede abrir esta ruta? (lib/permisos, `puedeAbrir`). */
    puede: (ruta: string) => boolean;
    /** ¿El rol tiene este permiso? Para lo que no es una ruta del panel (la consola de guardia). */
    tiene: (permiso: string) => boolean;
    /** Las pantallas de OmniVision, de la misma lista que su barra (components/vision/NavOmniVision). */
    omnivision: { href: string; rotulo: string }[];
};

const sinConsulta = (href: string) => href.split("?")[0];
const insignia = (n: number, tono: TonoInsignia): Insignia | undefined => (n > 0 ? { n, tono } : undefined);

/**
 * El menú de esta instalación para este rol. Lo que no corresponde no aparece —ni apagado ni
 * tachado—, y una sección que queda vacía tampoco.
 */
export function armarMenu(c: ContextoMenu): SeccionMenu[] {
    const { modos: m, func: f } = c;
    /** Una hoja, si el rol puede abrirla y la condición se cumple. */
    const hoja = (si: boolean, h: HojaMenu): HojaMenu[] => (si && c.puede(sinConsulta(h.href)) ? [h] : []);
    /**
     * Un grupo. Sin hojas no existe. Con UNA sola hoja se muestra como una entrada directa: abrir un
     * grupo para encontrar adentro una única cosa es un clic que no dice nada.
     */
    const grupo = (id: string, rotulo: string, icono: IconoMenu, hijos: HojaMenu[], extra: { nuevo?: boolean } = {}): EntradaMenu[] => {
        if (!hijos.length) return [];
        if (hijos.length === 1) { const h = hijos[0]; return [{ id: h.id, rotulo: h.unico || rotulo, icono, href: h.href, insignia: h.insignia, prefijo: h.prefijo, tambien: h.tambien, ...extra }]; }
        return [{ id, rotulo, icono, hijos, ...extra }];
    };
    const sola = (si: boolean, e: { id: string; rotulo: string; icono: IconoMenu; href: string; insignia?: Insignia; prefijo?: boolean; tambien?: string[] }): EntradaMenu[] =>
        (si && c.puede(sinConsulta(e.href)) ? [e] : []);

    /* Las listas de vigilancia son pestañas de Usuarios. Con matrículas van en ese módulo, que es
       donde se las busca con apuro; sin él (una instalación sólo de rostro) quedan con las personas. */
    const listas: HojaMenu[] = [
        ...hoja(!m.filas, { id: "lista-negra", rotulo: "Lista negra", href: "/admin/users?tab=listanegra", insignia: insignia(c.cuentas.negra, "mal") }),
        ...hoja(!m.filas && f.amarilla, { id: "lista-amarilla", rotulo: "Lista amarilla", href: "/admin/users?tab=listaamarilla", insignia: insignia(c.cuentas.amarilla, "aviso") }),
    ];
    const conMatriculas = m.lpr && !m.filas;

    const comun: EntradaMenu[] = [
        /* Gestión de alarmas junta lo de todos los sistemas; en Filas aparece si hay intrusión o centrales. */
        ...sola(!m.filas || f.intrusion || f.recepcion, { id: "alarmas", rotulo: "Gestión de alarmas", icono: "alarmas", href: "/admin/alarmas" }),
        ...sola(!m.filas, { id: "mapa", rotulo: "Mapa", icono: "mapa", href: "/admin/mapa" }),
        /* En Filas no hay mapa del barrio: la entrada es el editor de planos. */
        ...sola(m.filas, { id: "mapas", rotulo: "Mapas", icono: "mapa", href: "/admin/mapas" }),
        ...grupo("historial", "Historial", "historial", [
            ...hoja(!m.filas, { id: "historial-accesos", rotulo: "Accesos", href: "/admin/history" }),
            ...hoja(conMatriculas, { id: "historial-lecturas", rotulo: "Procesamiento LPR", href: "/admin/procesamiento-lpr" }),
        ]),
        ...sola(true, { id: "evidencias", rotulo: "Evidencias", icono: "evidencias", href: "/admin/evidencias" }),
    ];

    const modulos: EntradaMenu[] = [
        ...(conMatriculas ? grupo("matriculas", "Matrículas", "matriculas", [
            /* Con matrículas prendido el Monitor LPR está SIEMPRE, también donde además hay rostro. Antes
               se escondía ahí («el monitor de la instalación es el facial»), y en una instalación con
               los dos módulos no había forma de llegar por el menú a la pantalla que Nico quiere
               primera de todas (24/11: «comenzando por Monitor LPR arriba del todo»). */
            ...hoja(true, { id: "lpr-monitor", rotulo: "Monitor LPR", href: "/admin/monitor-lpr" }),
            ...hoja(true, { id: "lpr-vehiculos", rotulo: "Vehículos y matrículas", href: "/admin/vehicles", tambien: ["/admin/credentials"] }),
            ...listas,
            ...hoja(true, { id: "lpr-invitados", rotulo: "Invitados", href: "/admin/invitados" }),
            ...hoja(f.plazas, { id: "lpr-plazas", rotulo: "Plazas de parking", href: "/admin/plazas" }),
        ]) : []),
        /* El Monitor Face (las capturas de rostros de porteros y controles de acceso) vive con las caras y
           no en Dispositivos (24/11, Nico: «es un historial de Face… no tiene que ver con bitácora»). Está
           también sin el modo face: un portero cuenta sus propias caras aunque OmniVision no mire. */
        /* El módulo Face (25/11, Nico: «un sub módulo Face que contendrá Monitor Face, Dispositivos Face
           —que va a Dispositivos filtrando por porteros faciales— y Sincronización Face»). La
           sincronización entra cuando esté su pantalla. */
        ...(f.face === false ? [] : grupo("rostro", "Face", "rostro", [
            ...hoja(!m.filas && (c.hay.accesos || m.rostro), { id: "rostro-capturas", rotulo: "Monitor Face", href: "/admin/face", unico: "Monitor Face" }),
            ...hoja(m.rostro && !m.filas, { id: "rostro-monitor", rotulo: "En vivo: entrada y salida", href: "/admin/monitor-face" }),
            ...hoja(!m.filas && c.hay.accesos, { id: "rostro-equipos", rotulo: "Dispositivos Face", href: "/admin/devices?type=DOOR_INTERCOM" }),
        ])),
        ...grupo("intrusion", "Intrusión", "intrusion", hoja(f.intrusion, { id: "intrusion-monitor", rotulo: "Monitor de intrusión", href: "/admin/monitor-intrusion" })),
        ...grupo("video", "Video", "video", [
            ...hoja(!m.filas, { id: "video-cctv", rotulo: "Monitor CCTV", href: "/admin/monitor-cctv" }),
            ...hoja(true, { id: "video-pared", rotulo: "Pared de monitores", href: "/admin/monitores", unico: "Pared de monitores" }),
        ]),
        /* Sus cinco pestañas, cada una con su dirección: del menú se llega derecho a Comandos. */
        ...(c.hay.gps && f.gps !== false ? grupo("gps", "Rastreo GPS", "gps", [
            ...hoja(true, { id: "gps-vehiculos", rotulo: "Vehículos", href: "/admin/gps" }),
            ...hoja(true, { id: "gps-zonas", rotulo: "Zonas", href: "/admin/gps?t=zonas" }),
            ...hoja(true, { id: "gps-reportes", rotulo: "Reportes", href: "/admin/gps?t=reportes" }),
            ...hoja(true, { id: "gps-comandos", rotulo: "Comandos", href: "/admin/gps?t=comandos" }),
            ...hoja(true, { id: "gps-ajustes", rotulo: "Ajustes", href: "/admin/gps?t=ajustes" }),
        ], { nuevo: true }) : []),
        ...(m.lpr && m.guardia ? grupo("guardia", "Guardia", "guardia", [
            /* La consola no es una ruta del panel: la abre quien tiene el permiso de guardia. */
            ...(c.tiene("guardia") ? [{ id: "guardia-consola", rotulo: "Consola de guardia", href: "/guard" }] : []),
            ...hoja(true, { id: "guardia-bitacora", rotulo: "Bitácora", href: "/admin/bitacora" }),
            ...hoja(true, { id: "guardia-visitas", rotulo: "Visitas y proveedores", href: "/admin/visitas" }),
            ...hoja(true, { id: "guardia-puestos", rotulo: "Puestos y consolas", href: "/admin/consolas" }),
        ]) : []),
        ...grupo("vision", "OmniVision", "vision", c.omnivision.flatMap((s) => hoja(f.face !== false || s.href !== "/admin/vision/rostros", { id: `vision-${s.href.split("/").pop()}`, rotulo: s.rotulo, href: s.href, prefijo: true }))),
        ...(m.filas ? grupo("filas", "Filas", "filas", [
            ...hoja(true, { id: "filas-monitor", rotulo: "Monitor en vivo", href: "/admin/monitor-queue" }),
            ...hoja(true, { id: "filas-flujo", rotulo: "Flujo de filas", href: "/admin/flujo-filas" }),
            ...hoja(true, { id: "filas-filas", rotulo: "Filas", href: "/admin/filas" }),
            ...hoja(true, { id: "filas-despachos", rotulo: "Despachos", href: "/admin/despachos" }),
            ...hoja(true, { id: "filas-reportes", rotulo: "Reportes", href: "/admin/reportes-queue" }),
            ...hoja(true, { id: "filas-horarios", rotulo: "Horarios", href: "/admin/horarios-filas" }),
            ...hoja(true, { id: "filas-kiosko", rotulo: "Pantalla y kiosko", href: "/admin/kiosko" }),
            ...hoja(true, { id: "filas-calibracion", rotulo: "Calibración", href: "/admin/calibracion-aforo" }),
        ]) : []),
    ];

    const padron: EntradaMenu[] = m.filas ? [] : [
        ...grupo("personas", "Personas", "personas", [
            ...hoja(true, { id: "personas-residentes", rotulo: "Residentes", href: "/admin/users" }),
            ...(conMatriculas ? [] : listas),
            ...hoja(f.censo, { id: "personas-censo", rotulo: "Censo", href: "/admin/censo", insignia: insignia(c.cuentas.censo, "aviso") }),
        ]),
        ...grupo("unidades", "Unidades", "unidades", [
            ...hoja(true, { id: "unidades-lotes", rotulo: "Lotes", href: "/admin/units" }),
            ...hoja(true, { id: "unidades-adm", rotulo: "Administraciones", href: "/admin/administraciones" }),
        ]),
        ...sola(true, { id: "tags", rotulo: "Tags RFID", icono: "tags", href: "/admin/rfid" }),
        ...sola(true, { id: "grupos", rotulo: "Grupos de acceso", icono: "grupos", href: "/admin/groups" }),
        ...sola(true, { id: "calendario", rotulo: "Calendario", icono: "calendario", href: "/admin/calendar" }),
    ];

    const sistema: EntradaMenu[] = [
        ...grupo("equipos", "Dispositivos", "equipos", [
            ...hoja(!m.filas, { id: "equipos-lista", rotulo: "Equipos", href: "/admin/devices", prefijo: true }),
        ]),
        ...grupo("config", "Configuración", "ajustes", [
            ...hoja(true, { id: "config-ajustes", rotulo: "Ajustes", href: "/admin/settings" }),
            ...hoja(true, { id: "config-auditoria", rotulo: "Auditoría", href: "/admin/audit", unico: "Auditoría" }),
            ...hoja(true, { id: "config-manuales", rotulo: "Manuales", href: "/admin/manuales", unico: "Manuales" }),
        ]),
    ];

    return [
        { id: "comun", titulo: null, entradas: comun },
        { id: "modulos", titulo: "Módulos", entradas: modulos },
        { id: "padron", titulo: "Padrón", entradas: padron },
        { id: "sistema", titulo: "Sistema", entradas: sistema },
    ].filter((s) => s.entradas.length > 0);
}

/** Todas las pantallas del menú, en orden, con el grupo del que cuelgan. De acá sale también el buscador. */
export type HojaConGrupo = HojaMenu & { grupo: string | null; rotuloGrupo: string | null; icono: IconoMenu };
export function hojasDe(menu: SeccionMenu[]): HojaConGrupo[] {
    return menu.flatMap((s) => s.entradas.flatMap((e): HojaConGrupo[] => (e.hijos
        ? e.hijos.map((h) => ({ ...h, grupo: e.id, rotuloGrupo: e.rotulo, icono: e.icono }))
        : [{ id: e.id, rotulo: e.rotulo, href: e.href, insignia: e.insignia, prefijo: e.prefijo, tambien: e.tambien, grupo: null, rotuloGrupo: null, icono: e.icono }])));
}

/**
 * Qué entrada corresponde a la dirección en la que se está. Gana la más específica: en
 * `/admin/users?tab=listanegra` calzan «Residentes» y «Lista negra», y la que nombra la pestaña es
 * la segunda. Una pestaña que el menú no conoce (`?tab=otra`) deja marcada a la pantalla.
 *
 * Devuelve el id de la hoja y el de su grupo, o null si la pantalla no está en el menú.
 */
export function activoDe(menu: SeccionMenu[], ruta: string, consulta: string | URLSearchParams | null | undefined): { id: string; grupo: string | null } | null {
    const q = typeof consulta === "string" ? new URLSearchParams(consulta) : consulta || new URLSearchParams();
    let mejor: { id: string; grupo: string | null; puntos: number } | null = null;
    for (const h of hojasDe(menu)) {
        const [camino, suya] = h.href.split("?");
        const calza = ruta === camino || (h.prefijo && ruta.startsWith(camino + "/")) || !!h.tambien?.includes(ruta);
        if (!calza) continue;
        const pide = [...new URLSearchParams(suya || "")];
        if (!pide.every(([k, v]) => q.get(k) === v)) continue;
        /* Lo que pide de la consulta pesa más que cualquier largo de ruta; entre iguales, la ruta más larga. */
        const puntos = pide.length * 1000 + (ruta === camino ? camino.length + 1 : camino.length);
        if (!mejor || puntos > mejor.puntos) mejor = { id: h.id, grupo: h.grupo, puntos };
    }
    return mejor ? { id: mejor.id, grupo: mejor.grupo } : null;
}

/** La suma de las insignias de un grupo, para mostrarla cuando está cerrado: cerrado no es vacío. */
export function insigniaDeGrupo(hijos: HojaMenu[]): Insignia | undefined {
    const con = hijos.map((h) => h.insignia).filter((x): x is Insignia => !!x);
    if (!con.length) return undefined;
    return { n: con.reduce((a, x) => a + x.n, 0), tono: con.some((x) => x.tono === "mal") ? "mal" : "aviso" };
}
