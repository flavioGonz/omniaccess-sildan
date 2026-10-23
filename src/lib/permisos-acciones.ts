/**
 * Qué pide cada acción de servidor cuando la invoca una sesión del panel (openspec roles-y-permisos,
 * «permisos-aplicacion»).
 *
 * Hasta el 23/10 el middleware sólo cerraba las acciones SIN sesión (lib/acciones-publicas): con
 * cualquier sesión pasaba todo. Un rol con sólo «Monitor» podía invocar `updateSetting`,
 * `restoreBackup` o `deleteAllUsers` desde la consola del navegador. Ahora cada acción tiene su
 * clase, y la puerta del middleware la exige:
 *
 *  · `"sesion"`: alcanza con la sesión del panel (lecturas, y lo que se valida solo).
 *  · `"secreto"`: una lectura que puede devolver un secreto; la acción se revisa sola por dentro
 *    (getSetting con una clave secreta pide Ajustes). Para la puerta vale como `"sesion"`.
 *  · una lista de permisos: alcanza con tener uno.
 *
 * Por archivo: `defecto` es la clase de lo que cambia algo; las funciones cuyo nombre empieza como
 * una lectura (LECTURA) son `"sesion"`; `por` corrige una función puntual. Lo que no esté en la
 * tabla no corre con la sesión del panel: tests/permisos-acciones.test.ts recorre src/app/actions
 * y falla si una acción queda sin clase o con un permiso que no existe.
 */
export type ClaseAccion = "sesion" | "secreto" | readonly string[];
type Archivo = { defecto: ClaseAccion; por?: Record<string, ClaseAccion>; sinLecturas?: boolean };

/** Los nombres de las lecturas: get…, listar…, leer…, estado…, ficha… (ver el porqué de cada excepción en `por`). */
export const LECTURA = /^(get|list|leer|buscar|contar|obtener|estado|datos|ficha|resumen|opciones|search|is[A-Z]|has[A-Z]|cobertura|preview|queSe|donde|retencion|capacidades|celdas|medir|vivo|logs|corridas|conversaciones|mensajes|actividad|eventos|relecturas|visitas|avisos|canales|calcular|tomarCuadro|rolesDe|logosPor|nombreDel|resolveHost|resolveBy|puede|grabaciones)/;

const S = "sesion" as const;
const P = (...claves: string[]) => claves as readonly string[];

export const ACCIONES: Record<string, Archivo> = {
    accesos: { defecto: P("accesos"), por: { getRolesApp: P("accesos"), getUsuariosSistema: P("accesos"), asegurarRolesDeSistema: P("accesos") } },
    acuseek: { defecto: P("acuseek") },
    alertas: { defecto: S },
    areas: { defecto: P("ajustes", "dispositivos.editar") },
    auth: { defecto: S },
    barriomap: { defecto: P("mapa.editar") },
    bitacora: { defecto: P("guardia") },
    "bot-historial": { defecto: P("notificaciones") },
    "clips-telegram": { defecto: P("grabaciones") },
    clips: { defecto: P("grabaciones") },
    compartir: { defecto: P("grabaciones") },
    "contador-fila": { defecto: P("filas.config", "dispositivos.editar") },
    credentials: { defecto: P("vehiculos.editar") },
    descubrir: { defecto: P("dispositivos.editar") },
    "destino-eventos": { defecto: P("ajustes") },
    detections: {
        // Atender una detección lo hace quien atiende alarmas o quien atiende intrusiones.
        defecto: P("alarmas.atender", "intrusion.atender"),
        por: { setVisualTrackLinks: P("intrusion.reglas", "ajustes") },
    },
    deviceMemory: {
        defecto: P("dispositivos.editar"),
        // La consola y la ficha de una persona cargan su cara o su matrícula en los equipos.
        por: { syncUserToDevice: P("usuarios.editar", "vehiculos.editar", "dispositivos.editar"), syncIdentityAction: P("usuarios.editar", "dispositivos.editar") },
    },
    devices: {
        defecto: P("dispositivos.editar"),
        por: {
            getCredencialesDispositivo: P("dispositivos.editar"),
            // Registrar una matrícula desde la captura del monitor, o desde la ficha del vehículo.
            addDevicePlate: P("lpr.operar", "vehiculos.editar", "dispositivos.editar"),
            importPlateBatch: P("vehiculos.editar", "dispositivos.editar"),
            importFaceBatch: P("usuarios.editar", "dispositivos.editar"),
            syncPlatesToDevice: P("vehiculos.editar", "dispositivos.editar"),
            syncPlatesToAllDevices: P("vehiculos.editar", "dispositivos.editar"),
            triggerDeviceRelay: P("lpr.operar", "dispositivos.editar"),
            updateDevicePosition: P("mapa.editar", "dispositivos.editar"),
            deleteDevicePosition: P("mapa.editar", "dispositivos.editar"),
            testDeviceConnection: P("dispositivos.editar"),
            probeDeviceInfo: P("dispositivos.editar"),
        },
    },
    "driver-models": { defecto: P("dispositivos.editar") },
    empresas: { defecto: P("ajustes") },
    estacionamiento: { defecto: P("ajustes") },
    "face-admin": { defecto: P("rostros.listas") },
    "face-resolve": { defecto: P("rostros.listas", "alarmas.atender", "guardia"), por: { resolveFaceEventAction: P("rostros.listas", "alarmas.atender", "guardia") } },
    "face-sync": { defecto: P("rostros.listas") },
    "face-verify": {
        defecto: P("rostros.listas"),
        // Verificar y buscar una cara son consultas.
        por: { verifyFaceAction: S, verifyIdentityAction: S, detectFaceAction: S, searchByPhotoAction: S },
    },
    floorplans: { defecto: P("mapa.editar") },
    franja: { defecto: P("ajustes") },
    funciones: { defecto: P("ajustes"), por: { funcionActiva: S } },
    grabaciones: { defecto: P("dispositivos.editar") },
    groups: { defecto: P("grupos") },
    help: { defecto: P("ajustes") },
    history: { defecto: P("historial.exportar", "lpr.operar"), por: { visionParaExportar: S } },
    invitations: { defecto: P("invitados.gestionar", "guardia"), por: { setWaAllowlist: P("invitados.gestionar", "ajustes"), expireStaleInvitations: P("invitados.gestionar") } },
    "lpr-sync": { defecto: P("dispositivos.editar", "vehiculos.editar", "usuarios.editar") },
    maps: { defecto: P("mapa.editar") },
    "modo-camara": { defecto: P("dispositivos.editar") },
    modules: { defecto: P("ajustes") },
    monitores: { defecto: P("monitores.config"), por: { listarEnlacesPantalla: P("monitores") } },
    notifications: { defecto: P("notificaciones") },
    nvr: { defecto: P("dispositivos.editar") },
    padron: { defecto: P("vigilancia"), por: { guardarComportamientoPadron: P("vigilancia", "usuarios.editar") } },
    parking: { defecto: P("plazas.config") },
    plazas: { defecto: P("plazas.config") },
    procesos: { defecto: P("mantenimiento"), por: { auditoriaProcesos: P("mantenimiento") } },
    proveedores: { defecto: P("visitas", "usuarios.editar") },
    provision: { defecto: P("dispositivos.editar") },
    "pwa-subs": { defecto: P("notificaciones") },
    "queue-schedules": { defecto: P("filas.config") },
    queue: { defecto: P("filas.config"), por: { retryDispatchJob: P("filas", "filas.config"), enqueueReportDispatch: P("filas", "filas.config") } },
    registrations: { defecto: P("usuarios.editar"), por: { submitRegistrationSuggestion: S } },
    registro: { defecto: S },
    "roles-camaras": { defecto: S },
    search: { defecto: S },
    settings: {
        defecto: P("ajustes"),
        por: {
            // getSetting revisa por dentro: una clave secreta (token, clave, conexión) pide Ajustes.
            getSetting: "secreto",
            getAppBranding: S, getReportBranding: S, getSplashConfig: S, getLearnedPlates: S,
            // Las que tocan la base o el almacenamiento entero, o borran en masa.
            purgeAccessEvents: P("mantenimiento"), updateDatabaseUrl: P("mantenimiento"), runDatabaseMigrations: P("mantenimiento"),
            downloadBackup: P("mantenimiento"), restoreBackup: P("mantenimiento"), populateDatabase: P("mantenimiento"),
            clearLearnedPlates: P("mantenimiento"), getS3InternalClient: P("mantenimiento"), listBucketObjects: P("mantenimiento"),
            testExternalDbConnection: P("mantenimiento"), testDbConnection: P("mantenimiento"),
            // Lecturas de la infraestructura: sólo las pantallas de Ajustes.
            getDbStats: P("ajustes"), getStorageCapacity: P("ajustes"), listBuckets: P("ajustes"), getBucketStats: P("ajustes"),
            getBucketLifecycle: P("ajustes"), estadoCapturasLocales: P("ajustes"), getWahaSessions: P("ajustes"), getWahaHistory: P("ajustes"),
        },
    },
    structure: { defecto: P("ajustes") },
    tags: { defecto: P("vehiculos.editar") },
    units: { defecto: P("unidades.editar"), por: { assignUserToUnit: P("unidades.editar", "usuarios.editar"), unassignUserFromUnit: P("unidades.editar", "usuarios.editar") } },
    users: {
        defecto: P("usuarios.editar"),
        por: {
            getAdminsList: P("accesos"), saveAdmin: P("accesos"), deleteAdmin: P("accesos"),
            deleteAllUsers: P("mantenimiento"),
            saveGuard: P("guardia.puestos", "usuarios.editar"), deleteGuard: P("guardia.puestos", "usuarios.editar"), forceGuardLogout: P("guardia.puestos"),
            toggleBlacklist: P("vigilancia", "usuarios.editar"),
            registerFace: P("usuarios.editar", "rostros.listas"),
            quickRegisterPlate: P("lpr.operar", "vehiculos.editar", "usuarios.editar"),
            verifyGuardCredential: S, guardiaVigente: S,
        },
    },
    vehicles: { defecto: P("vehiculos.editar") },
    visitas: { defecto: P("visitas", "guardia"), por: { guardarAjustesVisitas: P("ajustes") } },
    watchlist: {
        defecto: P("vigilancia"),
        // Al registrar a alguien se hereda su marca de lista negra: lo dispara la ficha de la persona o del vehículo.
        por: { heredarListaNegraSiCorresponde: P("vigilancia", "usuarios.editar", "vehiculos.editar") },
    },
    "whatsapp-avisos": { defecto: P("notificaciones") },
};

/** `src/app/actions/<archivo>.ts#<función>` → su clase. `null`: no está en la tabla (no corre). */
export function claseDeAccion(nombre: string): ClaseAccion | null {
    const m = /^src\/app\/actions\/([\w-]+)\.ts#(\w+)$/.exec(nombre);
    if (!m) return null;
    const a = ACCIONES[m[1]];
    if (!a) return null;
    if (a.por && m[2] in a.por) return a.por[m[2]];
    if (!a.sinLecturas && LECTURA.test(m[2])) return "sesion";
    return a.defecto;
}
