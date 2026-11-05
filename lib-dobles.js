// Doble captura LPR: la misma pasada leída más de una vez por la MISMA cámara.
// No se borra nada: el evento repetido queda marcado (isDuplicate) y apunta al original,
// así el historial, los conteos y la exportación lo pueden dejar afuera.
//   1) Misma matrícula, misma cámara, a menos de 2 min  → doble.
//   2) A menos de 5 s: matrícula que difiere en un carácter (lectura de la cámara y del
//      servidor de la misma pasada: SBX7527 / SBX7522) → doble.
//   3) A menos de 5 s: una NO_LEIDA junto a una lectura buena → la NO_LEIDA es la doble.
const VENTANA_MISMA_MS = 120000;
const VENTANA_CERCA_MS = 5000;
const NL = "NO_LEIDA";

function distanciaUno(a, b) {
    if (a === b) return true;
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0, j = 0, d = 0;
    while (i < a.length && j < b.length) {
        if (a[i] === b[j]) { i++; j++; continue; }
        if (++d > 1) return false;
        if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
    }
    return d + (a.length - i) + (b.length - j) <= 1;
}
const chapa = (x) => (x && String(x).trim()) || NL;

/** ¿e (posterior) repite a p (anterior), misma cámara? */
function repite(e, p) {
    const dt = Math.abs(e.t - p.t), a = chapa(e.plate), b = chapa(p.plate);
    if (a !== NL && a === b) return dt <= VENTANA_MISMA_MS;
    if (dt > VENTANA_CERCA_MS) return false;
    if (a === NL) return true;                                   // NO_LEIDA después de una lectura
    if (b !== NL && a.length >= 5 && b.length >= 5) return distanciaUno(a, b);
    return false;
}

/** Al crear un evento LPR: lo marca si repite a otro reciente de la misma cámara. */
async function marcarDoble(prisma, ev) {
    if (!ev || !ev.deviceId || !ev.timestamp) return null;
    const t = new Date(ev.timestamp).getTime();
    const previos = await prisma.accessEvent.findMany({
        where: { deviceId: ev.deviceId, id: { not: ev.id }, timestamp: { gte: new Date(t - VENTANA_MISMA_MS), lte: new Date(t + VENTANA_CERCA_MS) } },
        select: { id: true, timestamp: true, plateDetected: true, isDuplicate: true }, orderBy: { timestamp: "asc" },
    });
    const yo = { t, plate: ev.plateDetected };
    for (const p of previos) {
        const q = { t: p.timestamp.getTime(), plate: p.plateDetected };
        // Lectura buena que llega después de una NO_LEIDA de la misma pasada: la doble es la NO_LEIDA.
        if (chapa(yo.plate) !== NL && chapa(q.plate) === NL && Math.abs(t - q.t) <= VENTANA_CERCA_MS) {
            if (!p.isDuplicate) await prisma.accessEvent.update({ where: { id: p.id }, data: { isDuplicate: true, duplicateOfId: ev.id } });
            continue;
        }
        if (repite(yo, q)) {
            await prisma.accessEvent.update({ where: { id: ev.id }, data: { isDuplicate: true, duplicateOfId: p.id } });
            return p.id;
        }
    }
    return null;
}

module.exports = { marcarDoble, repite, chapa, VENTANA_MISMA_MS, VENTANA_CERCA_MS, NL };
