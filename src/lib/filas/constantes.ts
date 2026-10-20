/**
 * Valores del modo Filas que antes estaban repetidos (o escritos distinto) en cada pantalla y en
 * el servidor. Este archivo no importa nada de servidor: lo leen también las pantallas.
 */

/** Los contadores de cruce de la Bosch: acumulados de la cámara, NO gente en la fila. */
export const CANAL_ENTRADA = "Entrada";
export const CANAL_SALIDA = "Salida";
/** Cómo se reconoce el canal de aforo (la regla se llama distinto según quién la configuró). */
export const CANAL_AFORO_RX = /aforo|occupancy|ocupaci/i;
/** Todo lo que no es un contador de cruce es aforo (Occupancy, «Aforo», el nombre que le hayan puesto). */
export const esCanalAforo = (canal?: string | null) => canal !== CANAL_ENTRADA && canal !== CANAL_SALIDA;

/** Límite cuando la fila no tiene uno guardado en sus alertas de aforo. */
export const LIMITE_FILA_POR_DEFECTO = 10;
/** Ventana para la espera estimada: salidas de los últimos N minutos. */
export const VENTANA_ESPERA_MIN = 15;

/* ── Fotos ────────────────────────────────────────────────────────────────────
 * HB, 19/10 (Nico): «sacá más fotos, cada vez que cuenta más de 1 se tienen que guardar en
 * MinIO». Antes había dos criterios según por dónde llegara la lectura: el push sacaba foto con
 * cualquier valor > 0 (también en Entrada/Salida, que son contadores y no escena), y el sondeo
 * —que toma la posta cada vez que el push se cae— sólo al llegar al límite de alerta: en HB eso
 * dejó ~950 lecturas de aforo sin una sola foto. Ahora es un criterio, en un lugar. */

/** Desde cuántas personas en la fila se guarda foto. */
export const FOTO_DESDE_PERSONAS = 1;
/**
 * La Bosch parpadea 0→1→0 varias veces por segundo cuando alguien queda en el borde de la zona.
 * Una foto por parpadeo no agrega nada; si el aforo SUBE se fotografía igual (es justo el
 * momento que interesa), y si se repite el mismo valor se espera este tiempo.
 */
export const FOTO_INTERVALO_MS = 4_000;

/* ── Retención de las fotos ─────────────────────────────────────────────────── */
/** Días que se guardan las fotos. Pasado eso se borran de MinIO (la lectura queda, sin foto). */
export const AJUSTE_FOTOS_DIAS = "QUEUE_FOTOS_DIAS";
export const FOTOS_DIAS_POR_DEFECTO = 60;
/**
 * Días con TODAS las fotos. Después se adelgaza: queda la foto de mayor aforo de cada tramo de
 * FOTOS_TRAMO_MIN minutos por fila, y todas las de la fila sobre su límite (son la evidencia de
 * un aviso). Así una semana completa se puede revisar foto a foto y dos meses siguen teniendo
 * la escena de cada momento, por una fracción del espacio.
 */
export const AJUSTE_FOTOS_COMPLETAS_DIAS = "QUEUE_FOTOS_COMPLETAS_DIAS";
export const FOTOS_COMPLETAS_DIAS_POR_DEFECTO = 7;
export const FOTOS_TRAMO_MIN = 10;
/** Topes de lo que se puede elegir en Ajustes. */
export const FOTOS_DIAS_MAX = 365;

/* ── Aviso de fila sobre el límite ──────────────────────────────────────────── */
/** Segundos de video ANTES y DESPUÉS del momento en que la fila pasó el límite. */
export const AVISO_CLIP_ANTES_SEG = 10;
export const AVISO_CLIP_DESPUES_SEG = 5;
