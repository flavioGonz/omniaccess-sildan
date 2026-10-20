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

export type RespuestaBot = { texto: string; foto?: string /* base64 jpg */; video?: string /* archivo en DIR_CLIPS */ };

export const COMANDOS = [
    { comando: "estado", descripcion: "Cómo está cada fila ahora" },
    { comando: "foto", descripcion: "La foto de ahora, con las personas marcadas" },
    { comando: "video", descripcion: "Los últimos segundos de video" },
    { comando: "hoy", descripcion: "Resumen del día" },
    { comando: "pronostico", descripcion: "Si se va a llenar y cuándo reforzar" },
    { comando: "ayuda", descripcion: "Qué puedo contestar" },
] as const;

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
    return { texto: partes.join("\n\n") };
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
    return { video: marcado ? path.basename(marcado) : r.nombre, texto: `<b>${esc(f.name)}</b> · ${ESTADO(d.aforo, d.limite)} · ${d.aforo ?? "—"} personas\n<i>Últimos ${VIDEO_SEG} s · ${hhmm(new Date())}</i>` };
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
    return { texto: partes.join("\n\n") || "No hay filas dadas de alta." };
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
    return { texto: partes.join("\n\n") || "No hay filas dadas de alta." };
}

function ayuda(): RespuestaBot {
    return { texto: ["<b>Filas · OmniAccess</b>", ...COMANDOS.map((c) => `/${c.comando} — ${c.descripcion}`), "", "<i>Con /foto y /video se puede poner la fila: /foto caja 1</i>"].join("\n") };
}

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
        case "ayuda": case "help": case "start": return ayuda();
        default: return { texto: `No conozco /${esc(cmd)}.\n\n${ayuda().texto}` };
    }
}

