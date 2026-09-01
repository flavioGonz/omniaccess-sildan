// Grafo ruteable construido desde las calles dibujadas del BARRIO_MAP.
// Nodos = vértices de calles (+ nodos virtuales de empalme y de snap de cámaras).
// Aristas = segmentos consecutivos + empalmes entre calles a < SNAP_M metros.

export type LL = [number, number]; // [lat, lng]

const SNAP_M = 18;      // empalme entre calles
const CAM_SNAP_M = 80;  // enganche de una cámara a la red

function distM(a: LL, b: LL): number {
    const dlat = (a[0] - b[0]) * 111320;
    const dlng = (a[1] - b[1]) * 111320 * Math.cos((a[0] * Math.PI) / 180);
    return Math.hypot(dlat, dlng);
}

function projOnSeg(p: LL, a: LL, b: LL): { pt: LL; d: number; t: number } {
    const ax = a[1], ay = a[0], bx = b[1], by = b[0], px = p[1], py = p[0];
    const dx = bx - ax, dy = by - ay;
    if (dx === 0 && dy === 0) return { pt: a, d: distM(p, a), t: 0 };
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
    const pt: LL = [ay + t * dy, ax + t * dx];
    return { pt, d: distM(p, pt), t };
}

export interface Graph {
    nodes: LL[];
    adj: Map<number, { to: number; w: number }[]>;
}

interface Edge { a: number; b: number }

export function buildStreetGraph(streets: { points: { x?: number; y?: number; lat?: number; lng?: number }[] | LL[] }[] | any[]): Graph {
    const nodes: LL[] = [];
    const edges: Edge[] = [];
    const nodeAt = (p: LL): number => {
        for (let i = 0; i < nodes.length; i++) if (distM(nodes[i], p) < 3) return i;
        nodes.push(p); return nodes.length - 1;
    };

    // 1) calles: nodos + aristas consecutivas
    const streetEdges: { a: number; b: number }[] = [];
    for (const s of streets) {
        const pts: LL[] = (s.points as any[]).map((p: any) => Array.isArray(p) ? p as LL : [p.lat ?? p[0], p.lng ?? p[1]] as LL);
        let prev = -1;
        for (const p of pts) {
            const n = nodeAt(p);
            if (prev >= 0 && prev !== n) { edges.push({ a: prev, b: n }); streetEdges.push({ a: prev, b: n }); }
            prev = n;
        }
    }

    // 2) empalmes: cada nodo contra cada arista (si el nodo cae cerca de una arista ajena, partirla)
    //    (con pocas calles esto es barato: ~50 nodos x ~50 aristas)
    let changed = true; let guard = 0;
    while (changed && guard++ < 5) {
        changed = false;
        for (let ni = 0; ni < nodes.length; ni++) {
            for (let ei = 0; ei < edges.length; ei++) {
                const e = edges[ei];
                if (e.a === ni || e.b === ni) continue;
                const pr = projOnSeg(nodes[ni], nodes[e.a], nodes[e.b]);
                if (pr.d < SNAP_M) {
                    if (pr.t > 0.02 && pr.t < 0.98) {
                        const mid = nodeAt(pr.pt);
                        if (mid !== e.a && mid !== e.b) {
                            edges.splice(ei, 1, { a: e.a, b: mid }, { a: mid, b: e.b });
                            edges.push({ a: ni, b: mid });
                            changed = true;
                            break;
                        }
                    } else {
                        const other = pr.t <= 0.02 ? e.a : e.b;
                        if (other !== ni) { edges.push({ a: ni, b: other }); }
                    }
                }
            }
            if (changed) break;
        }
    }

    // dedup edges + adj
    const seen = new Set<string>();
    const adj = new Map<number, { to: number; w: number }[]>();
    for (const e of edges) {
        const k = e.a < e.b ? `${e.a}-${e.b}` : `${e.b}-${e.a}`;
        if (seen.has(k) || e.a === e.b) continue;
        seen.add(k);
        const w = distM(nodes[e.a], nodes[e.b]);
        if (!adj.has(e.a)) adj.set(e.a, []);
        if (!adj.has(e.b)) adj.set(e.b, []);
        adj.get(e.a)!.push({ to: e.b, w });
        adj.get(e.b)!.push({ to: e.a, w });
    }
    return { nodes, adj };
}

// Engancha un punto (cámara) a la red proyectándolo sobre el SEGMENTO más cercano
// (las calles largas tienen vértices lejanos: medir contra nodos dejaba cámaras "fuera de red").
// Inserta un nodo virtual en la proyección, partiendo la arista, y lo devuelve.
export function attachPoint(g: Graph, p: LL): number | null {
    let best: { d: number; a: number; b: number; pt: LL; t: number } | null = null;
    const seen = new Set<string>();
    for (const [a, nbrs] of g.adj) {
        for (const { to: b } of nbrs) {
            const k = a < b ? `${a}-${b}` : `${b}-${a}`;
            if (seen.has(k)) continue;
            seen.add(k);
            const pr = projOnSeg(p, g.nodes[a], g.nodes[b]);
            if (!best || pr.d < best.d) best = { d: pr.d, a, b, pt: pr.pt, t: pr.t };
        }
    }
    if (!best || best.d > CAM_SNAP_M) return null;
    // si la proyección cae sobre un extremo, usar ese nodo
    if (best.t <= 0.03) return best.a;
    if (best.t >= 0.97) return best.b;
    // insertar nodo virtual partiendo la arista a-b
    const mid = g.nodes.length;
    g.nodes.push(best.pt);
    const wA = distM(g.nodes[best.a], best.pt);
    const wB = distM(g.nodes[best.b], best.pt);
    const listA = g.adj.get(best.a)!;
    const listB = g.adj.get(best.b)!;
    const ia = listA.findIndex((e) => e.to === best!.b);
    const ib = listB.findIndex((e) => e.to === best!.a);
    if (ia >= 0) listA.splice(ia, 1);
    if (ib >= 0) listB.splice(ib, 1);
    listA.push({ to: mid, w: wA });
    listB.push({ to: mid, w: wB });
    g.adj.set(mid, [{ to: best.a, w: wA }, { to: best.b, w: wB }]);
    return mid;
}

// Dijkstra: ruta entre dos nodos -> array de LL (o null)
export function route(g: Graph, from: number, to: number): LL[] | null {
    if (from === to) return [g.nodes[from]];
    const dist = new Map<number, number>(); const prev = new Map<number, number>();
    const visited = new Set<number>();
    dist.set(from, 0);
    while (true) {
        let u = -1; let du = Infinity;
        for (const [n, d] of dist) if (!visited.has(n) && d < du) { u = n; du = d; }
        if (u === -1) break;
        if (u === to) break;
        visited.add(u);
        for (const { to: v, w } of (g.adj.get(u) || [])) {
            const nd = du + w;
            if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, u); }
        }
    }
    if (!prev.has(to) && from !== to) return null;
    const path: number[] = [to];
    let cur = to;
    while (cur !== from) { cur = prev.get(cur)!; if (cur == null) return null; path.push(cur); }
    path.reverse();
    return path.map((n) => g.nodes[n]);
}

// Camino "hacia adentro" desde un nodo: avanza por la red hasta ~maxM metros (para animar ingresos)
export function walkInward(g: Graph, from: number, maxM: number): LL[] {
    const path: LL[] = [g.nodes[from]];
    let cur = from; let prev = -1; let acc = 0;
    while (acc < maxM) {
        const nbrs = (g.adj.get(cur) || []).filter((n) => n.to !== prev);
        if (nbrs.length === 0) break;
        // elegir el vecino que más se aleja del origen
        let best = nbrs[0]; let bestD = -1;
        for (const n of nbrs) {
            const d = distM(g.nodes[n.to], g.nodes[from]);
            if (d > bestD) { bestD = d; best = n; }
        }
        if (acc + best.w > maxM) {
            // recortar la última arista para aterrizar exacto en maxM
            const rem = maxM - acc;
            const t = Math.max(0.05, Math.min(1, rem / best.w));
            const a = g.nodes[cur], b = g.nodes[best.to];
            path.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
            break;
        }
        acc += best.w;
        path.push(g.nodes[best.to]);
        prev = cur; cur = best.to;
    }
    return path;
}

export function pathLengthM(path: LL[]): number {
    let acc = 0;
    for (let i = 0; i < path.length - 1; i++) acc += distM(path[i], path[i + 1]);
    return acc;
}

// Interpola una posición sobre el path a fracción f (0..1 por distancia) + bearing en grados
export function pointAlong(path: LL[], f: number): { pt: LL; bearing: number } {
    const total = pathLengthM(path);
    let target = Math.max(0, Math.min(1, f)) * total;
    for (let i = 0; i < path.length - 1; i++) {
        const seg = distM(path[i], path[i + 1]);
        if (target <= seg || i === path.length - 2) {
            const t = seg === 0 ? 0 : Math.min(1, target / seg);
            const pt: LL = [
                path[i][0] + (path[i + 1][0] - path[i][0]) * t,
                path[i][1] + (path[i + 1][1] - path[i][1]) * t,
            ];
            const dy = path[i + 1][0] - path[i][0];
            const dx = (path[i + 1][1] - path[i][1]) * Math.cos((path[i][0] * Math.PI) / 180);
            const bearing = (Math.atan2(dx, dy) * 180) / Math.PI;
            return { pt, bearing };
        }
        target -= seg;
    }
    return { pt: path[path.length - 1], bearing: 0 };
}
