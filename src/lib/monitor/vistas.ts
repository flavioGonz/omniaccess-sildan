/**
 * El catálogo de vistas de pantalla del centro de monitoreo.
 *
 * Este archivo NO importa nada de servidor: lo usa el middleware (edge) para decidir qué
 * abre un enlace de pantalla, el menú Monitores para dibujar las tarjetas y las páginas
 * /monitor/<vista> para saber si existen. Si se agrega una vista, se agrega acá y en
 * ningún otro lado.
 */

export type ClaveVista = "intrusion" | "lpr" | "mapa" | "resumen" | "salud" | "rotacion";

export type Vista = {
    clave: ClaveVista;
    nombre: string;
    /** Para quién es, en una frase. */
    paraQuien: string;
    /** Qué muestra, en dos o tres frases. */
    queMuestra: string;
    /** Ícono de lucide, por nombre: el menú lo resuelve. */
    icono: "ShieldAlert" | "Car" | "Map" | "LayoutDashboard" | "HeartPulse" | "RefreshCw";
    /** Si la vista puede sonar y con qué modos. */
    sonido?: { ajuste: string; modos: { valor: string; rotulo: string }[] };
};

export const VISTAS: Vista[] = [
    {
        clave: "intrusion", nombre: "Intrusión", icono: "ShieldAlert",
        paraQuien: "La pared del centro: quien tiene que ver una intrusión en el segundo en que ocurre.",
        queMuestra: "Todas las cámaras de intrusión en mosaico, con su línea y su zona dibujadas y el armado de cada regla. Cuando una detecta, su canal se pone rojo y crece hasta ocupar media pantalla; al costado, las últimas detecciones con su foto.",
        sonido: { ajuste: "MONITOR_INTRUSION_SONIDO", modos: [{ valor: "off", rotulo: "Sin sonido" }, { valor: "una", rotulo: "Un tono por alarma" }, { valor: "repetir", rotulo: "Repetir hasta que se acepte" }] },
    },
    {
        clave: "lpr", nombre: "Control LPR", icono: "Car",
        paraQuien: "La garita o la pared: quién entra y quién sale, y si se le abrió.",
        queMuestra: "La última lectura grande (chapa y cuadro), permitido o denegado con el motivo, la tira de las últimas diez, los contadores del día y una fila de atención con lista negra, en búsqueda y merodeo.",
        sonido: { ajuste: "MONITOR_LPR_SONIDO", modos: [{ valor: "off", rotulo: "Sin sonido" }, { valor: "denegado", rotulo: "En cada denegado" }, { valor: "lista", rotulo: "Sólo lista negra y en búsqueda" }] },
    },
    {
        clave: "mapa", nombre: "Mapa", icono: "Map",
        paraQuien: "La pared: el barrio entero de un vistazo.",
        queMuestra: "El plano del barrio con las cámaras, los vehículos en seguimiento moviéndose, los estacionados con su cronómetro y la cámara en alarma titilando. Al pie, el último evento.",
    },
    {
        clave: "resumen", nombre: "Resumen del barrio", icono: "LayoutDashboard",
        paraQuien: "El supervisor: los números del día sin fotos ni mapa.",
        queMuestra: "Adentro ahora, entradas y salidas, denegados, visitas activas, cámaras en línea y caídas, alarmas pendientes; el pulso del día por hora y los últimos eventos.",
    },
    {
        clave: "salud", nombre: "Salud del sistema", icono: "HeartPulse",
        paraQuien: "Quien tiene que enterarse de una falla antes de que llame un residente.",
        queMuestra: "Cada cámara, lectora y NVR, el bot de WhatsApp, el almacenamiento, la base y los procesos, en verde, ámbar o rojo, con hace cuánto respondió y desde cuándo falla.",
    },
    {
        clave: "rotacion", nombre: "Rotación", icono: "RefreshCw",
        paraQuien: "Quien tiene un solo monitor y quiere ver varias cosas.",
        queMuestra: "Alterna las vistas que elijas cada tantos segundos. Si hay una intrusión confirmada, se queda en Intrusión hasta que se resuelva.",
    },
];

export const CLAVES_VISTAS = VISTAS.map((v) => v.clave);
export const esVista = (s: string | null | undefined): s is ClaveVista => !!s && (CLAVES_VISTAS as string[]).includes(s);
export const vistaPorClave = (c: string) => VISTAS.find((v) => v.clave === c) || null;

/**
 * Qué puede leer un enlace de pantalla de cada vista, además de `/api/monitor/<su vista>`.
 *
 * `/api/monitor/alarmas` lo leen todas (la alerta global se impone sobre cualquier vista).
 * La rotación abre cualquier vista: su contenido se cambia desde Monitores en cualquier
 * momento, así que acotarla a "las que tiene hoy" sería una promesa que no se cumple.
 */
export const ALCANCE_COMUN = ["/api/monitor/alarmas", "/api/monitor/marco"];
export const ALCANCE_POR_VISTA: Record<ClaveVista, string[]> = {
    intrusion: ["/api/monitor/intrusion"],
    lpr: ["/api/monitor/lpr"],
    mapa: ["/api/monitor/mapa"],
    resumen: ["/api/monitor/resumen"],
    salud: ["/api/monitor/salud", "/api/system-status"],
    rotacion: ["/api/monitor/"],
};

/** ¿Un enlace emitido para `vista` puede pedir esta ruta? */
export function alcanceCubre(vista: ClaveVista, pathname: string): boolean {
    if (vista === "rotacion") return pathname.startsWith("/api/monitor/") || pathname === "/api/system-status";
    return [...ALCANCE_COMUN, ...ALCANCE_POR_VISTA[vista]].some((p) => pathname === p || pathname.startsWith(p + "/") || pathname.startsWith(p + "?"));
}

/** ¿Un enlace emitido para `vista` puede abrir la página /monitor/<destino>? */
export function enlaceAbre(vista: ClaveVista, destino: string): boolean {
    return vista === "rotacion" ? esVista(destino) : vista === destino;
}

/** Nombre de la cookie y del parámetro con los que viaja el enlace de pantalla. */
export const COOKIE_PANTALLA = "pantalla";
export const PARAM_PANTALLA = "pantalla";
