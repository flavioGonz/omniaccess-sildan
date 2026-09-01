import { NextResponse } from "next/server";
import { getQueueDevices, getLatestQueueCounts, getQueueAlerts } from "@/app/actions/queue";
import { getSetting } from "@/app/actions/settings";

const OCC = ["Aforo", "IVA Aforo", "Occupancy", "Ocupación"];

export async function POST(req: Request) {
    let text = "";
    try { const b = await req.json(); text = (b?.text || "").toString(); } catch {}
    const lower = text.toLowerCase().trim();
    const _cb = await getSetting("CHATBOT_ENABLED");
    if (_cb?.value === "false") return NextResponse.json({ reply: "El asistente está desactivado.", disabled: true });
    if (!lower) return NextResponse.json({ reply: "Escribí un comando. Probá *aforo* o *ayuda*." });

    if (/^(aforo|filas|estado|ocupaci[oó]n|cola|espera)\b/.test(lower)) {
        try {
            const [qDevs, qCounts, qAlerts]: any[] = await Promise.all([getQueueDevices(), getLatestQueueCounts(), getQueueAlerts()]);
            if (!qDevs?.length) return NextResponse.json({ reply: "No hay filas configuradas en el sistema." });
            let total = 0;
            let msg = "📊 Aforo en vivo — Control de Filas\n\n";
            for (const d of qDevs) {
                const c = (qCounts || []).find((x: any) => x.device?.id === d.id);
                const ch = c ? (c.channels || []).find((x: any) => OCC.includes(x.channelName)) : null;
                const a = ch ? ch.peopleCount : 0;
                total += a;
                const al = (qAlerts || []).find((x: any) => x.deviceId === d.id);
                const thr = al ? al.threshold : null;
                const emoji = thr ? (a >= thr ? "🔴" : a >= thr * 0.7 ? "🟡" : "🟢") : "⚪";
                msg += `${emoji} ${d.name}: ${a}${thr ? ` / ${thr}` : ""} personas\n`;
            }
            msg += `\n👥 Total: ${total} personas`;
            return NextResponse.json({ reply: msg });
        } catch {
            return NextResponse.json({ reply: "No pude obtener el aforo en este momento." });
        }
    }

    if (/(ayuda|help|comando|hola|menu|menú)/.test(lower)) {
        return NextResponse.json({ reply: "Comandos disponibles:\n• *aforo* — estado de las filas en vivo\n• *espera* — aforo y umbrales\n• *estado* — resumen general\n• *ayuda* — esta ayuda" });
    }

    return NextResponse.json({ reply: 'No entendí ese comando. Probá *aforo* o *ayuda*.' });
}
