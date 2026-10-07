/**
 * Los permisos de la aplicación: qué puede abrir cada rol.
 *
 * Hasta el 7/10 había dos roles fijos —ADMIN (todo) y OPERATOR (todo menos siete pantallas)—
 * escritos en el layout y en el login. No se podía dar a alguien "monitor e historial y nada
 * más". Esto es el catálogo: cada permiso es una pantalla o una función con nombre, y un rol
 * es un conjunto de permisos que se edita desde Ajustes → Accesos.
 *
 * Este archivo NO importa nada de servidor: lo usa el middleware (edge) para cortar una ruta,
 * el layout para armar el menú, y Ajustes para dibujar la grilla. Las rutas de cada permiso
 * viven acá y en ningún otro lado: si se agrega una pantalla, se agrega su ruta a un permiso
 * o queda bajo "panel" (siempre visible para quien tiene sesión).
 */

export type GrupoPermiso = "Operación" | "Padrón" | "Equipos" | "Filas" | "Administración";

export type Permiso = {
    clave: string;
    rotulo: string;
    grupo: GrupoPermiso;
    /** Qué habilita, en una frase que un administrador entienda. */
    descripcion: string;
    /** Prefijos de ruta que este permiso abre. */
    rutas: string[];
};

export const PERMISOS: Permiso[] = [
    // ── Operación: lo que mira el guardia o el operador todo el día ──
    { clave: "monitor", rotulo: "Monitor en vivo", grupo: "Operación", descripcion: "El monitor LPR / facial / filas: lecturas en vivo, cámaras, registrar matrícula desde una captura.", rutas: ["/admin/monitor-lpr", "/admin/monitor-face", "/admin/monitor-queue"] },
    { clave: "intrusion", rotulo: "Monitor de intrusión", grupo: "Operación", descripcion: "Cruces de línea y zonas de las perimetrales, atender alarmas, calibrar reglas en las cámaras.", rutas: ["/admin/monitor-intrusion"] },
    { clave: "historial", rotulo: "Historial", grupo: "Operación", descripcion: "Historial de accesos, fichas de eventos, exportar el reporte Excel.", rutas: ["/admin/history"] },
    { clave: "mapa", rotulo: "Mapa y seguimiento", grupo: "Operación", descripcion: "Mapa del barrio, recorrido de vehículos, estacionados, evidencia.", rutas: ["/admin/mapa", "/admin/mapas", "/admin/seguimiento", "/admin/evidencia"] },
    { clave: "invitados", rotulo: "Invitados", grupo: "Operación", descripcion: "Pases de visita: crear, aprobar, ver quién entró.", rutas: ["/admin/invitados", "/admin/calendar"] },
    { clave: "vigilancia", rotulo: "Lista de vigilancia", grupo: "Operación", descripcion: "Poner y sacar matrículas de la lista negra / VIP / en búsqueda (también desde el monitor y la ficha del evento).", rutas: [] },
    { clave: "guardia", rotulo: "Consola de guardia y bitácora", grupo: "Operación", descripcion: "La consola del puesto, la bitácora y los puestos de guardia.", rutas: ["/admin/bitacora", "/admin/consolas", "/admin/guardias"] },
    { clave: "acuseek", rotulo: "Búsqueda inteligente", grupo: "Operación", descripcion: "Buscar en las grabaciones por descripción (AcuSeek).", rutas: ["/admin/acuseek"] },
    { clave: "monitores", rotulo: "Monitores", grupo: "Operación", descripcion: "Las vistas de pantalla para el centro de monitoreo y los enlaces que las abren sin usuario. Quien tiene esto puede dar acceso permanente a una pantalla.", rutas: ["/admin/monitores", "/monitor"] },

    // ── Padrón: quién es quién ──
    { clave: "usuarios", rotulo: "Usuarios y residentes", grupo: "Padrón", descripcion: "Alta, edición y baja de personas del barrio y sus matrículas.", rutas: ["/admin/users"] },
    { clave: "unidades", rotulo: "Unidades y lotes", grupo: "Padrón", descripcion: "Las unidades, los lotes del mapa y su vínculo.", rutas: ["/admin/units"] },
    { clave: "vehiculos", rotulo: "Vehículos y credenciales", grupo: "Padrón", descripcion: "Matrículas, tags RFID y demás credenciales, y su carga en los equipos.", rutas: ["/admin/vehicles", "/admin/credentials", "/admin/rfid"] },
    { clave: "grupos", rotulo: "Grupos de acceso", grupo: "Padrón", descripcion: "Qué personas pasan por qué equipos y en qué horarios.", rutas: ["/admin/groups"] },
    { clave: "plazas", rotulo: "Plazas de estacionamiento", grupo: "Padrón", descripcion: "Las plazas y su ocupación.", rutas: ["/admin/plazas"] },

    // ── Equipos ──
    { clave: "dispositivos", rotulo: "Dispositivos", grupo: "Equipos", descripcion: "Cámaras, grabadores, lectoras: alta, salud, sincronización de matrículas, hora.", rutas: ["/admin/devices"] },

    // ── Filas (módulo de colas) ──
    { clave: "filas", rotulo: "Control de filas", grupo: "Filas", descripcion: "Filas, flujo, despachos, horarios, kiosko, calibración de aforo y reportes de filas.", rutas: ["/admin/filas", "/admin/flujo-filas", "/admin/despachos", "/admin/horarios-filas", "/admin/kiosko", "/admin/calibracion-aforo", "/admin/reportes-queue"] },

    // ── Administración ──
    { clave: "notificaciones", rotulo: "Notificaciones", grupo: "Administración", descripcion: "Reglas de aviso: WhatsApp, Telegram, correo, destinatarios y plantillas.", rutas: ["/admin/notificaciones"] },
    { clave: "ajustes", rotulo: "Ajustes", grupo: "Administración", descripcion: "Toda la configuración del sistema, menos los accesos al panel.", rutas: ["/admin/settings", "/admin/debug", "/admin/manuales"] },
    { clave: "accesos", rotulo: "Accesos al panel", grupo: "Administración", descripcion: "Los usuarios del sistema y los roles: quién entra al panel y qué puede abrir. Quien tiene esto puede darse a sí mismo cualquier otro permiso.", rutas: [] },
];

export const CLAVES_PERMISOS = PERMISOS.map((p) => p.clave);
export const GRUPOS_PERMISOS: GrupoPermiso[] = ["Operación", "Padrón", "Equipos", "Filas", "Administración"];

/** Lo que tenía el viejo rol OPERATOR ("opera, no edita"): todo lo de operación, nada de administración ni padrón. */
export const PERMISOS_OPERADOR = ["monitor", "intrusion", "historial", "mapa", "invitados", "vigilancia", "guardia", "acuseek", "plazas", "filas"];

/** El id fijo del rol Administrador (lo siembra la migración de roles). */
export const ROL_ADMINISTRADOR_ID = "rol-administrador";

/**
 * Los permisos que valen para una sesión, a partir de lo que trae el JWT.
 *
 * Un administrador ve TODO, siempre, aunque su sesión sea de antes de que existiera un
 * permiso: el 7/10 se agregó `monitores` al catálogo y a los administradores les apareció
 * "tu rol no incluye el permiso Monitores" hasta volver a entrar, porque el middleware
 * miraba la lista congelada en el token. Acá el rol Administrador (por id, o el rol legado
 * ADMIN) devuelve el catálogo completo de hoy; los demás, lo que traiga el token, y una
 * sesión vieja sin `perms` lo del operador.
 */
export function permisosDeSesion(payload: { perms?: unknown; role?: unknown; rolApp?: unknown; rolAppId?: unknown } | null | undefined): string[] {
    if (!payload) return [];
    // `rolAppId` viaja en los tokens nuevos; `rolApp` (el nombre) y `role` legado cubren los anteriores.
    if (payload.rolAppId === ROL_ADMINISTRADOR_ID || payload.rolApp === "Administrador" || payload.role === "ADMIN") return CLAVES_PERMISOS;
    if (Array.isArray(payload.perms)) return payload.perms as string[];
    return PERMISOS_OPERADOR;
}

/** Un rol con todos los permisos es un administrador a los efectos de las pantallas viejas que preguntan `role === "ADMIN"`. */
export const esAdministrador = (permisos: string[] | null | undefined) =>
    !!permisos && CLAVES_PERMISOS.every((c) => permisos.includes(c));

/**
 * Qué permiso pide una ruta. `null` = no pide ninguno (el panel raíz, la cuenta propia, lo
 * que no está en el catálogo): con sesión alcanza. El prefijo más largo gana, para que
 * /admin/monitor-intrusion no caiga en /admin/monitor.
 */
export function permisoDeRuta(pathname: string): Permiso | null {
    let mejor: { p: Permiso; largo: number } | null = null;
    for (const p of PERMISOS) {
        for (const r of p.rutas) {
            if ((pathname === r || pathname.startsWith(r + "/") || pathname.startsWith(r + "?")) && (!mejor || r.length > mejor.largo)) mejor = { p, largo: r.length };
        }
    }
    return mejor?.p ?? null;
}

export function puedeAbrir(permisos: string[] | null | undefined, pathname: string): boolean {
    const p = permisoDeRuta(pathname);
    if (!p) return true;
    return !!permisos && permisos.includes(p.clave);
}

/** Rótulo corto de un conjunto de permisos para una tabla: "Todo", "Nada" o "7 de 18 · Monitor, Historial…". */
export function resumirPermisos(permisos: string[] | null | undefined, max = 3): string {
    const set = new Set(permisos || []);
    const tiene = PERMISOS.filter((p) => set.has(p.clave));
    if (tiene.length === 0) return "Sin permisos";
    if (tiene.length === PERMISOS.length) return "Todo";
    const nombres = tiene.slice(0, max).map((p) => p.rotulo);
    return `${tiene.length} de ${PERMISOS.length} · ${nombres.join(", ")}${tiene.length > max ? "…" : ""}`;
}
