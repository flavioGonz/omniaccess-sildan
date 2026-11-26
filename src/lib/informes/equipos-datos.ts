import { prisma } from "@/lib/prisma";
import { leerRetenciones, type Retencion } from "@/lib/grabaciones";
import { getChannelMap } from "@/lib/nvr-resolve";
import { saludNvr, type SaludNvr } from "@/lib/salud-nvr";

/**
 * El inventario de equipos, una sola vez para el PDF, el Excel y el paquete (26/11).
 *
 * Nico: «un botón para exportar todos los datos, con portada premium y los logos de OmniAccess, con
 * los datos de cada dispositivo: nombre, NVR, retención de grabaciones, usuario y clave del
 * dispositivo; si es NVR, la salud de los discos y los detalles del hardware. PDF y Excel, y además
 * una exportación de dispositivos con sus áreas y parámetros hacia otras instancias».
 *
 * Las claves sólo vienen si se piden (`conClaves`) y el pedido lo decide la ruta con el permiso; un
 * informe que viaja por correo no tiene por qué llevarlas. La salud de los discos se pregunta en el
 * momento a cada NVR (`conSalud`), en paralelo y con tope de tiempo: un NVR que no contesta figura
 * así, no frena el informe.
 */

export const ROTULO_TIPO: Record<string, string> = {
    LPR_CAMERA: "Cámara LPR", LPR_INTERIOR: "LPR interior", CAMERA: "Cámara de intrusión", NVR: "NVR / grabador",
    FACE_TERMINAL: "Terminal facial", ACCESS_CONTROL: "Control de acceso", DOOR_INTERCOM: "Portero", QUEUE_COUNTER: "Contador de filas",
    ALARM_HUB: "Central de alarma", GPS: "Rastreador GPS",
};
const MARCA: Record<string, string> = { GENERICA: "Genérica", HIKVISION: "Hikvision", DAHUA: "Dahua", AKUVOX: "Akuvox", INTELBRAS: "Intelbras", ZKTECO: "ZKTeco", AVICAM: "Avicam", MILESIGHT: "Milesight" };
const SENTIDO: Record<string, string> = { ENTRY: "Entrada", EXIT: "Salida", INTERIOR: "Interior" };

export type AreaPlana = { id: string; nombre: string; camino: string; nivel: number; padre: string | null; color: string };
export type EquipoInv = {
    id: string; nombre: string; tipo: string; rotuloTipo: string; marca: string; modelo: string | null; firmware: string | null;
    ip: string; puertoHttp: number | null; mac: string | null; ubicacion: string | null; sentido: string | null;
    areaId: string | null; area: string;
    nvr: string | null; canal: number | null; retencion: Retencion | null;
    usuario: string | null; clave: string | null; tieneClave: boolean;
    enLinea: boolean | null; latenciaMs: number | null; ultimaMuestra: string | null; alertas: string[];
    comprobado: string | null; alta: string;
};
export type NvrInv = EquipoInv & { salud: SaludNvr | null; camaras: number };
export type Inventario = {
    generado: string; conClaves: boolean; conSalud: boolean;
    areas: AreaPlana[]; equipos: EquipoInv[]; nvrs: NvrInv[];
    totales: { equipos: number; enLinea: number; fueraDeLinea: number; conAlertas: number; nvrs: number; discos: number; discosMal: number; retMin: number | null; retProm: number | null; porTipo: { tipo: string; rotulo: string; n: number }[] };
};

/** El árbol de áreas, aplanado en orden (cada área seguida de las suyas) y con su camino «Barrio › Perímetro › Norte». */
export function aplanarAreas(areas: { id: string; nombre: string; padre: string | null; orden?: number; color?: string }[]): AreaPlana[] {
    const out: AreaPlana[] = [];
    const hijas = (p: string | null) => areas.filter((a) => (a.padre || null) === p).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
    const ir = (p: string | null, nivel: number, camino: string[]) => {
        for (const a of hijas(p)) { const c = [...camino, a.nombre]; out.push({ id: a.id, nombre: a.nombre, camino: c.join(" › "), nivel, padre: a.padre || null, color: a.color || "#64748b" }); if (nivel < 20) ir(a.id, nivel + 1, c); }
    };
    ir(null, 0, []);
    return out;
}

export async function armarInventario(o: { conClaves: boolean; conSalud: boolean }): Promise<Inventario> {
    const devs = await prisma.device.findMany({
        select: { id: true, name: true, deviceType: true, brand: true, deviceModel: true, firmware: true, ip: true, httpPort: true, mac: true, location: true, direction: true, username: true, password: true, authType: true, trackAcceso: true, comprobadoAt: true, createdAt: true },
        orderBy: { name: "asc" },
    });
    let estadoAreas: { areas?: { id: string; nombre: string; padre: string | null; orden?: number; color?: string }[]; equipos?: Record<string, string> } = {};
    try { estadoAreas = JSON.parse((await prisma.setting.findUnique({ where: { key: "DEVICE_AREAS" } }))?.value || "{}"); } catch { }
    const areas = aplanarAreas(Array.isArray(estadoAreas.areas) ? estadoAreas.areas : []);
    const caminoDe = new Map(areas.map((a) => [a.id, a.camino]));
    const asign = estadoAreas.equipos || {};
    const [retenciones, mapa] = await Promise.all([leerRetenciones(), getChannelMap()]);
    const nombrePorId = new Map(devs.map((d) => [d.id, d.name]));

    // La última muestra de salud de cada equipo y sus alertas abiertas.
    const ultimas: { deviceId: string; ts: Date; reachable: boolean; latencyMs: number | null }[] = await prisma.$queryRaw`
        SELECT DISTINCT ON ("deviceId") "deviceId", ts, reachable, "latencyMs" FROM "DeviceHealthSample"
        WHERE ts > now() - interval '2 days' ORDER BY "deviceId", ts DESC`;
    const salud = new Map(ultimas.map((u) => [u.deviceId, u]));
    const alertas = await prisma.deviceAlert.findMany({ where: { active: true }, select: { deviceId: true, message: true } });
    const alertasDe = new Map<string, string[]>();
    for (const a of alertas) alertasDe.set(a.deviceId, [...(alertasDe.get(a.deviceId) || []), a.message]);

    const equipos: EquipoInv[] = devs.map((d) => {
        const tipo = String(d.deviceType);
        const g = d.ip ? mapa[d.ip] : undefined;
        const s = salud.get(d.id);
        const areaId = asign[d.id] && caminoDe.has(asign[d.id]) ? asign[d.id] : null;
        return {
            id: d.id, nombre: d.name, tipo, rotuloTipo: tipo === "LPR_INTERIOR" && d.trackAcceso ? "LPR OmniVision (acceso)" : ROTULO_TIPO[tipo] || tipo,
            marca: MARCA[String(d.brand)] || String(d.brand), modelo: d.deviceModel || null, firmware: d.firmware || null,
            ip: d.ip, puertoHttp: d.httpPort ?? null, mac: d.mac || null, ubicacion: d.location || null,
            sentido: ["LPR_CAMERA", "LPR_INTERIOR"].includes(tipo) ? SENTIDO[String(d.direction)] || null : null,
            areaId, area: areaId ? caminoDe.get(areaId)! : "Sin área",
            nvr: g?.nvrId ? nombrePorId.get(g.nvrId) || null : null, canal: g?.ch ?? null,
            retencion: tipo !== "NVR" && d.ip ? retenciones[d.ip] || null : null,
            usuario: d.username || null, clave: o.conClaves ? d.password || null : null, tieneClave: !!d.password,
            enLinea: s ? s.reachable : null, latenciaMs: s?.latencyMs ?? null, ultimaMuestra: s ? s.ts.toISOString() : null,
            alertas: alertasDe.get(d.id) || [],
            comprobado: d.comprobadoAt ? d.comprobadoAt.toISOString() : null, alta: d.createdAt.toISOString(),
        };
    });

    // Los NVR, con la salud de sus discos preguntada ahora (en paralelo, con tope).
    const nvrDevs = devs.filter((d) => String(d.deviceType) === "NVR");
    const saludes = o.conSalud
        ? await Promise.all(nvrDevs.map((d) => Promise.race([
            saludNvr({ ip: d.ip, username: d.username, password: d.password, authType: d.authType, brand: String(d.brand) }).catch(() => null),
            new Promise<null>((r) => setTimeout(() => r(null), 15000)),
        ])))
        : nvrDevs.map(() => null);
    const nvrs: NvrInv[] = nvrDevs.map((d, i) => ({
        ...equipos.find((e) => e.id === d.id)!,
        salud: saludes[i],
        camaras: Object.values(mapa).filter((m) => m.nvrId === d.id).length,
    }));

    const discos = nvrs.flatMap((n) => n.salud?.discos || []);
    const rets = equipos.map((e) => e.retencion?.dias).filter((x): x is number => typeof x === "number" && x > 0);
    const conteo = new Map<string, number>();
    for (const e of equipos) conteo.set(e.tipo, (conteo.get(e.tipo) || 0) + 1);
    return {
        generado: new Date().toISOString(), conClaves: o.conClaves, conSalud: o.conSalud, areas, equipos, nvrs,
        totales: {
            equipos: equipos.length, enLinea: equipos.filter((e) => e.enLinea === true).length, fueraDeLinea: equipos.filter((e) => e.enLinea === false).length,
            conAlertas: equipos.filter((e) => e.alertas.length).length, nvrs: nvrs.length, discos: discos.length,
            discosMal: discos.filter((x) => !discoBien(x.estado)).length,
            retMin: rets.length ? Math.min(...rets) : null, retProm: rets.length ? Math.round(rets.reduce((a, b) => a + b, 0) / rets.length) : null,
            porTipo: [...conteo.entries()].sort((a, b) => b[1] - a[1]).map(([tipo, n]) => ({ tipo, rotulo: ROTULO_TIPO[tipo] || tipo, n })),
        },
    };
}

/** «hace 3 días», para el uptime de un NVR. */
export function tiempoPrendido(seg: number | null | undefined): string {
    if (seg == null) return "—";
    const d = Math.floor(seg / 86400), h = Math.floor((seg % 86400) / 3600);
    return d ? `${d} d ${h} h` : `${h} h ${Math.floor((seg % 3600) / 60)} min`;
}
/** La retención en pocas palabras: «31 días · grabando». */
export function retencionTxt(r: Retencion | null): string {
    if (!r) return "—";
    if (r.error) return "No se pudo calcular";
    return `${r.dias} días${r.grabando === false ? " · NO graba" : ""}`;
}
/** Un disco «en reposo» está bien: los NVR duermen los que no están grabando. */
export const discoBien = (e: string) => /^(ok|normal|sleeping|idle)$/i.test(e);
export const estadoDiscoTxt = (e: string) => (/^ok$|^normal$/i.test(e) ? "Bien" : /error|abnormal|smart/i.test(e) ? "Con error" : /unformat/i.test(e) ? "Sin formatear" : /sleep|idle/i.test(e) ? "En reposo" : e);
