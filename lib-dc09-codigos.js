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
    306: ["OTRO", "PROGRAMACION", "Programación cambiada"], 412: ["OTRO", "PROGRAMACION", "Acceso remoto a la central"], 413: ["FALLA", "PROGRAMACION", "Acceso remoto fallido"],
    570: ["OTRO", "ANULADA", "Zona anulada"], 625: ["OTRO", "PROGRAMACION", "Cambio de fecha y hora"], 626: ["FALLA", "SISTEMA", "Hora de la central inexacta"], 601: ["PRUEBA", "PRUEBA", "Prueba manual"], 602: ["PRUEBA", "PRUEBA", "Prueba periódica"], 627: ["OTRO", "PROGRAMACION", "Entró en programación"], 628: ["OTRO", "PROGRAMACION", "Salió de programación"],
};
/*
 * El resto de la tabla Contact ID de Ademco (SIA DC-05), para que ningún código estándar llegue como
 * «Evento N» (23/10, Nico: «Evento 554 no lo reconocés: debés reconocerlos todos»). No pisa lo de
 * arriba: lo de arriba es lo que ya se había probado contra centrales reales.
 * Fuente: lista completa de códigos Contact ID de Ademco (DC-05).
 */
const CID_ESTANDAR = {
    116: ["ALARMA", "INCENDIO", "Ducto"], 117: ["ALARMA", "INCENDIO", "Llama"],
    124: ["ALARMA", "COACCION", "Coacción: acceso concedido"], 125: ["ALARMA", "COACCION", "Coacción: salida concedida"],
    141: ["ALARMA", "GENERAL", "Lazo de sondeo abierto"], 142: ["ALARMA", "GENERAL", "Lazo de sondeo en corto"], 146: ["ALARMA", "ROBO", "Robo silencioso"],
    152: ["ALARMA", "TEMPERATURA", "Refrigeración"], 153: ["ALARMA", "TEMPERATURA", "Pérdida de calefacción"], 155: ["ALARMA", "ROBO", "Rotura de lámina (vidrio)"],
    156: ["ALARMA", "GENERAL", "Falla de día"], 157: ["ALARMA", "GAS", "Gas envasado bajo"], 161: ["ALARMA", "GENERAL", "Pérdida de flujo de aire"],
    162: ["ALARMA", "GAS", "Monóxido de carbono"], 163: ["ALARMA", "GENERAL", "Nivel de tanque"],
    200: ["FALLA", "INCENDIO", "Supervisión de incendio"], 201: ["FALLA", "INCENDIO", "Baja presión de agua"], 202: ["FALLA", "INCENDIO", "Bajo CO2"],
    203: ["FALLA", "INCENDIO", "Sensor de válvula"], 204: ["FALLA", "INCENDIO", "Bajo nivel de agua"], 205: ["FALLA", "INCENDIO", "Bomba activada"], 206: ["FALLA", "INCENDIO", "Falla de bomba"],
    303: ["FALLA", "SISTEMA", "Falla de memoria RAM"], 304: ["FALLA", "SISTEMA", "Falla de memoria ROM"], 307: ["FALLA", "SISTEMA", "Autoprueba fallida"],
    308: ["FALLA", "SISTEMA", "Apagado del sistema"], 310: ["FALLA", "SISTEMA", "Falla de tierra"], 312: ["FALLA", "CORRIENTE", "Sobrecorriente en la fuente"],
    313: ["OTRO", "SISTEMA", "Reinicio por el técnico"], 314: ["FALLA", "CORRIENTE", "Falla de la fuente principal"],
    320: ["FALLA", "SIRENA", "Falla de sirena o relé"], 322: ["FALLA", "SIRENA", "Falla de sirena 2"], 323: ["FALLA", "SIRENA", "Falla del relé de alarma"],
    324: ["FALLA", "SIRENA", "Falla del relé de falla"], 325: ["FALLA", "SIRENA", "Falla del relé inversor"], 326: ["FALLA", "SIRENA", "Falla del circuito de aviso 3"], 327: ["FALLA", "SIRENA", "Falla del circuito de aviso 4"],
    330: ["FALLA", "EXPANSOR", "Falla de periférico"], 331: ["FALLA", "EXPANSOR", "Lazo de sondeo abierto"], 332: ["FALLA", "EXPANSOR", "Lazo de sondeo en corto"], 333: ["FALLA", "EXPANSOR", "Falla de módulo expansor"],
    334: ["FALLA", "EXPANSOR", "Falla de repetidor"], 335: ["FALLA", "EXPANSOR", "Impresora sin papel"], 336: ["FALLA", "EXPANSOR", "Falla de impresora"],
    337: ["FALLA", "CORRIENTE", "Módulo sin corriente continua"], 338: ["FALLA", "BATERIA", "Batería baja de módulo"], 339: ["OTRO", "SISTEMA", "Reinicio de módulo"],
    341: ["ALARMA", "SABOTAJE", "Sabotaje de módulo"], 342: ["FALLA", "CORRIENTE", "Módulo sin corriente"], 343: ["FALLA", "EXPANSOR", "Autoprueba de módulo fallida"], 344: ["FALLA", "SENSOR", "Interferencia de radio"],
    352: ["FALLA", "COMUNICACION", "Falla de línea 2"], 353: ["FALLA", "COMUNICACION", "Falla del transmisor de radio"], 355: ["FALLA", "COMUNICACION", "Pérdida de supervisión de radio"],
    356: ["FALLA", "COMUNICACION", "Pérdida del sondeo central"], 357: ["FALLA", "COMUNICACION", "Problema de antena del radio (VSWR)"],
    370: ["FALLA", "SENSOR", "Falla de lazo de protección"], 371: ["FALLA", "SENSOR", "Lazo de protección abierto"], 372: ["FALLA", "SENSOR", "Lazo de protección en corto"],
    373: ["FALLA", "INCENDIO", "Falla de incendio"], 374: ["ALARMA", "ROBO", "Error de salida (zona)"], 375: ["FALLA", "SENSOR", "Falla de zona de pánico"],
    376: ["FALLA", "SENSOR", "Falla de zona de asalto"], 377: ["FALLA", "SENSOR", "Zona repetitiva (swinger)"], 378: ["FALLA", "SENSOR", "Falla de zona cruzada"],
    382: ["FALLA", "SENSOR", "Pérdida de supervisión (RPM)"], 385: ["FALLA", "SENSOR", "Detector de humo: sensibilidad alta"], 386: ["FALLA", "SENSOR", "Detector de humo: sensibilidad baja"],
    387: ["FALLA", "SENSOR", "Intrusión: sensibilidad alta"], 388: ["FALLA", "SENSOR", "Intrusión: sensibilidad baja"], 389: ["FALLA", "SENSOR", "Autoprueba de sensor fallida"],
    391: ["FALLA", "SENSOR", "Falla de vigilancia de sensor"], 392: ["FALLA", "SENSOR", "Error de compensación"], 393: ["FALLA", "SENSOR", "Aviso de mantenimiento"],
    404: ["OTRO", "HORARIO", "Apertura o cierre tarde"], 405: ["OTRO", "HORARIO", "Apertura o cierre diferido"], 411: ["OTRO", "PROGRAMACION", "Pedido de devolución de llamada"],
    414: ["OTRO", "SISTEMA", "Apagado del sistema"], 415: ["OTRO", "COMUNICACION", "Discador apagado"], 416: ["OTRO", "PROGRAMACION", "Carga remota exitosa"],
    421: ["OTRO", "ACCESO", "Acceso denegado"], 422: ["OTRO", "ACCESO", "Acceso de usuario"], 423: ["ALARMA", "ROBO", "Acceso forzado"], 424: ["OTRO", "ACCESO", "Salida denegada"],
    425: ["OTRO", "ACCESO", "Salida concedida"], 426: ["FALLA", "SENSOR", "Puerta de acceso abierta demasiado tiempo"], 427: ["FALLA", "SENSOR", "Falla de monitor de puerta"],
    428: ["FALLA", "SENSOR", "Falla de pulsador de salida"], 429: ["FALLA", "SENSOR", "Falla de sensor de puerta"], 430: ["FALLA", "SENSOR", "Falla de lector"],
    431: ["FALLA", "SENSOR", "Falla de cerradura"], 432: ["FALLA", "SENSOR", "Falla de integridad de puerta"], 433: ["FALLA", "SENSOR", "Falla de zona cruzada de puerta"],
    434: ["ALARMA", "COACCION", "Coacción en puerta"], 435: ["ALARMA", "ROBO", "Salida por puerta en alarma"],
    450: ["OTRO", "HORARIO", "Apertura o cierre fuera de excepción"], 451: ["OTRO", "HORARIO", "Apertura o cierre temprano"], 452: ["OTRO", "HORARIO", "Apertura o cierre tarde"],
    453: ["OTRO", "HORARIO", "No se abrió"], 454: ["OTRO", "HORARIO", "No se cerró"], 455: ["FALLA", "SISTEMA", "Falló el armado automático"], 457: ["ALARMA", "ROBO", "Error de salida (usuario)"],
    458: ["OTRO", "ACCESO", "Usuario en el lugar"], 459: ["ALARMA", "ROBO", "Cierre reciente tras alarma"], 461: ["OTRO", "ACCESO", "Código incorrecto"], 462: ["OTRO", "ACCESO", "Código correcto"],
    463: ["OTRO", "SISTEMA", "Rearmado después de una alarma"], 464: ["OTRO", "HORARIO", "Armado automático postergado"], 465: ["OTRO", "SISTEMA", "Pánico restablecido"], 466: ["OTRO", "ACCESO", "Servicio en el lugar"],
    501: ["OTRO", "ANULADA", "Lector de acceso desactivado"], 520: ["OTRO", "ANULADA", "Sirena o relé desactivado"], 521: ["OTRO", "ANULADA", "Sirena 1 desactivada"], 522: ["OTRO", "ANULADA", "Sirena 2 desactivada"],
    523: ["OTRO", "ANULADA", "Relé de alarma desactivado"], 524: ["OTRO", "ANULADA", "Relé de falla desactivado"], 525: ["OTRO", "ANULADA", "Relé inversor desactivado"],
    526: ["OTRO", "ANULADA", "Circuito de aviso 3 desactivado"], 527: ["OTRO", "ANULADA", "Circuito de aviso 4 desactivado"], 531: ["OTRO", "SISTEMA", "Módulo agregado"], 532: ["OTRO", "SISTEMA", "Módulo quitado"],
    551: ["OTRO", "COMUNICACION", "Discador desactivado"], 552: ["OTRO", "COMUNICACION", "Transmisor de radio desactivado"], 553: ["OTRO", "COMUNICACION", "Carga y descarga remota desactivada"],
    571: ["OTRO", "ANULADA", "Zona de incendio anulada"], 572: ["OTRO", "ANULADA", "Zona 24 h anulada"], 573: ["OTRO", "ANULADA", "Zona de robo anulada"], 574: ["OTRO", "ANULADA", "Grupo anulado"],
    575: ["OTRO", "ANULADA", "Zona repetitiva anulada"], 576: ["OTRO", "ANULADA", "Zona de acceso puenteada"], 577: ["OTRO", "ANULADA", "Punto de acceso anulado"],
    603: ["PRUEBA", "PRUEBA", "Transmisión periódica de radio"], 604: ["PRUEBA", "PRUEBA", "Prueba de incendio"], 605: ["OTRO", "SISTEMA", "Sigue un informe de estado"],
    606: ["OTRO", "SISTEMA", "Sigue escucha de audio"], 607: ["PRUEBA", "PRUEBA", "Modo prueba de recorrido"], 608: ["PRUEBA", "PRUEBA", "Sistema en modo prueba"],
    609: ["OTRO", "SISTEMA", "Transmisor de video activo"], 610: ["PRUEBA", "PRUEBA", "Punto probado: bien"], 611: ["PRUEBA", "PRUEBA", "Punto sin probar"], 612: ["PRUEBA", "PRUEBA", "Puntos sin probar"],
    613: ["PRUEBA", "PRUEBA", "Zona de intrusión probada"], 614: ["PRUEBA", "PRUEBA", "Zona de incendio probada"], 615: ["PRUEBA", "PRUEBA", "Zona de pánico probada"], 616: ["OTRO", "SISTEMA", "Pedido de servicio"],
    621: ["OTRO", "SISTEMA", "Registro de eventos borrado"], 622: ["OTRO", "SISTEMA", "Registro de eventos al 50 %"], 623: ["OTRO", "SISTEMA", "Registro de eventos al 90 %"], 624: ["OTRO", "SISTEMA", "Registro de eventos lleno"],
    629: ["OTRO", "SISTEMA", "Marca de registro de 32 horas"], 630: ["OTRO", "HORARIO", "Cambio de horario"], 631: ["OTRO", "HORARIO", "Cambio de horario de excepción"], 632: ["OTRO", "HORARIO", "Cambio de horario de acceso"],
    641: ["ALARMA", "MEDICA", "Inactividad de la persona vigilada"], 642: ["OTRO", "ACCESO", "Llegada esperada (latch-key)"],
    651: ["OTRO", "SISTEMA", "Reinicio"], 652: ["OTRO", "PROGRAMACION", "Código de usuario borrado"], 653: ["OTRO", "PROGRAMACION", "Código de usuario cambiado"], 654: ["OTRO", "PROGRAMACION", "Nivel de acceso de usuario cambiado"],
    655: ["OTRO", "SISTEMA", "Reinicio"], 656: ["OTRO", "PROGRAMACION", "Código de usuario agregado"], 657: ["OTRO", "PROGRAMACION", "Usuario borrado"], 658: ["OTRO", "PROGRAMACION", "Usuario cambiado"], 659: ["OTRO", "PROGRAMACION", "Nivel de acceso cambiado"],
    750: ["OTRO", "PROGRAMACION", "Configuración aplicada"], 751: ["OTRO", "PROGRAMACION", "Configuración de módulo cambiada"], 752: ["OTRO", "SISTEMA", "Módulo agregado"], 753: ["OTRO", "SISTEMA", "Módulo quitado"],
    754: ["OTRO", "PROGRAMACION", "Actualización de firmware"], 755: ["OTRO", "PROGRAMACION", "Firmware actualizado"], 756: ["FALLA", "PROGRAMACION", "Falló la actualización de firmware"],
};
for (const [k, v] of Object.entries(CID_ESTANDAR)) if (!(k in CID)) CID[k] = v;
for (let k = 760; k <= 799; k++) if (!(k in CID)) CID[k] = ["OTRO", "ACCESO", "Inactividad de usuario"];

/**
 * Un código que no está en la tabla (propio del fabricante, como el 554 de Paradox): se nombra por
 * su familia del estándar, que es lo que se puede decir con certeza, y con el número a la vista.
 */
function familiaCid(ev) {
    const f = (cat, tipo, texto) => [cat, tipo, `${texto} (código ${ev})`];
    if (ev >= 100 && ev < 200) return f("ALARMA", "GENERAL", "Alarma");
    if (ev >= 200 && ev < 300) return f("FALLA", "INCENDIO", "Supervisión de incendio");
    if (ev >= 350 && ev < 360) return f("FALLA", "COMUNICACION", "Falla de comunicación");
    if (ev >= 380 && ev < 400) return f("FALLA", "SENSOR", "Falla de sensor");
    if (ev >= 300 && ev < 400) return f("FALLA", "SISTEMA", "Falla del sistema");
    if (ev >= 400 && ev < 420) return f("OTRO", "ACCESO", "Apertura o cierre");
    if (ev >= 420 && ev < 440) return f("OTRO", "ACCESO", "Control de acceso");
    if (ev >= 400 && ev < 500) return f("OTRO", "HORARIO", "Apertura o cierre");
    if (ev >= 520 && ev < 530) return f("OTRO", "ANULADA", "Sirena o relé desactivado");
    if (ev >= 530 && ev < 540) return f("OTRO", "SISTEMA", "Módulo");
    if (ev >= 550 && ev < 570) return f("OTRO", "COMUNICACION", "Comunicación desactivada");
    if (ev >= 570 && ev < 580) return f("OTRO", "ANULADA", "Anulación");
    if (ev >= 500 && ev < 600) return f("OTRO", "ANULADA", "Desactivación");
    if (ev >= 600 && ev < 620) return f("PRUEBA", "PRUEBA", "Prueba");
    if (ev >= 620 && ev < 700) return f("OTRO", "SISTEMA", "Evento del sistema");
    if (ev >= 700 && ev < 800) return f("OTRO", "PROGRAMACION", "Configuración");
    return f("OTRO", "SISTEMA", "Evento propio de la central");
}

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
        // 406 no es un desarmado «cancelado»: es el usuario cancelando la alarma en curso (con su código),
        // y en Paradox llega junto al 401 del desarmado (prueba real del IPC10, 22/10).
        const texto = ev === 406 ? "Alarma cancelada por el usuario" : `${arma ? "Armado" : "Desarmado"}${extra ? ` ${extra}` : ""}`;
        return [{ categoria: arma ? "ARMADO" : "DESARMADO", tipo: arma ? (presente ? "PRESENTE" : "ARMADO") : "DESARMADO", texto, codigo, cid: ev, particion: part, usuario: zz, zona: null }];
    }
    const def = CID[ev] || familiaCid(ev);
    let [categoria, tipo, texto] = def;
    if (q === 3) {
        if (categoria === "ALARMA") { categoria = "RESTAURACION"; texto = `${texto} restaurado`; }
        else if (categoria === "FALLA") { categoria = "FALLA_FIN"; texto = `${texto}: normal`; }
        // El resto (anulaciones, desactivaciones, sistema) también vuelve: se dice que terminó.
        else if (categoria === "OTRO") texto = `${texto}: fin`;
    }
    // El último campo es la zona sólo en alarmas y restauraciones; en 3xx/6xx suele ser un módulo
    // o nada, y «000» quiere decir «la central» (no una zona 0): no se crea una zona de mentira.
    // Una anulación (57x) también nombra la zona anulada.
    const esZona = (categoria === "ALARMA" || categoria === "RESTAURACION" || tipo === "ANULADA") && zz > 0;
    return [{ categoria, tipo, texto, codigo, cid: ev, particion: part, zona: esZona ? zz : null, modulo: esZona ? null : zz || null, usuario: null, ...(q === 3 ? { restaura: true } : {}), ...(CID[ev] ? {} : { propio: true }) }];
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

module.exports = { traducir, traducirCid, traducirSia, CID, SIA, ES_ALARMA, familiaCid };
