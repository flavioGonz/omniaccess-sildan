import path from "path";
import { prisma } from "@/lib/prisma";
import { demoraFila, inicioDelDiaUy } from "@/lib/filas/demora";
import { pronosticoFila, permanenciaMedia } from "@/lib/filas/medidas";
import { cuadroBosch } from "@/lib/filas/foto";
import { cuadroActual, ES_PERSONA } from "@/lib/filas/metadatos";
import { fotoConMarca, videoConMarca, type PersonaFoto } from "@/lib/filas/presentacion";
import { enMontevideo } from "@/lib/filas/horario";
import { clipDeInstante } from "@/lib/clip-instante";
import { CANAL_ENTRADA, CANAL_SALIDA, VENTANA_ESPERA_MIN } from "@/lib/filas/constantes";
import { graficaHoy } from "@/lib/filas/grafica";
import { registrarAcuse, silenciar, reactivar, silencioHasta, reaccionDesde } from "@/lib/filas/acuses";

/**
 * Lo que contesta el bot de Telegram de las filas (HB, 20/10: «sí, armalo»). Los mensajes los lee
 * el worker de despachos (getUpdates) y le pregunta a /api/filas/bot; acá se arma la respuesta con
 * los mismos cálculos que las pantallas, para que el bot y el panel no digan cosas distintas.
 *
 * Comandos:
 *   /estado       cómo está cada fila ahora
 *   /foto [fila]  el cuadro de ahora con las personas dibujadas por nosotros
 *   /video [fila] los últimos segundos de video
 *   /hoy          el resumen del día
 *   /pronostico   si se va a llenar y cuándo reforzar
 *   /ayuda
 */

/** Un botón: lo que dice y lo que manda al tocarlo (callback_data, hasta 64 bytes). */
export type Boton = { t: string; d: string };
export type RespuestaBot = {
    texto: string;
    foto?: string /* base64 jpg/png */;
    video?: string /* archivo en DIR_CLIPS */;
    /** Botones debajo del mensaje (inline keyboard). */
    botones?: Boton[][];
    /** Al tocar un botón: reemplazar el mensaje en vez de mandar otro (Actualizar). */
    editar?: boolean;
    /** Al tocar un botón: sacar ese botón del mensaje de origen («Lo atiendo» no se toca dos veces). */
    quitarBoton?: string;
    /** Aviso corto arriba de la pantalla del que tocó (answerCallbackQuery). */
    aviso?: string;
};

export const COMANDOS = [
    { comando: "menu", descripcion: "Todas las consultas, con botones" },
    { comando: "estado", descripcion: "Cómo está cada fila ahora" },
    { comando: "foto", descripcion: "La foto de ahora, con las personas marcadas" },
    { comando: "video", descripcion: "Los últimos segundos de video" },
    { comando: "grafica", descripcion: "La gráfica del aforo de hoy" },
    { comando: "hoy", descripcion: "Resumen del día" },
    { comando: "pronostico", descripcion: "Si se va a llenar y cuándo reforzar" },
    { comando: "silencio", descripcion: "Pausar los avisos (por defecto 30 min)" },
    { comando: "reactivar", descripcion: "Volver a mandar los avisos" },
    { comando: "ayuda", descripcion: "Qué puedo contestar" },
] as const;

/** Minutos de silencio por defecto, y el tope: un silencio olvidado no puede tapar el día entero. */
const SILENCIO_MIN = 30;
const SILENCIO_MAX_MIN = 12 * 60;

/** Los botones de siempre: lo que se puede pedir después de cualquier respuesta. */
const MENU: Boton[][] = [
    [{ t: "📊 Estado", d: "estado" }, { t: "📷 Foto", d: "foto" }, { t: "🎬 Video", d: "video" }],
    [{ t: "📈 Gráfica", d: "grafica" }, { t: "📅 Hoy", d: "hoy" }, { t: "🔮 Pronóstico", d: "pron" }],
    [{ t: "🔕 Silenciar 30 min", d: "sil:30" }, { t: "🔔 Reactivar", d: "react" }],
];
/** Los botones del aviso de fila llena (lib/filas/avisar). */
export const botonesAviso = (deviceId: string): Boton[][] => [
    [{ t: "✋ Lo atiendo", d: `atiendo:${deviceId}` }],
    [{ t: "📷 Foto ahora", d: `foto:${deviceId}` }, { t: "🎬 Video ahora", d: `video:${deviceId}` }, { t: "📈 Gráfica", d: `grafica:${deviceId}` }],
    [{ t: "🔕 Silenciar 30 min", d: "sil:30" }],
];

/** Segundos de video que manda /video (hacia atrás desde ahora). */
const VIDEO_SEG = 12;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const hhmm = (d: Date | null | undefined) => (d ? enMontevideo(d).hhmm : "—");
const hace = (d: Date | null | undefined) => {
    if (!d) return "sin datos";
    const s = Math.round((Date.now() - d.getTime()) / 1000);
    return s < 60 ? `hace ${s} s` : s < 3600 ? `hace ${Math.round(s / 60)} min` : `a las ${hhmm(d)}`;
};
const ESTADO = (aforo: number | null, limite: number) =>
    aforo == null ? "⚪️ sin datos" : aforo >= limite ? "🔴 llena" : aforo >= limite * 0.7 ? "🟠 cargada" : "🟢 fluida";

async function filas(arg?: string) {
    const todas = await prisma.device.findMany({ where: { deviceType: "QUEUE_COUNTER" }, select: { id: true, name: true, ip: true, username: true, password: true }, orderBy: { name: "asc" } });
    if (!arg) return todas;
    const a = arg.toLowerCase();
    const una = todas.filter((d) => d.name.toLowerCase().includes(a));
    return una.length ? una : todas;
}

async function estado(): Promise<RespuestaBot> {
    const fs = await filas();
    if (!fs.length) return { texto: "No hay filas dadas de alta." };
    const partes: string[] = [];
    for (const f of fs) {
        const d = await demoraFila(f.id);
        const ultimo = await prisma.queueEvent.findFirst({ where: { deviceId: f.id, NOT: { channelName: { in: [CANAL_ENTRADA, CANAL_SALIDA] } } }, orderBy: { timestamp: "desc" }, select: { timestamp: true } });
        const l = [`<b>${esc(f.name)}</b> · ${ESTADO(d.aforo, d.limite)}`, `👥 ${d.aforo ?? "—"} personas · límite ${d.limite}`];
        l.push(d.esperaMin === 0 ? "⏳ Sin espera" : d.esperaMin != null ? `⏳ Espera estimada ~${d.esperaMin} min` : `⏳ Sin salidas en ${VENTANA_ESPERA_MIN} min`);
        if (d.sobreDesde) l.push(`⏱️ Sobre el límite desde las ${hhmm(d.sobreDesde)}`);
        l.push(`🚶 ${VENTANA_ESPERA_MIN} min: entraron ${d.entradas15} · atendidos ${d.salidas15}`);
        l.push(`<i>Último dato ${hace(ultimo?.timestamp)}</i>`);
        partes.push(l.join("\n"));
    }
    const sil = await silencioHasta();
    if (sil) partes.push(`🔕 <i>Avisos en pausa hasta las ${hhmm(sil)}</i>`);
    return { texto: partes.join("\n\n"), botones: [[{ t: "🔄 Actualizar", d: "estado:act" }, { t: "📷 Foto", d: "foto" }, { t: "🎬 Video", d: "video" }], MENU[1]] };
}

async function foto(arg?: string): Promise<RespuestaBot> {
    const [f] = await filas(arg);
    if (!f) return { texto: "No hay filas dadas de alta." };
    const buf = await cuadroBosch(f);
    if (!buf) return { texto: `No pude traer el cuadro de <b>${esc(f.name)}</b>: la cámara no contestó.` };
    const personas: PersonaFoto[] = (cuadroActual(f.id)?.objetos || []).filter((o) => ES_PERSONA.test(o.clase)).map((o) => ({ caja: o.caja, poligono: o.poligono, p: o.p }));
    const d = await demoraFila(f.id);
    // La foto editada con la marca y la cuenta (lib/filas/presentacion), la misma que lleva el aviso.
    const jpg = await fotoConMarca(buf, personas, { fila: f.name, titulo: "Pedido desde Telegram", personas: d.aforo, limite: d.limite, esperaMin: d.esperaMin, momento: new Date() });
    return {
        foto: jpg.toString("base64"),
        texto: `<b>${esc(f.name)}</b> · ${ESTADO(d.aforo, d.limite)}\n👥 La cámara cuenta ${d.aforo ?? "—"} (límite ${d.limite}) · ${personas.length} ${personas.length === 1 ? "marcada" : "marcadas"} en la foto`,
        botones: [[{ t: "📷 Otra foto", d: `foto:${f.id}` }, { t: "🎬 Video", d: `video:${f.id}` }, { t: "📊 Estado", d: "estado" }]],
    };
}

async function video(arg?: string): Promise<RespuestaBot> {
    const [f] = await filas(arg);
    if (!f) return { texto: "No hay filas dadas de alta." };
    const r = await clipDeInstante({ deviceId: f.id, instante: Date.now() - 2_000, antes: VIDEO_SEG, despues: 1, para: "alerta" });
    if (!r.ok) return { texto: `No pude armar el video de <b>${esc(f.name)}</b>: ${esc(r.motivo)}.` };
    const d = await demoraFila(f.id);
    // Con la presentación animada de OmniAccess adelante; si no sale, el clip tal cual.
    const marcado = await videoConMarca(r.archivo, { fila: f.name, titulo: "Pedido desde Telegram", personas: d.aforo, limite: d.limite, esperaMin: d.esperaMin, momento: new Date() });
    return {
        video: marcado ? path.basename(marcado) : r.nombre, texto: `<b>${esc(f.name)}</b> · ${ESTADO(d.aforo, d.limite)} · ${d.aforo ?? "—"} personas\n<i>Últimos ${VIDEO_SEG} s · ${hhmm(new Date())}</i>`,
        botones: [[{ t: "🎬 Otro video", d: `video:${f.id}` }, { t: "📷 Foto", d: `foto:${f.id}` }, { t: "📊 Estado", d: "estado" }]],
    };
}

async function hoy(): Promise<RespuestaBot> {
    const fs = await filas();
    const hoy0 = inicioDelDiaUy();
    const partes: string[] = [];
    for (const f of fs) {
        const [d, entradas, salidas, perm] = await Promise.all([
            demoraFila(f.id),
            prisma.queueEvent.count({ where: { deviceId: f.id, channelName: CANAL_ENTRADA, timestamp: { gte: hoy0 } } }),
            prisma.queueEvent.count({ where: { deviceId: f.id, channelName: CANAL_SALIDA, timestamp: { gte: hoy0 } } }),
            permanenciaMedia(f.id, hoy0, new Date()),
        ]);
        partes.push([
            `<b>${esc(f.name)}</b> — hoy`,
            `🚶 Entraron ${entradas} · atendidos ${salidas}`,
            `📈 Pico ${d.picoHoy}${d.picoHoyA ? ` a las ${hhmm(d.picoHoyA)}` : ""} · límite ${d.limite}`,
            `🔴 Se llenó ${d.llenasHoy} ${d.llenasHoy === 1 ? "vez" : "veces"}`,
            perm.min != null ? `⌛ Permanencia media ${perm.min} min` : `⌛ Permanencia: sin datos suficientes`,
        ].join("\n"));
    }
    const reac = await reaccionDesde(hoy0);
    if (reac.n) partes.push(`✋ Avisos atendidos hoy: ${reac.n} · reacción mediana ${Math.max(1, Math.round((reac.medianaSeg || 0) / 60))} min`);
    return { texto: partes.join("\n\n") || "No hay filas dadas de alta.", botones: [[{ t: "📈 Gráfica", d: "grafica" }, { t: "🔮 Pronóstico", d: "pron" }, { t: "📊 Estado", d: "estado" }]] };
}

const DIAS = ["", "lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

async function pronostico(): Promise<RespuestaBot> {
    const fs = await filas();
    const partes: string[] = [];
    for (const f of fs) {
        const p = await pronosticoFila(f.id);
        const l = [`<b>${esc(f.name)}</b>`];
        if (p.ahora.aforo != null && p.ahora.aforo >= p.limite) l.push(`🔴 Está en su límite ahora (${p.ahora.aforo}/${p.limite}).`);
        else if (p.seLlena) l.push(`🟠 Se espera que se llene a las <b>${p.seLlena.a}</b> (en ~${p.seLlena.enMin} min).`);
        else l.push(`🟢 Sin riesgo de llenarse en la próxima hora.`);
        if (p.ahora.ajuste != null) {
            const a = p.ahora.ajuste;
            l.push(a > 1.05 ? `Hoy viene un ${Math.round((a - 1) * 100)}% más cargado que lo típico.` : a < 0.95 ? `Hoy viene un ${Math.round((1 - a) * 100)}% más tranquilo que lo típico.` : "Hoy viene como un día típico.");
        }
        if (p.franjas.length) l.push(`Reforzar: ${p.franjas.slice(0, 3).map((x) => `${DIAS[x.dia]} ${x.desde}–${x.hasta}`).join(" · ")}`);
        if (p.calidad.tono === "mal") l.push(`<i>Ojo: ${esc(p.calidad.resumen.toLowerCase())} (ver Calidad del dato en el panel).</i>`);
        partes.push(l.join("\n"));
    }
    return { texto: partes.join("\n\n") || "No hay filas dadas de alta.", botones: [[{ t: "📈 Gráfica", d: "grafica" }, { t: "📅 Hoy", d: "hoy" }, { t: "📊 Estado", d: "estado" }]] };
}

async function grafica(arg?: string): Promise<RespuestaBot> {
    const [f] = await filas(arg);
    if (!f) return { texto: "No hay filas dadas de alta." };
    const png = await graficaHoy(f.id, f.name);
    const d = await demoraFila(f.id);
    return {
        foto: png.toString("base64"), texto: `<b>${esc(f.name)}</b> · ahora ${d.aforo ?? "—"} personas · pico ${d.picoHoy}${d.picoHoyA ? ` (${hhmm(d.picoHoyA)})` : ""}`,
        botones: [[{ t: "🔄 Actualizar", d: `grafica:${f.id}` }, { t: "📅 Hoy", d: "hoy" }, { t: "🔮 Pronóstico", d: "pron" }]],
    };
}

async function silencio(arg?: string): Promise<RespuestaBot> {
    const min = Math.min(SILENCIO_MAX_MIN, Math.max(5, parseInt(arg || "", 10) || SILENCIO_MIN));
    const hasta = await silenciar(min);
    return { texto: `🔕 Avisos de fila llena en pausa hasta las <b>${hhmm(hasta)}</b> (${min} min).\nEl panel y las pantallas siguen funcionando.`, botones: [[{ t: "🔔 Reactivar ahora", d: "react" }, { t: "🔕 +1 hora", d: "sil:60" }]], aviso: `En pausa ${min} min` };
}

async function reactivarAvisos(): Promise<RespuestaBot> {
    await reactivar();
    return { texto: "🔔 Avisos reactivados.", botones: [MENU[0]], aviso: "Avisos reactivados" };
}

function menu(): RespuestaBot {
    return { texto: "<b>Filas · OmniAccess</b>\n¿Qué querés ver?", botones: MENU };
}

/** «Lo atiendo» en un aviso: queda quién y cuánto tardó, y se corta el escalamiento de ese episodio. */
async function atiendo(deviceId: string, quien: string): Promise<RespuestaBot> {
    const f = (await filas()).find((x) => x.id === deviceId);
    const d = await demoraFila(deviceId);
    const a = await registrarAcuse(deviceId, quien, d.sobreDesde);
    const min = a.reaccionSeg != null ? Math.max(1, Math.round(a.reaccionSeg / 60)) : null;
    return {
        texto: `✋ <b>${esc(quien)}</b> se ocupa de <b>${esc(f?.name || "la fila")}</b> (${hhmm(new Date(a.t))}${min != null ? `, ${min} min después de que se llenó` : ""}).\nNo se escala al supervisor por este episodio.`,
        quitarBoton: `atiendo:${deviceId}`, aviso: "Registrado: lo atendés vos",
    };
}

function ayuda(): RespuestaBot {
    return { texto: ["<b>Filas · OmniAccess</b>", ...COMANDOS.map((c) => `/${c.comando} — ${c.descripcion}`), "", "<i>Con /foto, /video y /grafica se puede poner la fila: /foto caja 1. /silencio 60 pausa una hora.</i>"].join("\n"), botones: MENU };
}

/**
 * Un botón tocado. `d` es su callback_data; `quien`, el nombre de quien lo tocó (para «Lo atiendo»).
 * Las consultas devuelven lo mismo que el comando; «Actualizar» reemplaza el mensaje.
 */
export async function boton(d: string, quien: string): Promise<RespuestaBot | null> {
    const [accion, arg] = d.split(":");
    switch (accion) {
        case "estado": return arg === "act" ? { ...(await estado()), editar: true, aviso: "Actualizado" } : estado();
        case "foto": return foto(await nombreDe(arg));
        case "video": return video(await nombreDe(arg));
        case "grafica": return grafica(await nombreDe(arg));
        case "hoy": return hoy();
        case "pron": return pronostico();
        case "sil": return silencio(arg);
        case "react": return reactivarAvisos();
        case "menu": return menu();
        case "atiendo": return arg ? atiendo(arg, quien) : null;
        default: return null;
    }
}
/* Los botones llevan el id (cabe en los 64 bytes y no cambia si se renombra la fila); los comandos, el nombre. */
async function nombreDe(id?: string) { return id ? (await filas()).find((f) => f.id === id)?.name : undefined; }

/** Contesta un mensaje. `texto` es lo que escribieron («/foto@iesbot2026bot caja 1»). */
export async function contestar(texto: string): Promise<RespuestaBot | null> {
    const m = texto.trim().match(/^\/(\w+)(?:@\w+)?\s*(.*)$/);
    if (!m) return null; // no es un comando: el bot no conversa
    const [, cmd, arg] = m;
    switch (cmd.toLowerCase()) {
        case "estado": case "fila": case "filas": return estado();
        case "foto": return foto(arg);
        case "video": case "clip": return video(arg);
        case "hoy": case "resumen": return hoy();
        case "pronostico": case "pronóstico": return pronostico();
        case "grafica": case "gráfica": return grafica(arg);
        case "silencio": case "silenciar": case "pausa": return silencio(arg);
        case "reactivar": return reactivarAvisos();
        case "menu": case "menú": return menu();
        case "ayuda": case "help": case "start": return ayuda();
        default: return { texto: `No conozco /${esc(cmd)}.\n\n${ayuda().texto}` };
    }
}

