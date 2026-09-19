#!/usr/bin/env node
/**
 * Medición de calibración del seguimiento.
 *
 * Contesta la pregunta que hasta ahora se contestaba a ojo: ¿estas cámaras están bien
 * puestas, o hay que ajustarlas? Mira lo que produjeron en una ventana de tiempo y lo
 * compara con lo que uno esperaría de una cámara sana.
 *
 * Dos reglas de honestidad que valen más que cualquier métrica:
 *
 * 1. CON POCA MUESTRA NO SE OPINA. Con cortes de seis horas, una calle tranquila puede
 *    dejar tres lecturas. Tres lecturas no dicen si una cámara está bien calibrada, y un
 *    porcentaje sobre tres casos es un número que engaña. Por debajo del mínimo el
 *    veredicto es "sin muestra", no "mal".
 *
 * 2. LO QUE NO SE PUEDE MEDIR SE DICE. La medición contra verdad conocida -cruzar contra
 *    las cámaras ANPR de entrada, que traen la matrícula correcta de fábrica- es la única
 *    que mide acierto de verdad. Si todavía no hay accesos registrados, se dice que no se
 *    pudo medir en vez de inventar una tasa con lo que hay.
 *
 * Uso:  node scripts/calibracion.js [--horas 6] [--json]
 */

// `quiet` importa: sin eso dotenv imprime su cartel en stdout y le mete una linea de
// adorno adelante al JSON, que deja de ser JSON.
require("dotenv").config({ quiet: true });
const fs = require("fs");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const arg = (n, d) => {
    const i = process.argv.indexOf(n);
    return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const HORAS = Number(arg("--horas", 6));
const SOLO_JSON = process.argv.includes("--json");

/** Debajo de esto no se emite veredicto: no hay con qué. */
const MUESTRA_MINIMA = Number(process.env.CALIB_MIN_MUESTRA || 8);

/** Umbrales de una cámara sana. Salieron de mirar las dos que hay, no de un manual. */
const UMBRAL = {
    productivas: 0.35,   // ráfagas que terminan en al menos una matrícula
    confianza: 0.75,     // mediana de las lecturas aceptadas
    coincidencias: 3,    // cuadros que coinciden, en promedio
    unicas: 0.45,        // proporción de matrículas vistas una sola vez
};

const mediana = (xs) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Dos lecturas del mismo auto o de dos autos distintos. Igual criterio que la pasarela. */
function mismaChapa(a, b) {
    if (!a || !b || a.length !== b.length || a === b) return false;
    const tolera = a.length >= 6 ? 2 : 1;
    let d = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { d++; if (d > tolera) return false; }
    return true;
}

/** Lo que el worker dejó en el log: ráfagas disparadas y cuáles salieron vacías. */
function leerLog(desde, validas) {
    const candidatos = [
        "/opt/OmniAccess/logs/tracking-out.log",
        "/root/.pm2/logs/tracking-worker-out.log",
    ];
    const porCamara = {};
    let leido = false;

    for (const ruta of candidatos) {
        let texto = "";
        try { texto = fs.readFileSync(ruta, "utf8"); } catch { continue; }
        leido = true;
        for (const linea of texto.split("\n")) {
            // La marca ISO que escribe el propio worker, no la que antepone pm2.
            const m = linea.match(/(\d{4}-\d{2}-\d{2}T[\d:.]+Z) \[track\] ([^:]+): (.*)$/);
            if (!m) continue;
            if (new Date(m[1]) < desde) continue;
            const cam = m[2].trim(), resto = m[3];
            // El log tiene renglones que no son de una cámara ("camara enganchada: ...",
            // "se fue: ..."). Sin esta puerta aparecían como cámaras fantasma en el
            // informe, con veredicto y todo.
            if (!validas.has(cam)) continue;
            const c = (porCamara[cam] ||= { rafagas: 0, vacias: 0, cerca: 0, aceptadas: 0, msRafaga: [] });

            if (/^rafaga abierta/.test(resto)) c.rafagas++;
            const vac = resto.match(/^(\d+) matricula\(s\) de (\d+) candidatas/);
            if (vac) {
                if (Number(vac[1]) === 0) c.vacias++;
                const cerca = resto.match(/cerca: (.+)$/);
                if (cerca) c.cerca += cerca[1].split(",").length;
            }
            if (/lecturas de \d+ baldosas/.test(resto)) c.aceptadas++;
            const t = resto.match(/^rafaga en (\d+) ms/);
            if (t) c.msRafaga.push(Number(t[1]));
        }
        break;
    }
    return { porCamara, leido };
}

(async () => {
    const hasta = new Date();
    const desde = new Date(hasta.getTime() - HORAS * 3600 * 1000);

    const filas = await prisma.plateSighting.findMany({
        where: { source: "TRACK", timestamp: { gte: desde, lte: hasta } },
        select: { plate: true, cameraName: true, confidence: true, reads: true, estado: true, timestamp: true },
    });

    const accesos = await prisma.accessEvent.count({ where: { timestamp: { gte: desde, lte: hasta } } });

    // Los nombres salen de los dispositivos dados de alta, no de lo que parezca un nombre
    // en el log. Una cámara sin ninguna lectura tiene que aparecer igual —es justamente la
    // que hay que mirar— y una línea del log que no es de una cámara no puede colarse.
    const equipos = await prisma.device.findMany({
        where: { deviceType: "LPR_INTERIOR" },
        select: { name: true, trackEnabled: true },
    });
    const validas = new Set(equipos.map((d) => d.name));
    const { porCamara: log, leido: hayLog } = leerLog(desde, validas);

    const nombres = [...new Set([
        ...equipos.filter((d) => d.trackEnabled).map((d) => d.name),
        ...filas.map((f) => f.cameraName).filter((n) => n && validas.has(n)),
    ])];

    const camaras = nombres.map((nombre) => {
        const mias = filas.filter((f) => f.cameraName === nombre);
        const pasadas = mias.filter((f) => f.estado !== "ESTACIONADO");
        const estadias = mias.filter((f) => f.estado === "ESTACIONADO");
        const confs = mias.map((f) => f.confidence).filter((c) => typeof c === "number");
        const lecturas = mias.map((f) => f.reads).filter((r) => typeof r === "number");

        const chapas = [...new Set(mias.map((f) => f.plate))];
        const conteo = new Map();
        for (const f of mias) conteo.set(f.plate, (conteo.get(f.plate) || 0) + 1);
        const unaVez = chapas.filter((p) => conteo.get(p) === 1).length;

        // Pares casi iguales: el mismo auto leído de dos formas. Es inestabilidad del OCR,
        // y es lo que más ensucia el historial sin que se note.
        let casiIguales = 0;
        for (let i = 0; i < chapas.length; i++)
            for (let j = i + 1; j < chapas.length; j++)
                if (mismaChapa(chapas[i], chapas[j])) casiIguales++;

        const l = log[nombre] || { rafagas: 0, vacias: 0, cerca: 0, aceptadas: 0, msRafaga: [] };
        const productivas = l.rafagas ? (l.rafagas - l.vacias) / l.rafagas : null;

        return {
            nombre,
            muestra: mias.length,
            rafagas: l.rafagas,
            rafagasVacias: l.vacias,
            productivas,
            pasadas: pasadas.length,
            estadias: estadias.length,
            confianzaMediana: mediana(confs),
            confianzaMinima: confs.length ? Math.min(...confs) : null,
            coincidenciasMedianas: mediana(lecturas),
            chapasDistintas: chapas.length,
            unaSolaVez: unaVez,
            propUnaVez: chapas.length ? unaVez / chapas.length : null,
            casiIguales,
            msRafagaMediana: mediana(l.msRafaga),
            cercaDelUmbral: l.cerca,
        };
    });

    // ── Veredicto por cámara ──
    for (const c of camaras) {
        const avisos = [];
        if (c.muestra < MUESTRA_MINIMA) {
            c.veredicto = "SIN MUESTRA";
            c.avisos = [`Solo ${c.muestra} lecturas en ${HORAS} h: no alcanza para opinar. `
                + `Hacen falta ${MUESTRA_MINIMA}.`];
            continue;
        }
        if (c.productivas != null && c.productivas < UMBRAL.productivas) {
            avisos.push(`Solo ${Math.round(c.productivas * 100)}% de las ráfagas termina en una matrícula `
                + `(${c.rafagasVacias} de ${c.rafagas} salieron vacías). La cámara se dispara pero no lee: `
                + `mirar encuadre, zona de interés y línea de pasada.`);
        }
        if (c.confianzaMediana != null && c.confianzaMediana < UMBRAL.confianza) {
            avisos.push(`Confianza mediana ${c.confianzaMediana.toFixed(2)}, por debajo de ${UMBRAL.confianza}. `
                + `La chapa llega con poco detalle: acercar la zona de interés o revisar el ángulo.`);
        }
        if (c.coincidenciasMedianas != null && c.coincidenciasMedianas < UMBRAL.coincidencias) {
            avisos.push(`Mediana de ${c.coincidenciasMedianas} cuadros coincidentes. Las lecturas se sostienen `
                + `en poca evidencia: el vehículo pasa muy rápido por el encuadre o la ventana es corta.`);
        }
        if (c.propUnaVez != null && c.propUnaVez > UMBRAL.unicas && c.chapasDistintas >= 6) {
            avisos.push(`${c.unaSolaVez} de ${c.chapasDistintas} matrículas aparecen una sola vez `
                + `(${Math.round(c.propUnaVez * 100)}%). Buena parte es probablemente invento del OCR.`);
        }
        if (c.casiIguales > 0) {
            avisos.push(`${c.casiIguales} par(es) de matrículas casi iguales: el mismo auto leído de dos formas. `
                + `Es inestabilidad del OCR y ensucia el historial.`);
        }
        c.avisos = avisos;
        c.veredicto = avisos.length === 0 ? "BIEN" : avisos.length <= 1 ? "ATENCION" : "AJUSTAR";
    }

    const informe = {
        generado: hasta.toISOString(),
        ventanaHoras: HORAS,
        muestraMinima: MUESTRA_MINIMA,
        logLeido: hayLog,
        totalLecturas: filas.length,
        accesosEnVentana: accesos,
        // La única medida real de acierto necesita las cámaras de entrada, que traen la
        // matrícula correcta de fábrica. Sin accesos no hay contra qué comparar.
        verdadConocida: accesos > 0
            ? "hay accesos en la ventana: se puede cruzar contra las lecturas interiores"
            : "no se puede medir: no hay accesos registrados en la ventana",
        camaras,
    };

    if (SOLO_JSON) { console.log(JSON.stringify(informe, null, 2)); await prisma.$disconnect(); return; }

    const pct = (x) => (x == null ? "—" : `${Math.round(x * 100)}%`);
    const num = (x, d = 2) => (x == null ? "—" : Number(x).toFixed(d));

    console.log(`\nCALIBRACION DEL SEGUIMIENTO · ultimas ${HORAS} h · ${hasta.toLocaleString("es-UY")}`);
    console.log("=".repeat(78));
    console.log(`Lecturas guardadas: ${filas.length}   Accesos en la ventana: ${accesos}`);
    if (!hayLog) console.log("AVISO: no se pudo leer el log del worker; faltan las metricas de rafagas.");
    console.log(`Verdad conocida: ${informe.verdadConocida}`);

    for (const c of camaras) {
        console.log(`\n── ${c.nombre} ── ${c.veredicto}`);
        console.log(`   muestra ${c.muestra} lecturas (${c.pasadas} pasadas, ${c.estadias} estadias)`);
        console.log(`   rafagas ${c.rafagas}, vacias ${c.rafagasVacias}, productivas ${pct(c.productivas)}`);
        console.log(`   confianza mediana ${num(c.confianzaMediana)} (minima ${num(c.confianzaMinima)})`);
        console.log(`   cuadros coincidentes (mediana) ${c.coincidenciasMedianas ?? "—"}`);
        console.log(`   chapas distintas ${c.chapasDistintas}, de una sola aparicion ${c.unaSolaVez} (${pct(c.propUnaVez)})`);
        console.log(`   pares casi iguales ${c.casiIguales}   cerca del umbral ${c.cercaDelUmbral}`);
        if (c.msRafagaMediana != null) console.log(`   rafaga mediana ${c.msRafagaMediana} ms`);
        for (const a of c.avisos) console.log(`   ! ${a}`);
    }
    console.log("");
    await prisma.$disconnect();
})().catch(async (e) => {
    console.error("fallo la medicion:", e.message);
    try { await prisma.$disconnect(); } catch { }
    process.exit(1);
});
