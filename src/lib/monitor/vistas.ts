/**
 * El catálogo de vistas de pantalla del centro de monitoreo.
 *
 * Este archivo NO importa nada de servidor: lo usa el middleware (edge) para decidir qué
 * abre un enlace de pantalla, el menú Monitores para dibujar las tarjetas y las páginas
 * /monitor/<vista> para saber si existen. Si se agrega una vista, se agrega acá y en
 * ningún otro lado.
 */

import type { FuncionId } from "@/lib/funciones";

export type ClaveVista = "intrusion" | "alarmas" | "lpr" | "mapa" | "resumen" | "salud" | "rotacion" | "camaras";

export type Vista = {
    clave: ClaveVista;
    nombre: string;
    /** Para quién es, en una frase. */
    paraQuien: string;
    /** Qué muestra, en dos o tres frases. */
    queMuestra: string;
    /** Ícono de lucide, por nombre: el menú lo resuelve. */
    icono: "ShieldAlert" | "Siren" | "Car" | "Map" | "LayoutDashboard" | "HeartPulse" | "RefreshCw" | "Cctv";
    /**
     * La función de la instalación sin la cual la vista no existe (openspec alarmas-como-funciones):
     * apagada, Monitores no la ofrece, la rotación la saltea y la pantalla dice que está apagada.
     */
    funcion?: FuncionId;
    /** Si la vista puede sonar y con qué modos. */
    sonido?: { ajuste: string; modos: { valor: string; rotulo: string }[] };
};

export const VISTAS: Vista[] = [
    {
        clave: "intrusion", nombre: "Intrusión", icono: "ShieldAlert", funcion: "FUNC_INTRUSION",
        paraQuien: "La pared del centro: quien tiene que ver una intrusión en el segundo en que ocurre.",
        queMuestra: "Todas las cámaras de intrusión en mosaico, con su línea y su zona dibujadas y el armado de cada regla. Cuando una detecta, su canal se pone rojo y crece hasta ocupar media pantalla; al costado, las últimas detecciones con su foto.",
        sonido: { ajuste: "MONITOR_INTRUSION_SONIDO", modos: [{ valor: "off", rotulo: "Sin sonido" }, { valor: "una", rotulo: "Un tono por alarma" }, { valor: "repetir", rotulo: "Repetir hasta que se acepte" }] },
    },
    {
        // 23/10, Nico: «un nuevo tipo de monitor para los wall, "Alarmas", con las alarmas del hub…
        // la recepción de eventos debe ser muy rápida: tenemos que verificar cada evento con video en vivo».
        clave: "alarmas", nombre: "Alarmas", icono: "Siren", funcion: "FUNC_ALARMAS_GESTION",
        paraQuien: "La pared del centro: quien verifica con video cada alarma que manda una central.",
        queMuestra: "La alarma más urgente sin tratar, con su prioridad, cuánto hace y quién la tiene, y las cámaras de su área en una pared como la de Cámaras: las de la zona en grande, el resto alrededor, con su disposición, páginas y «Ver el momento». Al costado, las otras pendientes, el procedimiento y lo que va llegando de las centrales con qué pasó con cada alarma; abajo, cada central con su armado y si sigue reportando.",
        sonido: { ajuste: "MONITOR_ALARMAS_SONIDO", modos: [{ valor: "una", rotulo: "Un tono por alarma" }, { valor: "repetir", rotulo: "Repetir mientras nadie la tome" }, { valor: "off", rotulo: "Sin sonido" }] },
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
        clave: "camaras", nombre: "Cámaras", icono: "Cctv",
        paraQuien: "La pared de video: todos los canales del barrio a la vista, como en el NVR.",
        queMuestra: "Los canales de los NVR y las cámaras sueltas en mosaico de 2×2 a 5×5, con su nombre, su NVR y su canal; si son más que el mosaico, pasa de página sola. La que detecta algo se pone roja y pasa adelante. Tocar un canal lo abre grande.",
    },
    {
        clave: "rotacion", nombre: "Rotación", icono: "RefreshCw",
        paraQuien: "Quien tiene un solo monitor y quiere ver varias cosas.",
        queMuestra: "Alterna las vistas que elijas cada tantos segundos. Si hay una intrusión confirmada, se queda en Intrusión hasta que se resuelva; si hay una alarma crítica de una central y la rotación incluye Alarmas, se queda en Alarmas hasta que se trate.",
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
    // Las cámaras del área del evento, como en la pared Cámaras (y la foto de un canal de NVR, de respaldo).
    alarmas: ["/api/monitor/centrales", "/api/monitor/camaras"],
    lpr: ["/api/monitor/lpr"],
    mapa: ["/api/monitor/mapa"],
    resumen: ["/api/monitor/resumen"],
    salud: ["/api/monitor/salud", "/api/system-status"],
    camaras: ["/api/monitor/camaras"],
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
