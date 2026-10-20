"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Las personas que la Bosch está viendo, dibujadas sobre el vivo (HB, 20/10). Las manda la misma
 * cámara por su flujo de metadatos ONVIF (/api/filas/siluetas): no hace falta GPU ni OmniVision.
 *
 * Si se le pasa la zona de la fila (coordenadas del script de la Bosch, y = −1 arriba), cada
 * persona se pinta según cuente o no: la cámara cuenta por el PIE (ObjectSet FootPoint), así que
 * cuenta quien tiene el pie —el centro del borde de abajo de su caja— adentro de la zona. Es la
 * manera de ver de un golpe por qué el aforo dice lo que dice: una «persona» en una planta, alguien
 * parado justo en el borde, dos personas juntas leídas como una.
 */

type ObjetoBosch = { id: string; clase: string; p: number; caja: [number, number, number, number]; poligono: [number, number][] };
export type PuntoZona = { x: number; y: number };

/** Clases que la Bosch da para una persona. */
const ES_PERSONA = /human|person/i;

/** Punto adentro de un polígono (rayo horizontal). */
function adentro(px: number, py: number, pol: PuntoZona[]): boolean {
    let dentro = false;
    for (let i = 0, j = pol.length - 1; i < pol.length; j = i++) {
        const a = pol[i], b = pol[j];
        if ((a.y > py) !== (b.y > py) && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) dentro = !dentro;
    }
    return dentro;
}

export function useObjetosBosch(deviceId: string, activo: boolean) {
    const [objetos, setObjetos] = useState<ObjetoBosch[]>([]);
    const [estado, setEstado] = useState<"conectando" | "andando" | "sin-datos">("conectando");
    useEffect(() => {
        if (!activo || !deviceId) { setObjetos([]); return; }
        setEstado("conectando");
        const es = new EventSource(`/api/filas/siluetas?device=${encodeURIComponent(deviceId)}`);
        es.addEventListener("objetos", (e: MessageEvent) => { try { setObjetos(JSON.parse(e.data).objetos || []); setEstado("andando"); } catch { /* bloque roto */ } });
        es.addEventListener("fin", () => setEstado("sin-datos"));
        es.onerror = () => setEstado((s) => (s === "andando" ? s : "sin-datos"));
        return () => es.close();
    }, [deviceId, activo]);
    return { objetos, estado };
}

/** Una persona para dibujar: caja (ONVIF, −1..1, y arriba), polígono si hay, confianza. */
export type PersonaDibujo = { id?: string; caja: [number, number, number, number]; poligono?: [number, number][] | null; p: number };
/** Como se guarda con la foto (lib/filas/metadatos: personasParaGuardar). */
export type PersonaGuardada = { c: [number, number, number, number]; p: number; g?: [number, number][] };
export const desdeGuardadas = (xs?: PersonaGuardada[] | null): PersonaDibujo[] => (xs || []).map((x) => ({ caja: x.c, poligono: x.g || null, p: x.p }));

/**
 * El dibujo, sin saber de dónde salen las personas: lo usan el vivo y las fotos. Lo dibuja
 * OmniAccess, no la cámara (Nico, 20/10: «la silueta debe estar dibujada por nosotros»): la cámara
 * sólo dice dónde está cada uno.
 */
export function DibujoPersonas({ personas, zona, etiquetas = true, chico = false }: { personas: PersonaDibujo[]; zona?: PuntoZona[] | null; etiquetas?: boolean; chico?: boolean }) {
    const cuenta = (o: PersonaDibujo) => {
        if (!zona || zona.length < 3) return null;
        const [l, , r, b] = o.caja;
        return adentro((l + r) / 2, -b, zona); // pie: centro del borde de abajo; ONVIF (y arriba) → script (y abajo)
    };
    return (
        <>
            <svg viewBox="-1 -1 2 2" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none">
                {personas.map((o, i) => {
                    const c = cuenta(o);
                    const color = c === false ? "var(--muted-foreground)" : "var(--accion-en-oscuro)";
                    const pts = (o.poligono && o.poligono.length >= 3 ? o.poligono : [[o.caja[0], o.caja[1]], [o.caja[2], o.caja[1]], [o.caja[2], o.caja[3]], [o.caja[0], o.caja[3]]] as [number, number][])
                        .map(([x, y]) => `${x},${-y}`).join(" ");
                    return (
                        <g key={o.id ?? i}>
                            <polygon points={pts} fill={color} fillOpacity={c === false ? 0.06 : 0.14} stroke={color} strokeWidth={chico ? 1.2 : 2} vectorEffect="non-scaling-stroke" strokeDasharray={c === false ? "4 3" : undefined} />
                            {/* El pie: el punto con el que la cámara decide si cuenta. */}
                            {!chico && <circle cx={(o.caja[0] + o.caja[2]) / 2} cy={-o.caja[3]} r={0.012} fill={color} />}
                        </g>
                    );
                })}
            </svg>
            {etiquetas && personas.map((o, i) => {
                const c = cuenta(o);
                return (
                    <span key={o.id ?? i} className={cn("absolute -translate-y-full mb-0.5 px-1.5 py-px rounded text-[10px] font-semibold tabular-nums whitespace-nowrap pointer-events-none",
                        c === false ? "bg-black/55 text-white/70" : "bg-[var(--accion)] text-[var(--accion-texto)]")}
                        style={{ left: `${((o.caja[0] + 1) / 2) * 100}%`, top: `${((1 - o.caja[1]) / 2) * 100}%` }}>
                        {c === false ? "no cuenta" : "persona"} · {Math.round(o.p * 100)}%
                    </span>
                );
            })}
        </>
    );
}

export function SiluetasBosch({ deviceId, activo, zona, className }: { deviceId: string; activo: boolean; zona?: PuntoZona[] | null; className?: string }) {
    const { objetos, estado } = useObjetosBosch(deviceId, activo);
    if (!activo) return null;
    const personas = objetos.filter((o) => ES_PERSONA.test(o.clase));
    return (
        <div className={cn("absolute inset-0 pointer-events-none z-10", className)}>
            <DibujoPersonas personas={personas} zona={zona} />
            <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10.5px] font-semibold text-white tabular-nums">
                {estado === "andando" ? `La cámara ve ${personas.length} ${personas.length === 1 ? "persona" : "personas"}`
                    : estado === "sin-datos" ? "La cámara no manda siluetas" : "Pidiendo siluetas…"}
            </span>
        </div>
    );
}
