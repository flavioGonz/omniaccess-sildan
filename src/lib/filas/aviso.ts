import { enMontevideo } from "@/lib/filas/horario";
import { VENTANA_ESPERA_MIN } from "@/lib/filas/constantes";
import type { DemoraFila } from "@/lib/filas/demora";

/**
 * El mensaje de Telegram cuando una fila pasa su límite (HB, 19/10). Va como leyenda del clip.
 *
 * Lo que tiene que contestar, en el orden en que se lee en el teléfono:
 *   1. ¿Qué fila y qué tan grave? — título con la fila y cuántos sobran.
 *   2. ¿Cuánto esperan? — la espera estimada, que es lo que siente la gente en la fila.
 *   3. ¿Desde cuándo? — si recién pasó o lleva rato (y si ya hay que llamar al supervisor).
 *   4. ¿Se está moviendo? — entradas contra atendidos de los últimos minutos.
 *   5. ¿Es raro hoy? — cuántas veces se llenó y el pico.
 *
 * Antes salía «Alerta de Aforo: Caja 1 / Ubicación: Aforo / Dispositivo: Caja 1 / Personas 12 / 10 /
 * Estado: LLENO»: tres renglones para decir el nombre de la cámara y ninguno sobre la demora.
 * Telegram limita la leyenda a 1024 caracteres: esto anda por 350.
 */

export type TipoAviso = "lleno" | "escalamiento";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const hhmm = (d: Date) => enMontevideo(d).hhmm;
const minutosDesde = (d: Date, ahora: Date) => Math.max(0, Math.round((ahora.getTime() - d.getTime()) / 60_000));

export function textoAvisoFila(p: { fila: string; demora: DemoraFila; tipo: TipoAviso; ahora?: Date; personas?: number }): string {
    const ahora = p.ahora || new Date();
    const d = p.demora;
    const personas = p.personas ?? d.aforo ?? 0;
    const sobran = personas - d.limite;
    const lineas: string[] = [];

    lineas.push(p.tipo === "escalamiento"
        ? `🔴 <b>${esc(p.fila)} — sigue sobre el límite</b>\n<i>Avisar al supervisor</i>`
        : `🟠 <b>${esc(p.fila)} — fila sobre el límite</b>`);
    lineas.push("");
    lineas.push(`👥 <b>${personas} personas</b> · límite ${d.limite}${sobran > 0 ? ` (+${sobran})` : ""}`);
    lineas.push(d.esperaMin != null
        ? `⏳ Espera estimada <b>~${d.esperaMin} min</b>`
        : `⏳ Espera estimada: sin salidas en ${VENTANA_ESPERA_MIN} min`);
    if (d.sobreDesde) {
        const m = minutosDesde(d.sobreDesde, ahora);
        lineas.push(`⏱️ Sobre el límite desde las ${hhmm(d.sobreDesde)}${m >= 1 ? ` (<b>${m} min</b>)` : ""}`);
    }
    lineas.push(`🚶 Últimos ${VENTANA_ESPERA_MIN} min: entraron <b>${d.entradas15}</b> · atendidos <b>${d.salidas15}</b>`);
    if (d.llenasHoy > 0 || d.picoHoy > 0) {
        const partes = [];
        if (d.llenasHoy > 0) partes.push(`se llenó <b>${d.llenasHoy}</b> ${d.llenasHoy === 1 ? "vez" : "veces"}`);
        if (d.picoHoy > 0) partes.push(`pico ${d.picoHoy}${d.picoHoyA ? ` a las ${hhmm(d.picoHoyA)}` : ""}`);
        lineas.push(`📊 Hoy: ${partes.join(" · ")}`);
    }
    lineas.push("");
    lineas.push(`<i>${hhmm(ahora)} · OmniAccess Filas</i>`);
    return lineas.join("\n");
}

/** El mismo aviso en texto plano (WhatsApp, correo, el historial de despachos). */
export function textoPlano(html: string): string {
    return html.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}
