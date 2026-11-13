/**
 * Las aperturas de un portero: qué puertas tiene y cómo se le pide a cada marca que abra una.
 *
 * 13/11, Nico: «el portero no tiene drawer, llama al modal viejo; debe ser el drawer típico pero
 * adaptado a porteros, como hik, akuvox, dahua, intelbras… explorá las aperturas». Hasta acá abrir
 * era un solo botón «Relé» que siempre accionaba «la 1», sin saber si el equipo tenía una puerta,
 * dos, o ninguna. Esto separa las dos preguntas:
 *
 *   · ¿qué puertas tiene ESTE equipo?  → se le pregunta al equipo (aperturas-servidor.ts).
 *   · ¿cómo abre ESTA marca, y lo probamos alguna vez contra un equipo real?  → la tabla de abajo.
 *
 * Este archivo no habla con nadie: son los tipos, la tabla y los que leen las respuestas de cada
 * marca. Por eso se puede probar con las respuestas reales guardadas (tests/aperturas.test.ts).
 */

export type Puerta = {
    /** El número con el que se la nombra al abrir: 1, 2… */
    n: number;
    nombre: string;
    /** Una cerradura (el equipo la maneja como puerta) o un relé suelto. */
    clase: "cerradura" | "rele";
    /** Cuánto la deja abierta el equipo, si lo dice. */
    segundos: number | null;
    /** Las órdenes que el equipo declara aceptar para esa puerta. Vacío = no lo informa. */
    ordenes: string[];
};

export type ComoAbre = {
    /** OmniAccess tiene escrito el pedido de apertura para esta marca. */
    puede: boolean;
    /** Ese pedido abrió alguna vez una puerta de verdad. Escrito según la documentación no es probado. */
    probado: boolean;
    /** El pedido, como lo vería alguien con un sniffer. */
    metodo: string;
    /** Una línea honesta sobre en qué punto está. */
    nota: string;
};

/**
 * Cómo abre cada marca. Como el catálogo de drivers (drivers/catalogo.ts): dice lo que de verdad
 * hay, no lo que se piensa hacer. «probado» sólo pasa a true después de ver abrir una puerta.
 */
export const COMO_ABRE: Record<string, ComoAbre> = {
    HIKVISION: {
        puede: true, probado: false,
        metodo: "ISAPI · PUT /ISAPI/AccessControl/RemoteControl/door/<n>",
        nota: "Un portero o un control de acceso Hikvision abre por su cerradura, no por la salida de alarma como una cámara. El equipo declara qué puertas tiene y qué órdenes acepta, y eso se lee. El pedido de apertura todavía no se probó contra una puerta real.",
    },
    AKUVOX: {
        puede: true, probado: true,
        metodo: "POST /api/relay/trig · si no, GET /fcgi/do?action=OpenDoor&DoorNum=<n>",
        nota: "Probado en los porteros que ya están andando. Akuvox no informa cuántos relés tiene el equipo: su API nombra el A (1) y el B (2). En un equipo de un solo relé, el B no hace nada.",
    },
    DAHUA: {
        puede: true, probado: false,
        metodo: "CGI · GET /cgi-bin/accessControl.cgi?action=openDoor&channel=<n>",
        nota: "Escrito según la API HTTP pública de Dahua (VTO y controladoras). Nunca se probó contra un equipo: la primera apertura tiene que ser con alguien mirando la puerta.",
    },
    INTELBRAS: {
        puede: true, probado: false,
        metodo: "CGI · GET /cgi-bin/accessControl.cgi?action=openDoor&channel=<n>",
        nota: "Los porteros y controladoras Intelbras usan la misma API que Dahua. Escrito según esa documentación, sin probar contra un equipo.",
    },
    GRANDSTREAM: {
        puede: false, probado: false,
        metodo: "—",
        nota: "La GDS pide habilitar «HTTP API Remote Open Door» en el equipo y su pedido de apertura no está en la documentación pública. No se adivina: se cablea con el equipo delante.",
    },
};

const NO_SABE: ComoAbre = { puede: false, probado: false, metodo: "—", nota: "OmniAccess no tiene escrito cómo abrirle una puerta a esta marca." };
export const comoAbre = (marca: string | null | undefined): ComoAbre => COMO_ABRE[String(marca || "").toUpperCase()] || NO_SABE;

/** Las marcas que se ofrecen al dar de alta un portero, en el orden en que se usan. */
export const MARCAS_PORTERO = ["HIKVISION", "AKUVOX", "DAHUA", "INTELBRAS", "GRANDSTREAM"] as const;
export const ROTULO_MARCA: Record<string, string> = { HIKVISION: "Hikvision", AKUVOX: "Akuvox", DAHUA: "Dahua", INTELBRAS: "Intelbras", GRANDSTREAM: "Grandstream" };

/** Más puertas que éstas no se le preguntan a un equipo: un portero tiene una o dos, una controladora cuatro. */
export const PUERTAS_MAXIMO = 8;

/** Lo que se muestra cuando no se le pudo preguntar al equipo: se asume la 1, y se dice que es asumida. */
export const PUERTA_ASUMIDA: Puerta = { n: 1, nombre: "Puerta 1", clase: "cerradura", segundos: null, ordenes: [] };

/* ── Hikvision ─────────────────────────────────────────────────────────────────── */

const etiqueta = (xml: string, nombre: string): string | null => {
    const m = new RegExp(`<(?:\\w+:)?${nombre}[^>]*>([^<]*)</(?:\\w+:)?${nombre}>`, "i").exec(xml);
    return m ? m[1].trim() : null;
};

/**
 * `RemoteControl/door/capabilities`: de qué número a qué número van las puertas y qué órdenes
 * acepta. El DS-KB8113-IME1(B) de Otto contesta `<doorNo min="1" max="1"/>` y
 * `<cmd opt="open,alwaysOpen,resume"/>`.
 */
export function rangoHikvision(xml: string): { desde: number; hasta: number; ordenes: string[] } | null {
    const puerta = /<(?:\w+:)?doorNo\b([^>]*)>/i.exec(xml);
    if (!puerta) return null;
    const attr = (k: string) => { const m = new RegExp(`${k}="(\\d+)"`).exec(puerta[1]); return m ? Number(m[1]) : null; };
    const desde = attr("min") ?? 1;
    const hasta = Math.min(attr("max") ?? desde, desde + PUERTAS_MAXIMO - 1);
    const cmd = /<(?:\w+:)?cmd\b[^>]*opt="([^"]*)"/i.exec(xml);
    return { desde, hasta: Math.max(desde, hasta), ordenes: cmd ? cmd[1].split(",").map((x) => x.trim()).filter(Boolean) : [] };
}

/** `Door/param/<n>`: el nombre de la puerta y cuántos segundos queda abierta. `null` si esa puerta no existe o está deshabilitada. */
export function paramHikvision(xml: string | null): { nombre: string | null; segundos: number | null } | null {
    if (!xml || !/<(?:\w+:)?DoorParam\b/i.test(xml)) return null;
    if (etiqueta(xml, "enable") === "false") return null;
    const seg = Number(etiqueta(xml, "openDuration"));
    return { nombre: etiqueta(xml, "doorName") || null, segundos: Number.isFinite(seg) && seg > 0 ? seg : null };
}

export function puertasHikvision(capacidades: string, params: Record<number, string | null>): Puerta[] {
    const r = rangoHikvision(capacidades);
    if (!r) return [];
    const out: Puerta[] = [];
    for (let n = r.desde; n <= r.hasta; n++) {
        const tieneParam = Object.prototype.hasOwnProperty.call(params, n);
        const p = paramHikvision(params[n] ?? null);
        // Se le preguntó por esa puerta y no existe o está deshabilitada: no se ofrece abrirla.
        if (tieneParam && params[n] && !p) continue;
        out.push({ n, nombre: p?.nombre || `Puerta ${n}`, clase: "cerradura", segundos: p?.segundos ?? null, ordenes: r.ordenes });
    }
    return out;
}

/* ── Dahua / Intelbras ─────────────────────────────────────────────────────────── */

/**
 * `configManager.cgi?action=getConfig&name=AccessControl` devuelve una línea por dato:
 *
 *     table.AccessControl[0].Name=Door1
 *     table.AccessControl[0].UnlockHoldInterval=2000      (milisegundos)
 *     table.AccessControl[1].Name=Door2
 *
 * El índice es desde 0 y el `channel` de openDoor desde 1.
 */
export function puertasDahua(texto: string): Puerta[] {
    const porIndice = new Map<number, { nombre?: string; ms?: number }>();
    for (const linea of String(texto || "").split(/\r?\n/)) {
        const m = /^table\.AccessControl\[(\d+)\]\.(\w+)=(.*)$/.exec(linea.trim());
        if (!m) continue;
        const i = Number(m[1]);
        if (i >= PUERTAS_MAXIMO) continue;
        const d = porIndice.get(i) || {};
        if (m[2] === "Name") d.nombre = m[3].trim();
        if (m[2] === "UnlockHoldInterval") d.ms = Number(m[3]);
        porIndice.set(i, d);
    }
    return [...porIndice.entries()].sort((a, b) => a[0] - b[0]).map(([i, d]) => ({
        n: i + 1, nombre: d.nombre || `Puerta ${i + 1}`, clase: "cerradura" as const,
        segundos: d.ms && Number.isFinite(d.ms) && d.ms > 0 ? Math.round(d.ms / 100) / 10 : null,
        ordenes: [],
    }));
}

/* ── Akuvox ────────────────────────────────────────────────────────────────────── */

/** Los relés que nombra la API de Akuvox (DoorNum 1 = A, 2 = B). El equipo no informa cuántos tiene. */
export const PUERTAS_AKUVOX: Puerta[] = [
    { n: 1, nombre: "Relé A", clase: "rele", segundos: null, ordenes: [] },
    { n: 2, nombre: "Relé B", clase: "rele", segundos: null, ordenes: [] },
];

/** «1 s», «2,5 s»: cuánto queda abierta, para la ficha. */
export const textoSegundos = (s: number | null) => (s == null ? null : `${String(s).replace(".", ",")} s`);
