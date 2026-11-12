/**
 * El resumen de seguimiento de una ficha de la Lista Amarilla (openspec
 * seguimiento-lista-amarilla): junta lo que el cajón «Investigar» ya calcula por matrícula
 * (actions/history › getFichaMatricula) en las cifras de la ficha.
 *
 * No consulta nada: sólo combina. Es a propósito — un segundo cálculo de la actividad terminaría
 * mostrando «12 lecturas» en la ficha y «11 pasadas» en Investigar para la misma matrícula.
 */

/** Lo que se necesita de la ficha de cada matrícula. Los días de `porDia` vienen como AAAA-MM-DD. */
export type ActividadMatricula = {
    plate: string;
    ultima: string | null;
    porDia: { dia: string; n: number }[];
    porHora: number[];
    pasadas: { deviceName: string | null }[];
};

export type ResumenSeguimiento = {
    lecturas7: number;
    lecturas30: number;
    /** Días con al menos una lectura en los últimos 30 (un día compartido por dos matrículas cuenta uno). */
    diasActivos30: number;
    /** El primer día con lecturas que se conoce (AAAA-MM-DD), dentro de la ventana que guarda la ficha. */
    primera: string | null;
    ultima: string | null;
    /** La hora del día con más lecturas, y cómo se le dice. Null sin lecturas. */
    horaPico: number | null;
    franja: string | null;
    /** Las cámaras por las que pasa, de más a menos (sobre las lecturas detalladas, 30 días). */
    camaras: { nombre: string; n: number }[];
    porMatricula: { plate: string; lecturas30: number; ultima: string | null }[];
    /** Ninguna cámara la vio: la ficha lo dice así, sin ceros que parezcan datos. */
    sinLecturas: boolean;
};

const DIA_MS = 86_400_000;
/** El día AAAA-MM-DD de hace `n` días (en UTC, que es como vienen los de `porDia`). */
const diaHace = (ahora: Date, n: number) => new Date(ahora.getTime() - n * DIA_MS).toISOString().slice(0, 10);

export function franjaDe(h: number): string {
    if (h < 6) return "madrugada";
    if (h < 12) return "mañana";
    if (h < 19) return "tarde";
    return "noche";
}

export function combinarSeguimiento(matriculas: ActividadMatricula[], ahora: Date = new Date()): ResumenSeguimiento {
    const desde7 = diaHace(ahora, 6), desde30 = diaHace(ahora, 29);
    let lecturas7 = 0, lecturas30 = 0, primera: string | null = null, ultima: string | null = null;
    const dias30 = new Set<string>();
    const porHora = Array<number>(24).fill(0);
    const camaras = new Map<string, number>();
    const porMatricula: ResumenSeguimiento["porMatricula"] = [];

    for (const m of matriculas) {
        let suyas30 = 0;
        for (const d of m.porDia || []) {
            if (!d.n) continue;
            if (!primera || d.dia < primera) primera = d.dia;
            if (d.dia >= desde30) { lecturas30 += d.n; suyas30 += d.n; dias30.add(d.dia); }
            if (d.dia >= desde7) lecturas7 += d.n;
        }
        (m.porHora || []).forEach((n, h) => { if (h < 24) porHora[h] += n || 0; });
        for (const p of m.pasadas || []) { const c = p.deviceName || "Cámara sin nombre"; camaras.set(c, (camaras.get(c) || 0) + 1); }
        if (m.ultima && (!ultima || m.ultima > ultima)) ultima = m.ultima;
        porMatricula.push({ plate: m.plate, lecturas30: suyas30, ultima: m.ultima });
    }

    const totalHoras = porHora.reduce((a, b) => a + b, 0);
    const horaPico = totalHoras ? porHora.indexOf(Math.max(...porHora)) : null;
    return {
        lecturas7, lecturas30, diasActivos30: dias30.size, primera, ultima,
        horaPico, franja: horaPico == null ? null : franjaDe(horaPico),
        camaras: [...camaras].map(([nombre, n]) => ({ nombre, n })).sort((a, b) => b.n - a.n || a.nombre.localeCompare(b.nombre)),
        porMatricula,
        sinLecturas: !primera && !ultima,
    };
}
