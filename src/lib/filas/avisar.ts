import { prisma } from "@/lib/prisma";
import { enqueueDispatch } from "@/lib/dispatch-queue";
import { demoraFila } from "@/lib/filas/demora";
import { textoAvisoFila, textoPlano, type TipoAviso } from "@/lib/filas/aviso";
import { AVISO_CLIP_ANTES_SEG, AVISO_CLIP_DESPUES_SEG } from "@/lib/filas/constantes";

/**
 * Manda el aviso de fila sobre el límite por la cola de despachos: al grupo de Telegram de
 * Ajustes › Notificaciones y a cada destinatario de Despachos.
 *
 * Antes salía dos veces y por dos caminos: el sondeo lo mandaba directo al grupo
 * (sendQueueAlertToTelegram, con foto pedida a la cámara en ese momento) Y además lo encolaba
 * para los destinatarios; si el grupo también era un destinatario, llegaba repetido. Y el push
 * (que es lo que anda casi siempre en HB) tenía su propia copia que sólo mandaba lo directo, sin
 * horario ni destinatarios. Ahora es un camino: la cola, que reintenta, deja registro en
 * Despachos, y el worker arma el clip del anillo de la cámara (lib/clip-instante).
 *
 * El clip va siempre en el aviso de filas, sin depender del interruptor «clip animado» de las
 * alertas de matrículas: es lo que pidió Nico (19/10) y el anillo de las Bosch graba igual.
 */
export async function avisarFila(p: {
    deviceId: string; alerta: string; personas: number; limite: number;
    snapshotPath?: string | null; tipo: TipoAviso; canal?: string | null;
}): Promise<number> {
    const ahora = new Date();
    const [dev, demora, destinatarios, grupo] = await Promise.all([
        prisma.device.findUnique({ where: { id: p.deviceId }, select: { name: true } }),
        demoraFila(p.deviceId, ahora),
        destinatariosDespacho(),
        prisma.setting.findUnique({ where: { key: "TELEGRAM_CHAT_ID" } }).then((s) => (s?.value || process.env.TELEGRAM_CHAT_ID || "").trim()).catch(() => ""),
    ]);
    const fila = dev?.name || "Fila";
    const html = textoAvisoFila({ fila, demora: { ...demora, limite: p.limite }, tipo: p.tipo, ahora, personas: p.personas });
    const base = {
        ruleName: p.alerta, deviceName: fila, channelName: p.canal || "Aforo",
        count: p.personas, threshold: p.limite, snapshotPath: p.snapshotPath || null,
        html, text: textoPlano(html), aviso: p.tipo,
        conVideo: true, clipAntes: AVISO_CLIP_ANTES_SEG, clipDespues: AVISO_CLIP_DESPUES_SEG,
        instante: ahora.toISOString(), timestamp: ahora.toISOString(), alertTs: ahora.getTime(),
        esperaMin: demora.esperaMin, sobreDesde: demora.sobreDesde?.toISOString() || null,
    };

    const envios: { channel: string; extra: Record<string, any> }[] = [];
    if (grupo) envios.push({ channel: "telegram", extra: { chatId: grupo, recipientName: "Grupo de Telegram" } });
    for (const r of destinatarios) {
        if (!r?.enabled || !r.channel || !r.address) continue;
        if (r.channel === "telegram" && String(r.address).trim() === grupo) continue; // ya va al grupo
        envios.push({ channel: r.channel, extra: { chatId: r.address, to: r.address, email: r.address, recipientName: r.name || r.address, recipientChannel: r.channel } });
    }
    let n = 0;
    for (const e of envios) {
        try { await enqueueDispatch({ type: "ALERT", channel: e.channel, deviceId: p.deviceId, payload: { ...base, ...e.extra } }); n++; }
        catch (err: any) { console.error(`[aviso-fila] no se pudo encolar ${e.channel}: ${err?.message || err}`); }
    }
    if (!n) console.warn(`[aviso-fila] ${fila}: nadie a quien avisar (sin grupo de Telegram ni destinatarios en Despachos)`);
    return n;
}

async function destinatariosDespacho(): Promise<any[]> {
    try { const st = await prisma.setting.findUnique({ where: { key: "DISPATCH_RECIPIENTS" } }); return st?.value ? JSON.parse(st.value) : []; }
    catch { return []; }
}
