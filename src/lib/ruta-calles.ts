/**
 * La traza del recorrido, siguiendo las calles.
 *
 * Unir dos cámaras con una línea recta dibuja algo que no pasó: el vehículo fue por la
 * calle, no por arriba de las casas. Con dos cámaras la diferencia ya se nota (386 m en
 * recta contra 445 m de calle en San Nicolás), y con el barrio entero lleno de cámaras un
 * recorrido en línea recta sería un dibujo abstracto, no un recorrido.
 *
 * La geometría sale de OSRM, que resuelve el camino sobre OpenStreetMap. Si no contesta o
 * el barrio no está mapeado, el tramo vuelve como recta y se marca `calle: false`, para
 * que la pantalla pueda decir que ese pedazo es una aproximación en vez de afirmarlo.
 */

const OSRM = process.env.OSRM_URL || "https://router.project-osrm.org";
const TIEMPO_MS = Number(process.env.OSRM_TIMEOUT_MS || 6000);

export type TramoTraza = {
    /** Índice del punto de partida dentro de `puntos`. */
    desde: number;
    /** Coordenadas [lat, lng] del camino, extremos incluidos. */
    coords: [number, number][];
    /** true si el camino salió del callejero; false si es la recta de respaldo. */
    calle: boolean;
    /** Metros del camino. Solo informativo: no se muestra como distancia recorrida. */
    metros: number;
};

/**
 * Memoria del proceso.
 *
 * Las cámaras no se mudan, así que el camino entre dos de ellas es siempre el mismo. Sin
 * esto, cada consulta de una matrícula saldría a pedir de nuevo lo mismo — lento para
 * quien mira y abusivo con un servicio público.
 */
const cache = new Map<string, TramoTraza | null>();
const clave = (a: [number, number], b: [number, number]) =>
    `${a[0].toFixed(5)},${a[1].toFixed(5)}>${b[0].toFixed(5)},${b[1].toFixed(5)}`;

async function porCalle(a: [number, number], b: [number, number]): Promise<TramoTraza | null> {
    const k = clave(a, b);
    if (cache.has(k)) return cache.get(k) || null;

    try {
        // OSRM habla lng,lat — al revés que todo lo demás acá. Invertirlo manda el
        // recorrido a China sin avisar, así que va explícito.
        const url = `${OSRM}/route/v1/driving/${a[1]},${a[0]};${b[1]},${b[0]}?overview=full&geometries=geojson`;
        const r = await fetch(url, { signal: AbortSignal.timeout(TIEMPO_MS) });
        if (!r.ok) throw new Error(`OSRM ${r.status}`);
        const d = await r.json();
        const ruta = d?.routes?.[0];
        const crudas: [number, number][] = ruta?.geometry?.coordinates || [];
        if (d?.code !== "Ok" || crudas.length < 2) throw new Error("sin ruta");

        const coords = crudas.map(([lng, lat]) => [lat, lng] as [number, number]);
        // Los extremos se fuerzan a la posición real de la cámara: OSRM devuelve el punto
        // enganchado a la calle, que puede quedar unos metros del marcador y hace que la
        // línea arranque despegada del ícono.
        coords[0] = a;
        coords[coords.length - 1] = b;

        const tramo: TramoTraza = { desde: 0, coords, calle: true, metros: Math.round(ruta.distance || 0) };
        cache.set(k, tramo);
        return tramo;
    } catch {
        cache.set(k, null);
        return null;
    }
}

/** Distancia en metros entre dos coordenadas. */
export function metrosEntre(a: [number, number], b: [number, number]) {
    const R = 6371000, rad = (x: number) => (x * Math.PI) / 180;
    const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Un tramo por cada par de puntos consecutivos.
 *
 * Se resuelven en paralelo, pero con un techo: un recorrido largo no puede disparar
 * cuarenta consultas de una. Lo que no se resuelve queda como recta, que es peor pero
 * honesto — nunca se deja un recorrido sin dibujar por esto.
 */
export async function trazaPorCalles(puntos: { lat: number; lng: number }[], max = 24): Promise<TramoTraza[]> {
    const pares: [number, number][][] = [];
    for (let i = 0; i < puntos.length - 1; i++) {
        pares.push([[puntos[i].lat, puntos[i].lng], [puntos[i + 1].lat, puntos[i + 1].lng]]);
    }

    const salida: TramoTraza[] = [];
    for (let i = 0; i < pares.length; i += 4) {
        const tanda = pares.slice(i, i + 4);
        const res = await Promise.all(tanda.map(([a, b], k) =>
            (i + k) < max ? porCalle(a, b).catch(() => null) : Promise.resolve(null),
        ));
        res.forEach((t, k) => {
            const idx = i + k;
            const [a, b] = pares[idx];
            salida.push(t
                ? { ...t, desde: idx }
                : { desde: idx, coords: [a, b], calle: false, metros: Math.round(metrosEntre(a, b)) });
        });
    }
    return salida;
}
