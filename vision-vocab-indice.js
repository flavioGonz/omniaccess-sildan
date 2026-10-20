/**
 * Indexa las fotos del historial para el vocabulario abierto (omni-vision /vocabulario/indexar).
 *
 * Por qué (17/10, Nico: «es demasiado lento al buscar»): buscar «carretilla» mirando cada foto con
 * OWLv2 cuesta ~0,25 s por foto (7 minutos por día de San Nicolás). Indexada una vez al llegar,
 * buscar en un mes tarda un segundo (ver services/omni-vision/indice_vocab.py).
 *
 * Dos frentes por vuelta:
 *   · lo NUEVO, desde el último indexado hacia adelante: así lo de recién llegado se puede buscar
 *     en uno o dos minutos;
 *   · lo VIEJO, desde donde se empezó hacia atrás, hasta `atrasDias`: el relleno inicial. Va
 *     después de lo nuevo en cada vuelta, para que el relleno no demore lo de hoy.
 *
 * Modos (Setting VOCAB_INDICE, {modo, ventana, atrasDias}):
 *   continuo — todo el día (OWLv2 queda cargado en la GPU mientras haya qué indexar);
 *   noche    — sólo en la ventana (por defecto 02:00–06:00), para placas justas como la 3050 de
 *              San Nicolás: el modelo no ocupa la GPU de día;
 *   apagado  — no indexa (lo ya indexado se sigue pudiendo buscar).
 * También se frena si la tarea «vocabulario» está apagada en omni-vision.
 *
 * De a una foto, con una pausa entre una y otra: omni-vision atiende una inferencia a la vez y
 * la verificación de intrusiones no tiene que esperar detrás de una tanda larga.
 */
const APP = (process.env.APP_INTERNAL_URL || "http://127.0.0.1:10001").replace(/\/$/, "");
const CLAVE = "VOCAB_INDICE";
const VUELTA_MS = 30_000;
const TANDA = 40;
const PAUSA_MS = 120;
const POR_DEFECTO = { modo: process.env.OMNI_VOCAB_INDICE_MODO || "continuo", ventana: "02:00-06:00", atrasDias: 7 };

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** De cómo quedó guardada la foto a la URL interna (lo mismo que lib/image-path). */
function urlFoto(ruta) {
    if (!ruta) return null;
    if (ruta.startsWith("http")) return ruta;
    const p = ruta.replace(/^\//, "");
    if (p.startsWith("api/files/lpr/")) return null;
    return APP + (p.startsWith("api/") ? `/${p}` : `/api/files/${p}`);
}

function enVentana(ventana) {
    const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(ventana || "");
    if (!m) return true;
    const ahora = new Date(); const min = ahora.getHours() * 60 + ahora.getMinutes();
    const a = +m[1] * 60 + +m[2], b = +m[3] * 60 + +m[4];
    return a <= b ? min >= a && min < b : min >= a || min < b;
}

function iniciar({ prisma, log, vision, apagado }) {
    let corriendo = true;
    const estado = { indexadas: 0, errores: 0, ultimoError: null, vivo: null, atras: null, frenado: null };

    async function leerConf() {
        try {
            const s = await prisma.setting.findUnique({ where: { key: CLAVE } });
            return { ...POR_DEFECTO, ...(s?.value ? JSON.parse(s.value) : {}) };
        } catch { return { ...POR_DEFECTO }; }
    }
    /** Guarda sólo los cursores, sobre lo que haya AHORA: si alguien cambió el modo durante la vuelta, se respeta. */
    async function guardarCursores(vivo, atras) {
        const c = { ...(await leerConf()), vivo, atras };
        await prisma.setting.upsert({ where: { key: CLAVE }, update: { value: JSON.stringify(c) }, create: { key: CLAVE, value: JSON.stringify(c) } }).catch(() => { });
    }

    /** Una foto al índice. true = hecha (o ya estaba); false = no se pudo y conviene frenar la vuelta. */
    async function indexar(ev) {
        const u = urlFoto(ev.snapshotPath || ev.imagePath);
        if (!u) return true;
        let foto;
        try {
            const r = await fetch(u, { signal: AbortSignal.timeout(10_000) });
            if (!r.ok) return true; // sin foto: se saltea, no se reintenta para siempre
            foto = Buffer.from(await r.arrayBuffer());
            if (foto.length < 1000) return true;
        } catch { return false; }
        const q = new URLSearchParams({ id: ev.id, ts: String(ev.timestamp.getTime()), ...(ev.deviceId ? { dev: ev.deviceId } : {}) });
        try {
            const r = await fetch(`${vision}/vocabulario/indexar?${q}`, { method: "POST", body: foto, headers: { "content-type": "image/jpeg" }, signal: AbortSignal.timeout(60_000) });
            if (r.status === 409 || r.status === 501 || r.status === 503) {
                const j = await r.json().catch(() => ({}));
                estado.frenado = j?.error || `omni-vision respondió ${r.status}`;
                return false;
            }
            if (!r.ok) { estado.errores++; estado.ultimoError = `omni-vision respondió ${r.status}`; return true; }
            estado.indexadas++;
            return true;
        } catch (e) { estado.errores++; estado.ultimoError = e.message; return false; }
    }

    async function vuelta() {
        const conf = await leerConf();
        if (conf.modo === "apagado") { estado.frenado = "modo apagado"; return 0; }
        if (apagado()) { estado.frenado = "tarea vocabulario apagada"; return 0; }
        if (conf.modo === "noche" && !enVentana(conf.ventana)) { estado.frenado = `fuera de la ventana ${conf.ventana}`; return 0; }
        const antes = estado.indexadas;
        estado.frenado = null;
        const conFoto = { OR: [{ snapshotPath: { not: null } }, { imagePath: { not: null } }] };
        const ahora = new Date();
        // La primera vez: lo nuevo arranca ahora y lo viejo va hacia atrás desde ahora.
        let vivo = conf.vivo ? new Date(conf.vivo) : ahora;
        let atras = conf.atras ? new Date(conf.atras) : ahora;
        const limiteAtras = new Date(Date.now() - (Number(conf.atrasDias) || 7) * 864e5);

        // 1. Lo nuevo.
        const nuevos = await prisma.accessEvent.findMany({
            where: { timestamp: { gt: vivo }, ...conFoto }, orderBy: { timestamp: "asc" }, take: TANDA,
            select: { id: true, timestamp: true, deviceId: true, snapshotPath: true, imagePath: true },
        });
        for (const ev of nuevos) {
            if (!corriendo || !(await indexar(ev))) break;
            vivo = ev.timestamp;
            await dormir(PAUSA_MS);
        }
        // 2. Lo viejo, si lo nuevo está al día y no se frenó.
        if (nuevos.length < TANDA && !estado.frenado && atras > limiteAtras) {
            const viejos = await prisma.accessEvent.findMany({
                where: { timestamp: { lt: atras, gte: limiteAtras }, ...conFoto }, orderBy: { timestamp: "desc" }, take: TANDA,
                select: { id: true, timestamp: true, deviceId: true, snapshotPath: true, imagePath: true },
            });
            for (const ev of viejos) {
                if (!corriendo || !(await indexar(ev))) break;
                atras = ev.timestamp;
                await dormir(PAUSA_MS);
            }
            if (viejos.length === 0) atras = limiteAtras;
        }
        estado.vivo = vivo.toISOString(); estado.atras = atras.toISOString();
        await guardarCursores(estado.vivo, estado.atras);
        return estado.indexadas - antes;
    }

    (async function bucle() {
        log("índice de vocabulario: arranca");
        while (corriendo) {
            const t0 = Date.now();
            let hechas = 0;
            try { hechas = await vuelta(); } catch (e) { estado.ultimoError = e.message; }
            // Con trabajo pendiente (el relleno) se sigue enseguida; al día, se espera la vuelta.
            await dormir(hechas > 0 ? 500 : Math.max(2000, VUELTA_MS - (Date.now() - t0)));
        }
    })();

    return { estado: () => ({ ...estado }), parar: () => { corriendo = false; } };
}

module.exports = { iniciar, CLAVE };
