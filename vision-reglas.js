/**
 * Las reglas de las analíticas de visión, dentro de vision-worker: conteo por línea, sentido
 * contrario, tiempo de permanencia, aglomeración, conteo de fila, cruce de línea propio, intrusión
 * en zona propia, merodeo y objeto retirado (ver src/lib/vision-reglas.ts, que define
 * las reglas y su validación; acá se aplican).
 *
 * Trabaja sobre lo que ya hace el registro: cada cámara se mira cada ~2 s y omni-vision
 * devuelve los objetos con su número de pista (ByteTrack). De cada objeto se usa el PIE de su
 * caja. Lo que pasa se escribe en EventoVision; si la regla avisa, además un AvisoGuardia (lo
 * ven la consola del guardia, Control LPR y Visitas) y se le avisa al socket por
 * /internal/emit, como hace el resto de la app.
 *
 * Límites que hay que saber (se dicen también en la pantalla):
 *  · A 2 s entre cuadros un auto rápido puede perder su número de pista entre dos cuadros:
 *    entonces no cruza «de un lado al otro» con el mismo número y no se cuenta. Las personas
 *    y los autos a paso de barrio se cuentan bien; una avenida, no.
 *  · El cruce se mide con el segmento entre dos cuadros seguidos: no hace falta que el pie
 *    caiga justo sobre la línea.
 */

const http = require("http");
const crypto = require("crypto");
const sharp = require("sharp");

/** Las analíticas del laboratorio que prenden cada tipo, y su valor si nadie las tocó. */
const ANALITICA = { conteo: "aforo", sentido: "sentido-contrario", permanencia: "permanencia", aglomeracion: "aglomeracion", fila: "fila", cruce: "linea-propia", intrusion: "zona-propia", merodeo: "merodeo", retirado: "retirado", animal: "animal", dejado: "dejados", suelo: "persona-suelo", trepar: "trepar", epp: "epp" };
const DEFECTO = { aforo: true, "sentido-contrario": true, permanencia: true, aglomeracion: true, fila: true, "linea-propia": true, "zona-propia": true, merodeo: true, retirado: true, animal: true, dejados: true, "persona-suelo": true, trepar: true, epp: true };
/** Las analíticas retiradas (copia de TIPOS_RETIRADOS en src/lib/vision-reglas.ts: si cambia allá, cambia acá). */
const RETIRADAS = new Set(["permanencia"]);
/** Cuánto tiene que correrse el pie (fracción del cuadro) para contar como movimiento. */
const MOVIMIENTO_MIN = 0.01;
/** Una pista que no se ve hace esto deja de existir para las reglas. */
const OLVIDO_MS = 20_000;
/*
 * «Se quedó en la zona» (permanencia), 21/10, Nico: «el clip no funciona bien: [tiene que traer] el
 * momento que estaciona el auto exacto». Medido en el lab: los seis avisos de «Prueba puesto 7» de
 * la mañana empezaban con el auto YA estacionado — el clip del 12:31:28 muestra la calle quieta.
 * El auto del fondo es chico y el detector lo pierde de a ratos: con OLVIDO_MS (20 s) cada pérdida
 * cerraba la estadía y la próxima vez que se lo veía abría otra, con `desde` = cuando se lo volvió
 * a tomar, no cuando llegó. La estadía es del LUGAR (como el estacionamiento, ver franja.ts), no de
 * la pista:
 *  · REENGANCHE_MS: una estadía que dejó de verse queda en suspenso; si en ese lugar (PERM_IOU)
 *    reaparece algo quieto, es la misma y sigue con su `desde`.
 *  · MEMORIA_LUGAR_MS: una ya cerrada por «dejó de verse» se recuerda; si el mismo auto vuelve a
 *    tomarse ahí, se reabre su aviso en vez de abrir otro (era el mismo auto, no una llegada).
 *  · `llegada`: si se lo VIO llegar (la pista venía de afuera de la zona o moviéndose). Si no, la
 *    pantalla dice que ya estaba y no inventa una hora de llegada.
 *  · `quieto`: cuándo dejó de moverse (el pie no se corre más de QUIETO_DESPLAZ en QUIETO_MS).
 *    `llegada` y `quieto` se guardan en el aviso pero hoy la pantalla no los usa: el clip «de la
 *    llegada a estacionar» se retiró a pedido de Nico (21/10, «retiremos esta función de momento»).
 */
const REENGANCHE_MS = 10 * 60_000;
const MEMORIA_LUGAR_MS = 2 * 3_600_000;
const PERM_IOU = 0.4;
const QUIETO_DESPLAZ = 0.015;
const QUIETO_MS = 6_000;
/** Cada cuánto se manda la caja y el reloj de una estadía con aviso, para dibujarla en vivo. */
const PERM_VIVO_MS = 2_000;
/** Dos cruces de la misma pista en la misma línea dentro de esto son el mismo (el pie tiembla sobre la línea). */
const REBOTE_MS = 5_000;
/** Entre dos avisos de sentido contrario de la misma regla. */
const ENFRIO_SENTIDO_MS = 60_000;
/** Entre dos avisos de aglomeración de la misma regla: la misma reunión no avisa cada 30 s. */
const ENFRIO_AGLOMERACION_MS = 10 * 60_000;

/**
 * Entre dos avisos de cruce propio de la misma regla. Cada cruce queda registrado con su foto;
 * lo que se espacia es el aviso: un grupo de cinco que salta el cerco es un aviso, no cinco.
 */
const ENFRIO_CRUCE_MS = 30_000;
/** Lo mismo para la intrusión en zona propia. */
const ENFRIO_INTRUSION_MS = 60_000;
/**
 * Conteo de fila: la analítica de aforo de una cámara Bosch del modo Filas, hecha por OmniVision.
 *  · Aforo: las personas con el pie adentro de la zona. Un número nuevo vale cuando se sostiene el
 *    «rebote» de la regla (el «Tiempo de rebote» de la tarea de aforo de la cámara): una persona
 *    tapada un cuadro, o el que pasa rozando el borde, no mueve la fila.
 *  · Entradas y salidas: una pista que pasa de afuera a adentro de la zona entra, de adentro a
 *    afuera sale (EnteringField / LeavingField). Una pista que APARECE adentro no cuenta: es casi
 *    siempre la misma persona renumerada por el seguimiento.
 *  · El límite: al llegar, aviso a la guardia con la foto (con su enfriamiento); si sigue llena
 *    `escalarMin` minutos, un aviso más «avisar al supervisor», uno por episodio.
 * Todo se escribe en EventoVision (FILA cuando el aforo cambia, FILA_ENTRA / FILA_SALE, FILA_LLENA,
 * FILA_ESCALADA); Visión → Filas lo lee de ahí.
 */
/** Una misma pista no entra y sale dos veces en esto: el pie tiembla sobre el borde de la zona. */
const FILA_BORDE_MS = 4_000;
/** Cada cuánto se manda a la pantalla dónde está la gente de la fila (socket, sin guardar nada). */
const FILA_VIVO_MS = 1_000;
/** El límite de una fila que no lo tiene guardado: el mismo que propone la pantalla. */
const FILA_LIMITE_DEFECTO = 10;

/** La hora del barrio, para el horario de armado de cruce e intrusión. */
const ZONA = process.env.NEXT_PUBLIC_TZ || "America/Montevideo";

/**
 * Merodeo: lo que tiene que haber caminado la persona dentro de la zona (suma de los pasos del
 * pie, en fracciones del ancho del cuadro) para no ser alguien parado esperando. 0,6 es cruzar el
 * cuadro de lado a lado más de media vez.
 */
const MERODEO_RECORRIDO_MIN = 0.6;
const ENFRIO_MERODEO_MS = 2 * 60_000;
/**
 * Objeto retirado: cuánto tiene que estar quieto algo para que la regla lo «aprenda» (una
 * mochila que alguien lleva puesta no se aprende), cuánto se puede mover sin dejar de ser el
 * mismo (IoU con su caja aprendida) y en cuántos cuadros analizados seguidos tiene que faltar,
 * además de los segundos de la regla (un cuadro sin detectarlo es ruido del detector).
 */
const RETIRADO_ESTABLE_MS = 60_000;
const RETIRADO_IOU_MISMO = 0.35;
const RETIRADO_FALTAS_MIN = 5;
/** Una persona que tapa el objeto (su caja lo cubre en esta fracción) no es que el objeto se fue. */
const RETIRADO_TAPADO = 0.3;
const ENFRIO_RETIRADO_MS = 60_000;

/**
 * Animal en zona: entre dos avisos de la misma regla (un perro que entra y sale de la zona no
 * avisa cada vez).
 */
const ENFRIO_ANIMAL_MS = 2 * 60_000;
/**
 * Objeto dejado. Un bulto es «el mismo» mientras su caja se superpone con la primera en
 * DEJADO_IOU_MISMO: el que alguien lleva en la mano se corre y empieza de cero en cada cuadro,
 * así que nunca junta tiempo. El dueño «está al lado» si una persona toca la caja del bulto
 * agrandada DEJADO_DUENO veces su tamaño para cada lado. Lo ya avisado se olvida si no se lo ve
 * DEJADO_OLVIDO_MS (con la escena quieta se analiza una vez por minuto).
 */
const DEJADO_IOU_MISMO = 0.35;
const DEJADO_DUENO = 1.5;
const DEJADO_OLVIDO_MS = 3 * 60_000;
const ENFRIO_DEJADO_MS = 60_000;

/**
 * Fase 3 (19/10): las reglas que miran el CUERPO. Persona en el suelo y trepando piden la pose
 * del cuadro (otra inferencia, ~30 ms): se pide sólo con una persona en la zona y como mucho una
 * vez por cuadro y cámara, aunque haya varias reglas (POSE_* abajo).
 *
 * Suelo: la pose dice «acostada» (torso a más de 60° de la vertical, ver detector.py) con el
 * centro de la caja en la zona, `segundos` seguidos. Es la misma persona mientras su caja se
 * superpone SUELO_IOU con la anterior; no se la olvida hasta SUELO_OLVIDO_MS sin verla acostada,
 * porque a una persona tirada a veces no se le ven hombros y caderas y la postura sale vacía.
 */
const SUELO_IOU = 0.3;
const SUELO_OLVIDO_MS = 15_000;
const ENFRIO_SUELO_MS = 2 * 60_000;
/**
 * Trepando: las dos muñecas por encima de la línea de los hombros, a más de TREPA_MANOS largos de
 * torso, con la persona en la zona (dibujada sobre el cerco o el muro), `segundos` seguidos. Un
 * punto de la pose se usa si «se ve» en POSE_VISIBLE (el mismo PUNTO_VISIBLE de detector.py).
 * Alguien que saluda con los brazos arriba también lo cumple: por eso pide la zona y el tiempo.
 */
const TREPA_MANOS = 0.25;
const TREPA_OLVIDO_MS = 6_000;
const ENFRIO_TREPA_MS = 2 * 60_000;
const POSE_VISIBLE = 0.3;
/** Un error de la pose (apagada, omni-vision ocupado) se anota como mucho una vez por minuto. */
const POSE_AVISO_ERROR_MS = 60_000;
/**
 * Casco y chaleco: los atributos de SigLIP de cada persona (los mismos del registro). Se juntan
 * las lecturas NO dudosas de cada pista; avisa cuando lleva `segundos` en la zona, hay al menos
 * EPP_LECTURAS_MIN lecturas del elemento y EPP_FALTA de ellas dicen «no». Una sola lectura en
 * contra no alcanza: el recorte de una persona de espaldas o lejos se equivoca seguido.
 */
const EPP_LECTURAS_MIN = 3;
const EPP_FALTA = 0.6;
const ENFRIO_EPP_MS = 2 * 60_000;

const TIPO_AVISO = { SUELO: "VISION_SUELO", TREPA: "VISION_TREPA", EPP: "VISION_EPP", ANIMAL: "VISION_ANIMAL", DEJADO: "VISION_DEJADO", FILA_LLENA: "VISION_FILA", FILA_ESCALADA: "VISION_FILA", SENTIDO_CONTRARIO: "VISION_SENTIDO", PERMANENCIA: "VISION_PERMANENCIA", AGLOMERACION: "VISION_AGLOMERACION", CRUCE_LINEA: "VISION_CRUCE", INTRUSION: "VISION_INTRUSION", MERODEO: "VISION_MERODEO", RETIRADO: "VISION_RETIRADO" };
const NOMBRE_CLASE = { person: "persona", car: "auto", truck: "camioneta", bus: "ómnibus", motorcycle: "moto", bicycle: "bicicleta", dog: "perro",
    cat: "gato", horse: "caballo", cow: "vaca", sheep: "oveja",
    backpack: "mochila", handbag: "bolso", suitcase: "valija", chair: "silla", bench: "banco", "potted plant": "maceta" };
/** Para el texto del aviso: «se llevaron una bicicleta», «un bolso». */
const ARTICULO = { dog: "un", cat: "un", horse: "un", cow: "una", sheep: "una", bicycle: "una", motorcycle: "una", backpack: "una", suitcase: "una", chair: "una", "potted plant": "una", handbag: "un", bench: "un" };
/** Intersección sobre unión de dos cajas [x1,y1,x2,y2]. */
function iou(a, b) {
    const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])), iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
    const i = ix * iy, u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i;
    return u > 0 ? i / u : 0;
}
/** Qué fracción de la caja `a` cubre la caja `b`. */
function cubre(a, b) {
    const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])), iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
    const area = (a[2] - a[0]) * (a[3] - a[1]);
    return area > 0 ? (ix * iy) / area : 0;
}
const centro = (c) => [(c[0] + c[2]) / 2, (c[1] + c[3]) / 2];

const pie = (o) => { const [x1, , x2, y2] = o.caja_norm; return [(x1 + x2) / 2, y2]; };
const lado = (l, p) => (l.b[0] - l.a[0]) * (p[1] - l.a[1]) - (l.b[1] - l.a[1]) * (p[0] - l.a[0]);
/** ¿El segmento p→q corta el segmento a→b? */
function corta(p, q, a, b) {
    const o = (u, v, w) => (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]);
    const d1 = o(a, b, p), d2 = o(a, b, q), d3 = o(p, q, a), d4 = o(p, q, b);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
/** Punto dentro de un polígono (ray casting). */
/** Un auto que el detector llama «camioneta» al rato sigue siendo el mismo: se compara por grupo. */
const VEHICULOS = new Set(["car", "truck", "bus", "motorcycle"]);
function grupoDe(clase) { return VEHICULOS.has(clase) ? "vehiculo" : String(clase || ""); }
function adentro(p, zona) {
    let dentro = false;
    for (let i = 0, j = zona.length - 1; i < zona.length; j = i++) {
        const [xi, yi] = zona[i], [xj, yj] = zona[j];
        if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) dentro = !dentro;
    }
    return dentro;
}

/** Minuto del día en la hora del barrio. */
function minutoDelDia(d) {
    const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: ZONA, hour: "2-digit", minute: "2-digit", hour12: false }).format(d).split(":").map(Number);
    return (h % 24) * 60 + m;
}
/** La misma cuenta que enHorario en src/lib/vision-reglas.ts: si cambia allá, cambia acá. */
function enHorario(h, d) {
    if (!h || !h.desde || !h.hasta) return true;
    const m = (x) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3, 5));
    const a = m(h.desde), b = m(h.hasta), x = minutoDelDia(d);
    if (a === b) return true;
    return a < b ? x >= a && x < b : x >= a || x < b;
}

/**
 * La foto del aviso, MARCADA: la zona (o la línea) de la regla y la caja de quien la disparó.
 *
 * 19/10, Nico, con la alarma «Se quedó en la zona» de Prueba puesto 7: «cuando saca una captura,
 * no la saca bien, no se ve quién ocupa». La foto era el cuadro crudo: el auto estaba (caja
 * 0,42–0,51 × 0,09–0,17, arriba, entre otros estacionados) pero nada decía cuál era, y en una
 * escena con diez autos la foto no contesta la pregunta del aviso. La caja ya se guardaba en
 * EventoVision; la consola de alarmas, el WhatsApp y el push muestran sólo la foto. Por eso se
 * dibuja SOBRE la imagen: así viaja a cualquier lado y se entiende sola.
 *
 * El cuadro crudo se sigue guardando en EventoVision.foto cuando el evento tiene caja (Reglas,
 * Verificación y el entrenamiento la usan sin marcas); la marcada va al aviso. En la fila y la
 * aglomeración, que no guardan caja, la marcada es también la del evento.
 *
 * Los colores son los tokens del diseño pasados a hex (librsvg no entiende oklch):
 * --accion-en-oscuro, --aviso y --mal de globals.css. Si cambian allá, cambian acá.
 */
const COLOR_MARCA = { accion: "#49a9ff", aviso: "#db8d0f", mal: "#e32a4e" };
/** Una zona que cubre casi todo el cuadro no se dibuja: sería un marco alrededor de la foto. */
const ZONA_SIN_DIBUJO = 0.85;
const xml = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
function areaZona(z) {
    let a = 0;
    for (let i = 0, j = z.length - 1; i < z.length; j = i++) a += (z[j][0] + z[i][0]) * (z[j][1] - z[i][1]);
    return Math.abs(a / 2);
}
/** `marcas`: { zona?, linea?, cajas?: [{ caja, tono, texto? }], rotulo?: { texto, tono } }. */
async function marcar(jpeg, marcas) {
    const meta = await sharp(jpeg).metadata();
    const W = meta.width || 1920, H = meta.height || 1080;
    const trazo = Math.max(2, Math.round(W / 640)), letra = Math.max(13, Math.round(W / 70));
    const px = (p) => `${(p[0] * W).toFixed(1)},${(p[1] * H).toFixed(1)}`;
    const chip = (x, y, texto, tono) => {
        const ancho = Math.round(texto.length * letra * 0.58 + letra * 1.6), alto = Math.round(letra * 1.7);
        const cx = Math.max(0, Math.min(W - ancho, x)), cy = Math.max(0, Math.min(H - alto, y));
        return `<rect x="${cx}" y="${cy}" width="${ancho}" height="${alto}" rx="${Math.round(alto / 3)}" fill="rgba(10,12,16,0.78)"/>`
            + `<rect x="${cx + letra * 0.45}" y="${cy + alto * 0.3}" width="${letra * 0.4}" height="${alto * 0.4}" rx="${letra * 0.1}" fill="${COLOR_MARCA[tono] || COLOR_MARCA.aviso}"/>`
            + `<text x="${cx + letra * 1.15}" y="${cy + alto * 0.7}" font-family="Outfit, DejaVu Sans, Arial, sans-serif" font-size="${letra}" font-weight="600" fill="#fff">${xml(texto)}</text>`;
    };
    let svg = "";
    const zona = Array.isArray(marcas.zona) && marcas.zona.length >= 3 ? marcas.zona : null;
    if (zona && areaZona(zona) < ZONA_SIN_DIBUJO) {
        const pts = zona.map(px).join(" ");
        svg += `<polygon points="${pts}" fill="${COLOR_MARCA.accion}" fill-opacity="0.10" stroke="rgba(0,0,0,0.55)" stroke-width="${trazo * 2.5}"/>`
            + `<polygon points="${pts}" fill="none" stroke="${COLOR_MARCA.accion}" stroke-width="${trazo}" stroke-dasharray="${trazo * 5} ${trazo * 3}"/>`;
    }
    if (marcas.linea?.a && marcas.linea?.b) {
        const [a, b] = [marcas.linea.a, marcas.linea.b].map(px);
        svg += `<polyline points="${a} ${b}" stroke="rgba(0,0,0,0.55)" stroke-width="${trazo * 3}" fill="none"/>`
            + `<polyline points="${a} ${b}" stroke="${COLOR_MARCA.accion}" stroke-width="${trazo * 1.5}" fill="none"/>`;
    }
    for (const c of marcas.cajas || []) {
        if (!Array.isArray(c.caja)) continue;
        // Un poco más grande que la caja: que el borde no tape al que se está señalando.
        const m = 0.006, [x1, y1, x2, y2] = [c.caja[0] - m, c.caja[1] - m, c.caja[2] + m, c.caja[3] + m].map((v, i) => Math.max(0, Math.min(1, v)) * (i % 2 ? H : W));
        const color = COLOR_MARCA[c.tono] || COLOR_MARCA.aviso;
        svg += `<rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" rx="${trazo * 2}" fill="none" stroke="rgba(0,0,0,0.6)" stroke-width="${trazo * 3}"/>`
            + `<rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" rx="${trazo * 2}" fill="none" stroke="${color}" stroke-width="${trazo * 1.5}"/>`;
        if (c.texto) svg += chip(x1, y1 - letra * 1.7 - trazo * 2 >= 0 ? y1 - letra * 1.7 - trazo * 2 : y2 + trazo * 2, c.texto, c.tono);
    }
    if (marcas.rotulo?.texto) {
        // El rótulo de toda la escena (la fila, la aglomeración): arriba del vértice más alto de la zona.
        const tope = zona ? zona.reduce((a, p) => (p[1] < a[1] ? p : a)) : [0.02, 0.06];
        svg += chip(tope[0] * W, tope[1] * H - letra * 2.2, marcas.rotulo.texto, marcas.rotulo.tono);
    }
    if (!svg) return jpeg;
    return sharp(jpeg).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${svg}</svg>`), top: 0, left: 0 }]).jpeg({ quality: 85 }).toBuffer();
}
/** Cómo terminó una estadía con aviso (ver cerrarAvisoEstadia). */
const COMO_TERMINO = { salio: "salió de la zona", "no-se-ve": "dejó de verse", reinicio: "se dejó de seguir (se reinició el análisis)" };
/** «40 s», «23 min», «1 h 05 min». */
const duracion = (seg) => { if (seg < 60) return `${Math.round(seg)} s`; const m = Math.round(seg / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`; };
const hhmm = (d) => d.toLocaleTimeString("es-UY", { timeZone: process.env.NEXT_PUBLIC_TZ || "America/Montevideo", hour: "2-digit", minute: "2-digit", hour12: false });
/** Cuánto lleva, para el rótulo de la caja: «15 min», «40 s». */
const lleva = (seg) => (seg >= 60 ? `${Math.round(seg / 60)} min` : `${Math.round(seg)} s`);
const nombreDe = (clase) => { const n = NOMBRE_CLASE[clase] || String(clase || "").replace(/^propio:.*/, "objeto"); return n.charAt(0).toUpperCase() + n.slice(1); };

function emitir(evento, datos) {
    try {
        const cuerpo = JSON.stringify({ __event: evento, ...datos });
        const req = http.request({ hostname: "127.0.0.1", port: Number(process.env.WEBHOOK_PORT || 10000), path: "/internal/emit", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(cuerpo) }, timeout: 2000 });
        req.on("error", () => { }); req.on("timeout", () => req.destroy());
        req.write(cuerpo); req.end();
    } catch { }
}

function iniciar({ prisma, subir, log, pose }) {
    let reglas = [];
    let analiticas = {};
    const contadores = { cruces: 0, sentido: 0, permanencia: 0, aglomeracion: 0, filas: 0, crucesPropios: 0, intrusiones: 0, merodeos: 0, retirados: 0, aprendidos: 0, avisos: 0, errores: 0, ultimoError: null };
    /** Último pie visto de cada pista: `${deviceId}:${pista}` → { p, t }. */
    const pies = new Map();
    /** Por regla y pista: último cruce { t, sentido }. */
    const cruces = new Map();
    /** Permanencia: `${regla}:${pista}` → { desde, visto, eventoId, avisoId, clase, caja, llegada, quieto, ref, refT, … }. */
    const estadias = new Map();
    /** Permanencia que dejó de verse, en suspenso hasta REENGANCHE_MS: regla → [estadía]. */
    const perdidas = new Map();
    /** Permanencia cerrada por «dejó de verse», recordada MEMORIA_LUGAR_MS: regla → [estadía]. */
    const idas = new Map();
    /** Aglomeración: regla → { desde, ultimoAviso }. */
    const grupos = new Map();
    const ultimoAvisoSentido = new Map();
    /** Intrusión: `${regla}:${pista}` → { desde, visto, avisado, deviceId }. */
    const intrusos = new Map();
    const ultimoAvisoCruce = new Map();
    const ultimoAvisoIntrusion = new Map();
    /** Merodeo: `${regla}:${pista}` → { desde, visto, recorrido, ultimo, avisado, deviceId }. */
    const merodeos = new Map();
    const ultimoAvisoMerodeo = new Map();
    /** Objeto retirado, por regla: lo aprendido en la zona → [{ clase, caja, desde, visto, faltas, jpeg, estable }]. */
    const aprendidos = new Map();
    const ultimoAvisoRetirado = new Map();
    /** Animal en zona: `${regla}:${pista}` → { desde, visto, avisado, deviceId }. */
    const animales = new Map();
    const ultimoAvisoAnimal = new Map();
    /** Objeto dejado, por regla: { lista: [{ clase, caja, desde, visto, avisado }] } (ver DEJADO_*). */
    const dejados = new Map();
    const ultimoAvisoDejado = new Map();
    /** Persona en el suelo / trepando, por regla: [{ caja, desde, visto, avisado }]. */
    const suelos = new Map();
    const trepadas = new Map();
    const ultimoAvisoSuelo = new Map();
    const ultimoAvisoTrepa = new Map();
    /** Casco y chaleco: `${regla}:${pista}` → { desde, visto, avisado, deviceId, si: {casco, chaleco}, no: {…} }. */
    const epps = new Map();
    const ultimoAvisoEpp = new Map();
    /** La pose del último cuadro de cada cámara: { t, objetos } (una inferencia por cuadro, la compartan las reglas que sea). */
    const poses = new Map();
    let poseError = 0;
    /**
     * Conteo de fila, por regla: { aceptado, candidato, desde, llenoDesde, ultimoAviso, escalado,
     * pistas: pista → { dentro, visto, cambio } }.
     */
    const filas = new Map();

    // Retirada no corre aunque la regla o la analítica estén prendidas (ver TIPOS_RETIRADOS en src/lib/vision-reglas.ts).
    const prendida = (r) => !RETIRADAS.has(r.tipo) && r.activa !== false && (analiticas[ANALITICA[r.tipo]] ?? DEFECTO[ANALITICA[r.tipo]]) !== false;

    function cargar(lista, an) {
        reglas = Array.isArray(lista) ? lista.filter((r) => r && r.deviceId && ANALITICA[r.tipo]) : [];
        analiticas = an || {};
    }
    /** Cámaras que hay que mirar por las reglas, aunque el registro esté apagado o no las incluya. */
    function camaras() { return new Set(reglas.filter(prendida).map((r) => r.deviceId)); }
    /** Cámaras con reglas de LÍNEA prendidas: necesitan el carril rápido (ver RAPIDO_FPS en vision-worker). */
    function camarasRapidas() { return new Set(reglas.filter((r) => prendida(r) && (r.tipo === "conteo" || r.tipo === "sentido" || r.tipo === "cruce")).map((r) => r.deviceId)); }
    /** Si hay algo en curso en esa cámara (alguien adentro de una zona): se mira aunque la imagen no cambie. */
    function enCurso(deviceId) {
        if (!reglas.some((r) => r.deviceId === deviceId && prendida(r))) return false;
        // Algo que se MOVIÓ hace poco en una cámara con reglas: se sigue mirando para no perder el
        // cruce. Que se mueva, no que esté: un auto estacionado en el cuadro lo dejaba analizando a
        // 4 c/s todo el día (9/10, LPR Interior: 430 cuadros seguidos por un auto quieto).
        const ahora = Date.now();
        for (const [k, v] of pies) if (k.startsWith(deviceId + ":") && ahora - v.t < OLVIDO_MS && ahora - (v.mov || 0) < OLVIDO_MS) return true;
        for (const r of reglas) {
            if (r.deviceId !== deviceId || !prendida(r)) continue;
            if (r.tipo === "aglomeracion" && grupos.get(r.id)?.desde) return true;
            // Un número de la fila esperando su rebote: si la imagen queda quieta y no se mira
            // más, el cambio no se confirma nunca. Y con gente en la fila, se sigue mirando.
            if (r.tipo === "fila") { const f = filas.get(r.id); if (f && (f.candidato !== f.aceptado || f.aceptado > 0)) return true; }
            if (r.tipo === "permanencia") { for (const k of estadias.keys()) if (k.startsWith(r.id + ":")) return true; if ((perdidas.get(r.id) || []).length) return true; }
            if (r.tipo === "intrusion") for (const k of intrusos.keys()) if (k.startsWith(r.id + ":")) return true;
            if (r.tipo === "merodeo") for (const k of merodeos.keys()) if (k.startsWith(r.id + ":")) return true;
            if (r.tipo === "animal") for (const [k, v] of animales) if (k.startsWith(r.id + ":") && !v.avisado) return true;
            // Un bulto nuevo juntando tiempo: si la escena queda quieta se analizaría una vez por minuto.
            if (r.tipo === "dejado" && (dejados.get(r.id)?.lista || []).some((a) => !a.avisado)) return true;
            if (r.tipo === "suelo" && (suelos.get(r.id) || []).some((a) => !a.avisado)) return true;
            if (r.tipo === "trepar" && (trepadas.get(r.id) || []).some((a) => !a.avisado)) return true;
            if (r.tipo === "epp") for (const [k, v] of epps) if (k.startsWith(r.id + ":") && !v.avisado) return true;
            // Algo aprendido que está faltando: se mira seguido hasta decidir si se lo llevaron.
            if (r.tipo === "retirado" && (aprendidos.get(r.id) || []).some((a) => a.estable && a.faltas > 0)) return true;
        }
        return false;
    }

    async function foto(jpeg, ahora) {
        const clave = `eventos/${ahora.toISOString().slice(0, 10)}/${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}.jpg`;
        try { await subir(clave, jpeg); return clave; } catch (e) { log("reglas: no se pudo guardar la foto:", e.message); return null; }
    }

    /** La foto marcada (ver `marcar`); si algo falla, la cruda: un aviso sin marcas es mejor que sin foto. */
    async function fotoMarcada(jpeg, ahora, marcas) {
        try { return await foto(await marcar(jpeg, marcas), ahora); }
        catch (e) { log("reglas: no se pudo marcar la foto:", e.message); return foto(jpeg, ahora); }
    }
    /** Para el aviso: la marcada, sólo si la regla avisa (si no, nadie la va a ver). */
    async function fotoDelAviso(r, jpeg, ahora, marcas, cruda) {
        return r.avisar ? fotoMarcada(jpeg, ahora, marcas) : cruda;
    }

    async function avisar(r, tipoEvento, motivo, eventoId, fotoClave, cam, extra = {}) {
        if (!r.avisar) return null;
        try {
            const aviso = await prisma.avisoGuardia.create({ data: { tipo: TIPO_AVISO[tipoEvento], motivo, camara: cam.name, datos: { reglaId: r.id, regla: r.nombre, eventoId, foto: fotoClave, ...extra } } });
            await prisma.eventoVision.update({ where: { id: eventoId }, data: { avisoId: aviso.id } }).catch(() => null);
            emitir("aviso_guardia", { accion: "nuevo", aviso });
            contadores.avisos++;
            return aviso;
        } catch (e) { contadores.errores++; contadores.ultimoError = `aviso: ${e.message}`; return null; }
    }

    async function evento(datos) {
        return prisma.eventoVision.create({ data: datos });
    }

    /** Lo que vio omni-vision en un cuadro de esa cámara. `objetos` con pista y caja_norm. */
    async function procesar(cam, objetos, jpeg, ahora) {
        const mias = reglas.filter((r) => r.deviceId === cam.id && prendida(r));
        const t = ahora.getTime();
        const conPista = objetos.filter((o) => o.pista != null && Array.isArray(o.caja_norm));
        if (mias.length) {
            for (const r of mias) {
                try {
                    const valen = conPista.filter((o) => r.clases.includes(o.clase));
                    if (r.tipo === "conteo" || r.tipo === "sentido" || r.tipo === "cruce") await lineas(r, cam, valen, jpeg, ahora, t);
                    else if (r.tipo === "intrusion") await intrusion(r, cam, valen, jpeg, ahora, t);
                    else if (r.tipo === "merodeo") await merodeo(r, cam, valen, jpeg, ahora, t);
                    else if (r.tipo === "animal") await animal(r, cam, valen, objetos, jpeg, ahora, t);
                    // Dejado no usa la pista (un bulto quieto puede cambiar de número), como retirado.
                    else if (r.tipo === "dejado") await dejado(r, cam, objetos, jpeg, ahora, t);
                    else if (r.tipo === "suelo" || r.tipo === "trepar") await cuerpo(r, cam, valen, jpeg, ahora, t);
                    else if (r.tipo === "epp") await epp(r, cam, valen, jpeg, ahora, t);
                    // Retirado mira también a las personas (para saber si tapan lo aprendido).
                    else if (r.tipo === "retirado") await retirado(r, cam, objetos, jpeg, ahora, t);
                    else if (r.tipo === "permanencia") await permanencia(r, cam, valen, jpeg, ahora, t);
                    else if (r.tipo === "aglomeracion") await aglomeracion(r, cam, valen, jpeg, ahora, t);
                    // La fila cuenta a todos los que se ven, tengan número de pista o no: el que
                    // está quieto en la fila es justo el que el seguimiento a veces renumera.
                    else if (r.tipo === "fila") await fila(r, cam, objetos.filter((o) => r.clases.includes(o.clase) && Array.isArray(o.caja_norm)), jpeg, ahora, t);
                } catch (e) { contadores.errores++; contadores.ultimoError = `${r.nombre}: ${e.message}`; }
            }
        }
        // El pie de cada pista, para el próximo cuadro (aunque hoy no haya reglas: si se crea una, ya tiene de dónde partir).
        for (const o of conPista) {
            const k = `${cam.id}:${o.pista}`, ant = pies.get(k), p = pie(o);
            // `mov`: la última vez que el pie se corrió más de MOVIMIENTO_MIN desde donde estaba.
            const se_movio = !ant || Math.hypot(p[0] - ant.ref[0], p[1] - ant.ref[1]) > MOVIMIENTO_MIN;
            pies.set(k, { p, t, ref: se_movio ? p : ant.ref, mov: se_movio ? t : ant.mov });
        }
        // Olvido de lo viejo.
        for (const [k, v] of pies) if (t - v.t > OLVIDO_MS * 3) pies.delete(k);
        for (const [k, v] of cruces) if (t - v.t > OLVIDO_MS * 3) cruces.delete(k);
        for (const [k, v] of intrusos) if (v.deviceId === cam.id && t - v.visto > OLVIDO_MS) intrusos.delete(k);
        for (const [k, v] of merodeos) if (v.deviceId === cam.id && t - v.visto > OLVIDO_MS) merodeos.delete(k);
        for (const [k, v] of animales) if (v.deviceId === cam.id && t - v.visto > OLVIDO_MS) animales.delete(k);
        for (const [k, v] of epps) if (v.deviceId === cam.id && t - v.visto > OLVIDO_MS) epps.delete(k);
        await cerrarEstadias(cam, t, false);
    }

    async function lineas(r, cam, valen, jpeg, ahora, t) {
        for (const o of valen) {
            const antes = pies.get(`${cam.id}:${o.pista}`);
            if (!antes || t - antes.t > OLVIDO_MS) continue;
            const ahoraP = pie(o);
            if (!corta(antes.p, ahoraP, r.linea.a, r.linea.b)) continue;
            const sentido = lado(r.linea, ahoraP) > 0 ? "ab" : "ba";
            const k = `${r.id}:${cam.id}:${o.pista}`;
            const previo = cruces.get(k);
            if (previo && previo.sentido === sentido && t - previo.t < REBOTE_MS * 6) continue; // el mismo cruce visto dos veces
            if (previo && t - previo.t < REBOTE_MS) { cruces.set(k, { t, sentido }); continue; } // tiembla sobre la línea
            cruces.set(k, { t, sentido });
            if (r.tipo === "conteo") {
                // Los vehículos llevan foto: en un acceso, el cruce que no tuvo lectura (OmniVision ›
                // Accesos) sin foto no se puede revisar. Las personas siguen sin foto: son muchas y
                // en un conteo no se miran una por una.
                const f = o.grupo === "vehiculo" ? await foto(jpeg, ahora) : null;
                await evento({ tipo: "CRUCE", reglaId: r.id, deviceId: cam.id, camara: cam.name, clase: o.clase, pista: o.pista, sentido, ts: ahora, ...(f ? { foto: f, caja: o.caja_norm } : {}) });
                contadores.cruces++;
            } else if (r.tipo === "cruce") {
                // Fuera de horario, o en el sentido que no interesa: no pasó nada para esta regla.
                if ((r.sentidos && r.sentidos !== "ambos" && sentido !== r.sentidos) || !enHorario(r.horario, ahora)) continue;
                const f = await foto(jpeg, ahora);
                const ev = await evento({ tipo: "CRUCE_LINEA", reglaId: r.id, deviceId: cam.id, camara: cam.name, clase: o.clase, pista: o.pista, sentido, foto: f, caja: o.caja_norm, ts: ahora });
                contadores.crucesPropios++;
                if (t - (ultimoAvisoCruce.get(r.id) || 0) > ENFRIO_CRUCE_MS) {
                    ultimoAvisoCruce.set(r.id, t);
                    await avisar(r, "CRUCE_LINEA", `${NOMBRE_CLASE[o.clase] || o.clase} cruzó ${r.nombre}`, ev.id,
                        await fotoDelAviso(r, jpeg, ahora, { linea: r.linea, cajas: [{ caja: o.caja_norm, tono: "aviso", texto: nombreDe(o.clase) }] }, f), cam);
                }
            } else if (sentido !== r.permitido) {
                const f = await foto(jpeg, ahora);
                const ev = await evento({ tipo: "SENTIDO_CONTRARIO", reglaId: r.id, deviceId: cam.id, camara: cam.name, clase: o.clase, pista: o.pista, sentido, foto: f, caja: o.caja_norm, ts: ahora });
                contadores.sentido++;
                if (t - (ultimoAvisoSentido.get(r.id) || 0) > ENFRIO_SENTIDO_MS) {
                    ultimoAvisoSentido.set(r.id, t);
                    await avisar(r, "SENTIDO_CONTRARIO", `${NOMBRE_CLASE[o.clase] || o.clase} en sentido contrario · ${r.nombre}`, ev.id,
                        await fotoDelAviso(r, jpeg, ahora, { linea: r.linea, cajas: [{ caja: o.caja_norm, tono: "mal", texto: `${nombreDe(o.clase)} · contramano` }] }, f), cam);
                }
            }
        }
    }

    /** La estadía en suspenso o recordada que ocupa ese lugar, si hay; la saca de su lista. */
    function reenganchar(lista, regla, caja, clase, t, ventana) {
        const xs = lista.get(regla) || [];
        let mejor = -1, val = PERM_IOU;
        xs.forEach((e, i) => {
            if (t - e.visto > ventana || !e.caja) return;
            if (grupoDe(e.clase) !== grupoDe(clase)) return;
            const v = iou(e.caja, caja);
            if (v >= val) { val = v; mejor = i; }
        });
        if (mejor < 0) return null;
        const [e] = xs.splice(mejor, 1);
        return e;
    }

    async function permanencia(r, cam, valen, jpeg, ahora, t) {
        for (const o of valen) {
            const k = `${r.id}:${o.pista}`;
            const p = pie(o);
            const dentro = adentro(p, r.zona);
            let e = estadias.get(k);
            if (!dentro) { if (e) { e.visto = t; e.fuera = true; } continue; }
            if (!e) {
                // ¿Se lo vio llegar? La pista se vio antes afuera de la zona, o venía moviéndose.
                const ant = pies.get(`${cam.id}:${o.pista}`);
                const llego = !!ant && t - ant.t < OLVIDO_MS && (!adentro(ant.p, r.zona) || t - (ant.mov || 0) < OLVIDO_MS);
                // Algo quieto que aparece donde había una estadía: es la misma, que se había perdido.
                e = llego ? null : reenganchar(perdidas, r.id, o.caja_norm, o.clase, t, REENGANCHE_MS);
                if (!e && !llego) {
                    e = reenganchar(idas, r.id, o.caja_norm, o.clase, t, MEMORIA_LUGAR_MS);
                    if (e) await reabrirAvisoEstadia(e, r);
                }
                if (!e) e = { desde: t, visto: t, eventoId: null, avisoId: null, clase: o.clase, deviceId: cam.id, camara: cam.name, regla: r.nombre, reglaId: r.id, fuera: false, llegada: llego, quieto: null, ref: p, refT: t, caja: o.caja_norm, vivo: 0 };
                estadias.set(k, e);
            }
            e.visto = t; e.fuera = false; e.caja = o.caja_norm;
            // Cuándo dejó de moverse: el pie se queda (QUIETO_DESPLAZ) QUIETO_MS seguidos.
            if (Math.hypot(p[0] - e.ref[0], p[1] - e.ref[1]) > QUIETO_DESPLAZ) { e.ref = p; e.refT = t; if (e.quieto) e.quieto = null; }
            else if (!e.quieto && t - e.refT >= QUIETO_MS) {
                e.quieto = e.refT;
                if (e.avisoId) await completarDatosAviso(e.avisoId, { quieto: new Date(e.quieto).toISOString() });
            }
            const seg = (t - e.desde) / 1000;
            if (!e.eventoId && seg >= r.segundos) {
                const f = await foto(jpeg, ahora);
                const ev = await evento({ tipo: "PERMANENCIA", reglaId: r.id, deviceId: cam.id, camara: cam.name, clase: o.clase, pista: o.pista, valor: Math.round(seg), foto: f, caja: o.caja_norm, ts: new Date(e.desde) });
                e.eventoId = ev.id;
                contadores.permanencia++;
                // «lleva», no «hace»: «auto hace 15 min» se leía como «pasó hace 15 min» (20/10, Nico:
                // «no comprendo mucho el se quedó y ese timer»). Con `desde`, el panel cuenta en vivo
                // cuánto lleva; al irse, cerrarEstadias completa el aviso con cuándo y cuánto fue.
                // `llegada`, `quieto`, la caja y la zona: para el clip de la maniobra y el dibujo en vivo.
                const aviso = await avisar(r, "PERMANENCIA", `${nombreDe(o.clase)} lleva ${duracion(seg)} en ${r.nombre}`, ev.id,
                    await fotoDelAviso(r, jpeg, ahora, { zona: r.zona, cajas: [{ caja: o.caja_norm, tono: "aviso", texto: `${nombreDe(o.clase)} · ${lleva(seg)}` }] }, f), cam,
                    { desde: new Date(e.desde).toISOString(), umbral: r.segundos, llegada: e.llegada, quieto: e.quieto ? new Date(e.quieto).toISOString() : null, caja: o.caja_norm, zona: r.zona, clase: o.clase, fotoCruda: f });
                if (aviso) e.avisoId = aviso.id;
            }
            // En vivo: dónde está y desde cuándo, para dibujar la caja con su reloj sobre la cámara.
            if (e.avisoId && t - e.vivo >= PERM_VIVO_MS) {
                e.vivo = t;
                emitir("vision_estadia", { avisoId: e.avisoId, deviceId: cam.id, caja: e.caja, desde: new Date(e.desde).toISOString(), visto: new Date(t).toISOString(), quieto: e.quieto ? new Date(e.quieto).toISOString() : null });
            }
        }
    }

    async function completarDatosAviso(avisoId, mas) {
        try {
            const previo = await prisma.avisoGuardia.findUnique({ where: { id: avisoId }, select: { datos: true } });
            if (previo) await prisma.avisoGuardia.update({ where: { id: avisoId }, data: { datos: { ...(previo.datos || {}), ...mas } } });
        } catch { }
    }

    /**
     * El mismo auto que se había dado por ido («dejó de verse») vuelve a tomarse en el mismo lugar:
     * no se fue, lo perdió el detector. Se reabre su aviso (sin hasta, con la bitácora diciéndolo)
     * en vez de abrir otro que diría «llegó ahora» de un auto que lleva horas ahí.
     */
    async function reabrirAvisoEstadia(e, r) {
        if (!e.avisoId) return;
        try {
            const previo = await prisma.avisoGuardia.findUnique({ where: { id: e.avisoId }, select: { datos: true } });
            if (!previo) return;
            const { hasta: _h, segundos: _s, como: _c, ...resto } = previo.datos || {};
            await prisma.avisoGuardia.update({ where: { id: e.avisoId }, data: {
                motivo: `${nombreDe(e.clase)} lleva ${duracion((Date.now() - e.desde) / 1000)} en ${r.nombre}`,
                datos: { ...resto, reabierta: (resto.reabierta || 0) + 1 },
            } });
            await prisma.alarmaGestion.create({ data: { clave: `a:${e.avisoId}`, accion: "VOLVIO", por: e.camara || "OmniVision", deviceId: e.deviceId, detalle: "volvió a verse en el mismo lugar: no se había ido" } });
            emitir("alarma_gestion", { clave: `a:${e.avisoId}`, accion: "VOLVIO" });
            emitir("aviso_guardia", { accion: "actualizado", id: e.avisoId });
        } catch (err) { contadores.errores++; contadores.ultimoError = `reabrir estadía: ${err.message}`; }
    }

    /** Intrusión: un objeto con el pie adentro de la zona `segundos` seguidos, en horario. Una vez por pista. */
    async function intrusion(r, cam, valen, jpeg, ahora, t) {
        const armada = enHorario(r.horario, ahora);
        for (const o of valen) {
            const k = `${r.id}:${o.pista}`;
            if (!armada || !adentro(pie(o), r.zona)) { intrusos.delete(k); continue; }
            let e = intrusos.get(k);
            if (!e) { e = { desde: t, visto: t, avisado: false, deviceId: cam.id }; intrusos.set(k, e); }
            e.visto = t;
            if (e.avisado || (t - e.desde) / 1000 < (r.segundos ?? 2)) continue;
            e.avisado = true;
            const f = await foto(jpeg, ahora);
            const ev = await evento({ tipo: "INTRUSION", reglaId: r.id, deviceId: cam.id, camara: cam.name, clase: o.clase, pista: o.pista, valor: Math.round((t - e.desde) / 1000), foto: f, caja: o.caja_norm, ts: new Date(e.desde) });
            contadores.intrusiones++;
            if (t - (ultimoAvisoIntrusion.get(r.id) || 0) > ENFRIO_INTRUSION_MS) {
                ultimoAvisoIntrusion.set(r.id, t);
                await avisar(r, "INTRUSION", `${NOMBRE_CLASE[o.clase] || o.clase} en ${r.nombre}`, ev.id,
                    await fotoDelAviso(r, jpeg, ahora, { zona: r.zona, cajas: [{ caja: o.caja_norm, tono: "mal", texto: nombreDe(o.clase) }] }, f), cam);
            }
        }
    }

    /**
     * Merodeo: una pista con el pie en la zona (o en el cuadro, si la regla no tiene zona) más de
     * `segundos`, que además CAMINÓ (MERODEO_RECORRIDO_MIN): parado esperando es permanencia, no
     * merodeo. En horario. Una vez por pista.
     */
    async function merodeo(r, cam, valen, jpeg, ahora, t) {
        const armada = enHorario(r.horario, ahora);
        for (const o of valen) {
            const k = `${r.id}:${o.pista}`;
            const p = pie(o);
            if (!armada || (r.zona && !adentro(p, r.zona))) { merodeos.delete(k); continue; }
            let e = merodeos.get(k);
            if (!e) { e = { desde: t, visto: t, recorrido: 0, ultimo: p, avisado: false, deviceId: cam.id }; merodeos.set(k, e); }
            e.recorrido += Math.hypot(p[0] - e.ultimo[0], p[1] - e.ultimo[1]);
            e.ultimo = p; e.visto = t;
            if (e.avisado || (t - e.desde) / 1000 < r.segundos || e.recorrido < MERODEO_RECORRIDO_MIN) continue;
            e.avisado = true;
            const f = await foto(jpeg, ahora);
            const seg = Math.round((t - e.desde) / 1000);
            const ev = await evento({ tipo: "MERODEO", reglaId: r.id, deviceId: cam.id, camara: cam.name, clase: o.clase, pista: o.pista, valor: seg, foto: f, caja: o.caja_norm, ts: new Date(e.desde) });
            contadores.merodeos++;
            if (t - (ultimoAvisoMerodeo.get(r.id) || 0) > ENFRIO_MERODEO_MS) {
                ultimoAvisoMerodeo.set(r.id, t);
                await avisar(r, "MERODEO", `${NOMBRE_CLASE[o.clase] || o.clase} dando vueltas hace ${seg >= 60 ? `${Math.floor(seg / 60)} min` : `${seg} s`} en ${r.nombre}`, ev.id,
                    await fotoDelAviso(r, jpeg, ahora, { zona: r.zona, cajas: [{ caja: o.caja_norm, tono: "aviso", texto: `${nombreDe(o.clase)} · ${lleva(seg)}` }] }, f), cam);
            }
        }
    }

    /**
     * Objeto retirado. Lo que está quieto en la zona RETIRADO_ESTABLE_MS se aprende (con el
     * último cuadro donde se lo vio). Si falta `segundos` y RETIRADO_FALTAS_MIN cuadros seguidos,
     * sin una persona tapándolo, se avisa con la foto de antes y la de después. No usa la pista
     * (un objeto quieto puede cambiar de número): lo reconoce por clase y por dónde está.
     */
    async function retirado(r, cam, todos, jpeg, ahora, t) {
        const lista = aprendidos.get(r.id) || [];
        const enZona = todos.filter((o) => r.clases.includes(o.clase) && Array.isArray(o.caja_norm) && adentro(centro(o.caja_norm), r.zona));
        const personas = todos.filter((o) => o.grupo === "persona" && Array.isArray(o.caja_norm));
        const usados = new Set();
        for (const a of lista) {
            const i = enZona.findIndex((o, j) => !usados.has(j) && o.clase === a.clase && iou(o.caja_norm, a.caja) >= RETIRADO_IOU_MISMO);
            if (i >= 0) {
                usados.add(i);
                a.visto = t; a.faltas = 0;
                if (!a.estable && t - a.desde >= RETIRADO_ESTABLE_MS) { a.estable = true; contadores.aprendidos++; }
                if (a.estable) a.jpeg = jpeg; // el «antes» es el último cuadro donde estaba
                continue;
            }
            // No se lo ve. Si una persona lo tapa, no es que se fue.
            if (personas.some((p) => cubre(a.caja, p.caja_norm) >= RETIRADO_TAPADO)) continue;
            a.faltas++;
        }
        // Lo nuevo en la zona empieza a aprenderse.
        enZona.forEach((o, j) => { if (!usados.has(j)) lista.push({ clase: o.clase, caja: o.caja_norm, desde: t, visto: t, faltas: 0, jpeg: null, estable: false }); });
        // Lo que faltó lo suficiente: si estaba aprendido y la regla está armada, avisa; si no, se olvida.
        const quedan = [];
        for (const a of lista) {
            const falta = (t - a.visto) / 1000;
            if (a.faltas < RETIRADO_FALTAS_MIN || falta < r.segundos) { quedan.push(a); continue; }
            if (!a.estable || !enHorario(r.horario, ahora)) continue;
            const [fAntes, fDespues] = await Promise.all([a.jpeg ? foto(a.jpeg, ahora) : null, foto(jpeg, ahora)]);
            const ev = await evento({ tipo: "RETIRADO", reglaId: r.id, deviceId: cam.id, camara: cam.name, clase: a.clase, valor: Math.round((a.visto - a.desde) / 1000), foto: fDespues, fotoAntes: fAntes, caja: a.caja, ts: new Date(a.visto) });
            contadores.retirados++;
            if (t - (ultimoAvisoRetirado.get(r.id) || 0) > ENFRIO_RETIRADO_MS) {
                ultimoAvisoRetirado.set(r.id, t);
                await avisar(r, "RETIRADO", `Se llevaron ${ARTICULO[a.clase] || "un"} ${NOMBRE_CLASE[a.clase] || a.clase} de ${r.nombre}`, ev.id,
                    await fotoDelAviso(r, jpeg, ahora, { zona: r.zona, cajas: [{ caja: a.caja, tono: "mal", texto: `Acá estaba ${ARTICULO[a.clase] || "un"} ${NOMBRE_CLASE[a.clase] || a.clase}` }] }, fDespues), cam);
            }
        }
        aprendidos.set(r.id, quedan);
    }

    /**
     * Animal en zona (catálogo «Animal en zona»): un perro, gato, caballo, vaca u oveja con el pie
     * en la zona `segundos` seguidos, en horario y —salvo que la regla diga lo contrario— sin
     * ninguna persona en la zona: el perro que pasea con su dueño no está suelto. Una vez por pista.
     */
    async function animal(r, cam, valen, todos, jpeg, ahora, t) {
        const armada = enHorario(r.horario, ahora);
        const conGente = r.sinPersona !== false && todos.some((o) => o.grupo === "persona" && Array.isArray(o.caja_norm) && adentro(pie(o), r.zona));
        for (const o of valen) {
            const k = `${r.id}:${o.pista}`;
            if (!armada || !adentro(pie(o), r.zona)) { animales.delete(k); continue; }
            let e = animales.get(k);
            if (!e) { e = { desde: t, visto: t, avisado: false, deviceId: cam.id }; animales.set(k, e); }
            e.visto = t;
            // Con una persona en la zona no avisa, pero el tiempo sigue corriendo: si se va, avisa.
            if (e.avisado || conGente || (t - e.desde) / 1000 < (r.segundos ?? 3)) continue;
            e.avisado = true;
            const f = await foto(jpeg, ahora);
            const seg = Math.round((t - e.desde) / 1000);
            const ev = await evento({ tipo: "ANIMAL", reglaId: r.id, deviceId: cam.id, camara: cam.name, clase: o.clase, pista: o.pista, valor: seg, foto: f, caja: o.caja_norm, ts: new Date(e.desde) });
            contadores.animales = (contadores.animales || 0) + 1;
            if (t - (ultimoAvisoAnimal.get(r.id) || 0) > ENFRIO_ANIMAL_MS) {
                ultimoAvisoAnimal.set(r.id, t);
                await avisar(r, "ANIMAL", `${nombreDe(o.clase)} suelto en ${r.nombre}`, ev.id,
                    await fotoDelAviso(r, jpeg, ahora, { zona: r.zona, cajas: [{ caja: o.caja_norm, tono: "aviso", texto: `${nombreDe(o.clase)} · ${lleva(seg)}` }] }, f), cam);
            }
        }
    }

    /**
     * Objeto dejado (catálogo «Objetos dejados»): un bulto que APARECE en la zona, se queda quieto
     * `segundos` y no tiene a nadie al lado. Lo que ya estaba la primera vez que la regla mira la
     * cámara (al crearla o al arrancar el worker) no cuenta: si no, cada reinicio avisaría por la
     * maceta de siempre. Reconoce el bulto por clase y por dónde está, como retirado.
     */
    async function dejado(r, cam, todos, jpeg, ahora, t) {
        const enZona = todos.filter((o) => r.clases.includes(o.clase) && Array.isArray(o.caja_norm) && adentro(centro(o.caja_norm), r.zona));
        let d = dejados.get(r.id);
        if (!d) {
            dejados.set(r.id, { lista: enZona.map((o) => ({ clase: o.clase, caja: o.caja_norm, desde: t, visto: t, avisado: true })) });
            return;
        }
        const usados = new Set();
        for (const a of d.lista) {
            const i = enZona.findIndex((o, j) => !usados.has(j) && o.clase === a.clase && iou(o.caja_norm, a.caja) >= DEJADO_IOU_MISMO);
            if (i >= 0) { usados.add(i); a.visto = t; }
        }
        enZona.forEach((o, j) => { if (!usados.has(j)) d.lista.push({ clase: o.clase, caja: o.caja_norm, desde: t, visto: t, avisado: false }); });
        d.lista = d.lista.filter((a) => t - a.visto <= (a.avisado ? DEJADO_OLVIDO_MS : OLVIDO_MS));
        if (!enHorario(r.horario, ahora)) return;
        const personas = todos.filter((o) => o.grupo === "persona" && Array.isArray(o.caja_norm));
        for (const a of d.lista) {
            if (a.avisado || a.visto !== t || (t - a.desde) / 1000 < (r.segundos ?? 120)) continue;
            const [x1, y1, x2, y2] = a.caja, w = (x2 - x1) * DEJADO_DUENO, h = (y2 - y1) * DEJADO_DUENO;
            const alrededor = [x1 - w, y1 - h, x2 + w, y2 + h];
            if (personas.some((p) => cubre(p.caja_norm, alrededor) > 0)) continue;
            a.avisado = true;
            const seg = Math.round((t - a.desde) / 1000);
            const f = await foto(jpeg, ahora);
            const ev = await evento({ tipo: "DEJADO", reglaId: r.id, deviceId: cam.id, camara: cam.name, clase: a.clase, valor: seg, foto: f, caja: a.caja, ts: new Date(a.desde) });
            contadores.dejados = (contadores.dejados || 0) + 1;
            if (t - (ultimoAvisoDejado.get(r.id) || 0) > ENFRIO_DEJADO_MS) {
                ultimoAvisoDejado.set(r.id, t);
                await avisar(r, "DEJADO", `${nombreDe(a.clase)} sin dueño hace ${lleva(seg)} en ${r.nombre}`, ev.id,
                    await fotoDelAviso(r, jpeg, ahora, { zona: r.zona, cajas: [{ caja: a.caja, tono: "aviso", texto: `${nombreDe(a.clase)} · ${lleva(seg)}` }] }, f), cam);
            }
        }
    }

    /** La pose de este cuadro (una sola inferencia por cuadro y cámara). null si no se pudo. */
    async function poseDe(cam, jpeg, t) {
        const c = poses.get(cam.id);
        if (c && c.t === t) return c.objetos;
        let objetos = null;
        try { objetos = pose ? await pose(jpeg, cam.id) : null; }
        catch (e) {
            if (Date.now() - poseError > POSE_AVISO_ERROR_MS) { poseError = Date.now(); log("reglas: no se pudo pedir la pose:", e.message); }
            contadores.errores++; contadores.ultimoError = `pose: ${e.message}`;
        }
        poses.set(cam.id, { t, objetos });
        return objetos;
    }

    /** ¿Las dos muñecas por encima de los hombros? (puntos normalizados [x, y, se ve]). */
    function manosArriba(p) {
        const pt = Array.isArray(p?.puntos) ? p.puntos : null;
        if (!pt || pt.length < 13) return false;
        const ve = (i) => pt[i] && pt[i][2] >= POSE_VISIBLE;
        if (![5, 6, 9, 10, 11, 12].every(ve)) return false;
        const hombros = (pt[5][1] + pt[6][1]) / 2, caderas = (pt[11][1] + pt[12][1]) / 2;
        const torso = Math.abs(caderas - hombros);
        if (torso < 0.01) return false;
        return pt[9][1] < hombros - TREPA_MANOS * torso && pt[10][1] < hombros - TREPA_MANOS * torso;
    }

    /**
     * Persona en el suelo y trepando: la misma mecánica sobre la pose. Se pide la pose sólo si hay
     * una persona en la zona o algo en curso; las personas de la pose se siguen por superposición
     * de cajas (la pose no tiene número de pista: va sin sesión, ver detectar en vision-worker).
     */
    async function cuerpo(r, cam, valen, jpeg, ahora, t) {
        const suelo = r.tipo === "suelo";
        const mapa = suelo ? suelos : trepadas;
        let lista = mapa.get(r.id) || [];
        const enZona = valen.some((o) => adentro(pie(o), r.zona) || adentro(centro(o.caja_norm), r.zona));
        if (!enZona && !lista.length) return;
        const objetos = await poseDe(cam, jpeg, t);
        if (!objetos) return;
        const cumplen = objetos.filter((p) => p.clase === "person" && Array.isArray(p.caja_norm)
            && (adentro(centro(p.caja_norm), r.zona) || adentro(pie(p), r.zona))
            && (suelo ? p.postura === "acostada" : manosArriba(p)));
        const usados = new Set();
        for (const a of lista) {
            const i = cumplen.findIndex((p, j) => !usados.has(j) && iou(p.caja_norm, a.caja) >= SUELO_IOU);
            if (i >= 0) { usados.add(i); a.visto = t; a.caja = cumplen[i].caja_norm; }
        }
        cumplen.forEach((p, j) => { if (!usados.has(j)) lista.push({ caja: p.caja_norm, desde: t, visto: t, avisado: false }); });
        // Trepando pide continuidad (manos arriba un instante es saludar): se olvida antes.
        lista = lista.filter((a) => t - a.visto <= (suelo ? SUELO_OLVIDO_MS : TREPA_OLVIDO_MS));
        mapa.set(r.id, lista);
        if (!enHorario(r.horario, ahora)) return;
        for (const a of lista) {
            if (a.avisado || a.visto !== t || (t - a.desde) / 1000 < (r.segundos ?? (suelo ? 20 : 2))) continue;
            a.avisado = true;
            const seg = Math.round((t - a.desde) / 1000);
            const tipo = suelo ? "SUELO" : "TREPA";
            const f = await foto(jpeg, ahora);
            const ev = await evento({ tipo, reglaId: r.id, deviceId: cam.id, camara: cam.name, clase: "person", valor: seg, foto: f, caja: a.caja, ts: new Date(a.desde) });
            contadores[suelo ? "suelos" : "trepadas"] = (contadores[suelo ? "suelos" : "trepadas"] || 0) + 1;
            const ultimo = suelo ? ultimoAvisoSuelo : ultimoAvisoTrepa;
            if (t - (ultimo.get(r.id) || 0) > (suelo ? ENFRIO_SUELO_MS : ENFRIO_TREPA_MS)) {
                ultimo.set(r.id, t);
                await avisar(r, tipo, suelo ? `Persona en el suelo hace ${lleva(seg)} en ${r.nombre}` : `Persona trepando en ${r.nombre}`, ev.id,
                    await fotoDelAviso(r, jpeg, ahora, { zona: r.zona, cajas: [{ caja: a.caja, tono: "mal", texto: suelo ? `En el suelo · ${lleva(seg)}` : "Trepando" }] }, f), cam);
            }
        }
    }

    /** Casco y chaleco en una obra: ver EPP_*. Una vez por pista. */
    async function epp(r, cam, valen, jpeg, ahora, t) {
        const requiere = Array.isArray(r.requiere) && r.requiere.length ? r.requiere : ["casco", "chaleco"];
        const armada = enHorario(r.horario, ahora);
        for (const o of valen) {
            const k = `${r.id}:${o.pista}`;
            if (!armada || !adentro(pie(o), r.zona)) { epps.delete(k); continue; }
            let e = epps.get(k);
            if (!e) { e = { desde: t, visto: t, avisado: false, deviceId: cam.id, si: {}, no: {} }; epps.set(k, e); }
            e.visto = t;
            for (const a of Array.isArray(o.atributos) ? o.atributos : []) {
                if (!requiere.includes(a.id) || a.dudoso) continue;
                if (a.valor === "no") e.no[a.id] = (e.no[a.id] || 0) + 1; else e.si[a.id] = (e.si[a.id] || 0) + 1;
            }
            if (e.avisado || (t - e.desde) / 1000 < (r.segundos ?? 10)) continue;
            const faltan = requiere.filter((id) => { const n = (e.si[id] || 0) + (e.no[id] || 0); return n >= EPP_LECTURAS_MIN && (e.no[id] || 0) / n >= EPP_FALTA; });
            if (!faltan.length) continue;
            e.avisado = true;
            const que = faltan.length === 2 ? "sin casco ni chaleco" : faltan[0] === "casco" ? "sin casco" : "sin chaleco";
            const f = await foto(jpeg, ahora);
            const seg = Math.round((t - e.desde) / 1000);
            const ev = await evento({ tipo: "EPP", reglaId: r.id, deviceId: cam.id, camara: cam.name, clase: "person", pista: o.pista, sentido: faltan.join(","), valor: seg, foto: f, caja: o.caja_norm, ts: new Date(e.desde) });
            contadores.epp = (contadores.epp || 0) + 1;
            if (t - (ultimoAvisoEpp.get(r.id) || 0) > ENFRIO_EPP_MS) {
                ultimoAvisoEpp.set(r.id, t);
                await avisar(r, "EPP", `Persona ${que} en ${r.nombre}`, ev.id,
                    await fotoDelAviso(r, jpeg, ahora, { zona: r.zona, cajas: [{ caja: o.caja_norm, tono: "aviso", texto: que.charAt(0).toUpperCase() + que.slice(1) }] }, f), cam);
            }
        }
    }

    /**
     * Las estadías que terminaron. Salió de la zona: se cierra ya. Dejó de verse: queda en suspenso
     * REENGANCHE_MS (ver arriba) y recién entonces se cierra, y se recuerda por si vuelve a tomarse.
     */
    async function cerrarEstadias(cam, t, todas) {
        for (const [k, e] of estadias) {
            if (cam && e.deviceId !== cam.id && !todas) continue;
            const termino = todas || e.fuera || t - e.visto > OLVIDO_MS;
            if (!termino) continue;
            estadias.delete(k);
            if (!todas && !e.fuera) {
                const xs = perdidas.get(e.reglaId) || [];
                xs.push(e); perdidas.set(e.reglaId, xs);
                if (e.avisoId) emitir("vision_estadia", { avisoId: e.avisoId, deviceId: e.deviceId, perdida: true, visto: new Date(e.visto).toISOString() });
                continue;
            }
            await cerrarUna(e, todas ? "reinicio" : "salio");
        }
        for (const [regla, xs] of perdidas) {
            for (let i = xs.length - 1; i >= 0; i--) {
                const e = xs[i];
                if (cam && e.deviceId !== cam.id && !todas) continue;
                if (!todas && t - e.visto <= REENGANCHE_MS) continue;
                xs.splice(i, 1);
                await cerrarUna(e, todas ? "reinicio" : "no-se-ve");
                if (!todas) { const ys = idas.get(regla) || []; ys.push(e); idas.set(regla, ys); }
            }
        }
        for (const [regla, ys] of idas) idas.set(regla, ys.filter((e) => t - e.visto <= MEMORIA_LUGAR_MS));
    }
    async function cerrarUna(e, como) {
        if (e.eventoId) await prisma.eventoVision.update({ where: { id: e.eventoId }, data: { valor: Math.round((e.visto - e.desde) / 1000) } }).catch(() => null);
        if (e.avisoId) await cerrarAvisoEstadia(e, como);
    }

    /**
     * Cuando el que se quedó se va, el aviso lo dice (20/10, Nico: «debés indicar cuándo se va
     * también»). Antes la estadía se cerraba sólo en el registro de detecciones y la alarma quedaba
     * para siempre en «auto hace 15 min», sin saber si seguía ahí.
     *
     * Tres finales distintos, porque no significan lo mismo para el guardia:
     *   - salio: se lo vio AFUERA de la zona — se fue;
     *   - no-se-ve: dejó de verse REENGANCHE_MS (10 min) sin que se lo viera salir — puede haberse ido, o
     *     algo lo tapó o el seguimiento lo perdió;
     *   - reinicio: se reinició el análisis (no se sabe qué pasó después).
     * El aviso se reescribe («estuvo 23 min · salió 16:06»), `datos` guarda hasta / segundos / cómo,
     * y la bitácora de la alarma suma el paso SE_FUE.
     */
    async function cerrarAvisoEstadia(e, como) {
        const seg = Math.max(0, Math.round((e.visto - e.desde) / 1000));
        const hasta = new Date(e.visto);
        const que = COMO_TERMINO[como];
        try {
            const previo = await prisma.avisoGuardia.findUnique({ where: { id: e.avisoId }, select: { datos: true } });
            if (!previo) return;
            await prisma.avisoGuardia.update({ where: { id: e.avisoId }, data: {
                motivo: `${nombreDe(e.clase)} estuvo ${duracion(seg)} en ${e.regla} · ${que} ${hhmm(hasta)}`,
                datos: { ...(previo.datos || {}), hasta: hasta.toISOString(), segundos: seg, como },
            } });
            await prisma.alarmaGestion.create({ data: { clave: `a:${e.avisoId}`, accion: "SE_FUE", por: e.camara || "OmniVision", deviceId: e.deviceId, detalle: `${que} · estuvo ${duracion(seg)}` } });
            emitir("alarma_gestion", { clave: `a:${e.avisoId}`, accion: "SE_FUE" });
            emitir("aviso_guardia", { accion: "actualizado", id: e.avisoId });
        } catch (err) { contadores.errores++; contadores.ultimoError = `cierre de estadía: ${err.message}`; }
    }

    async function aglomeracion(r, cam, valen, jpeg, ahora, t) {
        const dentro = valen.filter((o) => !r.zona || adentro(pie(o), r.zona));
        const g = grupos.get(r.id) || { desde: null, ultimoAviso: 0, max: 0 };
        if (dentro.length < r.maximo) { g.desde = null; g.max = 0; grupos.set(r.id, g); return; }
        if (!g.desde) g.desde = t;
        g.max = Math.max(g.max, dentro.length);
        grupos.set(r.id, g);
        if ((t - g.desde) / 1000 < r.segundos || t - g.ultimoAviso < ENFRIO_AGLOMERACION_MS) return;
        g.ultimoAviso = t;
        // Sin caja en el evento: la marcada (la zona y cada uno de los que cuentan) es la del evento también.
        const f = await fotoMarcada(jpeg, ahora, { zona: r.zona, cajas: dentro.map((o) => ({ caja: o.caja_norm, tono: "aviso" })), rotulo: { texto: `${dentro.length} personas juntas`, tono: "aviso" } });
        const ev = await evento({ tipo: "AGLOMERACION", reglaId: r.id, deviceId: cam.id, camara: cam.name, clase: "person", valor: dentro.length, foto: f, ts: ahora });
        contadores.aglomeracion++;
        await avisar(r, "AGLOMERACION", `${dentro.length} personas juntas en ${r.nombre}`, ev.id, f, cam);
    }

    async function fila(r, cam, personas, jpeg, ahora, t) {
        const f = filas.get(r.id) || { aceptado: null, candidato: null, desde: t, llenoDesde: null, ultimoAviso: 0, escalado: false, pistas: new Map(), vivo: 0 };
        filas.set(r.id, f);
        const minimo = Math.max(0, r.permanencia ?? 0) * 1000;

        // Cada pista: si está adentro, desde cuándo, y su cruce del borde (entradas y salidas).
        for (const o of personas) {
            if (o.pista == null) continue;
            const k = String(o.pista), adentroAhora = adentro(pie(o), r.zona), p = f.pistas.get(k);
            if (!p) { f.pistas.set(k, { dentro: adentroAhora, visto: t, cambio: 0, desde: adentroAhora ? t : null }); continue; }
            p.visto = t;
            if (p.dentro === adentroAhora || t - p.cambio < FILA_BORDE_MS) continue;
            // Al salir, cuánto estuvo adentro: es la espera MEDIDA (la del kiosco es una estimación).
            const estuvo = !adentroAhora && p.desde ? Math.round((t - p.desde) / 1000) : null;
            await evento({ tipo: adentroAhora ? "FILA_ENTRA" : "FILA_SALE", reglaId: r.id, deviceId: cam.id, camara: cam.name, clase: "person", pista: o.pista, sentido: adentroAhora ? "entra" : "sale", valor: estuvo, ts: ahora });
            p.dentro = adentroAhora; p.cambio = t; p.desde = adentroAhora ? t : null;
        }
        for (const [k, p] of f.pistas) if (t - p.visto > OLVIDO_MS) f.pistas.delete(k);

        // Aforo: los que están adentro; con «permanencia mínima», sólo los que ya llevan ese tiempo
        // (el que cruza la zona caminando no hace fila). Sin número de pista cuenta igual.
        const dentro = personas.filter((o) => {
            if (!adentro(pie(o), r.zona)) return false;
            if (!minimo || o.pista == null) return true;
            const p = f.pistas.get(String(o.pista));
            return !p?.desde || t - p.desde >= minimo;
        });
        const n = dentro.length;

        // Con su tiempo de rebote.
        if (n !== f.candidato) { f.candidato = n; f.desde = t; }
        if (n !== f.aceptado && (f.aceptado === null || t - f.desde >= (r.rebote ?? 2) * 1000)) {
            f.aceptado = n;
            contadores.filas++;
            await evento({ tipo: "FILA", reglaId: r.id, deviceId: cam.id, camara: cam.name, clase: "person", valor: n, ts: ahora });
            emitir("vision_fila", { reglaId: r.id, deviceId: cam.id, valor: n, ts: ahora.toISOString() });
        }

        // En vivo para Visión → Filas: dónde está cada pie y si cuenta, como mucho una vez por segundo.
        if (t - f.vivo >= FILA_VIVO_MS) {
            f.vivo = t;
            const cuentan = new Set(dentro);
            emitir("vision_fila_vivo", {
                reglaId: r.id, aforo: f.aceptado, candidato: f.candidato,
                pies: personas.slice(0, 60).map((o) => { const [x, y] = pie(o); return [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000, cuentan.has(o) ? 1 : 0]; }),
            });
        }

        // El límite: aviso, enfriamiento y escalamiento, dentro del horario de atención.
        // Una regla guardada antes de tener límite usa el de la pantalla (TIPOS_REGLA.fila.maximoDefecto).
        const limite = r.maximo ?? FILA_LIMITE_DEFECTO;
        if (f.aceptado < limite || !enHorario(r.horario, ahora)) { f.llenoDesde = null; f.escalado = false; return; }
        if (!f.llenoDesde) f.llenoDesde = t;
        /*
         * La foto de la fila: la zona, una caja por cada uno que CUENTA (en el tono del aviso) y
         * las de los que están adentro pero todavía no cuentan (permanencia mínima) en azul, para
         * que se vea por qué el número es ése. Sin esto la foto mostraba la escena y nada más.
         */
        const cuentan = new Set(dentro);
        const marcasFila = (tono, texto) => ({
            zona: r.zona, rotulo: { texto, tono },
            cajas: personas.filter((o) => adentro(pie(o), r.zona)).map((o) => ({ caja: o.caja_norm, tono: cuentan.has(o) ? tono : "accion" })),
        });
        if (t - f.ultimoAviso >= (r.enfrioMin ?? 5) * 60_000) {
            f.ultimoAviso = t;
            const fo = await fotoMarcada(jpeg, ahora, marcasFila("aviso", `${f.aceptado} en la fila · límite ${limite}`));
            const ev = await evento({ tipo: "FILA_LLENA", reglaId: r.id, deviceId: cam.id, camara: cam.name, clase: "person", valor: f.aceptado, foto: fo, ts: ahora });
            await avisar(r, "FILA_LLENA", `${r.nombre}: ${f.aceptado} personas en la fila (límite ${limite})`, ev.id, fo, cam);
        }
        const min = (t - f.llenoDesde) / 60_000;
        if (!f.escalado && min >= (r.escalarMin ?? 5)) {
            f.escalado = true;
            const fo = await fotoMarcada(jpeg, ahora, marcasFila("mal", `${f.aceptado} en la fila hace ${Math.round(min)} min · límite ${limite}`));
            const ev = await evento({ tipo: "FILA_ESCALADA", reglaId: r.id, deviceId: cam.id, camara: cam.name, clase: "person", valor: f.aceptado, foto: fo, ts: ahora });
            await avisar(r, "FILA_ESCALADA", `Avisar al supervisor: ${r.nombre} sigue llena hace ${Math.round(min)} min (${f.aceptado} personas, límite ${limite})`, ev.id, fo, cam);
        }
    }

    return { cargar, camaras, camarasRapidas, enCurso, procesar, contadores, cerrarTodo: () => cerrarEstadias(null, Date.now(), true) };
}

module.exports = { iniciar, enHorario };
