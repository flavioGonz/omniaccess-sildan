/**
 * Moverse a lo largo de la traza: dónde está el vehículo y hacia dónde apunta.
 *
 * Lo usan las dos vistas del mapa, la plana y la 3D, para que el vehículo se mueva igual
 * en las dos. El `avance` es continuo —2,4 significa "en el 40 % del tercer tramo"— y se
 * reparte por DISTANCIA dentro del tramo, no por cantidad de vértices: una calle trae
 * vértices apretados en las curvas y separados en las rectas, así que repartir por
 * vértice haría que el auto frenara en cada curva y saliera disparado en las rectas.
 */

export type TramoTraza = {
    desde: number;
    coords: [number, number][];
    calle: boolean;
    metros: number;
};

const metros = (a: [number, number], b: [number, number]) => {
    const R = 6371000, rad = (x: number) => (x * Math.PI) / 180;
    const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
};

/** El rumbo en grados, 0 = norte, como lo espera una rotación en pantalla. */
export function rumbo(a: [number, number], b: [number, number]) {
    const rad = (x: number) => (x * Math.PI) / 180;
    const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
    const x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
    return (Math.atan2(y, x) * 180) / Math.PI;
}

/** Toda la traza como una sola polilínea, para dibujarla de una. */
export function polilinea(tramos: TramoTraza[]): [number, number][] {
    const out: [number, number][] = [];
    for (const t of tramos) {
        for (let i = 0; i < t.coords.length; i++) {
            if (i === 0 && out.length) continue;   // el extremo ya lo puso el tramo anterior
            out.push(t.coords[i]);
        }
    }
    return out;
}

/** La parte ya recorrida, cortada justo donde va el vehículo. */
export function recorrida(tramos: TramoTraza[], avance: number): [number, number][] {
    if (!tramos.length) return [];
    const entero = Math.floor(avance);
    const out: [number, number][] = [];
    for (let i = 0; i < Math.min(entero, tramos.length); i++) {
        for (let k = 0; k < tramos[i].coords.length; k++) {
            if (k === 0 && out.length) continue;
            out.push(tramos[i].coords[k]);
        }
    }
    const parcial = tramos[entero];
    if (parcial) {
        const frac = avance - entero;
        const { hasta, punto } = cortar(parcial.coords, frac);
        for (let k = 0; k <= hasta; k++) {
            if (k === 0 && out.length) continue;
            out.push(parcial.coords[k]);
        }
        if (punto) out.push(punto);
    } else if (!out.length && tramos[0]) {
        out.push(tramos[0].coords[0]);
    }
    return out;
}

/** Hasta qué vértice llegó, y el punto exacto entre ese vértice y el siguiente. */
function cortar(coords: [number, number][], frac: number) {
    if (coords.length < 2) return { hasta: 0, punto: null as [number, number] | null };
    const largos: number[] = [];
    let total = 0;
    for (let i = 0; i < coords.length - 1; i++) {
        const d = metros(coords[i], coords[i + 1]);
        largos.push(d); total += d;
    }
    if (total <= 0) return { hasta: 0, punto: null };
    let objetivo = Math.max(0, Math.min(1, frac)) * total;
    for (let i = 0; i < largos.length; i++) {
        if (objetivo <= largos[i]) {
            const t = largos[i] > 0 ? objetivo / largos[i] : 0;
            const a = coords[i], b = coords[i + 1];
            return { hasta: i, punto: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] as [number, number] };
        }
        objetivo -= largos[i];
    }
    return { hasta: coords.length - 1, punto: null };
}

/** Dónde está el vehículo y hacia dónde mira, para un avance continuo. */
export function posicionEnTraza(tramos: TramoTraza[], avance: number): { pos: [number, number]; grados: number } | null {
    if (!tramos.length) return null;
    const entero = Math.max(0, Math.min(Math.floor(avance), tramos.length - 1));
    const tramo = tramos[entero];
    if (!tramo || tramo.coords.length < 2) {
        const p = tramo?.coords?.[0];
        return p ? { pos: p, grados: 0 } : null;
    }
    const frac = Math.max(0, Math.min(1, avance - entero));
    const { hasta, punto } = cortar(tramo.coords, frac);
    const pos = punto || tramo.coords[tramo.coords.length - 1];
    const a = tramo.coords[hasta];
    const b = tramo.coords[Math.min(hasta + 1, tramo.coords.length - 1)];
    return { pos, grados: rumbo(a, b) };
}
