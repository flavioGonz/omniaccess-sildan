import { pedirAx } from "./isapi-ax";
import type { DestinoReceptor, DriverCentral, EquipoCentral, EstadoCentral, EstadoParticion, ModeloCentral, Resultado, ZonaLeida } from "./tipos";

/**
 * Hikvision AX PRO y AX Hybrid PRO, por ISAPI (/ISAPI/SecurityCP/…). openspec D7.
 *
 * SIN PROBAR CON EQUIPO (21/10: todavía no hay ninguna AX). Por eso:
 *  · nada se escribe a ciegas: para vincular se LEE primero el centro receptor de la central y se
 *    cambian sólo los campos que la central ya tiene (con los nombres que ella usa). Si no se
 *    encuentra un campo, no se inventa: se dice cuál falta y no se guarda nada;
 *  · «probar» devuelve lo que se escribiría sin escribirlo;
 *  · la pantalla dice «sin probar con equipo» hasta la primera AX (probado: false).
 *
 * La central exige una cuenta de rol ADMINISTRADOR (no Instalador) para ISAPI. Se entra con sesión
 * (isapi-ax), como el panel web; las rutas de armado y de estado son las que usa la integración de
 * Home Assistant con equipos reales. El centro receptor (ReportCenterCfg) es lo único sin una
 * fuente así: por eso se lee primero y se cambian sólo los campos que la central ya tiene.
 */
// La sesión, la clave encadenada y el digest de respaldo viven en isapi-ax (tarea 4.2).
const pedir = (e: EquipoCentral, metodo: "GET" | "PUT" | "POST", url: string, data?: unknown) => pedirAx(e, metodo, url, data);

function errorDe(x: any): string {
    const d = x?.response?.data;
    const sub = d?.subStatusCode || d?.ResponseStatus?.subStatusCode;
    if (x?.response?.status === 401) return "La central no aceptó el usuario o la clave (tiene que ser una cuenta de Administrador, no de Instalador).";
    if (sub) return `La central contestó ${sub}${d?.errorMsg ? `: ${d.errorMsg}` : ""}`;
    return x?.message || "La central no contestó";
}
const okIsapi = (r: any) => !r || r.statusCode == null || Number(r.statusCode) === 1 || r.statusString === "OK";

/** Busca una clave por nombre sin importar mayúsculas, entre varios nombres posibles. */
function campo(o: Record<string, any>, ...nombres: string[]): string | null {
    const ks = Object.keys(o || {});
    for (const n of nombres) { const k = ks.find((x) => x.toLowerCase() === n.toLowerCase()); if (k) return k; }
    return null;
}

/** El primer centro receptor libre o el que ya apunta a OmniAccess. */
async function elegirCentro(e: EquipoCentral, d: DestinoReceptor): Promise<{ id: number; cfg: Record<string, any> } | { error: string }> {
    let lista: any;
    try { lista = await pedir(e, "GET", "/ISAPI/SecurityCP/ReportCenterCfg?format=json"); }
    catch { lista = null; }
    const filas: any[] = (lista?.ReportCenterCfgList || lista?.List || []).map((x: any) => x?.ReportCenterCfg || x).filter(Boolean);
    const ids = filas.length ? filas : [1, 2].map((id) => ({ id }));
    const leidos: { id: number; cfg: Record<string, any> }[] = [];
    for (const f of ids) {
        const id = Number(f.id);
        if (!id) continue;
        try {
            const r: any = await pedir(e, "GET", `/ISAPI/SecurityCP/ReportCenterCfg/${id}?format=json`);
            const cfg = r?.ReportCenterCfg || r;
            if (cfg && typeof cfg === "object") leidos.push({ id, cfg });
        } catch (x) { if (!leidos.length && id === Number(ids[0].id)) return { error: errorDe(x) }; }
    }
    if (!leidos.length) return { error: "La central no devolvió su centro receptor (ReportCenterCfg)." };
    const nuestro = leidos.find(({ cfg }) => [cfg.ipAddress, cfg.domain, cfg.address, cfg.serverAddress].some((v) => String(v || "").toLowerCase() === d.direccion.toLowerCase()));
    const libre = leidos.find(({ cfg }) => cfg.enabled === false || !(cfg.ipAddress || cfg.domain || cfg.address));
    return nuestro || libre || leidos[leidos.length - 1];
}

function armarCentro(cfg: Record<string, any>, d: DestinoReceptor): { nuevo: Record<string, any> } | { error: string } {
    const n = { ...cfg };
    const faltan: string[] = [];
    const poner = (valor: unknown, rotulo: string, ...nombres: string[]) => { const k = campo(n, ...nombres); if (k) n[k] = valor; else faltan.push(rotulo); };
    const esIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(d.direccion);
    const kTipoDir = campo(n, "addressType", "addressingFormatType");
    if (kTipoDir) n[kTipoDir] = esIp ? "ipaddress" : "domain";
    poner(true, "habilitado", "enabled");
    // Con un dominio y una central que distingue el tipo de dirección (addressType), el dominio va
    // en su propio campo aunque la central no lo haya devuelto vacío; la IP vieja no se toca.
    if (!esIp && kTipoDir) n[campo(n, "domain", "domainName") || "domain"] = d.direccion;
    else poner(d.direccion, "dirección", esIp ? "ipAddress" : "domain", "ipAddress", "address", "serverAddress");
    poner(d.puerto, "puerto", "port", "portNo");
    poner(`${d.clave ? "*" : ""}${d.protocolo}`, "protocolo", "protocolType", "protocol");
    poner(d.cuenta, "cuenta", "accountCode", "account", "userAccount");
    const kTransp = campo(n, "transmissionProtocol", "transportProtocol", "transProtocol");
    if (kTransp) n[kTransp] = d.transporte.toUpperCase();
    if (d.clave) poner(d.clave, "clave de cifrado", "encryptionKey", "secretKey", "encryptKey", "password");
    const kSup = campo(n, "pollingRate", "pollingInterval", "heartbeatInterval");
    if (kSup) n[kSup] = d.supervisionSeg;
    if (faltan.length) return { error: `La central no tiene estos campos con los nombres esperados: ${faltan.join(", ")}. Mandame lo que devuelve /ISAPI/SecurityCP/ReportCenterCfg/1 para completar el driver.` };
    return { nuevo: n };
}

// Los valores de `arming` de /status/subSystems (los mismos que lee hikaxpro): away, stay, vacation, disarm, arming.
const ESTADO_PART: Record<string, EstadoParticion["estado"]> = { away: "ausente", arm: "ausente", vacation: "ausente", stay: "presente", home: "presente", disarm: "desarmada", disarmed: "desarmada" };

function crear(modelo: ModeloCentral, nombre: string): DriverCentral {
    return {
        modelo, nombre, probado: false,
        ayudaAlta: "IP de la central en la red del barrio y una cuenta de rol Administrador (la de Instalador no puede usar ISAPI). OmniAccess le escribe el centro receptor: dirección y puerto públicos, cuenta, SIA-DCS cifrado y la clave.",

        async vincular(e, d, probar) {
            const c = await elegirCentro(e, d);
            if ("error" in c) return { ok: false, error: c.error };
            const a = armarCentro(c.cfg, d);
            if ("error" in a) return { ok: false, error: a.error, actual: ocultar(c.cfg) };
            if (probar) return { ok: true, detalle: `Se escribiría el centro receptor ${c.id}.`, actual: ocultar(a.nuevo) };
            try {
                const r: any = await pedir(e, "PUT", `/ISAPI/SecurityCP/ReportCenterCfg/${c.id}?format=json`, { ReportCenterCfg: a.nuevo });
                if (!okIsapi(r)) return { ok: false, error: `La central contestó ${r?.subStatusCode || r?.statusString || "error"}` };
                return { ok: true, detalle: `Centro receptor ${c.id} apuntando a ${d.direccion}:${d.puerto}.` };
            } catch (x) { return { ok: false, error: errorDe(x) }; }
        },

        async zonas(e) {
            let r: any;
            try { r = await pedir(e, "GET", "/ISAPI/SecurityCP/status/zones?format=json"); }
            catch (x) { throw new Error(errorDe(x)); }
            const lista: any[] = (r?.ZoneList || []).map((z: any) => z?.Zone || z);
            return lista.map((z): ZonaLeida => ({
                zona: Number(z.id), particion: z.subSystemNo != null ? Number(z.subSystemNo) : Array.isArray(z.linkageSubSystem) ? Number(z.linkageSubSystem[0]) : null,
                nombre: z.name || z.zoneName || null, tipo: z.zoneType || z.detectorType || null,
                estado: z.alarm ? "alarma" : z.bypassed ? "anulada" : z.tamperEvident ? "sabotaje" : z.sensorStatus || z.status || z.zoneStatus || null,
            })).filter((z) => Number.isFinite(z.zona));
        },

        async estado(e): Promise<EstadoCentral> {
            let r: any;
            try { r = await pedir(e, "GET", "/ISAPI/SecurityCP/status/subSystems?format=json"); }
            catch (x) { throw new Error(errorDe(x)); }
            const lista: any[] = (r?.SubSysList || []).map((s: any) => s?.SubSys || s);
            const particiones = lista.map((s): EstadoParticion => ({
                id: Number(s.id), nombre: s.name || null,
                estado: s.alarm === true || s.alarmState === "alarm" ? "alarma" : ESTADO_PART[String(s.arming || s.armingStatus || "").toLowerCase()] || "desconocido",
            }));
            const zonas = await this.zonas!(e).catch(() => []);
            return { particiones, zonas };
        },

        async armar(e, particion, modo) {
            try {
                const r: any = await pedir(e, "PUT", `/ISAPI/SecurityCP/control/arm/${particion}?ways=${modo === "presente" ? "stay" : "away"}&format=json`);
                return okIsapi(r) ? { ok: true } : { ok: false, error: `La central contestó ${r?.subStatusCode || "error"}` };
            } catch (x) { return { ok: false, error: errorDe(x) }; }
        },
        async desarmar(e, particion) {
            try {
                const r: any = await pedir(e, "PUT", `/ISAPI/SecurityCP/control/disarm/${particion}?format=json`);
                return okIsapi(r) ? { ok: true } : { ok: false, error: `La central contestó ${r?.subStatusCode || "error"}` };
            } catch (x) { return { ok: false, error: errorDe(x) }; }
        },
    };
}

/** Lo que se muestra de la configuración de la central, sin la clave. */
function ocultar(cfg: Record<string, any>) {
    const o = { ...cfg };
    for (const k of Object.keys(o)) if (/key|password|secret/i.test(k) && o[k]) o[k] = "••••";
    return o;
}

export const axPro = crear("ax-pro", "Hikvision AX PRO");
export const axHybrid = crear("ax-hybrid", "Hikvision AX Hybrid PRO");
export type { Resultado };
