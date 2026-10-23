/**
 * Con qué cámaras se verifica un evento de una central de alarma (openspec alarmas-como-funciones,
 * «Cámaras de una zona»). Lo usan alarm-receiver.js (las fotos del momento y el aviso del socket) y
 * Next (src/lib/centrales/camaras.ts: la ficha, la pared y el editor de zonas), así que es CommonJS y
 * no depende de nada de Next.
 *
 * El orden, del más preciso al más amplio:
 *   1. las cámaras elegidas para la zona;
 *   2. si no tiene, las cámaras del área de la zona (y de sus sub-áreas);
 *   3. si tampoco, las cámaras del abonado (la central).
 * Siempre hasta TOPE. Una cámara es un id de equipo o un canal de NVR que no es equipo,
 * `nvrch-<nvr>-<ch>` — el mismo nombre que usa el Monitor CCTV, y su stream en go2rtc es `lpr_<id>`.
 *
 * Del área sólo salen equipos cámara: los canales de un NVR del área no se conocen sin preguntarle al
 * NVR (y esto corre con cada alarma); se pueden elegir a mano en la zona o en el abonado.
 */
"use strict";

const TOPE = 4;
/** Los tipos de equipo que filman (los mismos que ofrece el editor de zonas). */
const TIPOS_CAMARA = ["CAMERA", "LPR_CAMERA", "LPR_INTERIOR", "QUEUE_COUNTER"];
const CLAVE_AREAS = "DEVICE_AREAS";

const RE_CANAL = /^nvrch-(.+)-(\d+)$/;
/** `nvrch-<nvr>-<ch>` → { nvrId, ch }; un id de equipo → null. */
function canalDe(id) {
    const m = RE_CANAL.exec(String(id || ""));
    return m ? { nvrId: m[1], ch: Number(m[2]) } : null;
}
const streamDe = (id) => `lpr_${id}`;

/** Las ids sin repetir y sin vacíos, en el orden en que vinieron. */
const limpiar = (xs) => [...new Set((Array.isArray(xs) ? xs : []).map((x) => String(x || "").trim()).filter(Boolean))];

/**
 * La decisión, pura (sin base): de qué lista salen las cámaras y cuáles.
 * @param {{ zona?: string[], area?: string[], abonado?: string[], areaNombre?: string|null, tope?: number }} p
 * @returns {{ ids: string[], origen: "zona"|"area"|"abonado"|"ninguna", area: string|null }}
 */
function elegir(p) {
    const tope = p.tope || TOPE;
    const zona = limpiar(p.zona), area = limpiar(p.area), abonado = limpiar(p.abonado);
    if (zona.length) return { ids: zona.slice(0, tope), origen: "zona", area: null };
    if (area.length) return { ids: area.slice(0, tope), origen: "area", area: p.areaNombre || null };
    if (abonado.length) return { ids: abonado.slice(0, tope), origen: "abonado", area: null };
    return { ids: [], origen: "ninguna", area: null };
}

/** El árbol de áreas guardado por Dispositivos: { areas: [{id,nombre,padre}], equipos: {deviceId: areaId} }. */
async function leerAreas(prisma) {
    try {
        const f = await prisma.setting.findUnique({ where: { key: CLAVE_AREAS } });
        const e = JSON.parse((f && f.value) || "{}") || {};
        return { areas: Array.isArray(e.areas) ? e.areas : [], equipos: e.equipos && typeof e.equipos === "object" ? e.equipos : {} };
    } catch { return { areas: [], equipos: {} }; }
}

/** El área y todas las que cuelgan de ella. */
function conSubareas(areas, id) {
    const out = new Set([id]);
    let creció = true;
    while (creció) { creció = false; for (const a of areas) if (a.padre && out.has(a.padre) && !out.has(a.id)) { out.add(a.id); creció = true; } }
    return out;
}

/**
 * Las cámaras (equipos) de un área, ordenadas por nombre.
 * @returns {Promise<{ ids: string[], nombre: string|null }>}
 */
async function camarasDelArea(prisma, areaId, arbol) {
    if (!areaId) return { ids: [], nombre: null };
    const { areas, equipos } = arbol || (await leerAreas(prisma));
    const area = areas.find((a) => a.id === areaId);
    const dentro = conSubareas(areas, areaId);
    const ids = Object.entries(equipos).filter(([, a]) => dentro.has(a)).map(([d]) => d);
    if (!ids.length) return { ids: [], nombre: area ? area.nombre : null };
    const devs = await prisma.device.findMany({ where: { id: { in: ids }, deviceType: { in: TIPOS_CAMARA } }, select: { id: true, name: true }, orderBy: { name: "asc" } }).catch(() => []);
    return { ids: devs.map((d) => d.id), nombre: area ? area.nombre : null };
}

/**
 * Las cámaras con que se verifica un evento de la zona `zonaNum` de la central `centralId`
 * (zonaNum null = el evento no trae zona: van las del abonado).
 * @returns {Promise<{ ids: string[], origen: "zona"|"area"|"abonado"|"ninguna", area: string|null, abonado: string[] }>}
 */
async function camarasDeZona(prisma, centralId, zonaNum) {
    const central = await prisma.centralAlarma.findUnique({ where: { id: centralId }, select: { camaras: true, deviceId: true } }).catch(() => null);
    const abonado = limpiar(central && central.camaras);
    const zona = zonaNum != null ? await prisma.zonaCentral.findUnique({ where: { centralId_zona: { centralId, zona: Number(zonaNum) } }, select: { camaras: true, areaId: true } }).catch(() => null) : null;
    let area = { ids: [], nombre: null };
    if (zona && !limpiar(zona.camaras).length && zona.areaId) area = await camarasDelArea(prisma, zona.areaId);
    return { ...elegir({ zona: zona ? zona.camaras : [], area: area.ids, abonado, areaNombre: area.nombre }), abonado };
}

module.exports = { TOPE, TIPOS_CAMARA, canalDe, streamDe, elegir, leerAreas, conSubareas, camarasDelArea, camarasDeZona };
