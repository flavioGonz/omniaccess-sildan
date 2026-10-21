/**
 * Qué quiere decir cada evento de una central: Contact ID (ADM-CID) y SIA (SIA-DCS) a una misma
 * CATEGORÍA (lo que hace OmniAccess con él) y un TIPO fino (lo que ve el operador).
 *
 *   ALARMA        → una alarma para la Gestión de alarmas y el Monitor de Intrusión
 *   RESTAURACION  → la zona volvió a la normalidad (no cierra la alarma: eso lo decide el operador)
 *   ARMADO / DESARMADO
 *   FALLA / FALLA_FIN → batería, corriente, comunicación, sensor (van a la salud del equipo)
 *   PRUEBA        → la prueba periódica (cuenta como supervisión)
 *   OTRO
 *
 * Puro, sin base: lo usan el receptor, el simulador y las pruebas.
 */
"use strict";

// Contact ID: código → [categoría, tipo, texto]. Los 4xx de apertura/cierre se resuelven con el calificador.
const CID = {
    100: ["ALARMA", "MEDICA", "Emergencia médica"], 101: ["ALARMA", "MEDICA", "Emergencia personal"], 102: ["FALLA", "SUPERVISION", "Falla de reporte"],
    110: ["ALARMA", "INCENDIO", "Incendio"], 111: ["ALARMA", "INCENDIO", "Humo"], 112: ["ALARMA", "INCENDIO", "Combustión"], 113: ["ALARMA", "INCENDIO", "Flujo de agua (rociadores)"], 114: ["ALARMA", "INCENDIO", "Calor"], 115: ["ALARMA", "INCENDIO", "Pulsador de incendio"], 118: ["ALARMA", "INCENDIO", "Prealarma de incendio"],
    120: ["ALARMA", "PANICO", "Pánico"], 121: ["ALARMA", "COACCION", "Coacción"], 122: ["ALARMA", "PANICO", "Pánico silencioso"], 123: ["ALARMA", "PANICO", "Pánico audible"],
    130: ["ALARMA", "ROBO", "Robo"], 131: ["ALARMA", "ROBO", "Robo perimetral"], 132: ["ALARMA", "ROBO", "Robo interior"], 133: ["ALARMA", "ROBO", "Zona 24 horas"], 134: ["ALARMA", "ROBO", "Entrada / salida"], 135: ["ALARMA", "ROBO", "Día / noche"], 136: ["ALARMA", "ROBO", "Robo exterior"], 137: ["ALARMA", "SABOTAJE", "Sabotaje"], 138: ["ALARMA", "ROBO", "Casi alarma"], 139: ["ALARMA", "ROBO", "Intrusión verificada"],
    140: ["ALARMA", "GENERAL", "Alarma general"], 143: ["FALLA", "EXPANSOR", "Falla de expansor"], 144: ["ALARMA", "SABOTAJE", "Sabotaje de sensor"], 145: ["ALARMA", "SABOTAJE", "Sabotaje de expansor"],
    150: ["ALARMA", "GENERAL", "Alarma 24 h (no robo)"], 151: ["ALARMA", "GAS", "Gas"], 154: ["ALARMA", "AGUA", "Pérdida de agua"], 158: ["ALARMA", "TEMPERATURA", "Temperatura alta"], 159: ["ALARMA", "TEMPERATURA", "Temperatura baja"],
    300: ["FALLA", "SISTEMA", "Falla del sistema"], 301: ["FALLA", "CORRIENTE", "Corte de corriente"], 302: ["FALLA", "BATERIA", "Batería baja"], 305: ["OTRO", "SISTEMA", "Reinicio del sistema"], 309: ["FALLA", "BATERIA", "Prueba de batería fallida"], 311: ["FALLA", "BATERIA", "Sin batería"], 321: ["FALLA", "SIRENA", "Falla de sirena"],
    350: ["FALLA", "COMUNICACION", "Falla de comunicación"], 351: ["FALLA", "COMUNICACION", "Falla de línea 1"], 354: ["FALLA", "COMUNICACION", "Falla al comunicar un evento"],
    380: ["FALLA", "SENSOR", "Falla de sensor"], 381: ["FALLA", "SENSOR", "Sensor inalámbrico sin supervisión"], 383: ["ALARMA", "SABOTAJE", "Sabotaje de sensor"], 384: ["FALLA", "BATERIA", "Batería baja de sensor inalámbrico"],
    570: ["OTRO", "ANULADA", "Zona anulada"], 601: ["PRUEBA", "PRUEBA", "Prueba manual"], 602: ["PRUEBA", "PRUEBA", "Prueba periódica"], 627: ["OTRO", "PROGRAMACION", "Entró en programación"], 628: ["OTRO", "PROGRAMACION", "Salió de programación"],
};
const CID_APERTURA = { 400: "", 401: "", 402: "de grupo", 403: "automático", 406: "cancelado", 407: "remoto", 408: "rápido", 409: "con llave", 441: "presente", 442: "presente con llave", 456: "parcial" };

// SIA: código de dos letras → [categoría, tipo, texto]. Los de restauración apuntan al tipo de su alarma.
const SIA = {
    BA: ["ALARMA", "ROBO", "Robo"], BR: ["RESTAURACION", "ROBO", "Robo restaurado"], BV: ["ALARMA", "ROBO", "Intrusión verificada"], BB: ["OTRO", "ANULADA", "Zona anulada"], BU: ["OTRO", "ANULADA", "Zona habilitada"], BT: ["FALLA", "SENSOR", "Falla de zona"], BJ: ["FALLA_FIN", "SENSOR", "Zona sin falla"],
    PA: ["ALARMA", "PANICO", "Pánico"], PR: ["RESTAURACION", "PANICO", "Pánico restaurado"],
    HA: ["ALARMA", "COACCION", "Asalto / coacción"], HR: ["RESTAURACION", "COACCION", "Asalto restaurado"],
    FA: ["ALARMA", "INCENDIO", "Incendio"], FR: ["RESTAURACION", "INCENDIO", "Incendio restaurado"], FT: ["FALLA", "INCENDIO", "Falla de incendio"], FJ: ["FALLA_FIN", "INCENDIO", "Incendio sin falla"],
    MA: ["ALARMA", "MEDICA", "Emergencia médica"], MR: ["RESTAURACION", "MEDICA", "Emergencia médica restaurada"],
    QA: ["ALARMA", "MEDICA", "Emergencia"], QR: ["RESTAURACION", "MEDICA", "Emergencia restaurada"],
    TA: ["ALARMA", "SABOTAJE", "Sabotaje"], TR: ["RESTAURACION", "SABOTAJE", "Sabotaje restaurado"],
    GA: ["ALARMA", "GAS", "Gas"], GR: ["RESTAURACION", "GAS", "Gas restaurado"],
    WA: ["ALARMA", "AGUA", "Pérdida de agua"], WR: ["RESTAURACION", "AGUA", "Agua restaurada"],
    KA: ["ALARMA", "TEMPERATURA", "Calor"], KR: ["RESTAURACION", "TEMPERATURA", "Calor restaurado"],
    UA: ["ALARMA", "GENERAL", "Alarma"], UR: ["RESTAURACION", "GENERAL", "Alarma restaurada"],
    EA: ["ALARMA", "ROBO", "Salida forzada"],
    CL: ["ARMADO", "ARMADO", "Armado"], CG: ["ARMADO", "ARMADO", "Partición armada"], CA: ["ARMADO", "ARMADO", "Armado automático"], CS: ["ARMADO", "ARMADO", "Armado con llave"], CQ: ["ARMADO", "ARMADO", "Armado remoto"], NL: ["ARMADO", "PRESENTE", "Armado presente"], CR: ["ARMADO", "ARMADO", "Armado reciente"],
    OP: ["DESARMADO", "DESARMADO", "Desarmado"], OG: ["DESARMADO", "DESARMADO", "Partición desarmada"], OA: ["DESARMADO", "DESARMADO", "Desarmado automático"], OS: ["DESARMADO", "DESARMADO", "Desarmado con llave"], OQ: ["DESARMADO", "DESARMADO", "Desarmado remoto"], OC: ["DESARMADO", "DESARMADO", "Armado cancelado"],
    AT: ["FALLA", "CORRIENTE", "Corte de corriente"], AR: ["FALLA_FIN", "CORRIENTE", "Corriente restaurada"],
    YT: ["FALLA", "BATERIA", "Batería baja"], YR: ["FALLA_FIN", "BATERIA", "Batería normal"], YM: ["FALLA", "BATERIA", "Sin batería"],
    XT: ["FALLA", "BATERIA", "Batería baja de sensor inalámbrico"], XR: ["FALLA_FIN", "BATERIA", "Batería de sensor normal"],
    YC: ["FALLA", "COMUNICACION", "Falla de comunicación"], YK: ["FALLA_FIN", "COMUNICACION", "Comunicación restaurada"], LT: ["FALLA", "COMUNICACION", "Falla de línea"], LR: ["FALLA_FIN", "COMUNICACION", "Línea restaurada"],
    XQ: ["FALLA", "SENSOR", "Interferencia de radio"], XH: ["FALLA_FIN", "SENSOR", "Radio sin interferencia"], US: ["FALLA", "SENSOR", "Sensor sin supervisión"], UJ: ["FALLA_FIN", "SENSOR", "Sensor supervisado"],
    RP: ["PRUEBA", "PRUEBA", "Prueba periódica"], RX: ["PRUEBA", "PRUEBA", "Prueba manual"], RR: ["OTRO", "SISTEMA", "Encendido"], RS: ["OTRO", "SISTEMA", "Reinicio"],
    LB: ["OTRO", "PROGRAMACION", "Entró en programación"], LX: ["OTRO", "PROGRAMACION", "Salió de programación"],
    JA: ["ALARMA", "SABOTAJE", "Código erróneo repetido"],
    DD: ["OTRO", "ACCESO", "Acceso denegado"], DG: ["OTRO", "ACCESO", "Acceso concedido"],
};
// Cuál restauración corresponde a cada alarma SIA (para la ficha).
const SIA_RESTAURA = { BR: "BA", PR: "PA", HR: "HA", FR: "FA", MR: "MA", QR: "QA", TR: "TA", GR: "GA", WR: "WA", KR: "KA", UR: "UA" };

const num = (s) => { const n = parseInt(s, 10); return Number.isFinite(n) ? n : null; };

/** Contact ID: «QEEE GG ZZZ» (con o sin espacios). */
function traducirCid(datos) {
    const s = String(datos || "").replace(/\s+/g, "");
    const m = /^([136])(\d{3})([0-9A-F]{2})([0-9A-F]{3})/i.exec(s);
    if (!m) return [{ categoria: "OTRO", tipo: "DESCONOCIDO", texto: `Contact ID ilegible: ${String(datos).slice(0, 40)}`, codigo: null }];
    const q = Number(m[1]), ev = Number(m[2]), part = num(m[3]), zz = num(m[4]);
    const codigo = `CID ${m[1]}${m[2]}`;
    if (ev in CID_APERTURA) {
        // 1 = apertura (desarma), 3 = cierre (arma). El tercer campo es el usuario.
        const arma = q === 3;
        const extra = CID_APERTURA[ev];
        const presente = ev === 441 || ev === 442 || ev === 456;
        return [{ categoria: arma ? "ARMADO" : "DESARMADO", tipo: arma ? (presente ? "PRESENTE" : "ARMADO") : "DESARMADO", texto: `${arma ? "Armado" : "Desarmado"}${extra ? ` ${extra}` : ""}`, codigo, cid: ev, particion: part, usuario: zz, zona: null }];
    }
    const def = CID[ev] || (ev >= 100 && ev < 200 ? ["ALARMA", "GENERAL", `Alarma ${ev}`] : ev >= 300 && ev < 400 ? ["FALLA", "SISTEMA", `Falla ${ev}`] : ["OTRO", "DESCONOCIDO", `Evento ${ev}`]);
    let [categoria, tipo, texto] = def;
    if (q === 3) {
        if (categoria === "ALARMA") { categoria = "RESTAURACION"; texto = `${texto} restaurado`; }
        else if (categoria === "FALLA") { categoria = "FALLA_FIN"; texto = `${texto}: normal`; }
    }
    // En los 3xx/6xx el último campo no siempre es una zona (puede ser un módulo): se guarda igual.
    return [{ categoria, tipo, texto, codigo, cid: ev, particion: part, zona: zz, usuario: null }];
}

/**
 * SIA DC-03 dentro de SIA-DCS: «Nri1/BA003» o «Nri1/id5/OP» o varios: «Nri1/BA003/BA004».
 * Empieza con N (evento nuevo) u O (viejo). Los modificadores en minúscula (ri = partición,
 * id = usuario, pi = periférico, ti = hora) valen para los eventos que siguen.
 */
function traducirSia(datos) {
    let s = String(datos || "").trim();
    if (!s) return [];
    if (/^[NO]/.test(s)) s = s.slice(1);
    const out = [];
    let particion = null, usuario = null;
    for (const tok of s.split(/[/|]/).map((x) => x.trim()).filter(Boolean)) {
        const mod = /^([a-z]{2})(.*)$/.exec(tok);
        if (mod) {
            if (mod[1] === "ri") particion = num(mod[2]);
            else if (mod[1] === "id") usuario = num(mod[2]);
            continue;
        }
        const ev = /^([A-Z]{2})\s*(\d*)(?:\^(.*?)\^)?/.exec(tok);
        if (!ev) continue;
        const [categoria, tipo, texto] = SIA[ev[1]] || ["OTRO", "DESCONOCIDO", `Evento ${ev[1]}`];
        const n = ev[2] ? num(ev[2]) : null;
        // En armado/desarmado el número es el usuario; en el resto, la zona.
        const esUsuario = categoria === "ARMADO" || categoria === "DESARMADO";
        out.push({ categoria, tipo, texto, codigo: `SIA ${ev[1]}`, sia: ev[1], restauraA: SIA_RESTAURA[ev[1]] || null, particion, zona: esUsuario ? null : n, usuario: esUsuario ? (n ?? usuario) : usuario, nombre: ev[3] || null });
    }
    return out;
}

/** Los eventos de un mensaje leído (lib-dc09.leer). NULL no tiene eventos: es supervisión. */
function traducir(m) {
    if (!m || m.id === "NULL") return [];
    if (m.id === "ADM-CID") return traducirCid(m.datos);
    if (m.id === "SIA-DCS") return traducirSia(m.datos);
    return [];
}

/** Las categorías que, según el ajuste, son una alarma para el operador. */
const ES_ALARMA = (e) => e.categoria === "ALARMA";

module.exports = { traducir, traducirCid, traducirSia, CID, SIA, ES_ALARMA };
