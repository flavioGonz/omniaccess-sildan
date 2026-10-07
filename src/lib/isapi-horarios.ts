import { authenticatedRequest } from "@/lib/digest-auth";
import type { CamDev } from "@/lib/isapi-analytics";

/**
 * El horario de armado de cada regla de intrusión, en la cámara.
 *
 * Una cámara AcuSense tiene una regla de cruce de línea y una de zona, y CADA UNA tiene su
 * propio horario semanal de armado: fuera de ese horario la cámara no avisa aunque la línea
 * se cruce. Hasta el 7/10 eso vivía sólo en la web de la cámara, invisible desde OmniAccess:
 * una perimetral podía estar "activa" en el monitor y no avisar de noche porque alguien la
 * dejó armada de 8 a 18. Esto lo lee y lo escribe por ISAPI, para que se vea y se cambie
 * desde el monitor, por regla, por cámara o para todas.
 *
 * Verificado el 7/10 en las DS-2CD2T26G2-2I (.19/.22/.36):
 *   GET/PUT /ISAPI/Event/schedules/lineDetections/lineDetection-1
 *   GET/PUT /ISAPI/Event/schedules/fieldDetections/fieldDetection-1
 * Documento <Schedule> con <TimeBlockList> de <TimeBlock><dayOfWeek>1..7</dayOfWeek>
 * <TimeRange><beginTime>HH:MM</beginTime><endTime>HH:MM</endTime>. dayOfWeek 1 = lunes,
 * 7 = domingo. "24:00" es fin de día. Las rutas en minúscula (linedetection/linedetection-1)
 * contestan 403 en este firmware.
 */

export type TipoRegla = "linea" | "zona";
/** 1 = lunes … 7 = domingo, como lo numera la cámara. */
export type Bloque = { dia: number; desde: string; hasta: string };
export type Horario = { bloques: Bloque[] };

const RUTA: Record<TipoRegla, string> = {
    linea: "/ISAPI/Event/schedules/lineDetections/lineDetection-1",
    zona: "/ISAPI/Event/schedules/fieldDetections/fieldDetection-1",
};

export const DIAS_CORTOS = ["", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
export const DIAS_LETRA = ["", "L", "M", "X", "J", "V", "S", "D"];

const dv = (d: CamDev): CamDev => ({ ...d, authType: d.authType || "DIGEST" });

export async function leerHorario(d: CamDev, tipo: TipoRegla): Promise<Horario | null> {
    const xml: string = await authenticatedRequest("GET", RUTA[tipo], dv(d) as any, { responseType: "text", accept: "application/xml", timeout: 8000 });
    if (!/<Schedule\b/i.test(xml)) return null;
    const bloques: Bloque[] = [];
    const re = /<TimeBlock>\s*<dayOfWeek>(\d)<\/dayOfWeek>\s*<TimeRange>\s*<beginTime>([\d:]+)<\/beginTime>\s*<endTime>([\d:]+)<\/endTime>\s*<\/TimeRange>\s*<\/TimeBlock>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml))) bloques.push({ dia: Number(m[1]), desde: m[2], hasta: m[3] });
    return { bloques };
}

/**
 * Escribe el horario sobre el documento que devuelve la cámara (mismo criterio que las reglas:
 * de cero contesta "Invalid XML Content"). Relee para confirmar: el 200 de ISAPI no alcanza.
 */
export async function escribirHorario(d: CamDev, tipo: TipoRegla, horario: Horario): Promise<Horario> {
    const actual: string = await authenticatedRequest("GET", RUTA[tipo], dv(d) as any, { responseType: "text", accept: "application/xml", timeout: 8000 });
    const bloques = normalizarBloques(horario.bloques);
    const lista = `<TimeBlockList size="8">${bloques.map((b) => `<TimeBlock><dayOfWeek>${b.dia}</dayOfWeek><TimeRange><beginTime>${b.desde}</beginTime><endTime>${b.hasta}</endTime></TimeRange></TimeBlock>`).join("")}</TimeBlockList>`;
    const cuerpo = /<TimeBlockList\b[\s\S]*?<\/TimeBlockList>/.test(actual)
        ? actual.replace(/<TimeBlockList\b[\s\S]*?<\/TimeBlockList>/, lista)
        : actual.replace(/<\/Schedule>/, `${lista}</Schedule>`);
    const resp: string = await authenticatedRequest("PUT", RUTA[tipo], dv(d) as any, { data: cuerpo, contentType: "application/xml", accept: "application/xml", responseType: "text", timeout: 12000 });
    const estado = (resp.match(/<statusString>([^<]*)<\/statusString>/) || [])[1] || "";
    if (estado && estado.toUpperCase() !== "OK") throw new Error(estado);
    const releido = await leerHorario(d, tipo);
    if (!releido) throw new Error("la cámara no devolvió el horario al releerlo");
    if (!mismoHorario(releido, { bloques })) throw new Error("la cámara aceptó el PUT pero el horario releído no coincide");
    return releido;
}

/** Ordena, limpia y parte los rangos que cruzan medianoche (22:00–06:00 → 22:00–24:00 + 00:00–06:00 del día siguiente). */
export function normalizarBloques(bloques: Bloque[]): Bloque[] {
    const out: Bloque[] = [];
    for (const b of bloques) {
        const dia = Math.min(7, Math.max(1, Number(b.dia) || 1));
        const desde = hhmm(b.desde), hasta = hhmm(b.hasta);
        if (!desde || !hasta || desde === hasta) continue;
        if (minutos(hasta) > minutos(desde)) out.push({ dia, desde, hasta });
        else { out.push({ dia, desde, hasta: "24:00" }); out.push({ dia: dia === 7 ? 1 : dia + 1, desde: "00:00", hasta }); }
    }
    return out.sort((a, b) => a.dia - b.dia || minutos(a.desde) - minutos(b.desde));
}

const hhmm = (s: string) => { const m = String(s || "").match(/^(\d{1,2}):(\d{2})$/); if (!m) return ""; const h = Math.min(24, Number(m[1])), mi = Math.min(59, Number(m[2])); return `${String(h).padStart(2, "0")}:${h === 24 ? "00" : String(mi).padStart(2, "0")}`; };
const minutos = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };

export function mismoHorario(a: Horario, b: Horario): boolean {
    const na = normalizarBloques(a.bloques), nb = normalizarBloques(b.bloques);
    return na.length === nb.length && na.every((x, i) => x.dia === nb[i].dia && x.desde === nb[i].desde && x.hasta === nb[i].hasta);
}

export const HORARIO_SIEMPRE: Horario = { bloques: [1, 2, 3, 4, 5, 6, 7].map((dia) => ({ dia, desde: "00:00", hasta: "24:00" })) };

/** Un rango igual todos los días elegidos (puede cruzar medianoche). */
export function horarioDiario(dias: number[], desde: string, hasta: string): Horario {
    return { bloques: dias.map((dia) => ({ dia, desde, hasta })) };
}

/**
 * El horario en palabras: "Siempre", "Nunca", "L–D 22:00–06:00", "L–V 08:00–18:00 · S–D 24 h".
 * Vuelve a juntar los rangos que la cámara guarda partidos por medianoche.
 */
export function describirHorario(h: Horario | null | undefined): string {
    if (!h) return "sin dato";
    const bl = normalizarBloques(h.bloques);
    if (bl.length === 0) return "Nunca (desarmada)";
    if (mismoHorario(h, HORARIO_SIEMPRE)) return "Siempre";
    // Rango por día, rejuntando "desde–24:00" con el "00:00–hasta" del día siguiente.
    const porDia = new Map<number, string[]>();
    const usados = new Set<number>();
    bl.forEach((b, i) => {
        if (usados.has(i)) return;
        let texto = `${b.desde}–${b.hasta}`;
        if (b.hasta === "24:00") {
            const sig = b.dia === 7 ? 1 : b.dia + 1;
            const j = bl.findIndex((x, k) => !usados.has(k) && k !== i && x.dia === sig && x.desde === "00:00");
            if (j >= 0) { texto = `${b.desde}–${bl[j].hasta}`; usados.add(j); }
            else if (b.desde === "00:00") texto = "24 h";
        }
        usados.add(i);
        porDia.set(b.dia, [...(porDia.get(b.dia) || []), texto]);
    });
    // Agrupar días consecutivos con el mismo texto.
    const grupos: { dias: number[]; texto: string }[] = [];
    for (let d = 1; d <= 7; d++) {
        const t = (porDia.get(d) || []).join(" y ");
        if (!t) continue;
        const u = grupos[grupos.length - 1];
        if (u && u.texto === t && u.dias[u.dias.length - 1] === d - 1) u.dias.push(d); else grupos.push({ dias: [d], texto: t });
    }
    return grupos.map((g) => `${g.dias.length > 2 ? `${DIAS_LETRA[g.dias[0]]}–${DIAS_LETRA[g.dias[g.dias.length - 1]]}` : g.dias.map((x) => DIAS_LETRA[x]).join(" ")} ${g.texto}`).join(" · ");
}

/** ¿Está armada ahora mismo? (hora local del servidor; las cámaras están en el huso del barrio). */
export function armadaAhora(h: Horario | null | undefined, ahora = new Date()): boolean {
    if (!h) return false;
    const dia = ahora.getDay() === 0 ? 7 : ahora.getDay();
    const min = ahora.getHours() * 60 + ahora.getMinutes();
    return normalizarBloques(h.bloques).some((b) => b.dia === dia && min >= minutos(b.desde) && min < minutos(b.hasta));
}
