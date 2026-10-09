import { readFileSync } from "fs";
import { join } from "path";

/**
 * Qué acciones del servidor se pueden invocar SIN sesión del panel.
 *
 * Una acción de servidor de Next se invoca con un POST a cualquier página que la importe,
 * con el encabezado `Next-Action: <id>`. El id está en el JavaScript público. Así que una
 * acción importada por una página pública (/guard, /login, /residente…) la puede llamar
 * cualquiera desde internet, aunque la página "no la use" todavía: basta con que el módulo
 * esté importado. Medido el 9/10 en producción: un POST anónimo a /guard ejecutó
 * `getBlacklist`, y por el mismo camino quedaban al alcance `deleteAllUsers`,
 * `restoreBackup`, `downloadBackup` y `saveAdmin`, que no revisan quién llama.
 *
 * El arreglo de fondo es que cada acción revise quién la llama (hay 361 sin esa revisión).
 * Mientras tanto, el middleware cierra la puerta: sin sesión del panel, sólo pasan las
 * acciones de estas dos listas. Lo que no está en la lista no se ejecuta. Se nombran por
 * archivo y función porque el id cambia en cada compilación.
 */

/** Sin ninguna identificación: entrar, la marca, la identificación del guardia y lo que valida su propio token. */
const ANONIMAS = new Set([
    "src/app/actions/auth.ts#login",
    "src/app/actions/auth.ts#logout",
    "src/app/actions/auth.ts#getSession",
    "src/app/actions/auth.ts#resetPassword",
    "src/app/actions/settings.ts#getAppBranding",
    "src/app/actions/settings.ts#getSplashConfig",
    // La consola del guardia, antes de identificarse: la lista para elegir quién es y el PIN.
    "src/app/actions/users.ts#getGuardsList",
    "src/app/actions/users.ts#verifyGuardCredential",
    "src/app/actions/users.ts#guardiaVigente",
    // El pase del invitado y el portal del residente: cada una valida el token que recibe.
    "src/app/actions/invitations.ts#getPublicPass",
    "src/app/actions/invitations.ts#getQrSvg",
    "src/app/actions/invitations.ts#nombreDelBarrio",
    "src/app/actions/invitations.ts#listMyInvitations",
    "src/app/actions/invitations.ts#createMyInvitation",
    "src/app/actions/invitations.ts#addMyGuest",
    "src/app/actions/invitations.ts#revokeMyInvitation",
    "src/app/actions/invitations.ts#extendMyInvitation",
]);

/**
 * Con el guardia identificado (cookie `guardia`, firmada al poner su PIN): lo que usan las
 * dos consolas de la garita. Sacado de los imports reales de /guard y /guard-iphone.
 */
const DE_GUARDIA = new Set([
    "src/app/actions/barriomap.ts#getBarrioMap",
    "src/app/actions/bitacora.ts#createBitacoraEntry",
    "src/app/actions/bitacora.ts#deleteBitacoraEntry",
    "src/app/actions/bitacora.ts#getBitacoraPage",
    "src/app/actions/bitacora.ts#searchRecentBitacora",
    "src/app/actions/deviceMemory.ts#syncUserToDevice",
    "src/app/actions/devices.ts#addDevicePlate",
    "src/app/actions/empresas.ts#getEmpresas",
    "src/app/actions/face-resolve.ts#resolveFaceEventAction",
    "src/app/actions/face-verify.ts#searchByPhotoAction",
    "src/app/actions/history.ts#getAccessEvents",
    "src/app/actions/history.ts#getPlateAnalysis",
    "src/app/actions/plazas.ts#getParkingElements",
    "src/app/actions/plazas.ts#getParkingMap",
    "src/app/actions/plazas.ts#getParkingOccupancy",
    "src/app/actions/plazas.ts#getParkingSlots",
    "src/app/actions/plazas.ts#getSlotDetail",
    "src/app/actions/registrations.ts#submitRegistrationSuggestion",
    "src/app/actions/search.ts#searchUsers",
    // Estas cuatro, sin sesión del panel, sólo tocan claves GUARD_* e imágenes (actions/settings).
    "src/app/actions/settings.ts#getSetting",
    "src/app/actions/settings.ts#updateSetting",
    "src/app/actions/settings.ts#saveGuardBranding",
    "src/app/actions/settings.ts#uploadBrandingFile",
    "src/app/actions/users.ts#createUser",
    "src/app/actions/users.ts#updateUser",
    "src/app/actions/users.ts#getQuickCreateData",
    "src/app/actions/visitas.ts#atenderAvisoAMano",
    "src/app/actions/visitas.ts#avisosPendientes",
    "src/app/actions/visitas.ts#cerrarVisitaAMano",
    "src/app/actions/visitas.ts#datosParaRegistrar",
    "src/app/actions/visitas.ts#extenderVisitaAMano",
    "src/app/actions/visitas.ts#getAjustesVisitas",
    "src/app/actions/visitas.ts#registrarVisita",
    "src/app/actions/visitas.ts#visitasEnCurso",
    "src/app/actions/watchlist.ts#desmarcarPersonaEnListaNegra",
    "src/app/actions/watchlist.ts#estadoListaNegraDePersona",
    "src/app/actions/watchlist.ts#marcarPersonaEnListaNegra",
]);

type Entrada = { filename?: string; exportedName?: string };
let mapa: Map<string, string> | null = null;
let leidoEn = 0;
/** Se relee cada tanto por si se compiló de nuevo sin reiniciar (no debería pasar, pero no cuesta). */
const RELEER_MS = 10 * 60_000;

function nombreDeAccion(id: string): string | null {
    if (!mapa || Date.now() - leidoEn > RELEER_MS) {
        try {
            const crudo = JSON.parse(readFileSync(join(process.cwd(), ".next/server/server-reference-manifest.json"), "utf8"));
            const m = new Map<string, string>();
            for (const [k, v] of Object.entries<Entrada>(crudo.node || {})) if (v.filename && v.exportedName) m.set(k, `${v.filename}#${v.exportedName}`);
            mapa = m; leidoEn = Date.now();
        } catch {
            // Sin el manifiesto no se sabe qué acción es: se trata como desconocida (no pasa).
            return null;
        }
    }
    return mapa.get(id) || null;
}

/** ¿Puede correr esta acción quien no tiene sesión del panel? `guardia`: si trae la cookie del guardia válida. */
export function accionPermitidaSinSesion(id: string, guardia: boolean): { ok: boolean; nombre: string | null } {
    const nombre = nombreDeAccion(id);
    if (!nombre) return { ok: false, nombre: null };
    return { ok: ANONIMAS.has(nombre) || (guardia && DE_GUARDIA.has(nombre)), nombre };
}
