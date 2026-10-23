/**
 * Cuánto se guardan las fotos de las alarmas de central (bucket propio, ver lib-s3.js). Lo usan
 * alarm-receiver.js (aplica la regla y poda por tamaño) y Next (Ajustes → Centrales de alarma), así
 * que es CommonJS y no depende de nada de Next.
 *
 * Los valores por defecto, medidos el 23/10: una alarma guarda hasta 4 cuadros de ~150 KB. Con
 * 200 alarmas por día —una central que se dispara de más— son ~120 MB por día; 90 días son
 * ~11 GB. El tope de 10 GB es la red para ese caso: los días no frenan una central en bucle.
 * 90 días porque un robo se reclama al seguro o a la policía semanas después; lo que haya que
 * guardar más se exporta desde la ficha.
 */
"use strict";

const AJUSTE_DIAS = "CENTRALES_FOTOS_DIAS";
const AJUSTE_TOPE_GB = "CENTRALES_FOTOS_TOPE_GB";
const DIAS_DEFECTO = 90, DIAS_MIN = 7, DIAS_MAX = 730;
const TOPE_GB_DEFECTO = 10, TOPE_GB_MIN = 1, TOPE_GB_MAX = 500;

const acotar = (v, min, max, def) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? Math.min(max, Math.max(min, n)) : def; };
const diasValidos = (v) => acotar(v, DIAS_MIN, DIAS_MAX, DIAS_DEFECTO);
const topeValido = (v) => acotar(v, TOPE_GB_MIN, TOPE_GB_MAX, TOPE_GB_DEFECTO);

/** Lo guardado, ya acotado. @returns {Promise<{ dias: number, topeGb: number }>} */
async function leerRetencion(prisma) {
    const filas = await prisma.setting.findMany({ where: { key: { in: [AJUSTE_DIAS, AJUSTE_TOPE_GB] } }, select: { key: true, value: true } }).catch(() => []);
    const v = (k) => filas.find((f) => f.key === k)?.value;
    return { dias: diasValidos(v(AJUSTE_DIAS)), topeGb: topeValido(v(AJUSTE_TOPE_GB)) };
}

module.exports = { AJUSTE_DIAS, AJUSTE_TOPE_GB, DIAS_DEFECTO, DIAS_MIN, DIAS_MAX, TOPE_GB_DEFECTO, TOPE_GB_MIN, TOPE_GB_MAX, diasValidos, topeValido, leerRetencion };
