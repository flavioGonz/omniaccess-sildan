/**
 * El contexto de una lectura de la Lista Amarilla: cuánto se la vio antes (openspec
 * seguimiento-lista-amarilla). Lo usa server.js al avisar, y la frase que arma es la que
 * muestran el monitor, Control LPR y el Telegram: se redacta UNA vez, acá, para que los cuatro
 * destinos digan exactamente lo mismo. Mandar los números y redactar en cada lugar daba frases
 * parecidas pero no iguales, que es peor que no tenerlas.
 *
 * `contextoDe` y `fraseDeContexto` son puras y reciben el reloj y la zona por parámetro: así se
 * prueba «ayer» y el cruce de medianoche sin esperar a que pasen (tests/contexto-vigilancia).
 *
 * Qué cuenta: lecturas (AccessEvent de matrícula, sin las «sin vehículo»), NO pasadas. Un auto
 * leído por dos cámaras en un minuto cuenta dos, igual que en el cajón Investigar; por eso la
 * frase destaca los días distintos, que no se inflan.
 */

/** La zona de la instalación: los «días distintos» son del barrio, no de UTC. */
const ZONA = process.env.NEXT_PUBLIC_TZ || "America/Montevideo";
const VENTANA_DIAS = 7;
const DIA_MS = 86_400_000;
/** Tope de la consulta: el aviso no espera por el contexto. */
const TOPE_MS = 1500;
/** No hace falta contarlas todas para decir «N.ª lectura»: pasado esto se dice «más de». */
const TOPE_LECTURAS = 500;

const ms = (x) => (x instanceof Date ? x.getTime() : new Date(x).getTime());

/** El día de calendario (AAAA-MM-DD) de un instante, en la zona pedida. */
function diaEn(zona, cuando) {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms(cuando)));
    const v = (t) => p.find((x) => x.type === t).value;
    return `${v("year")}-${v("month")}-${v("day")}`;
}
const horaEn = (zona, cuando) => new Intl.DateTimeFormat("es-UY", { timeZone: zona, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms(cuando)));
/** Cuántos días de calendario hay entre dos días AAAA-MM-DD. */
const diasEntre = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DIA_MS);

/**
 * @param {{ ts: Date|string|number, camara?: string|null }[]} anteriores lecturas previas a la
 *   actual, de cualquier antigüedad (la actual NO va).
 * @returns {{ lecturas7: number, dias7: number, anterior: { ts: string, camara: string|null } | null }}
 *   `lecturas7` y `dias7` cuentan la lectura actual.
 */
function contextoDe(anteriores, ahora, zona = ZONA) {
    const t = ms(ahora);
    const lista = (anteriores || []).filter((l) => l && Number.isFinite(ms(l.ts)) && ms(l.ts) <= t);
    // La semana son 7 días DE CALENDARIO del barrio (hoy y los seis anteriores), no 168 horas:
    // con horas, un jueves a la tarde alcanzaba al jueves anterior y el aviso decía «en 7 días,
    // en 8 días distintos» (visto en el lab el 12/11 con lecturas reales).
    const hoy = diaEn(zona, t);
    const enVentana = lista.filter((l) => diasEntre(diaEn(zona, l.ts), hoy) < VENTANA_DIAS);
    const dias = new Set(enVentana.map((l) => diaEn(zona, l.ts)));
    dias.add(hoy);
    let ultima = null;
    for (const l of lista) if (!ultima || ms(l.ts) > ms(ultima.ts)) ultima = l;
    return {
        lecturas7: enVentana.length + 1,
        dias7: dias.size,
        anterior: ultima ? { ts: new Date(ms(ultima.ts)).toISOString(), camara: ultima.camara || null } : null,
    };
}

const DIAS_SEMANA = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

/** «hoy 08:12», «ayer 22:14», «el lun 22:14» (dentro de la semana) o «el 3/11 22:14». */
function cuandoFue(ts, ahora, zona = ZONA) {
    const dia = diaEn(zona, ts), hoy = diaEn(zona, ahora), hora = horaEn(zona, ts);
    const hace = diasEntre(dia, hoy);
    if (hace <= 0) return `hoy ${hora}`;
    if (hace === 1) return `ayer ${hora}`;
    const [a, m, d] = dia.split("-").map(Number);
    if (hace < 7) return `el ${DIAS_SEMANA[new Date(Date.UTC(a, m - 1, d)).getUTCDay()]} ${hora}`;
    return `el ${d}/${m}${a !== Number(hoy.slice(0, 4)) ? `/${a}` : ""} ${hora}`;
}

/** La línea que se muestra y se manda. Vacía si no hay contexto. */
function fraseDeContexto(c, ahora, zona = ZONA) {
    if (!c) return "";
    if (!c.anterior) return "Primera vez que se la ve";
    const anterior = `anterior: ${cuandoFue(c.anterior.ts, ahora, zona)}${c.anterior.camara ? ` en ${c.anterior.camara}` : ""}`;
    if (c.lecturas7 <= 1) return `Primera lectura en ${VENTANA_DIAS} días · ${anterior}`;
    const cuantas = c.lecturas7 > TOPE_LECTURAS ? `Más de ${TOPE_LECTURAS} lecturas` : `${c.lecturas7}.ª lectura`;
    return `${cuantas} en ${VENTANA_DIAS} días, en ${c.dias7} día${c.dias7 === 1 ? "" : "s"} distinto${c.dias7 === 1 ? "" : "s"} · ${anterior}`;
}

// ── Con la base ───────────────────────────────────────────────────────────────────────────

let busqueda = { vale: true, hasta: 0 };
/** Si la función «Lista Amarilla» está prendida. Sin fila guardada vale su defecto (prendida). */
async function busquedaPrendida(prisma) {
    if (busqueda.hasta > Date.now()) return busqueda.vale;
    try {
        const f = await prisma.setting.findUnique({ where: { key: "LPR_BUSQUEDA" } });
        busqueda = { vale: !f || String(f.value).trim().toLowerCase() !== "false", hasta: Date.now() + 30_000 };
    } catch { busqueda = { vale: busqueda.vale, hasta: Date.now() + 5_000 }; }
    return busqueda.vale;
}

const SELECCION = { timestamp: true, location: true, device: { select: { name: true } } };
const aLectura = (e) => ({ ts: e.timestamp, camara: (e.device && e.device.name) || e.location || null });

/**
 * El contexto de la lectura `eventId` de `plate`, o null si no se pudo (falla o tarda más que
 * el tope): el aviso sale igual, sin la línea. Una consulta por la semana, sobre el índice
 * (plateDetected, timestamp); y sólo si la semana está vacía, otra por la anterior más reciente.
 */
async function contextoDeLectura(prisma, { plate, eventId, ahora = new Date() }, zona = ZONA) {
    const base = { accessType: "PLATE", sinVehiculo: false, plateDetected: plate, ...(eventId ? { id: { not: eventId } } : {}) };
    const desde = new Date(ms(ahora) - VENTANA_DIAS * DIA_MS);
    const buscar = (async () => {
        const semana = await prisma.accessEvent.findMany({
            where: { ...base, timestamp: { gte: desde, lte: new Date(ms(ahora)) } },
            orderBy: { timestamp: "desc" }, take: TOPE_LECTURAS + 1, select: SELECCION,
        });
        let anteriores = semana.map(aLectura);
        if (!anteriores.length) {
            const vieja = await prisma.accessEvent.findFirst({ where: { ...base, timestamp: { lt: desde } }, orderBy: { timestamp: "desc" }, select: SELECCION });
            if (vieja) anteriores = [aLectura(vieja)];
        }
        const c = contextoDe(anteriores, ahora, zona);
        return { ...c, frase: fraseDeContexto(c, ahora, zona) };
    })();
    let reloj;
    const tope = new Promise((_, no) => { reloj = setTimeout(() => no(new Error(`el contexto tardó más de ${TOPE_MS} ms`)), TOPE_MS); });
    try { return await Promise.race([buscar, tope]); }
    finally { clearTimeout(reloj); buscar.catch(() => { }); }
}

module.exports = { ZONA, VENTANA_DIAS, TOPE_LECTURAS, diaEn, cuandoFue, contextoDe, fraseDeContexto, contextoDeLectura, busquedaPrendida };
