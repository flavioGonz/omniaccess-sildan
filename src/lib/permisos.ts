/**
 * Los permisos de la aplicación: qué puede ver, operar y configurar cada rol.
 *
 * Hasta el 7/10 había dos roles fijos (ADMIN y OPERATOR) escritos en el layout y en el login.
 * El 7/10 llegó este catálogo con 19 permisos, uno por pantalla. El 23/10 (openspec
 * roles-y-permisos; Nico: «revisá bien los roles según todo lo que hemos creado; faltan secciones,
 * módulos y que sea más profesional») se rehízo por MÓDULO y por NIVEL:
 *
 *  · Cada sección de OmniAccess tiene hasta tres permisos: Ver (abrir y mirar), Operar (la tarea
 *    del día: atender, tratar, crear, marcar) y Configurar (cambiar cómo funciona). Antes «Monitor»
 *    abría LPR, CCTV, rostro, filas y la gestión de alarmas a la vez, «Ajustes» abría OmniVision
 *    y el respaldo de la base, y no se podía dar «ver» sin «editar».
 *  · Los permisos son claves planas (`hub`, `hub.tratar`, `hub.config`): `AppRole.permisos` y el
 *    token siguen siendo una lista, y preguntar es un `includes`.
 *  · Operar y Configurar arrastran Ver (normalizarPermisos), así nunca hay que preguntar «¿ver o más?».
 *  · Los permisos de antes se traducen a los nuevos que habilitan lo mismo (TRADUCCION), para los
 *    roles guardados (scripts/permisos-roles.js) y para las sesiones abiertas (permisosDeSesion).
 *
 * Este archivo NO importa nada de servidor: lo usan el middleware, el layout y Ajustes. Las rutas de
 * página de cada permiso viven acá y en ningún otro lado; las acciones y la API se clasifican en
 * lib/permisos-acciones.ts y lib/permisos-api.ts. tests/permisos.test.ts falla si una página nueva
 * no tiene permiso ni está entre las libres.
 */

export type Nivel = "ver" | "operar" | "configurar";
export const NIVELES: { id: Nivel; nombre: string; ayuda: string }[] = [
    { id: "ver", nombre: "Ver", ayuda: "Abrir la pantalla y mirar." },
    { id: "operar", nombre: "Operar", ayuda: "La tarea del día: atender, tratar, crear, marcar." },
    { id: "configurar", nombre: "Configurar", ayuda: "Cambiar cómo funciona: reglas, catálogos, alta de equipos." },
];

export type ModuloId = "operacion" | "lpr" | "video" | "intrusion" | "hub" | "vision" | "rostro" | "filas" | "guardia" | "padron" | "equipos" | "administracion";
export type Modulo = { id: ModuloId; nombre: string; descripcion: string };
export const MODULOS: Modulo[] = [
    { id: "operacion", nombre: "Operación", descripcion: "Lo común a toda la instalación: la gestión de alarmas, el historial, el mapa y los monitores de pared." },
    { id: "lpr", nombre: "LPR · Matrículas", descripcion: "Lectura de matrículas, lista de vigilancia, invitados y plazas." },
    { id: "video", nombre: "Video", descripcion: "El vivo de las cámaras, las grabaciones y los clips." },
    { id: "intrusion", nombre: "Intrusión", descripcion: "Cruces de línea y zonas de las cámaras perimetrales." },
    { id: "hub", nombre: "Alarm Hub", descripcion: "Las centrales de alarma: sus eventos, su tratamiento y el armado a distancia." },
    { id: "vision", nombre: "OmniVision", descripcion: "Las analíticas propias sobre las cámaras: detecciones, búsqueda, entrenamiento." },
    { id: "rostro", nombre: "Rostro", descripcion: "Reconocimiento facial: el monitor, las listas y la carga de caras." },
    { id: "filas", nombre: "Filas", descripcion: "El módulo de colas: conteo, despachos, reportes." },
    { id: "guardia", nombre: "Guardia", descripcion: "El puesto: la consola, la bitácora y las visitas registradas." },
    { id: "padron", nombre: "Padrón", descripcion: "Quién es quién: personas, unidades, vehículos y grupos de acceso." },
    { id: "equipos", nombre: "Equipos", descripcion: "Cámaras, grabadores, lectoras y centrales dadas de alta." },
    { id: "administracion", nombre: "Administración", descripcion: "La configuración del sistema y quién entra al panel." },
];

export type Permiso = {
    clave: string;
    modulo: ModuloId;
    /** La sección (una fila de la matriz): la clave de su permiso de Ver, o la del único que tenga. */
    seccion: string;
    /** El nombre de la sección, igual en sus tres niveles. */
    nombreSeccion: string;
    nivel: Nivel;
    /** El rótulo del permiso solo (en un resumen o en «sin permiso»). */
    rotulo: string;
    /** Qué habilita, en una frase que un administrador entienda. */
    descripcion: string;
    /** Da acceso permanente o hace algo sin vuelta atrás: se marca y se explica por qué. */
    delicado?: string;
    /** Prefijos de ruta de página que este permiso abre. */
    rutas: string[];
};

type Def = [clave: string, nivel: Nivel, rotulo: string, descripcion: string, rutas?: string[], delicado?: string];
type Seccion = { modulo: ModuloId; seccion: string; nombre: string; permisos: Def[] };

const SECCIONES: Seccion[] = [
    // ── Operación ──
    { modulo: "operacion", seccion: "alarmas", nombre: "Gestión de alarmas", permisos: [
        ["alarmas", "ver", "Gestión de alarmas", "Abrir Gestión de alarmas: todos los eventos de OmniAccess por sistema, y quién está adentro.", ["/admin/alarmas"]],
        ["alarmas.atender", "operar", "Atender alarmas", "Marcar una alarma como real, falsa o atendida, tomarla y pasarla, dejar una nota y marcar que un auto salió."],
    ] },
    { modulo: "operacion", seccion: "historial", nombre: "Historial y lecturas", permisos: [
        ["historial", "ver", "Historial", "El historial de accesos, las fichas de los eventos y las lecturas de las cámaras.", ["/admin/history", "/admin/lecturas-camara"]],
        ["historial.exportar", "operar", "Exportar y corregir", "Exportar el reporte Excel y corregir la matrícula de una lectura."],
    ] },
    { modulo: "operacion", seccion: "mapa", nombre: "Mapa y seguimiento", permisos: [
        ["mapa", "ver", "Mapa y seguimiento", "El mapa del barrio, el recorrido de los vehículos, los estacionados y la evidencia.", ["/admin/mapa", "/admin/seguimiento", "/admin/evidencia"]],
        ["mapa.editar", "configurar", "Editar mapas", "Editar los mapas, los lotes y los planos, y ubicar los equipos en ellos.", ["/admin/mapas"]],
    ] },
    { modulo: "operacion", seccion: "monitores", nombre: "Monitores de pared", permisos: [
        ["monitores", "ver", "Monitores", "Las vistas de pantalla del centro de monitoreo: abrirlas con el usuario propio.", ["/admin/monitores", "/monitor"]],
        ["monitores.config", "configurar", "Configurar monitores", "Crear y revocar enlaces de pantalla, diseñar las vistas de cámaras, el sonido y la rotación.", [],
            "Un enlace de pantalla abre una vista sin usuario y sin vencimiento hasta que alguien lo revoque."],
    ] },
    // ── LPR ──
    { modulo: "lpr", seccion: "lpr", nombre: "Monitor LPR", permisos: [
        ["lpr", "ver", "Monitor LPR", "El monitor de matrículas en vivo: lecturas, capturas y decisiones.", ["/admin/monitor-lpr"]],
        ["lpr.operar", "operar", "Operar LPR", "Registrar una matrícula desde una captura, corregir una lectura y accionar el relé de un equipo."],
    ] },
    { modulo: "lpr", seccion: "vigilancia", nombre: "Lista de vigilancia", permisos: [
        ["vigilancia", "operar", "Lista de vigilancia", "Poner y sacar matrículas y personas de la lista negra, VIP o en búsqueda (también desde el monitor y la ficha)."],
    ] },
    { modulo: "lpr", seccion: "invitados", nombre: "Invitados", permisos: [
        ["invitados", "ver", "Invitados", "Los pases de visita y el calendario: quién viene y quién entró.", ["/admin/invitados", "/admin/calendar"]],
        ["invitados.gestionar", "operar", "Gestionar invitados", "Crear, extender y revocar pases, sumar invitados y marcar la entrada."],
    ] },
    { modulo: "lpr", seccion: "plazas", nombre: "Plazas de estacionamiento", permisos: [
        ["plazas", "ver", "Plazas", "Las plazas y su ocupación.", ["/admin/plazas"]],
        ["plazas.config", "configurar", "Configurar plazas", "Dibujar las plazas, subir el plano y asignarlas a personas."],
    ] },
    // ── Video ──
    { modulo: "video", seccion: "video", nombre: "Monitor CCTV y vivo", permisos: [
        ["video", "ver", "Monitor CCTV", "El monitor CCTV y el vivo de las cámaras, con PTZ.", ["/admin/monitor-cctv"]],
    ] },
    { modulo: "video", seccion: "grabaciones", nombre: "Grabaciones y clips", permisos: [
        ["grabaciones", "operar", "Grabaciones y clips", "Mirar la grabación de un evento, buscar en el grabador, exportar clips y compartirlos por WhatsApp o Telegram."],
    ] },
    { modulo: "video", seccion: "acuseek", nombre: "Búsqueda inteligente", permisos: [
        ["acuseek", "ver", "Búsqueda inteligente", "Buscar en las grabaciones por descripción (AcuSeek).", ["/admin/acuseek"]],
    ] },
    // ── Intrusión ──
    { modulo: "intrusion", seccion: "intrusion", nombre: "Intrusión", permisos: [
        ["intrusion", "ver", "Monitor de intrusión", "El monitor de intrusión: cruces de línea y zonas de las perimetrales.", ["/admin/monitor-intrusion"]],
        ["intrusion.atender", "operar", "Atender intrusiones", "Tomar, pasar, aceptar y marcar como falsa una detección."],
        ["intrusion.reglas", "configurar", "Reglas de intrusión", "Calibrar las reglas en las cámaras, los horarios y el seguimiento entre cámaras."],
    ] },
    // ── Alarm Hub ──
    { modulo: "hub", seccion: "hub", nombre: "Eventos de las centrales", permisos: [
        ["hub", "ver", "Alarm Hub", "Los eventos y los mensajes de las centrales de alarma, en Gestión de alarmas y en las pantallas."],
        ["hub.tratar", "operar", "Tratar eventos", "Tomar un evento, seguir su procedimiento, tratarlo y escalarlo."],
        ["hub.config", "configurar", "Configurar centrales", "Dar de alta centrales, sus zonas y cámaras, las prioridades, los procedimientos, los cierres, el escalado y la retención de las fotos."],
    ] },
    { modulo: "hub", seccion: "centrales", nombre: "Control de centrales", permisos: [
        ["centrales", "operar", "Armar y desarmar", "Armar y desarmar las centrales de alarma desde OmniAccess. Cada orden queda en Auditoría.", [],
            "Desarmar una central deja una casa sin protección."],
    ] },
    // ── OmniVision ──
    { modulo: "vision", seccion: "vision", nombre: "OmniVision", permisos: [
        ["vision", "ver", "OmniVision", "Las detecciones, la búsqueda, el mapa de calor, las analíticas, el estacionamiento y las filas de OmniVision.", ["/admin/vision"]],
        ["vision.config", "configurar", "Configurar OmniVision", "Las reglas, el entrenamiento, las pruebas, las relecturas y la verificación.",
            ["/admin/vision/entrenar", "/admin/vision/reglas", "/admin/vision/probar", "/admin/vision/relecturas", "/admin/vision/verificacion"]],
    ] },
    // ── Rostro ──
    { modulo: "rostro", seccion: "rostros", nombre: "Rostro", permisos: [
        ["rostros", "ver", "Monitor facial", "El monitor facial y la búsqueda por foto.", ["/admin/monitor-face", "/admin/dashboard-face"]],
        ["rostros.listas", "operar", "Listas de rostros", "Las listas blanca y negra de rostros, la carga de caras y su sincronización con los equipos.",
            ["/admin/dashboard-face/blacklist", "/admin/dashboard-face/whitelist", "/admin/dashboard-face/upload"]],
    ] },
    // ── Filas ──
    { modulo: "filas", seccion: "filas", nombre: "Filas", permisos: [
        ["filas", "ver", "Control de filas", "El monitor y el flujo de filas, los despachos, el kiosko y los reportes.",
            ["/admin/monitor-queue", "/admin/queue", "/admin/filas", "/admin/flujo-filas", "/admin/despachos", "/admin/kiosko", "/admin/reportes-queue"]],
        ["filas.config", "configurar", "Configurar filas", "Los horarios, la calibración del aforo, las alertas y las notificaciones de filas.",
            ["/admin/horarios-filas", "/admin/calibracion-aforo", "/admin/notificaciones-queue"]],
    ] },
    // ── Guardia ──
    { modulo: "guardia", seccion: "guardia", nombre: "Consola y bitácora", permisos: [
        ["guardia", "operar", "Consola y bitácora", "La bitácora del puesto: escribir, buscar y borrar entradas.", ["/admin/bitacora"]],
        ["guardia.puestos", "configurar", "Puestos de guardia", "Los puestos y las consolas, los guardias y sus PIN.", ["/admin/consolas", "/admin/guardias"]],
    ] },
    { modulo: "guardia", seccion: "visitas", nombre: "Visitas y proveedores", permisos: [
        ["visitas", "operar", "Visitas y proveedores", "Registrar, extender y cerrar visitas, los avisos de vencimiento y la planilla de los proveedores.", ["/admin/visitas"]],
    ] },
    // ── Padrón ──
    { modulo: "padron", seccion: "usuarios", nombre: "Personas", permisos: [
        ["usuarios", "ver", "Personas", "La lista de residentes y demás personas del barrio, con sus matrículas.", ["/admin/users"]],
        ["usuarios.editar", "operar", "Editar personas", "Dar de alta, editar y dar de baja personas, y cargar su cara."],
    ] },
    { modulo: "padron", seccion: "unidades", nombre: "Unidades y lotes", permisos: [
        ["unidades", "ver", "Unidades", "Las unidades y los lotes.", ["/admin/units"]],
        ["unidades.editar", "operar", "Editar unidades", "Crear y editar unidades y asignarles personas."],
    ] },
    { modulo: "padron", seccion: "vehiculos", nombre: "Vehículos y credenciales", permisos: [
        ["vehiculos", "ver", "Vehículos", "Las matrículas, los tags RFID y demás credenciales.", ["/admin/vehicles", "/admin/credentials", "/admin/rfid"]],
        ["vehiculos.editar", "operar", "Editar vehículos", "Dar de alta y de baja matrículas, tags y credenciales, y cargarlas en los equipos."],
    ] },
    { modulo: "padron", seccion: "grupos", nombre: "Grupos de acceso", permisos: [
        ["grupos", "configurar", "Grupos de acceso", "Qué personas pasan por qué equipos y en qué horarios.", ["/admin/groups"]],
    ] },
    // ── Equipos ──
    { modulo: "equipos", seccion: "dispositivos", nombre: "Dispositivos", permisos: [
        ["dispositivos", "ver", "Dispositivos", "Cámaras, grabadores y lectoras: su estado y su salud.", ["/admin/devices"]],
        ["dispositivos.editar", "configurar", "Editar dispositivos", "Dar de alta y editar equipos, sincronizar matrículas, la hora, los canales y el modo de cada cámara."],
    ] },
    // ── Administración ──
    { modulo: "administracion", seccion: "ajustes", nombre: "Ajustes", permisos: [
        ["ajustes", "configurar", "Ajustes", "La configuración del sistema: modos, funciones, marca, almacenamiento y demás.", ["/admin/settings", "/admin/debug", "/admin/manuales"]],
    ] },
    { modulo: "administracion", seccion: "notificaciones", nombre: "Notificaciones", permisos: [
        ["notificaciones", "configurar", "Notificaciones", "Las reglas de aviso por WhatsApp, Telegram y correo, sus destinatarios y plantillas.", ["/admin/notificaciones"]],
    ] },
    { modulo: "administracion", seccion: "auditoria", nombre: "Auditoría", permisos: [
        ["auditoria", "ver", "Auditoría", "Quién hizo qué y cuándo: cambios de configuración, de accesos y entradas al panel.", ["/admin/audit"]],
    ] },
    { modulo: "administracion", seccion: "mantenimiento", nombre: "Mantenimiento", permisos: [
        ["mantenimiento", "configurar", "Mantenimiento", "Respaldar y restaurar la base, cambiar su conexión, migrar, reiniciar servicios y borrar datos en masa.", [],
            "Restaurar un respaldo o borrar datos en masa no tiene vuelta atrás."],
    ] },
    { modulo: "administracion", seccion: "accesos", nombre: "Accesos al panel", permisos: [
        ["accesos", "configurar", "Accesos al panel", "Los usuarios del sistema y los roles: quién entra al panel y qué puede hacer.", [],
            "Quien tiene esto puede darse a sí mismo cualquier otro permiso."],
    ] },
];

export const PERMISOS: Permiso[] = SECCIONES.flatMap((s) => s.permisos.map(([clave, nivel, rotulo, descripcion, rutas, delicado]) => ({
    clave, modulo: s.modulo, seccion: s.seccion, nombreSeccion: s.nombre, nivel, rotulo, descripcion, rutas: rutas || [], ...(delicado ? { delicado } : {}),
})));
export const CLAVES_PERMISOS = PERMISOS.map((p) => p.clave);
export const permisoPorClave = (clave: string) => PERMISOS.find((p) => p.clave === clave) || null;

/** Las secciones en orden, con su permiso de cada nivel (o null): las filas de la matriz de Accesos. */
export const SECCIONES_PERMISOS = SECCIONES.map((s) => ({
    modulo: s.modulo, seccion: s.seccion, nombre: s.nombre,
    niveles: Object.fromEntries(NIVELES.map((n) => [n.id, PERMISOS.find((p) => p.seccion === s.seccion && p.nivel === n.id) || null])) as Record<Nivel, Permiso | null>,
}));

/**
 * Las páginas que se abren con cualquier sesión del panel: el inicio (redirige a lo que se pueda
 * abrir), «sin permiso», las novedades y el aviso de enlace de pantalla inválido.
 */
export const PAGINAS_LIBRES = ["/admin", "/admin/dashboard", "/admin/sin-permiso", "/admin/changelog", "/monitor/enlace-invalido"];

// ── Lo de antes ─────────────────────────────────────────────────────────────────────────────

/**
 * Cada permiso del catálogo del 7/10 → los nuevos que habilitan lo mismo (design §3). La regla es
 * no sacar nada que se use: «monitor» abría cinco monitores y la gestión de alarmas; «ajustes»,
 * OmniVision, Auditoría (que en realidad abría cualquiera) y el mantenimiento.
 */
export const TRADUCCION: Record<string, string[]> = {
    monitor: ["lpr", "lpr.operar", "video", "grabaciones", "rostros", "rostros.listas", "filas", "alarmas", "alarmas.atender", "hub", "hub.tratar"],
    intrusion: ["intrusion", "intrusion.atender", "intrusion.reglas", "grabaciones"],
    historial: ["historial", "historial.exportar", "grabaciones"],
    mapa: ["mapa", "mapa.editar"],
    invitados: ["invitados", "invitados.gestionar"],
    vigilancia: ["vigilancia"],
    guardia: ["guardia", "guardia.puestos", "visitas"],
    acuseek: ["acuseek"],
    monitores: ["monitores", "monitores.config"],
    usuarios: ["usuarios", "usuarios.editar"],
    unidades: ["unidades", "unidades.editar"],
    vehiculos: ["vehiculos", "vehiculos.editar"],
    grupos: ["grupos"],
    plazas: ["plazas", "plazas.config"],
    dispositivos: ["dispositivos", "dispositivos.editar", "hub.config"],
    centrales: ["centrales"],
    filas: ["filas", "filas.config"],
    notificaciones: ["notificaciones"],
    ajustes: ["ajustes", "vision", "vision.config", "auditoria", "mantenimiento", "hub.config", "intrusion.reglas", "plazas.config"],
    accesos: ["accesos"],
};
/** La versión del catálogo que viaja en el token (`pv`). Un token sin ella trae claves de antes. */
export const VERSION_PERMISOS = 2;
/** Lo que tenía el viejo rol OPERATOR («opera, no edita»), en claves de antes. */
const OPERADOR_LEGADO = ["monitor", "intrusion", "historial", "mapa", "invitados", "vigilancia", "guardia", "acuseek", "plazas", "filas"];

/**
 * Deja una lista de permisos limpia: sin claves que no existen, con Ver en toda sección donde haya
 * Operar o Configurar, y —con `deAntes`— con las claves del catálogo del 7/10 traducidas. Sin
 * `deAntes` una clave que existe en los dos catálogos (`intrusion`, `ajustes`…) vale por lo que
 * dice hoy: si no, quitarle a un rol «Reglas de intrusión» se desharía solo al guardarlo.
 */
export function normalizarPermisos(lista: readonly unknown[] | null | undefined, { deAntes = false } = {}): string[] {
    const out = new Set<string>();
    for (const x of lista || []) {
        const k = String(x);
        if (deAntes && TRADUCCION[k]) TRADUCCION[k].forEach((t) => out.add(t));
        else if (!deAntes && TRADUCCION[k] && !permisoPorClave(k)) TRADUCCION[k].forEach((t) => out.add(t));   // una clave que ya no existe («monitor»)
        else if (permisoPorClave(k)) out.add(k);
    }
    for (const k of [...out]) {
        const p = permisoPorClave(k)!;
        if (p.nivel !== "ver") { const ver = PERMISOS.find((q) => q.seccion === p.seccion && q.nivel === "ver"); if (ver) out.add(ver.clave); }
    }
    return CLAVES_PERMISOS.filter((k) => out.has(k));
}

/** Lo del viejo OPERATOR, traducido: para usuarios sin rol de aplicación. */
export const PERMISOS_OPERADOR = normalizarPermisos(OPERADOR_LEGADO, { deAntes: true });

/** El id fijo del rol Administrador (lo siembra la migración de roles). */
export const ROL_ADMINISTRADOR_ID = "rol-administrador";

/**
 * Los permisos que valen para una sesión, a partir de lo que trae el JWT.
 *
 * Un administrador ve TODO, siempre, aunque su sesión sea de antes de que existiera un permiso
 * (el 7/10 a los administradores les apareció «tu rol no incluye Monitores» hasta volver a entrar).
 * Un token sin `pv` es de antes del catálogo por niveles: sus claves se traducen. Una sesión vieja
 * sin `perms`, lo del operador.
 */
export function permisosDeSesion(payload: { perms?: unknown; role?: unknown; rolApp?: unknown; rolAppId?: unknown; pv?: unknown } | null | undefined): string[] {
    if (!payload) return [];
    if (payload.rolAppId === ROL_ADMINISTRADOR_ID || payload.rolApp === "Administrador" || payload.role === "ADMIN") return CLAVES_PERMISOS;
    if (Array.isArray(payload.perms)) return normalizarPermisos(payload.perms, { deAntes: payload.pv !== VERSION_PERMISOS });
    return PERMISOS_OPERADOR;
}

/** Un rol con todos los permisos es un administrador a los efectos de las pantallas viejas que preguntan `role === "ADMIN"`. */
export const esAdministrador = (permisos: string[] | null | undefined) =>
    !!permisos && CLAVES_PERMISOS.every((c) => permisos.includes(c));

/** ¿Tiene alguno de estos permisos? */
export const tieneAlguno = (permisos: readonly string[] | null | undefined, claves: string | readonly string[]) =>
    !!permisos && (typeof claves === "string" ? [claves] : claves).some((c) => permisos.includes(c));

const cubre = (pathname: string, r: string) => pathname === r || pathname.startsWith(r + "/") || pathname.startsWith(r + "?");
export const esPaginaLibre = (pathname: string) => PAGINAS_LIBRES.some((r) => pathname === r || (r !== "/admin" && cubre(pathname, r)));

/**
 * Qué permiso pide una ruta. `null` = no pide ninguno (las páginas libres, lo que no está en el
 * catálogo): con sesión alcanza. El prefijo más largo gana, para que /admin/vision/reglas pida
 * Configurar OmniVision y /admin/vision, Ver.
 */
export function permisoDeRuta(pathname: string): Permiso | null {
    if (esPaginaLibre(pathname)) return null;
    let mejor: { p: Permiso; largo: number } | null = null;
    for (const p of PERMISOS) for (const r of p.rutas) if (cubre(pathname, r) && (!mejor || r.length > mejor.largo)) mejor = { p, largo: r.length };
    return mejor?.p ?? null;
}

/**
 * Páginas que reúnen varios sistemas y que abre también quien tiene el Ver de alguno de ellos.
 * Gestión de alarmas: con «Gestión de alarmas · ver» se ve el panel único (Todo); con Alarm Hub,
 * Intrusión, LPR u OmniVision, la pestaña de ese sistema (la página decide qué grupos muestra).
 */
export const TAMBIEN_ABREN: Record<string, string[]> = {
    "/admin/alarmas": ["hub", "intrusion", "lpr", "vision"],
};

export function puedeAbrir(permisos: string[] | null | undefined, pathname: string): boolean {
    const p = permisoDeRuta(pathname);
    if (!p) return true;
    if (!permisos) return false;
    if (permisos.includes(p.clave)) return true;
    const alt = Object.entries(TAMBIEN_ABREN).find(([r]) => cubre(pathname, r));
    return !!alt && alt[1].some((k) => permisos.includes(k));
}

/** Rótulo corto de un conjunto de permisos para una tabla: «Todo», «Sin permisos» o «7 de 48 · Monitor LPR, Historial…». */
export function resumirPermisos(permisos: string[] | null | undefined, max = 3): string {
    const set = new Set(permisos || []);
    const tiene = PERMISOS.filter((p) => set.has(p.clave));
    if (tiene.length === 0) return "Sin permisos";
    if (tiene.length === PERMISOS.length) return "Todo";
    const nombres = tiene.slice(0, max).map((p) => p.rotulo);
    return `${tiene.length} de ${PERMISOS.length} · ${nombres.join(", ")}${tiene.length > max ? "…" : ""}`;
}

/** Por módulo, el nivel más alto que tiene en alguna sección (para el resumen de un usuario). */
export function nivelesPorModulo(permisos: string[] | null | undefined): { modulo: Modulo; nivel: Nivel | null; cuantos: number; total: number }[] {
    const set = new Set(permisos || []);
    const orden: Nivel[] = ["ver", "operar", "configurar"];
    return MODULOS.map((m) => {
        const del = PERMISOS.filter((p) => p.modulo === m.id);
        const tiene = del.filter((p) => set.has(p.clave));
        const nivel = tiene.reduce<Nivel | null>((a, p) => (!a || orden.indexOf(p.nivel) > orden.indexOf(a) ? p.nivel : a), null);
        return { modulo: m, nivel, cuantos: tiene.length, total: del.length };
    });
}

// ── Plantillas ──────────────────────────────────────────────────────────────────────────────

const verDe = (...modulos: ModuloId[]) => PERMISOS.filter((p) => modulos.includes(p.modulo) && p.nivel === "ver").map((p) => p.clave);

/**
 * Roles listos para crear de un toque (y ajustar después). No se siembran en la base: el
 * administrador crea el rol desde la plantilla. Ninguna lleva Accesos ni Mantenimiento.
 */
export const PLANTILLAS_ROL: { id: string; nombre: string; descripcion: string; permisos: string[] }[] = [
    { id: "supervisor", nombre: "Supervisor", descripcion: "Ve y opera todo lo del día, revisa la auditoría y edita el padrón. No toca la configuración ni los accesos.", permisos: normalizarPermisos([
        "alarmas.atender", "historial.exportar", "mapa", "monitores", "lpr.operar", "vigilancia", "invitados.gestionar", "plazas",
        "video", "grabaciones", "acuseek", "intrusion.atender", "hub.tratar", "vision", "rostros.listas", "filas", "guardia", "visitas",
        "usuarios.editar", "unidades.editar", "vehiculos.editar", "dispositivos", "auditoria"]) },
    { id: "monitoreo", nombre: "Operador de monitoreo", descripcion: "El centro de monitoreo: atiende alarmas, intrusiones y eventos de las centrales con video y grabaciones.", permisos: normalizarPermisos([
        "alarmas.atender", "historial", "mapa", "monitores", "lpr", "video", "grabaciones", "intrusion.atender", "hub.tratar", "vision"]) },
    { id: "garita", nombre: "Guardia de garita", descripcion: "El puesto de entrada: matrículas, invitados, visitas, la bitácora y la lista de vigilancia.", permisos: normalizarPermisos([
        "alarmas.atender", "historial", "lpr.operar", "vigilancia", "invitados.gestionar", "guardia", "visitas", "usuarios", "vehiculos"]) },
    { id: "tecnico", nombre: "Técnico", descripcion: "Instala y ajusta: equipos, reglas de intrusión, OmniVision, centrales, mapas, plazas, filas y monitores.", permisos: normalizarPermisos([
        "dispositivos.editar", "intrusion.reglas", "video", "grabaciones", "vision.config", "hub.config", "monitores.config", "mapa.editar", "plazas.config", "filas.config", "historial"]) },
    { id: "administracion", nombre: "Administración del barrio", descripcion: "El padrón: personas, unidades, vehículos, grupos, invitados y plazas, con el historial para consultar.", permisos: normalizarPermisos([
        "usuarios.editar", "unidades.editar", "vehiculos.editar", "grupos", "invitados.gestionar", "plazas", "historial.exportar", "visitas"]) },
    { id: "auditor", nombre: "Auditor", descripcion: "Sólo mira: todas las pantallas en modo ver, y la auditoría.", permisos: normalizarPermisos([
        ...verDe("operacion", "lpr", "video", "intrusion", "hub", "vision", "rostro", "filas", "padron", "equipos"), "auditoria"]) },
];
