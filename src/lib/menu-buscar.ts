import type { HojaConGrupo } from "@/lib/menu";

/**
 * El buscador de pantallas (23/11): qué pantallas responden a lo que se escribió, y en qué orden.
 * Sin React ni navegador, para poder probarlo.
 *
 * Sale del mismo árbol que el menú (lib/menu.ts, `hojasDe`): lo que un rol no ve en el menú tampoco
 * aparece acá, sin una segunda lista de permisos que mantener al día.
 */

/** Minúsculas y sin tildes: «matricula» encuentra «Matrículas», y «CAMARAS» encuentra «cámaras». */
export function sinTildes(t: string): string {
    return (t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Cómo le dice la gente a cada pantalla cuando no le dice como el menú. Quien busca «cámaras» quiere
 * el Monitor CCTV aunque el rótulo no lo diga; quien busca «usuarios» casi siempre busca a los
 * residentes, y a veces los permisos del panel, que están en Ajustes.
 *
 * Va por id de la hoja. Una clave que no exista en el menú hace fallar una prueba: si se renombra una
 * pantalla, sus sinónimos no quedan colgados de nada.
 */
export const TAMBIEN_SE_DICE: Record<string, string> = {
    "alarmas": "eventos central panel de alarmas sirena",
    "mapa": "plano barrio ubicación vehículos en vivo",
    "mapas": "plano ubicación",
    "historial-accesos": "eventos entradas salidas ingresos pasadas registro",
    "historial-lecturas": "lpr matrículas chapas patentes leídas lecturas de cámara procesamiento en vivo",
    "evidencias": "clips videos grabaciones exportar casos",
    "lpr-monitor": "vivo cámaras chapas patentes",
    "lpr-vehiculos": "chapas patentes autos credenciales",
    "lista-negra": "requeridas prohibidos bloqueados alerta",
    "lista-amarilla": "observados seguimiento alerta",
    "lpr-invitados": "invitaciones visitas qr",
    "lpr-plazas": "estacionamiento parking cocheras",
    "rostro-monitor": "caras facial vivo entrada salida",
    "rostro-capturas": "caras rostros capturas porteros reconocimiento facial bitacora equipos face",
    "rostro-equipos": "porteros faciales terminales control de acceso lectores face dispositivos",
    "intrusion-monitor": "perímetro cerco alarma vivo",
    "video-cctv": "cámaras vivo grabaciones nvr reproducción",
    "video-pared": "videowall cámaras televisores",
    "gps-vehiculos": "flota rastreo camiones autos móviles rastreadores",
    "gps-zonas": "geocercas flota rastreo",
    "gps-reportes": "informes viajes paradas kilómetros excel pdf flota",
    "gps-comandos": "cortar motor relé rastreador flota",
    "gps-ajustes": "horario laboral velocidad direcciones flota",
    "guardia-consola": "puesto portería garita",
    "guardia-bitacora": "novedades libro de guardia",
    "guardia-visitas": "visitantes proveedores ingresos",
    "guardia-puestos": "garitas porterías",
    "personas-residentes": "usuarios vecinos propietarios habitantes padrón",
    "personas-censo": "relevamiento actualización de datos",
    "unidades-censo": "relevamiento actualización de datos lotes",
    "unidades-lotes": "casas padrones viviendas terrenos",
    "unidades-adm": "administradoras administración",
    "tags": "tarjetas llaveros rfid",
    "grupos": "permisos de paso horarios puertas",
    "calendario": "feriados agenda",
    "equipos-lista": "cámaras lectores porteros dispositivos nvr rastreadores hikvision",
    "config-ajustes": "configuración permisos roles usuarios del panel correo empresa logo módulos",
    "config-auditoria": "quién hizo qué registro de cambios",
    "config-manuales": "ayuda instructivo documentación",
};

const empiezaPalabra = (texto: string, t: string) => texto.split(" ").some((p) => p.startsWith(t));

/**
 * Las pantallas que responden a `texto`, la mejor primero. Sin texto devuelve todas, en el orden del
 * menú: abrir el buscador y bajar con la flecha también sirve.
 *
 * Todas las palabras escritas tienen que estar («gps comandos» no trae Zonas). El orden: primero lo
 * que calza con el NOMBRE de la pantalla, después con el de su módulo, y al final lo que sólo calza
 * por un sinónimo. Entre iguales, el orden del menú.
 *
 * Una palabra calza si alguna EMPIEZA con lo escrito. En el medio de una palabra sólo vale en el
 * nombre de la pantalla y de tres letras para arriba: con dos, «re» traía «Pared de monitores», y
 * por los sinónimos y el «Rastreo» del módulo, media lista que no tenía nada que ver.
 */
export function buscarPantallas(hojas: HojaConGrupo[], texto: string, cuantas = 8): HojaConGrupo[] {
    const t = sinTildes(texto);
    if (!t) return hojas;
    const palabras = t.split(" ");
    const halladas: { h: HojaConGrupo; puntos: number; orden: number }[] = [];
    hojas.forEach((h, orden) => {
        const r = sinTildes(h.rotulo), g = sinTildes(h.rotuloGrupo || ""), s = sinTildes(TAMBIEN_SE_DICE[h.id] || "");
        const enNombre = (p: string) => empiezaPalabra(r, p) || (p.length >= 3 && r.includes(p));
        const enModulo = (p: string) => empiezaPalabra(g, p);
        if (!palabras.every((p) => enNombre(p) || enModulo(p) || empiezaPalabra(s, p))) return;
        const puntos = r === t ? 100
            : r.startsWith(t) ? 90
            : empiezaPalabra(r, t) ? 80
            : t.length >= 3 && r.includes(t) ? 70
            : palabras.every(enNombre) ? 65
            : g.startsWith(t) || empiezaPalabra(g, t) ? 50
            : palabras.every((p) => enNombre(p) || enModulo(p)) ? 40
            : 20;
        halladas.push({ h, puntos, orden });
    });
    return halladas.sort((a, b) => b.puntos - a.puntos || a.orden - b.orden).slice(0, cuantas).map((x) => x.h);
}
