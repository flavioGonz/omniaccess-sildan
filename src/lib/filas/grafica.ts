import sharp from "sharp";
import { lecturasAforo, porTramos, medianocheUy, TRAMOS_DIA, hhmmDeTramo } from "@/lib/filas/medidas";
import { limiteDeFila } from "@/lib/filas/demora";
import { enMontevideo } from "@/lib/filas/horario";
import { marcaDeAgua } from "@/lib/filas/presentacion";

/**
 * La gráfica del aforo de hoy como imagen, para mandarla por Telegram (/grafica y el botón
 * «Gráfica»). Mismo cálculo que el Pronóstico (aforo ponderado por tiempo cada 15 min) y los
 * colores del isotipo: sharp no lee variables CSS, por eso van escritos.
 */
// ABA deja lugar abajo para la marca de agua (lib/filas/presentacion): con 60 tapaba las horas.
const W = 1200, H = 720, IZQ = 70, DER = 30, ARR = 110, ABA = 160;
const C = { fondo: "#0b1220", linea: "#1e293b", tenue: "#94a3b8", tinta: "#f8fafc", acc: "#3b82f6", acc2: "#22d3ee", mal: "#ef4444" };
const FUENTE = "Outfit, 'DejaVu Sans', sans-serif";

export async function graficaHoy(deviceId: string, fila: string): Promise<Buffer> {
    const ahora = Date.now();
    const hoy0 = medianocheUy(ahora);
    const [lect, limite] = await Promise.all([lecturasAforo(deviceId, new Date(hoy0), new Date(ahora)), limiteDeFila(deviceId)]);
    const tr = porTramos(lect, hoy0, TRAMOS_DIA);
    const kAhora = Math.floor((ahora - hoy0) / (15 * 60_000));
    const conDato = tr.map((x, k) => ({ k, ...x })).filter((x) => x.prom != null);
    const a = conDato.length ? Math.max(0, conDato[0].k - 2) : Math.max(0, kAhora - 16), b = Math.max(kAhora, a + 8);
    const n = b - a + 1;
    const max = Math.max(limite + 1, 4, ...conDato.map((x) => x.max ?? 0));
    const x = (k: number) => IZQ + ((k - a) / Math.max(1, n - 1)) * (W - IZQ - DER);
    const y = (v: number) => ARR + (1 - v / max) * (H - ARR - ABA);
    const puntos = conDato.filter((p) => p.k >= a && p.k <= b);
    const linea = (campo: "prom" | "max") => puntos.map((p, i) => `${i ? "L" : "M"}${x(p.k).toFixed(1)},${y((p[campo] as number) || 0).toFixed(1)}`).join(" ");
    const area = puntos.length ? `${linea("max")} L${x(puntos[puntos.length - 1].k)},${y(0)} L${x(puntos[0].k)},${y(0)} Z` : "";
    const pico = conDato.reduce((m, p) => ((p.max ?? 0) > m.v ? { v: p.max ?? 0, k: p.k } : m), { v: 0, k: 0 });
    const etiquetas = Array.from({ length: n }, (_, i) => a + i).filter((k) => k % 4 === 0);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
<defs><linearGradient id="ar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.acc}" stop-opacity=".45"/><stop offset="1" stop-color="${C.acc}" stop-opacity="0"/></linearGradient></defs>
<rect width="${W}" height="${H}" fill="${C.fondo}"/>
<text x="${IZQ}" y="52" font-family="${FUENTE}" font-size="30" font-weight="700" fill="${C.tinta}">${fila.replace(/&/g, "&amp;").replace(/</g, "&lt;")} · aforo de hoy</text>
<text x="${IZQ}" y="84" font-family="${FUENTE}" font-size="18" font-weight="600" fill="${C.tenue}">${enMontevideo(new Date()).fecha.split("-").reverse().join("/")} · pico ${pico.v}${pico.v ? ` a las ${hhmmDeTramo(pico.k)}` : ""} · límite ${limite}</text>
${[0, 0.5, 1].map((g) => `<line x1="${IZQ}" x2="${W - DER}" y1="${y(max * g)}" y2="${y(max * g)}" stroke="${C.linea}" stroke-dasharray="${g ? "4 6" : ""}"/><text x="${IZQ - 12}" y="${y(max * g) + 6}" text-anchor="end" font-family="${FUENTE}" font-size="16" fill="${C.tenue}">${Math.round(max * g)}</text>`).join("")}
<line x1="${IZQ}" x2="${W - DER}" y1="${y(limite)}" y2="${y(limite)}" stroke="${C.mal}" stroke-width="2" stroke-dasharray="10 6"/>
<text x="${W - DER}" y="${y(limite) - 8}" text-anchor="end" font-family="${FUENTE}" font-size="15" font-weight="700" fill="${C.mal}">límite ${limite}</text>
${area ? `<path d="${area}" fill="url(#ar)"/><path d="${linea("max")}" fill="none" stroke="${C.acc}" stroke-width="3" stroke-linejoin="round"/><path d="${linea("prom")}" fill="none" stroke="${C.acc2}" stroke-width="2" stroke-dasharray="6 5"/>` : `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-family="${FUENTE}" font-size="22" fill="${C.tenue}">Todavía no hay datos hoy</text>`}
<line x1="${x(kAhora)}" x2="${x(kAhora)}" y1="${ARR}" y2="${y(0)}" stroke="${C.tenue}" stroke-dasharray="3 4"/>
${etiquetas.map((k) => `<text x="${x(k)}" y="${y(0) + 28}" text-anchor="middle" font-family="${FUENTE}" font-size="15" fill="${C.tenue}">${hhmmDeTramo(k)}</text>`).join("")}
<g font-family="${FUENTE}" font-size="15" fill="${C.tenue}"><rect x="${W - 330}" y="40" width="18" height="4" fill="${C.acc}"/><text x="${W - 304}" y="47">pico de cada 15 min</text><rect x="${W - 150}" y="40" width="18" height="4" fill="${C.acc2}"/><text x="${W - 124}" y="47">promedio</text></g>
</svg>`;
    // La misma marca de agua que las fotos y los videos: todo lo que sale por Telegram lleva el sello.
    return sharp(Buffer.from(svg)).composite(await marcaDeAgua(W, H)).png().toBuffer();
}
