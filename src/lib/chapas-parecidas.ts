/**
 * ¿La chapa que se consulta puede ser otra, mal leída?
 *
 * Por qué existe (13/11, Nico: «es la primera vez que vemos eso… necesitamos saber por qué la da»).
 * El Ministerio contestó «está requerida» para SCH1707. La respuesta era del sitio, tal cual; pero
 * la chapa consultada salió de UNA lectura. En esa misma cámara, esa semana, el lector había leído
 * SDH1707 dieciocho veces, SDM1707 siete, y SCH1707 una sola: el auto estacionado es, casi seguro,
 * SDH1707, y la requerida es otro vehículo. Un cartel rojo de «matrícula requerida» sobre una
 * lectura equivocada es acusar al auto que no es.
 *
 * Acá sólo se decide cuáles otras chapas vale la pena mostrarle a quien consulta: las del mismo
 * largo que difieren en una o dos letras y que se leyeron MÁS veces. La decisión es de la persona,
 * mirando la foto. Sin base ni red: lo usan la ruta y las pruebas.
 */
export type ConteoChapa = { chapa: string; lecturas: number };

/** En cuántas posiciones difieren dos chapas del mismo largo (Infinity si el largo no coincide). */
export function diferencias(a: string, b: string): number {
    if (a.length !== b.length) return Infinity;
    let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
    return n;
}

/** Hasta cuántas letras de diferencia se toma como «puede ser la misma, mal leída». */
export const DIFERENCIAS_MAX = 2;
/** Cuántas se muestran. */
export const PARECIDAS_MAX = 3;

/** Las chapas parecidas a `chapa` que se leyeron más veces que ella, de la más leída a la menos. */
export function variantesMasLeidas(chapa: string, conteos: ConteoChapa[]): { propias: number; parecidas: ConteoChapa[] } {
    const propias = conteos.find((c) => c.chapa === chapa)?.lecturas ?? 0;
    const parecidas = conteos
        .filter((c) => c.chapa !== chapa && c.lecturas > propias && diferencias(c.chapa, chapa) <= DIFERENCIAS_MAX)
        .sort((a, b) => b.lecturas - a.lecturas || diferencias(a.chapa, chapa) - diferencias(b.chapa, chapa))
        .slice(0, PARECIDAS_MAX);
    return { propias, parecidas };
}

/* ═══════════════════════ Matrículas parecidas, con las confusiones del OCR (26/11) ═══════════════════════
 *
 * Nico: «quiero alguna función para buscar matrículas parecidas: a veces un carácter no se detecta
 * bien, pero tenemos que poder buscar las más parecidas y sugerir el auto correcto».
 *
 * No todas las diferencias pesan igual. Que el OCR lea una B donde hay un 8 es lo más común del
 * mundo; que lea una K donde hay un 3, no. Por eso la distancia es de edición PESADA: cambiar un
 * carácter por otro de su grupo de confusión cuesta poco, por cualquier otro cuesta uno entero, y
 * que falte o sobre un carácter (el recorte se comió el borde) también cuesta uno.
 */

/** Los grupos de caracteres que el OCR confunde entre sí, medidos en las lecturas de San Nicolás y Olivos. */
const GRUPOS_CONFUSION = ["0ODQU", "1IL7T", "2Z", "5S", "6GC", "8B3", "4A", "MNHW", "VYU", "EF", "PR", "KX"];
const grupoDe = new Map<string, number[]>();
GRUPOS_CONFUSION.forEach((g, i) => { for (const c of g) grupoDe.set(c, [...(grupoDe.get(c) || []), i]); });
/** ¿El OCR suele confundir a con b? */
export function seConfunden(a: string, b: string): boolean {
    if (a === b) return true;
    const ga = grupoDe.get(a), gb = grupoDe.get(b);
    return !!ga && !!gb && ga.some((x) => gb.includes(x));
}
/** Lo que cuesta cambiar un carácter de su grupo de confusión. */
export const COSTO_CONFUSION = 0.35;
/** Hasta qué costo se ofrece como parecida: una letra cualquiera mal, o hasta cuatro confusiones típicas. */
export const COSTO_MAX = 1.4;

const limpia = (p: string) => String(p || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** La distancia pesada entre dos chapas (0 = iguales). */
export function costoEntre(a0: string, b0: string): number {
    const a = limpia(a0), b = limpia(b0);
    if (a === b) return 0;
    const f = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        let prev = f[0]; f[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const t = f[j];
            const cambio = a[i - 1] === b[j - 1] ? 0 : seConfunden(a[i - 1], b[j - 1]) ? COSTO_CONFUSION : 1;
            f[j] = Math.min(f[j] + 1, f[j - 1] + 1, prev + cambio);
            prev = t;
        }
    }
    return Math.round(f[b.length] * 100) / 100;
}

/** Qué posiciones cambian, para marcarlas en pantalla (sólo si tienen el mismo largo). */
export function posicionesDistintas(a0: string, b0: string): number[] {
    const a = limpia(a0), b = limpia(b0);
    if (a.length !== b.length) return [];
    return [...a].map((c, i) => (c !== b[i] ? i : -1)).filter((i) => i >= 0);
}

export type Parecida<T> = T & { plate: string; costo: number; distintas: number[] };

/** Las más parecidas a `consulta` de una lista, de la más cercana a la más lejana (sin la idéntica). */
export function masParecidas<T extends { plate: string }>(consulta: string, lista: T[], max = 6, costoMax = COSTO_MAX): Parecida<T>[] {
    const q = limpia(consulta);
    if (q.length < 4) return [];
    const vistas = new Set<string>();
    const out: Parecida<T>[] = [];
    for (const x of lista) {
        const p = limpia(x.plate);
        if (!p || p === q || vistas.has(p) || Math.abs(p.length - q.length) > 1) continue;
        const costo = costoEntre(q, p);
        if (costo <= costoMax) { vistas.add(p); out.push({ ...x, plate: p, costo, distintas: posicionesDistintas(q, p) }); }
    }
    return out.sort((a, b) => a.costo - b.costo || a.plate.localeCompare(b.plate)).slice(0, max);
}
