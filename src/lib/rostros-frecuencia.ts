/**
 * Con qué frecuencia pasa una cara, y si conviene registrarla (13/11, Nico: «debe registrar los
 * rostros y ser más inteligente en esto: entender la frecuencia de cada uno y sugerir un registro»).
 *
 * Hasta acá una identidad sólo sabía «veces»: un número que no distingue al que vino cinco veces
 * la misma mañana del que viene todos los días a las siete. Con las pasadas guardadas se puede
 * contestar lo que el guardia quiere saber: ¿viene seguido?, ¿cuándo?, ¿por dónde?
 *
 * Los criterios, y por qué:
 *  · Una VISITA es verla de nuevo después de VISITA_MS (el mismo corte que usa el proceso de
 *    visión para contar «veces»): cruzar dos cámaras o quedarse en la puerta no son dos visitas.
 *  · Se sugiere registrar a quien vino SUGERIR.visitas veces o más en SUGERIR.dias días distintos
 *    dentro de las últimas dos semanas. Los días distintos son lo que importa: un albañil que
 *    entra y sale ocho veces en una jornada no es todavía alguien «de la casa»; el que vino tres
 *    días, sí. Y no se le sugiere a nadie que ya tenga nombre.
 *  · La franja habitual se dice sólo si la mayoría de las visitas cae en ella: con dos visitas
 *    sueltas no hay costumbre que contar.
 *
 * Son criterios, no mediciones: el 13/11 había tres identidades y ninguna había vuelto a pasar.
 * Cuando haya un mes de pasadas reales hay que mirar a quién se le sugirió y a quién no.
 *
 * Sin base ni red: lo usan las acciones, las pantallas y las pruebas.
 */

/** Igual que VISITA_MS de lib-rostros.js (tests/rostros-frecuencia.test.ts comprueba que coincidan). */
export const VISITA_MS = 10 * 60_000;
/** Cuánto para atrás se mira para hablar de frecuencia. */
export const VENTANA_DIAS = 30;
/** Cuándo se sugiere registrar a una cara sin nombre. */
export const SUGERIR = { visitas: 3, dias: 2, enDias: 14 };
/** De cuántos días distintos (en dos semanas) para arriba es alguien habitual. */
export const HABITUAL_DIAS = 4;
/** Ancho de la franja horaria que se busca, y qué parte de las visitas tiene que caer adentro. */
export const FRANJA_HORAS = 3;
export const FRANJA_PARTE = 0.6;
/** Cuántos días muestra la tira de la ficha. */
export const TIRA_DIAS = 14;

const ZONA = "America/Montevideo";
const DIA_MS = 86_400_000;

export type PasadaMin = { cuando: number | string | Date; camara?: string | null };
export type PatronRostro = "habitual" | "recurrente" | "ocasional" | "nueva";
export type Frecuencia = {
    /** Visitas dentro de la ventana (VENTANA_DIAS), y en los últimos 7 y 14 días. */
    visitas: number; visitas7: number; visitas14: number;
    /** Días distintos con alguna visita, en la ventana y en los últimos 14. */
    dias: number; dias14: number;
    /** La hora habitual [desde, hasta) si la mayoría de las visitas cae ahí. Null si no hay costumbre. */
    franja: { desde: number; hasta: number } | null;
    /** La cámara por la que más pasa, si se sabe. */
    camara: string | null;
    patron: PatronRostro;
    /** Sin nombre y viene seguido: conviene registrarla. */
    conviene: boolean;
    /** Las visitas de cada uno de los últimos TIRA_DIAS días, del más viejo a hoy. */
    tira: number[];
    /** En palabras: «5 visitas en 4 días · casi siempre de 07 a 10 h · Entrada Proveedores». */
    texto: string;
};

const ms = (v: number | string | Date) => (v instanceof Date ? v.getTime() : typeof v === "number" ? v : new Date(v).getTime());
/** El día (AAAA-MM-DD) y la hora (0–23) de un instante, en la hora de acá. */
function diaYHora(t: number): { dia: string; hora: number } {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date(t));
    const de = (k: string) => p.find((x) => x.type === k)?.value || "";
    return { dia: `${de("year")}-${de("month")}-${de("day")}`, hora: Number(de("hour")) % 24 };
}
const dosCifras = (n: number) => String(n).padStart(2, "0");

/** Las visitas que hacen esas pasadas: el instante en que empezó cada una, y por qué cámara. */
export function visitasDe(pasadas: PasadaMin[]): { t: number; camara: string | null }[] {
    const orden = pasadas.map((p) => ({ t: ms(p.cuando), camara: p.camara ?? null })).filter((p) => Number.isFinite(p.t)).sort((a, b) => a.t - b.t);
    const out: { t: number; camara: string | null }[] = [];
    let ultimo = -Infinity;
    for (const p of orden) { if (p.t - ultimo > VISITA_MS) out.push(p); ultimo = p.t; }
    return out;
}

export function frecuencia(pasadas: PasadaMin[], op: { ahora?: number; registrada?: boolean; primeraVez?: number | string | Date | null } = {}): Frecuencia {
    const ahora = op.ahora ?? Date.now();
    const todas = visitasDe(pasadas).filter((v) => v.t <= ahora);
    const enVentana = todas.filter((v) => ahora - v.t <= VENTANA_DIAS * DIA_MS);
    const en = (dias: number) => enVentana.filter((v) => ahora - v.t <= dias * DIA_MS);
    const diasDe = (vs: typeof todas) => new Set(vs.map((v) => diaYHora(v.t).dia)).size;
    const v14 = en(SUGERIR.enDias), dias14 = diasDe(v14);

    // La franja: la ventana de FRANJA_HORAS horas (da la vuelta a medianoche) con más visitas.
    let franja: Frecuencia["franja"] = null;
    if (enVentana.length >= 3) {
        const porHora = new Array(24).fill(0);
        enVentana.forEach((v) => porHora[diaYHora(v.t).hora]++);
        let mejor = 0, desde = 0;
        for (let h = 0; h < 24; h++) { let n = 0; for (let k = 0; k < FRANJA_HORAS; k++) n += porHora[(h + k) % 24]; if (n > mejor) { mejor = n; desde = h; } }
        if (mejor / enVentana.length >= FRANJA_PARTE) {
            // Se ajusta a las horas que de verdad tienen visitas: «de 07 a 08», no «de 06 a 09» por una sola hora ocupada.
            let a = desde, b = desde + FRANJA_HORAS;
            while (b - a > 1 && !porHora[a % 24]) a++;
            while (b - a > 1 && !porHora[(b - 1) % 24]) b--;
            franja = { desde: a % 24, hasta: b % 24 };
        }
    }

    const porCamara = new Map<string, number>();
    enVentana.forEach((v) => { if (v.camara) porCamara.set(v.camara, (porCamara.get(v.camara) || 0) + 1); });
    const camara = [...porCamara.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    const primera = op.primeraVez != null ? ms(op.primeraVez) : todas[0]?.t ?? ahora;
    const patron: PatronRostro = dias14 >= HABITUAL_DIAS ? "habitual"
        : enVentana.length >= SUGERIR.visitas && diasDe(enVentana) >= SUGERIR.dias ? "recurrente"
        : ahora - primera <= DIA_MS && enVentana.length <= 1 ? "nueva" : "ocasional";
    const conviene = !op.registrada && v14.length >= SUGERIR.visitas && dias14 >= SUGERIR.dias;

    // La tira: hoy es la última casilla.
    const hoy = diaYHora(ahora).dia, tira = new Array(TIRA_DIAS).fill(0);
    const aDia = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
    enVentana.forEach((v) => { const atras = Math.round((aDia(hoy) - aDia(diaYHora(v.t).dia)) / DIA_MS); if (atras >= 0 && atras < TIRA_DIAS) tira[TIRA_DIAS - 1 - atras]++; });

    const dias = diasDe(enVentana);
    const partes: string[] = [];
    if (!enVentana.length) partes.push(`Sin visitas en los últimos ${VENTANA_DIAS} días`);
    else {
        partes.push(`${enVentana.length === 1 ? "1 visita" : `${enVentana.length} visitas`}${enVentana.length > 1 ? ` en ${dias === 1 ? "un mismo día" : `${dias} días`}` : ""}`);
        if (franja) partes.push(`casi siempre de ${dosCifras(franja.desde)} a ${dosCifras(franja.hasta)} h`);
        if (camara && porCamara.size > 0 && enVentana.length > 1) partes.push(porCamara.size === 1 ? `siempre por ${camara}` : `sobre todo por ${camara}`);
    }
    return { visitas: enVentana.length, visitas7: en(7).length, visitas14: v14.length, dias, dias14, franja, camara, patron, conviene, tira, texto: partes.join(" · ") };
}

export const TEXTO_PATRON: Record<PatronRostro, string> = { habitual: "Habitual", recurrente: "Viene seguido", ocasional: "Ocasional", nueva: "Cara nueva" };
