/**
 * Qué permiso pide cada ruta de /api que CAMBIA algo (POST, PUT, PATCH, DELETE) cuando la llama
 * una sesión del panel (openspec roles-y-permisos, «La API pide su permiso»). Las lecturas (GET)
 * siguen bastando con la sesión.
 *
 * Hasta el 23/10 el middleware dejaba pasar cualquier sesión válida: 136 de las 196 rutas no
 * preguntaban el rol. Las clases:
 *  · una lista de permisos: alcanza con uno;
 *  · `"sesion"`: alcanza con la sesión (una consulta que viaja por POST, como el OCR);
 *  · `"propio"`: la ruta tiene su propia regla y el middleware no se mete — las públicas y las de
 *    los equipos (webhooks, ticks con token), las de los enlaces de pantalla (/api/monitor) y las
 *    que deciden el permiso según lo que se pide (armar o desarmar una central).
 * La primera que calza gana: las específicas van antes. tests/permisos-api.test.ts falla si una
 * ruta que cambia algo no calza con ninguna.
 */
export type ClaseApi = "sesion" | "propio" | readonly string[];
const P = (...claves: string[]) => claves as readonly string[];

export const RUTAS_API: [RegExp, ClaseApi][] = [
    // ── Con su propia regla ──
    [/^\/api\/webhooks\//, "propio"],
    [/^\/api\/monitor\//, "propio"],
    // La foto del celular para la pared: pública, la autoriza el token del QR (lib/monitor/subida).
    [/^\/api\/subida\//, "propio"],
    [/^\/api\/(health|version|subscribe|queue-report|notifications\/event|visitas\/tick|vigilancia\/bot)$/, "propio"],
    [/^\/api\/(apk|push\/dispatch|topology|chatbot|onvif\/notify|invitado|branding|min-interior|devices\/health\/tick|devices\/usuarios\/tick)(\/|$)/, "propio"],
    [/^\/api\/queue\/(poll|vca-config|report\/send|reset|schedule\/tick|report\/tick)(\/|$)/, "propio"],
    // El motor de seguimiento con su token (x-tracking-token): lo llama el worker, no una persona.
    [/^\/api\/tracking\/(sighting|franja\/vision|franja\/mirar|calibracion|stays\/sweep)$/, "propio"],
    // Armar y desarmar pide «Control de centrales»; vincular y probar, «Configurar centrales»: lo decide la ruta.
    [/^\/api\/centrales\/[^/]+\/accion$/, "propio"],

    // ── Operación ──
    [/^\/api\/alarmas$/, P("alarmas.atender", "intrusion.atender")],
    [/^\/api\/avisos\/activas$/, P("alarmas.atender", "intrusion.atender", "guardia")],
    [/^\/api\/presencia$/, P("alarmas.atender", "visitas", "guardia")],
    [/^\/api\/barriomap$/, P("mapa.editar")],
    [/^\/api\/history\/import$/, P("mantenimiento")],
    [/^\/api\/history\//, "sesion"],
    [/^\/api\/(matriculas\/en-base|ocr|modes\/pin)$/, "sesion"],
    // ── Video ──
    [/^\/api\/acuseek\//, P("acuseek")],
    [/^\/api\/clip\//, P("grabaciones")],
    [/^\/api\/playback\//, P("grabaciones", "ajustes")],
    [/^\/api\/grabador\/buscar$/, P("grabaciones")],
    [/^\/api\/grabador\//, P("dispositivos.editar")],
    [/^\/api\/nvr\/canal-vivo$/, P("video", "dispositivos.editar")],
    [/^\/api\/devices\/(ptz|stream)$/, P("video", "dispositivos.editar")],
    // ── Intrusión ──
    [/^\/api\/intrusion\//, P("intrusion.reglas")],
    // ── Alarm Hub ──
    [/^\/api\/centrales\/eventos(\/|$)/, P("hub.tratar")],
    [/^\/api\/centrales(\/|$)/, P("hub.config")],
    // ── OmniVision ──
    [/^\/api\/vision\/(buscar|parecidos\/|vocabulario\/historial)/, P("vision")],
    [/^\/api\/vision\//, P("vision.config")],
    // ── Equipos, seguimiento ──
    [/^\/api\/tracking\/(probe|frame|camera-rule|service|calibration|enabled|stays\/verify)$/, P("dispositivos.editar", "ajustes")],
    // Las cuentas locales de los equipos (openspec usuarios-de-equipos): su propio permiso, delicado.
    [/^\/api\/devices\/(usuarios\/|[^/]+\/usuarios(\/|$))/, P("dispositivos.usuarios")],
    [/^\/api\/devices\//, P("dispositivos.editar")],
    [/^\/api\/queue\/onvif-topics$/, P("filas.config")],
    // ── Padrón ──
    [/^\/api\/users\/[^/]+\/face$/, P("usuarios.editar")],
    // ── Administración ──
    [/^\/api\/(notifications\/test|push\/test|wa\/session)$/, P("notificaciones")],
    [/^\/api\/manuals$/, P("ajustes")],
    [/^\/api\/test$/, P("mantenimiento")],
];

/** La clase de una ruta de /api, o null si no está en la tabla. */
export function claseDeApi(pathname: string): ClaseApi | null {
    for (const [re, c] of RUTAS_API) if (re.test(pathname)) return c;
    return null;
}

export const METODOS_DE_ESCRITURA = new Set(["POST", "PUT", "PATCH", "DELETE"]);
