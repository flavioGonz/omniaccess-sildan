/**
 * Los comandos que se le pueden mandar a un rastreador, uno por uno (23/11).
 *
 * Pedido de Nico: «debemos poder integrar todos los comandos disponibles de este GPS y del driver
 * que hicimos». Hasta acá había cinco, escritos a mano en la acción: preguntar el estado y la
 * posición, y el relé.
 *
 * ── Sigue siendo una lista cerrada ──────────────────────────────────────────
 *
 * El equipo acepta por este canal lo mismo que por SMS, y eso incluye cambiarle el servidor,
 * apagarle los datos y volverlo de fábrica. Por eso no hay un campo de texto libre, ni lo va a
 * haber: cada comando está acá con nombre, con lo que hace, con sus valores acotados y con el
 * permiso que pide. Lo que arma el texto que viaja es `armarComando`, y sólo acepta lo que el
 * catálogo describe.
 *
 * ── De dónde sale cada uno ──────────────────────────────────────────────────
 *
 * El equipo es un clon de GT06 (firmware `W16_NP_v01`) y su manual no existe. El 23/11 se le
 * mandaron, una por una, las CONSULTAS del protocolo de Concox —las que sólo preguntan— y se
 * anotó cuáles contestó y con qué palabras; esas respuestas son las que leen las funciones `leer`
 * de abajo, y están tal cual en tests/gps-comandos.test.ts. Contestó a casi todas, con el mismo
 * formato del original: es un Concox por dentro.
 *
 * Las ESCRITURAS (cambiar un intervalo, prender una alarma) usan la sintaxis del mismo protocolo,
 * pero no se le mandaron: cambiarle la configuración a un rastreador que va puesto en un vehículo
 * es una decisión de quien lo administra, no una prueba. Por eso cada escritura, después de
 * mandarse, **vuelve a preguntarle al equipo cómo quedó** y muestra las dos respuestas, textuales.
 * Si este clon no entiende alguna, se ve en el acto y no cambió nada.
 *
 * ── Lo que se dejó afuera, a propósito ──────────────────────────────────────
 *
 *  · `GPRSON,0#` (apagarle los datos): desde acá sólo sirve para perder el equipo. Se arregla
 *    nada más que por SMS.
 *  · `LANG` (el idioma de las respuestas): lo que contesta el equipo se LEE; cambiarle el idioma
 *    rompe la lectura de todo lo demás.
 *  · `FENCE` (la geocerca del propio equipo): las zonas las vigila OmniAccess, con horario, forma
 *    libre y por rastreador. Una segunda geocerca adentro del aparato avisaría por duplicado.
 *  · Lo que el equipo no contestó: `IMSI#`, `SEESOS#`, `SEEFN#`, `DISTANCE#`, `GFENCE#`, `EURL#`.
 *
 * Este archivo es puro: no manda nada ni toca la base. Lo usan la acción (para armar y validar) y
 * la pantalla (para dibujar el formulario): así lo que se ofrece y lo que se acepta no pueden
 * desencontrarse.
 */

/** Qué clase de cosa es un comando: decide el permiso que pide y cuánto se confirma. */
export type NivelComando =
    /** Sólo pregunta. No cambia nada en el equipo. */
    | "consulta"
    /** Cambia cómo reporta o qué avisa. Se puede deshacer con otro comando. */
    | "ajuste"
    /** El relé: corta o devuelve el motor. */
    | "rele"
    /** Puede dejar al equipo sin hablar con este servidor. Es de quien instala. */
    | "instalacion";

export type GrupoComando = "preguntar" | "reporte" | "alarmas" | "telefonos" | "rele" | "instalacion";
export const GRUPOS_COMANDO: { clave: GrupoComando; titulo: string; ayuda: string }[] = [
    { clave: "preguntar", titulo: "Preguntarle al equipo", ayuda: "No cambian nada: el rastreador contesta cómo está." },
    { clave: "reporte", titulo: "Cada cuánto reporta", ayuda: "Más seguido es un recorrido más fino y más datos de la SIM." },
    { clave: "alarmas", titulo: "Alarmas del equipo", ayuda: "Lo que el rastreador avisa por su cuenta. Las zonas y los excesos de OmniAccess no dependen de esto." },
    { clave: "telefonos", titulo: "Teléfonos", ayuda: "A quién le manda SMS o llama el equipo, si la alarma está puesta en ese modo." },
    { clave: "rele", titulo: "Corte de motor", ayuda: "El relé del rastreador. Sólo se acciona con el vehículo detenido." },
    { clave: "instalacion", titulo: "Instalación", ayuda: "Lo que se toca al instalar. Un valor equivocado deja al equipo sin reportar." },
];

type Base = { clave: string; rotulo: string; ayuda?: string };
export type CampoComando =
    | (Base & { tipo: "entero"; min: number; max: number; unidad?: string; defecto: number })
    | (Base & { tipo: "opcion"; opciones: { valor: string; rotulo: string }[]; defecto: string })
    | (Base & { tipo: "telefono"; opcional?: boolean })
    | (Base & { tipo: "texto"; patron: RegExp; largo: number; ejemplo: string; opcional?: boolean });

export type Valores = Record<string, string | number>;

export type DefComando = {
    clave: string;
    grupo: GrupoComando;
    titulo: string;
    /** Qué hace, en una frase que entienda quien no instaló el equipo. */
    ayuda: string;
    nivel: NivelComando;
    campos?: CampoComando[];
    /** El texto que viaja. Recibe los valores YA validados. */
    texto: (v: Valores) => string;
    /** La consulta que dice cómo está esto hoy (y cómo quedó después de cambiarlo). */
    pregunta?: string;
    /** Lee la respuesta a `pregunta` y devuelve los valores del formulario. Null si no se entiende. */
    leer?: (respuesta: string) => Valores | null;
    /** Lo que hay que saber antes de mandarlo. Se muestra siempre, al lado del botón. */
    cuidado?: string;
    /**
     * Cuánto se confirma: `toque` pide un segundo toque; `escribir` pide tipear los últimos cuatro
     * dígitos del IMEI, y el servidor lo vuelve a comprobar. Sin esto, se manda de una.
     */
    confirmar?: "toque" | "escribir";
    /** El equipo se reinicia y puede no llegar a contestar: que no conteste no es que haya fallado. */
    puedeCallar?: boolean;
    /** Cómo se anota en el historial, si el texto lleva algo que no tiene que quedar escrito (una contraseña). */
    paraAnotar?: (v: Valores) => string;
};

/* ── Leer lo que contesta el equipo ───────────────────────────────────────── */

/** Los números de una respuesta, en orden, después de los dos puntos: «Timer:10,10;» → [10, 10]. */
const numeros = (r: string): number[] => (r.slice(r.indexOf(":") + 1).match(/-?\d+/g) || []).map(Number);
/** «…:ON,…» o «Switch:OFF». Null si no dice ni una cosa ni la otra. */
const prendido = (r: string): boolean | null => (/\bON\b/i.test(r) ? true : /\bOFF\b/i.test(r) ? false : null);
/**
 * Por dónde avisa una alarma. El equipo lo contesta en palabras («GPRS», «SMS+GPRS») o con el
 * número; adentro del comando va siempre el número.
 */
const modoDe = (r: string): string => {
    if (/call/i.test(r)) return "2";
    if (/sms/i.test(r)) return "1";
    const m = /,\s*([012])\s*[,;]/.exec(r);
    return m ? m[1] : "0";
};
const MODOS = [
    { valor: "0", rotulo: "Sólo a OmniAccess" },
    { valor: "1", rotulo: "Y por SMS al teléfono SOS" },
    { valor: "2", rotulo: "SMS y además llamada" },
];
const SI_NO = [{ valor: "ON", rotulo: "Prendida" }, { valor: "OFF", rotulo: "Apagada" }];
const campoPrendida: CampoComando = { clave: "on", rotulo: "Esta alarma", tipo: "opcion", opciones: SI_NO, defecto: "ON" };
const campoModo: CampoComando = { clave: "modo", rotulo: "Avisa", tipo: "opcion", opciones: MODOS, defecto: "0", ayuda: "Los SMS y las llamadas salen de la SIM del rastreador, y sólo si hay un teléfono SOS cargado." };
const conSwitch = (r: string, resto: (n: number[]) => Valores | null): Valores | null => {
    const on = prendido(r); if (on === null) return null;
    const v = resto(numeros(r)); return v ? { on: on ? "ON" : "OFF", ...v } : null;
};

/** Un teléfono como lo acepta el equipo: dígitos, con un + adelante si es internacional. */
export const TELEFONO = /^\+?\d{6,15}$/;
/** Nombre de un servidor o una IP: letras, números, puntos y guiones. Sin espacios ni comas, que cortarían el comando. */
const SERVIDOR = /^(?=.{4,60}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
const ES_IP = /^\d{1,3}(\.\d{1,3}){3}$/;
/** El nombre de la red de la operadora (APN) y su usuario: sin comas ni numerales. */
const APN = /^[a-z0-9._-]{1,40}$/i;

/* ── El catálogo del GT06 ─────────────────────────────────────────────────── */

export const COMANDOS_GT06: DefComando[] = [
    // ── Preguntarle ──
    { clave: "estado", grupo: "preguntar", titulo: "Cómo está", nivel: "consulta", texto: () => "STATUS#",
        ayuda: "Alimentación, enlace de datos, señal, si tiene el GPS despierto, el contacto y la guardia." },
    { clave: "posicion", grupo: "preguntar", titulo: "Dónde está", nivel: "consulta", texto: () => "WHERE#",
        ayuda: "La última posición que sabe, con rumbo, velocidad y hora." },
    { clave: "enlace", grupo: "preguntar", titulo: "Enlace al mapa", nivel: "consulta", texto: () => "URL#",
        ayuda: "La misma posición como un enlace de Google Maps, que es lo que mandaría por SMS." },
    { clave: "parametros", grupo: "preguntar", titulo: "Su configuración", nivel: "consulta", texto: () => "PARAM#",
        ayuda: "Todo junto: intervalos, latido, teléfonos, sensor, guardia y zona horaria." },
    { clave: "conexion", grupo: "preguntar", titulo: "Su conexión", nivel: "consulta", texto: () => "GPRSSET#",
        ayuda: "A qué red de datos (APN) y a qué servidor le reporta." },
    { clave: "version", grupo: "preguntar", titulo: "Versión del programa", nivel: "consulta", texto: () => "VERSION#",
        ayuda: "El firmware que lleva adentro. Sirve para saber qué comandos entiende." },
    { clave: "sim", grupo: "preguntar", titulo: "La SIM", nivel: "consulta", texto: () => "ICCID#",
        ayuda: "El número de serie del chip (ICCID): es lo que pide la operadora para reponerlo o darlo de baja." },
    { clave: "rele", grupo: "rele", titulo: "Cómo está el relé", nivel: "consulta", texto: () => "RELAY#",
        ayuda: "Se le pregunta al equipo, en vez de confiar en lo último que dijo el latido." },

    // ── Cada cuánto reporta ──
    { clave: "reporte.intervalo", grupo: "reporte", titulo: "Intervalo de posiciones", nivel: "ajuste",
        ayuda: "Cada cuántos segundos manda una posición, con el contacto puesto y con el contacto cortado.",
        campos: [
            { clave: "andando", rotulo: "Con el contacto puesto", tipo: "entero", min: 5, max: 18000, unidad: "s", defecto: 10 },
            { clave: "quieto", rotulo: "Con el contacto cortado", tipo: "entero", min: 5, max: 18000, unidad: "s", defecto: 10, ayuda: "Detenido el GPS se duerme igual a los pocos minutos: lo que sigue llegando es el latido." },
        ],
        texto: (v) => `TIMER,${v.andando},${v.quieto}#`, pregunta: "TIMER#",
        leer: (r) => { const n = numeros(r); return n.length >= 2 ? { andando: n[0], quieto: n[1] } : null; },
        cuidado: "A 10 s son unas 360 posiciones por hora de marcha. Menos de 10 s gasta datos sin que el recorrido se vea mejor." },
    { clave: "reporte.latido", grupo: "reporte", titulo: "Latido", nivel: "ajuste",
        ayuda: "Cada cuántos minutos dice «sigo acá» aunque no se mueva. De esto sale el «en línea» y el aviso de que dejó de reportar.",
        campos: [
            { clave: "andando", rotulo: "Con el contacto puesto", tipo: "entero", min: 1, max: 300, unidad: "min", defecto: 3 },
            { clave: "quieto", rotulo: "Con el contacto cortado", tipo: "entero", min: 1, max: 300, unidad: "min", defecto: 5 },
        ],
        texto: (v) => `HBT,${v.andando},${v.quieto}#`, pregunta: "HBT#",
        leer: (r) => { const n = numeros(r); return n.length >= 2 ? { andando: n[0], quieto: n[1] } : null; },
        cuidado: "OmniAccess da por fuera de línea a un rastreador que no late en 12 minutos: con más de 10 va a figurar apagado entre latido y latido." },
    { clave: "reporte.giro", grupo: "reporte", titulo: "Reportar al doblar", nivel: "ajuste",
        ayuda: "Manda una posición extra cuando el rumbo cambia, sin esperar al intervalo: es lo que hace que las esquinas salgan redondas y no cortadas.",
        campos: [
            { clave: "on", rotulo: "Reportar al doblar", tipo: "opcion", opciones: [{ valor: "ON", rotulo: "Sí" }, { valor: "OFF", rotulo: "No" }], defecto: "ON" },
            { clave: "grados", rotulo: "A partir de un giro de", tipo: "entero", min: 5, max: 180, unidad: "°", defecto: 20 },
            { clave: "segundos", rotulo: "Sostenido durante", tipo: "entero", min: 2, max: 5, unidad: "s", defecto: 2 },
        ],
        texto: (v) => (v.on === "OFF" ? "ANGLEREP,OFF#" : `ANGLEREP,ON,${v.grados},${v.segundos}#`), pregunta: "ANGLEREP#",
        leer: (r) => conSwitch(r, (n) => ({ grados: n[0] ?? 20, segundos: n[1] ?? 2 })) },
    { clave: "reporte.despierto", grupo: "reporte", titulo: "GPS despierto después de moverse", nivel: "ajuste",
        ayuda: "Con el contacto cortado, cuántos minutos sigue buscando satélites después de la última vibración antes de dormirse.",
        campos: [{ clave: "minutos", rotulo: "Sigue despierto", tipo: "entero", min: 0, max: 300, unidad: "min", defecto: 3, ayuda: "Según el protocolo, 0 lo deja siempre despierto: más consumo de la batería del vehículo." }],
        texto: (v) => `SENDS,${v.minutos}#`, pregunta: "SENDS#",
        leer: (r) => { const n = numeros(r); return n.length ? { minutos: n[0] } : null; } },

    // ── Alarmas del equipo ──
    { clave: "alarma.velocidad", grupo: "alarmas", titulo: "Exceso de velocidad", nivel: "ajuste",
        ayuda: "El equipo avisa si pasa una velocidad durante un rato. Es aparte del límite de OmniAccess, que pinta el recorrido y arma el reporte de excesos.",
        campos: [
            campoPrendida,
            { clave: "kmh", rotulo: "Por encima de", tipo: "entero", min: 1, max: 255, unidad: "km/h", defecto: 100 },
            { clave: "segundos", rotulo: "Durante", tipo: "entero", min: 5, max: 600, unidad: "s", defecto: 10 },
            campoModo,
        ],
        texto: (v) => (v.on === "OFF" ? "SPEED,OFF#" : `SPEED,ON,${v.segundos},${v.kmh},${v.modo}#`), pregunta: "SPEED#",
        leer: (r) => conSwitch(r, (n) => ({ segundos: n[0] ?? 10, kmh: n[1] ?? 100, modo: String(n[2] ?? 0) })) },
    { clave: "alarma.movimiento", grupo: "alarmas", titulo: "Movimiento sin contacto", nivel: "ajuste",
        ayuda: "Avisa si el vehículo se aleja de donde quedó estacionado: un remolque, una grúa.",
        campos: [
            campoPrendida,
            { clave: "radio", rotulo: "Si se aleja más de", tipo: "entero", min: 100, max: 1000, unidad: "m", defecto: 300 },
            campoModo,
        ],
        texto: (v) => (v.on === "OFF" ? "MOVING,OFF#" : `MOVING,ON,${v.radio},${v.modo}#`), pregunta: "MOVING#",
        /* «Moving Switch:OFF;Radius:100m;Alarm Type:0;» */
        leer: (r) => { const on = prendido(r); const rad = /Radius\s*:\s*(\d+)/i.exec(r), tipo = /Type\s*:\s*(\d)/i.exec(r); return on === null ? null : { on: on ? "ON" : "OFF", radio: rad ? Number(rad[1]) : 300, modo: tipo ? tipo[1] : "0" }; },
        cuidado: "OmniAccess ya avisa «se mueve con el motor apagado» por su cuenta. Con las dos prendidas llegan dos avisos." },
    { clave: "alarma.vibracion", grupo: "alarmas", titulo: "Vibración", nivel: "ajuste",
        ayuda: "Con el vehículo en guardia (contacto cortado hace un rato), avisa si lo sacuden. Estacionado en la calle puede avisar decenas de veces por día.",
        campos: [campoPrendida, campoModo],
        texto: (v) => (v.on === "OFF" ? "SENALM,OFF#" : `SENALM,ON,${v.modo}#`), pregunta: "SENALM#",
        leer: (r) => { const on = prendido(r); return on === null ? null : { on: on ? "ON" : "OFF", modo: modoDe(r) }; } },
    { clave: "alarma.sensor", grupo: "alarmas", titulo: "Sensor de vibración", nivel: "ajuste",
        ayuda: "Cuánto tiene que durar una sacudida para contarla y cada cuánto puede repetir el aviso.",
        campos: [
            { clave: "deteccion", rotulo: "Cuenta como vibración después de", tipo: "entero", min: 10, max: 300, unidad: "s", defecto: 10 },
            { clave: "demora", rotulo: "Demora antes de avisar", tipo: "entero", min: 1, max: 300, unidad: "s", defecto: 1 },
            { clave: "intervalo", rotulo: "No repite el aviso antes de", tipo: "entero", min: 1, max: 3000, unidad: "min", defecto: 20 },
        ],
        texto: (v) => `SENSOR,${v.deteccion},${v.demora},${v.intervalo}#`, pregunta: "SENSOR#",
        leer: (r) => { const n = numeros(r); return n.length >= 3 ? { deteccion: n[0], demora: n[1], intervalo: n[2] } : null; },
        cuidado: "Qué es cada número sale del protocolo original; en este equipo coincide con lo medido (repite cada 20 minutos). Cambiá uno por vez." },
    { clave: "alarma.nivel", grupo: "alarmas", titulo: "Nivel del sensor", nivel: "ajuste",
        ayuda: "Qué tan fácil se dispara el sensor de vibración, del 1 al 5.",
        campos: [{ clave: "nivel", rotulo: "Nivel", tipo: "entero", min: 1, max: 5, defecto: 4 }],
        texto: (v) => `LEVEL,${v.nivel}#`, pregunta: "LEVEL#",
        /* «LEVEL,4#»: contesta con el mismo comando, sin dos puntos. */
        leer: (r) => { const m = /LEVEL\D*(\d)/i.exec(r); return m ? { nivel: Number(m[1]) } : null; },
        cuidado: "El equipo no dice hacia qué lado es más sensible. Cambialo de a un escalón y mirá cuántas vibraciones avisa." },
    { clave: "alarma.guardia", grupo: "alarmas", titulo: "Demora de la guardia", nivel: "ajuste",
        ayuda: "Cuántos minutos después de cortar el contacto el equipo se pone en guardia y empieza a avisar vibraciones.",
        campos: [{ clave: "minutos", rotulo: "Entra en guardia a los", tipo: "entero", min: 1, max: 60, unidad: "min", defecto: 10 }],
        texto: (v) => `DEFENSE,${v.minutos}#`, pregunta: "DEFENSE#",
        leer: (r) => { const n = numeros(r); return n.length ? { minutos: n[0] } : null; } },
    { clave: "alarma.corte", grupo: "alarmas", titulo: "Corte de alimentación", nivel: "ajuste",
        ayuda: "Avisa si le desconectan la batería del vehículo o le cortan el cable. Es la alarma que más importa: conviene dejarla prendida.",
        campos: [
            campoPrendida, campoModo,
            { clave: "segundos", rotulo: "Sin alimentación durante", tipo: "entero", min: 2, max: 60, unidad: "s", defecto: 5 },
        ],
        texto: (v) => (v.on === "OFF" ? "POWERALM,OFF#" : `POWERALM,ON,${v.modo},${v.segundos}#`), pregunta: "POWERALM#",
        leer: (r) => conSwitch(r, (n) => ({ modo: String(n[0] ?? 0), segundos: n[1] ?? 5 })) },
    { clave: "alarma.bateria", grupo: "alarmas", titulo: "Batería interna baja", nivel: "ajuste",
        ayuda: "Avisa cuando se le está acabando su batería de respaldo: la que lo mantiene vivo si le cortan la alimentación.",
        campos: [campoPrendida, campoModo],
        texto: (v) => (v.on === "OFF" ? "BATALM,OFF#" : `BATALM,ON,${v.modo}#`), pregunta: "BATALM#",
        leer: (r) => { const on = prendido(r); return on === null ? null : { on: on ? "ON" : "OFF", modo: modoDe(r) }; } },
    { clave: "alarma.contacto", grupo: "alarmas", titulo: "Contacto", nivel: "ajuste",
        ayuda: "Avisa cada vez que se pone o se corta el contacto. Sólo sirve si el cable de encendido (ACC) está conectado.",
        campos: [campoPrendida, campoModo],
        texto: (v) => (v.on === "OFF" ? "ACCALM,OFF#" : `ACCALM,ON,${v.modo}#`), pregunta: "ACCALM#",
        leer: (r) => { const on = prendido(r); return on === null ? null : { on: on ? "ON" : "OFF", modo: modoDe(r) }; } },

    // ── Teléfonos ──
    { clave: "telefono.sos", grupo: "telefonos", titulo: "Teléfonos SOS", nivel: "ajuste",
        ayuda: "Hasta tres números a los que el equipo les manda SMS o llama cuando una alarma está en ese modo, o cuando aprietan su botón de pánico.",
        campos: [
            { clave: "n1", rotulo: "Primero", tipo: "telefono", opcional: true },
            { clave: "n2", rotulo: "Segundo", tipo: "telefono", opcional: true },
            { clave: "n3", rotulo: "Tercero", tipo: "telefono", opcional: true },
        ],
        /* Los tres vacíos es «borrarlos»: no hay otra forma de decir «ninguno» que el borrado. */
        texto: (v) => (v.n1 || v.n2 || v.n3 ? `SOS,A,${v.n1 || ""},${v.n2 || ""},${v.n3 || ""}#` : "SOS,D,1,2,3#"), pregunta: "SOS#",
        /* «SOS number:,,;» */
        leer: (r) => { const p = r.slice(r.indexOf(":") + 1).replace(/;.*$/, "").split(",").map((x) => x.trim()); return /sos/i.test(r) ? { n1: p[0] || "", n2: p[1] || "", n3: p[2] || "" } : null; },
        cuidado: "Cada SMS y cada llamada los paga la SIM del rastreador. Los números van con código de país (+598…)." },
    { clave: "telefono.central", grupo: "telefonos", titulo: "Teléfono central", nivel: "ajuste",
        ayuda: "El único número desde el que el equipo acepta, por SMS, la orden de cortar el motor. Vacío, no la acepta de ninguno.",
        campos: [{ clave: "numero", rotulo: "Número", tipo: "telefono", opcional: true }],
        texto: (v) => (v.numero ? `CENTER,A,${v.numero}#` : "CENTER,D#"), pregunta: "CENTER#",
        /* «Center number is empty.» o «Center number:+598…» */
        leer: (r) => { if (/empty/i.test(r)) return { numero: "" }; const m = /(\+?\d{6,15})/.exec(r); return m ? { numero: m[1] } : /center/i.test(r) ? { numero: "" } : null; },
        confirmar: "toque",
        cuidado: "Quien tenga ese teléfono puede cortar el motor con un SMS, sin pasar por OmniAccess ni por su regla de «sólo detenido»." },

    // ── Corte de motor ──
    { clave: "rele.soltar", grupo: "rele", titulo: "Devolver el motor", nivel: "rele", texto: () => "RELAY,0#", pregunta: "RELAY#",
        ayuda: "Suelta el relé: el vehículo vuelve a arrancar." },
    { clave: "rele.accionar", grupo: "rele", titulo: "Cortar el motor", nivel: "rele", texto: () => "RELAY,1#", pregunta: "RELAY#",
        ayuda: "Acciona el relé. El servidor lo rechaza si no puede comprobar que el vehículo está detenido.",
        confirmar: "toque",
        cuidado: "El vehículo no vuelve a arrancar hasta que se le devuelva el motor desde acá." },

    // ── Instalación ──
    { clave: "instalacion.huso", grupo: "instalacion", titulo: "Zona horaria", nivel: "instalacion",
        ayuda: "El huso con el que el equipo escribe la hora en sus respuestas. Las posiciones que guarda OmniAccess no dependen de esto.",
        campos: [
            { clave: "lado", rotulo: "Respecto de Greenwich", tipo: "opcion", opciones: [{ valor: "W", rotulo: "Al oeste (América)" }, { valor: "E", rotulo: "Al este" }], defecto: "W" },
            { clave: "horas", rotulo: "Horas", tipo: "entero", min: 0, max: 12, unidad: "h", defecto: 3 },
            { clave: "minutos", rotulo: "Minutos", tipo: "opcion", opciones: ["0", "15", "30", "45"].map((m) => ({ valor: m, rotulo: m })), defecto: "0" },
        ],
        texto: (v) => `GMT,${v.lado},${v.horas},${v.minutos}#`, pregunta: "GMT#",
        /* «Currently Timezone(GMT):W,3,0» */
        leer: (r) => { const m = /:\s*([EW])\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(r); return m ? { lado: m[1].toUpperCase(), horas: Number(m[2]), minutos: m[3] } : null; },
        confirmar: "toque" },
    { clave: "instalacion.reiniciar", grupo: "instalacion", titulo: "Reiniciar el equipo", nivel: "instalacion", texto: () => "RESET#",
        ayuda: "Lo apaga y lo vuelve a prender. No pierde la configuración. Tarda uno o dos minutos en volver a estar en línea.",
        confirmar: "toque", puedeCallar: true },
    { clave: "instalacion.servidor", grupo: "instalacion", titulo: "Cambiar el servidor", nivel: "instalacion",
        ayuda: "A qué dirección y puerto le reporta. Es lo que se le carga al instalarlo.",
        campos: [
            { clave: "destino", rotulo: "Dirección del servidor", tipo: "texto", patron: SERVIDOR, largo: 60, ejemplo: "gps.ejemplo.com.uy o 200.40.0.1" },
            { clave: "puerto", rotulo: "Puerto", tipo: "entero", min: 1, max: 65535, defecto: 1341 },
        ],
        /* El primer número dice si lo que sigue es un nombre (1) o una IP (0); el último, TCP (0). */
        texto: (v) => `SERVER,${ES_IP.test(String(v.destino)) ? 0 : 1},${v.destino},${v.puerto},0#`, pregunta: "GPRSSET#",
        confirmar: "escribir", puedeCallar: true,
        cuidado: "Si la dirección o el puerto están mal, el rastreador deja de reportar acá y ya no se le puede mandar nada: sólo se arregla por SMS o yendo al vehículo." },
    { clave: "instalacion.apn", grupo: "instalacion", titulo: "Cambiar la red de datos (APN)", nivel: "instalacion",
        ayuda: "El nombre de la red de la operadora de la SIM. Se cambia al cambiarle el chip por uno de otra compañía.",
        campos: [
            { clave: "apn", rotulo: "APN", tipo: "texto", patron: APN, largo: 40, ejemplo: "ba.amx" },
            { clave: "usuario", rotulo: "Usuario", tipo: "texto", patron: APN, largo: 40, ejemplo: "casi siempre vacío", opcional: true },
            { clave: "clave", rotulo: "Contraseña", tipo: "texto", patron: APN, largo: 40, ejemplo: "casi siempre vacía", opcional: true },
        ],
        texto: (v) => (v.usuario || v.clave ? `APN,${v.apn},${v.usuario || ""},${v.clave || ""}#` : `APN,${v.apn}#`), pregunta: "GPRSSET#",
        paraAnotar: (v) => (v.usuario || v.clave ? `APN,${v.apn},${v.usuario || ""},${v.clave ? "•••" : ""}#` : `APN,${v.apn}#`),
        confirmar: "escribir", puedeCallar: true,
        cuidado: "Con un APN que no es el de la SIM que lleva puesta, el equipo se queda sin datos y no se le puede mandar nada más desde acá." },
    { clave: "instalacion.fabrica", grupo: "instalacion", titulo: "Volver de fábrica", nivel: "instalacion", texto: () => "FACTORY#",
        ayuda: "Borra toda la configuración del equipo, incluido a qué servidor le reporta.",
        confirmar: "escribir", puedeCallar: true,
        cuidado: "Deja de reportarle a OmniAccess en el acto. Para recuperarlo hay que volver a cargarle el servidor por SMS." },
];

/** Los comandos de un rastreador según el protocolo que habla. Vacío: todavía no hay ninguno hecho. */
export function comandosDe(protocolo: string | null | undefined): DefComando[] {
    return (protocolo || "GT06") === "GT06" ? COMANDOS_GT06 : [];
}
export const comandoPorClave = (protocolo: string | null | undefined, clave: string): DefComando | null =>
    comandosDe(protocolo).find((c) => c.clave === clave) || null;

/* ── Armar el texto que viaja ─────────────────────────────────────────────── */

/**
 * Valida los valores contra el catálogo y arma el texto. Es la ÚNICA puerta por la que sale un
 * comando hacia un rastreador: lo que no pasa por acá no se manda.
 *
 * Nada se «acomoda»: un número fuera de rango, un teléfono con letras o un servidor con una coma
 * (que cortaría el comando en dos) se rechazan diciendo cuál. Recortar en silencio un 3 a 5 sería
 * mandarle al equipo algo que nadie pidió.
 */
export function armarComando(def: DefComando, valores: Valores | null | undefined): { ok: true; texto: string; valores: Valores } | { ok: false; error: string } {
    const limpios: Valores = {};
    for (const c of def.campos || []) {
        const crudo = valores?.[c.clave];
        if (c.tipo === "entero") {
            /* Sin dato vale el de fábrica; un campo que se vació a mano no (Number("") es 0, y un 0 que nadie escribió no se manda). */
            const dado = crudo === undefined || crudo === null ? c.defecto : crudo;
            if (String(dado).trim() === "" || !Number.isFinite(Number(dado))) return { ok: false, error: `«${c.rotulo}» necesita un número.` };
            const e = Math.round(Number(dado));
            if (e < c.min || e > c.max) return { ok: false, error: `«${c.rotulo}» va de ${c.min} a ${c.max}${c.unidad ? ` ${c.unidad}` : ""}.` };
            limpios[c.clave] = e;
        } else if (c.tipo === "opcion") {
            const v = String(crudo ?? c.defecto);
            if (!c.opciones.some((o) => o.valor === v)) return { ok: false, error: `«${c.rotulo}» no admite ese valor.` };
            limpios[c.clave] = v;
        } else if (c.tipo === "telefono") {
            const v = String(crudo ?? "").replace(/[\s().-]/g, "");
            if (!v) { if (!c.opcional) return { ok: false, error: `Falta «${c.rotulo}».` }; limpios[c.clave] = ""; continue; }
            if (!TELEFONO.test(v)) return { ok: false, error: `«${c.rotulo}» no es un teléfono: van sólo números, con + adelante si lleva código de país.` };
            limpios[c.clave] = v;
        } else {
            const v = String(crudo ?? "").trim();
            if (!v) { if (!c.opcional) return { ok: false, error: `Falta «${c.rotulo}».` }; limpios[c.clave] = ""; continue; }
            if (v.length > c.largo || !c.patron.test(v)) return { ok: false, error: `«${c.rotulo}» no es válido. Por ejemplo: ${c.ejemplo}.` };
            limpios[c.clave] = v;
        }
    }
    const texto = def.texto(limpios);
    /* La red de seguridad: imprimible, corto, un solo numeral y al final. Si un valor lograra colar
       un «#» partiría el comando en dos, y el segundo podría ser cualquiera. */
    if (!/^[\x20-\x7e]{2,80}$/.test(texto) || texto.indexOf("#") !== texto.length - 1) return { ok: false, error: "El comando no se pudo armar con esos valores." };
    return { ok: true, texto, valores: limpios };
}

/** Los valores con los que arranca un formulario cuando no se pudo preguntar cómo está hoy. */
export function valoresPorDefecto(def: DefComando): Valores {
    const v: Valores = {};
    for (const c of def.campos || []) v[c.clave] = c.tipo === "entero" || c.tipo === "opcion" ? c.defecto : "";
    return v;
}

/** Lo que hay que tipear para confirmar un comando de los que no tienen vuelta: el final del IMEI. */
export const palabraDeConfirmacion = (imei: string) => imei.slice(-4);

/**
 * ¿El equipo dijo que no? Lo que contesta va siempre textual a la pantalla; esto sólo decide si se
 * lo pinta como rechazo. El «Success!» del relé y un valor repetido no lo son; un «Error», «Fail»,
 * «Invalid» o «not support» sí.
 */
export const pareceRechazo = (respuesta: string | null | undefined): boolean =>
    /\b(error|fail(ed|ure)?|invalid|illegal|not\s+support(ed)?|unknown|wrong|refuse)/i.test(respuesta || "");

/* ── Leer el estado general ───────────────────────────────────────────────── */

export type EstadoDelEquipo = {
    /** «12.5V»: la alimentación, o sea la batería del vehículo. */
    alimentacion: string | null;
    enlace: boolean | null;
    senal: string | null;
    gps: boolean | null;
    contacto: boolean | null;
    guardia: boolean | null;
};
/** «Charging:12.5V;GPRS:Link Up;NW Signal Level:strong;PPP_STATE:1;GPS+BD:OFF;ACC:OFF;Defense:ON;» */
export function leerEstadoDelEquipo(r: string): EstadoDelEquipo | null {
    if (!/GPRS|ACC|Defense/i.test(r || "")) return null;
    const de = (k: RegExp) => k.exec(r)?.[1]?.trim() ?? null;
    const si = (v: string | null) => (v === null ? null : /^(on|up|1)$/i.test(v.replace(/^link\s+/i, "")));
    return {
        alimentacion: de(/Charging\s*:\s*([^;]+)/i) ?? de(/Battery\s*:\s*([^;]+)/i),
        enlace: si(de(/GPRS\s*:\s*([^;]+)/i)),
        senal: de(/Signal Level\s*:\s*([^;]+)/i),
        gps: si(de(/GPS(?:\+BD)?\s*:\s*([^;]+)/i)),
        contacto: si(de(/ACC\s*:\s*([^;]+)/i)),
        guardia: si(de(/Defense\s*:\s*([^;]+)/i)),
    };
}

/** «GPRS:ON;APN:ba.amx,,;Server:0,200.40.182.246,1341,0;URL:…» → a dónde reporta y por qué red. */
export function leerConexion(r: string): { apn: string | null; servidor: string | null; puerto: number | null } | null {
    const s = /Server\s*:\s*\d\s*,\s*([^,;]+)\s*,\s*(\d+)/i.exec(r || ""), a = /APN\s*:\s*([^,;]*)/i.exec(r || "");
    if (!s && !a) return null;
    return { apn: a?.[1]?.trim() || null, servidor: s?.[1]?.trim() || null, puerto: s ? Number(s[2]) : null };
}
