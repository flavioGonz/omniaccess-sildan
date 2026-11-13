/**
 * Cuánto lleva un vehículo en su lugar, para mostrarlo sobre el auto en el vivo (12/11, Nico:
 * «sería estupendo en el live view poder mostrar sobre el auto el tiempo estacionado… sin que
 * gaste tanto hardware ni tiempo de GPU»).
 *
 * No detecta nada: mira las cajas de vehículos que vision-worker YA saca de cada cuadro que
 * analiza, y recuerda «en este lugar hay un vehículo desde tal hora». Cero GPU, y de CPU una
 * comparación de cajas por vehículo.
 *
 * Por qué del LUGAR y no de la pista del registro: medido en el lab el 12/11, un auto estacionado
 * no es una pista larga sino una pista nueva por minuto (con la escena quieta el cuadro se analiza
 * cada 60 s y la pista se cierra a los 15). Colgar el reloj de la pista lo volvía a cero cada
 * minuto. Es la misma lección del estacionamiento: la estadía es del lugar.
 *
 * Sin base ni red: lo usan vision-worker (para llevar la cuenta) y los tests.
 */

/** Dos cajas que se pisan más que esto son el mismo vehículo en el mismo lugar. */
const MISMO_LUGAR_IOU = 0.6;
/**
 * Cuándo se da por ido un vehículo que dejó de verse. Con la escena quieta el cuadro se analiza
 * cada minuto, así que «no lo vi» puede ser sólo «no miré»: hace falta que haya habido cuadros
 * analizados SIN él (FALTAS_MIN) y un rato sin verlo (SIN_VER_MS) — un camión que pasa por delante
 * lo tapa unos segundos y no lo borra. Pasado OLVIDO_MS sin verlo, se va igual.
 */
const FALTAS_MIN = 4;
const SIN_VER_MS = 45_000;
const OLVIDO_MS = 6 * 60_000;
/** Menos que esto en el lugar no es «estacionado»: es un auto que pasa o que frenó. */
const ESTACIONADO_MIN_MS = 60_000;
/** Tope por cámara: un auto que cruza deja un lugar por cuadro hasta que vencen. */
const LUGARES_MAX = 60;
/** Una foto de los lugares más vieja que esto no se hereda al arrancar: ya no dice nada de ahora. */
const HEREDAR_MS = 10 * 60_000;

function iou(a, b) {
    const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]), x2 = Math.min(a[2], b[2]), y2 = Math.min(a[3], b[3]);
    const i = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i;
    return u > 0 ? i / u : 0;
}

/**
 * Un cuadro analizado de una cámara: `cajas` son los vehículos que se vieron (normalizadas 0-1).
 * `lugares` es la lista de esa cámara (se cambia y se devuelve): { caja, desde, visto, faltas }.
 */
function actualizar(lugares, cajas, ahora) {
    const libres = new Set(lugares.map((_, i) => i));
    const nuevos = [];
    for (const caja of cajas) {
        let mejor = -1, mejorIou = MISMO_LUGAR_IOU;
        for (const i of libres) { const v = iou(lugares[i].caja, caja); if (v >= mejorIou) { mejor = i; mejorIou = v; } }
        if (mejor >= 0) { const l = lugares[mejor]; l.caja = caja; l.visto = ahora; l.faltas = 0; libres.delete(mejor); }
        else nuevos.push({ caja, desde: ahora, visto: ahora, faltas: 0 });
    }
    for (const i of libres) lugares[i].faltas++;
    const quedan = lugares.filter((l) => !((l.faltas >= FALTAS_MIN && ahora - l.visto > SIN_VER_MS) || ahora - l.visto > OLVIDO_MS)).concat(nuevos);
    // Si hay de más, se van los más nuevos que no se volvieron a ver: son autos que pasaron.
    if (quedan.length > LUGARES_MAX) quedan.sort((a, b) => (b.visto - b.desde) - (a.visto - a.desde)).length = LUGARES_MAX;
    return quedan;
}

/** Lo que se publica de una cámara: sólo los que ya llevan un rato. [x1, y1, x2, y2, desdeMs]. */
function publicar(lugares, ahora) {
    return lugares.filter((l) => l.visto - l.desde >= ESTACIONADO_MIN_MS && ahora - l.visto <= OLVIDO_MS)
        .map((l) => [...l.caja.map((v) => Math.round(v * 1000) / 1000), l.desde]);
}

/** Al arrancar: lo publicado antes del reinicio vuelve a ser la lista, para que el reloj no empiece de cero. */
function heredar(foto, ahora) {
    const out = {};
    if (!foto || !foto.t || ahora - Date.parse(foto.t) > HEREDAR_MS) return out;
    for (const [id, lista] of Object.entries(foto.camaras || {})) {
        out[id] = (lista || []).filter((x) => Array.isArray(x) && x.length === 5).map((x) => ({ caja: x.slice(0, 4), desde: x[4], visto: ahora, faltas: 0 }));
    }
    return out;
}

module.exports = { actualizar, publicar, heredar, iou, MISMO_LUGAR_IOU, ESTACIONADO_MIN_MS, FALTAS_MIN, SIN_VER_MS, OLVIDO_MS, LUGARES_MAX, HEREDAR_MS };
