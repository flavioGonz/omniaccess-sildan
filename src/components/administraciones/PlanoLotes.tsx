"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Crosshair, ExternalLink, Map as MapaIcono, Minus, Plus } from "lucide-react";
import { planoDeLotes, type LoteAdm } from "@/app/actions/administraciones";
import { Button } from "@/components/ui/button";
import { Cargando, ErrorEstado, Vacio } from "@/components/ui/estados";
import { Seek } from "@/components/ui/search";
import { cn } from "@/lib/utils";

/**
 * Los lotes de una administración sobre el croquis del complejo (25/11).
 *
 * Nico pasó un artefacto con el croquis unificado de San Nicolás y el punto de cada solar («según me
 * dieron, es exacto»): eso es lo que se dibuja acá, tal cual, sin pasar por el mapa. Cada lote es un
 * punto del color de cómo va su censo, y tocarlo abre su cajón. Al entrar, el croquis se encuadra en
 * los lotes de esta administración: cada comisión ve primero lo suyo.
 *
 * El croquis es una imagen grande (la lámina entera a 1:1000), así que se mueve con el mouse y se
 * acerca con la rueda, como un mapa. Los puntos se dibujan del mismo tamaño en pantalla a cualquier
 * zoom: lejos, un punto de 34 px de la lámina sería una mota; cerca, taparía el número del solar.
 */

type Estado = "cargo" | "enviado" | "listo" | "nadie" | "terreno";
const ESTADOS: Record<Estado, { rotulo: string; color: string }> = {
    cargo: { rotulo: "Ya cargó el censo", color: "var(--bien)" },
    enviado: { rotulo: "Código enviado", color: "var(--info)" },
    listo: { rotulo: "Código sin enviar", color: "var(--aviso)" },
    nadie: { rotulo: "Sin nadie con correo", color: "var(--mal)" },
    terreno: { rotulo: "Terreno o sin vender", color: "var(--quieto, #8a8f98)" },
};
/* El estado es del lote: lo lleva su persona principal (un código por lote, 25/11). */
function estadoDe(l: LoteAdm): Estado {
    const p = l.personas.find((x) => x.principal);
    if (p?.codigo === "cargo") return "cargo";
    if (p?.codigo === "enviado") return "enviado";
    if (l.personas.length) return "listo";
    return l.situacion === "TERRENO" || l.situacion === "DESARROLLADOR" ? "terreno" : "nadie";
}
const ORDEN: Estado[] = ["cargo", "enviado", "listo", "nadie", "terreno"];
const sinEspacios = (s: string) => s.toLowerCase().replace(/\s+/g, "");

export function PlanoLotes({ lotes, alAbrir }: { lotes: LoteAdm[] | null; alAbrir: (id: string) => void }) {
    const [plano, setPlano] = useState<{ titulo: string; ancho: number; alto: number; georef: boolean } | null | undefined>(undefined);
    const [error, setError] = useState<string | null>(null);
    const [otra, setOtra] = useState(0);
    useEffect(() => {
        let vivo = true;
        planoDeLotes().then((p) => { if (vivo) { setPlano(p); setError(null); } }).catch((e) => { if (vivo) setError(e instanceof Error ? e.message : "No se pudo traer el croquis."); });
        return () => { vivo = false; };
    }, [otra]);

    if (error) return <ErrorEstado mensaje={error} alReintentar={() => setOtra((n) => n + 1)} />;
    if (plano === undefined || !lotes) return <div className="rounded-[10px] border border-border bg-card"><Cargando texto="Trayendo el croquis…" /></div>;
    if (!plano) return (
        <div className="rounded-[10px] border border-dashed border-border">
            <Vacio icono={MapaIcono} titulo="Todavía no hay un croquis de los lotes" ayuda="Se carga desde el servidor con el plano del complejo y el punto de cada solar (scripts/importar-plano-lotes.ts)." />
        </div>
    );
    return <Lienzo plano={plano} lotes={lotes} alAbrir={alAbrir} />;
}

function Lienzo({ plano, lotes, alAbrir }: { plano: { titulo: string; ancho: number; alto: number }; lotes: LoteAdm[]; alAbrir: (id: string) => void }) {
    const caja = useRef<HTMLDivElement>(null);
    const [v, setV] = useState({ s: 0.1, x: 0, y: 0 });
    const [cargada, setCargada] = useState(false);
    const [encima, setEncima] = useState<{ l: LoteAdm; px: number; py: number; w: number } | null>(null);
    const [marcado, setMarcado] = useState<string | null>(null);
    const [q, setQ] = useState("");
    const [ver, setVer] = useState<Record<Estado, boolean>>({ cargo: true, enviado: true, listo: true, nadie: true, terreno: true });

    const ubicados = useMemo(() => lotes.filter((l) => l.planoX !== null && l.planoY !== null).map((l) => ({ l, e: estadoDe(l) })), [lotes]);
    const cuenta = useMemo(() => { const c = { cargo: 0, enviado: 0, listo: 0, nadie: 0, terreno: 0 } as Record<Estado, number>; for (const u of ubicados) c[u.e]++; return c; }, [ubicados]);
    const sinPunto = lotes.length - ubicados.length;

    /** Encuadrar un rectángulo del croquis en la caja, con margen. */
    const encuadrar = useCallback((x0: number, y0: number, x1: number, y1: number, margen = 80) => {
        const r = caja.current?.getBoundingClientRect();
        if (!r) return;
        const w = Math.max(x1 - x0, 1) + margen * 2, h = Math.max(y1 - y0, 1) + margen * 2;
        const s = Math.min(1.4, Math.min(r.width / w, r.height / h));
        setV({ s, x: r.width / 2 - ((x0 + x1) / 2) * s, y: r.height / 2 - ((y0 + y1) / 2) * s });
    }, []);
    const encuadrarSuyos = useCallback(() => {
        if (!ubicados.length) return encuadrar(0, 0, plano.ancho, plano.alto, 0);
        const xs = ubicados.map((u) => u.l.planoX!), ys = ubicados.map((u) => u.l.planoY!);
        encuadrar(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), 260);
    }, [ubicados, encuadrar, plano.ancho, plano.alto]);
    // Al entrar (y al cambiar de administración): sus lotes en el centro.
    // En el cuadro siguiente: recién ahí la caja tiene su tamaño.
    useLayoutEffect(() => { const id = requestAnimationFrame(encuadrarSuyos); return () => cancelAnimationFrame(id); }, [encuadrarSuyos]);

    const zoomEn = useCallback((f: number, cx: number, cy: number) => {
        setV((o) => { const s = Math.min(2, Math.max(0.04, o.s * f)); return { s, x: cx - ((cx - o.x) * s) / o.s, y: cy - ((cy - o.y) * s) / o.s }; });
    }, []);
    // La rueda tiene que poder cancelar el scroll de la página: con React no se puede (es pasivo).
    useEffect(() => {
        const el = caja.current;
        if (!el) return;
        const rueda = (e: WheelEvent) => { e.preventDefault(); const r = el.getBoundingClientRect(); zoomEn(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top); };
        el.addEventListener("wheel", rueda, { passive: false });
        return () => el.removeEventListener("wheel", rueda);
    }, [zoomEn]);

    const arrastre = useRef<{ x: number; y: number; movido: number } | null>(null);
    const bajar = (e: React.PointerEvent) => { if ((e.target as HTMLElement).closest("[data-control]")) return; arrastre.current = { x: e.clientX, y: e.clientY, movido: 0 }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); };
    const mover = (e: React.PointerEvent) => {
        const a = arrastre.current; if (!a) return;
        const dx = e.clientX - a.x, dy = e.clientY - a.y; a.movido += Math.abs(dx) + Math.abs(dy); a.x = e.clientX; a.y = e.clientY;
        setV((o) => ({ ...o, x: o.x + dx, y: o.y + dy }));
    };
    const soltar = (e: React.PointerEvent) => {
        const a = arrastre.current; arrastre.current = null;
        // Un toque (sin arrastrar) sobre un punto abre el lote. Se busca por posición porque el puntero está capturado por la caja.
        if (a && a.movido < 6) { const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null; const id = el?.getAttribute?.("data-lote"); if (id) alAbrir(id); }
    };

    const buscar = (t: string) => {
        setQ(t);
        const n = sinEspacios(t);
        if (!n) { setMarcado(null); return; }
        const u = ubicados.find((x) => sinEspacios(x.l.codigo) === n) || ubicados.find((x) => sinEspacios(x.l.codigo).startsWith(n));
        if (u) { setMarcado(u.l.id); encuadrar(u.l.planoX! - 1, u.l.planoY! - 1, u.l.planoX! + 1, u.l.planoY! + 1, 420); }
        else setMarcado(null);
    };

    const r = 9 / v.s;          // el radio del punto: 9 px de pantalla a cualquier zoom
    /* De cerca, el punto pasa a ser un aro alrededor del número del solar: lleno lo tapaba, y de cerca
       lo que se viene a leer es justamente el número y las medidas del lote. */
    const cerca = v.s >= 0.3;
    const centro = () => { const b = caja.current?.getBoundingClientRect(); return b ? [b.width / 2, b.height / 2] as const : [0, 0] as const; };
    return (
        <div className="rounded-[10px] border border-border bg-card overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
                <Seek value={q} onChange={buscar} placeholder="Ir a un lote: «C 4»" startOpen width={200} alto={34} />
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Qué lotes se ven">
                    {ORDEN.filter((e) => cuenta[e] > 0).map((e) => (
                        <button key={e} type="button" aria-pressed={ver[e]} onClick={() => setVer((o) => ({ ...o, [e]: !o[e] }))}
                            className={cn("h-7 px-2.5 rounded-full border text-[11.5px] font-semibold inline-flex items-center gap-1.5 transition-opacity", ver[e] ? "border-border bg-background" : "border-dashed border-border opacity-50")}>
                            <span className="h-2.5 w-2.5 rounded-full" style={{ background: ESTADOS[e].color }} />{ESTADOS[e].rotulo}<span className="tabular-nums text-[10.5px] text-muted-foreground">{cuenta[e]}</span>
                        </button>))}
                </div>
                {sinPunto > 0 && <span className="ml-auto text-[11.5px] text-muted-foreground" title="Lotes de esta administración que no tienen su punto en el croquis.">{sinPunto} sin punto en el croquis</span>}
            </div>

            <div ref={caja} onPointerDown={bajar} onPointerMove={mover} onPointerUp={soltar} onPointerCancel={() => { arrastre.current = null; }}
                className="relative h-[calc(100vh-300px)] min-h-[460px] overflow-hidden bg-white cursor-grab active:cursor-grabbing touch-none select-none">
                <div className="absolute left-0 top-0 origin-top-left will-change-transform" style={{ transform: `translate(${v.x}px, ${v.y}px) scale(${v.s})`, width: plano.ancho, height: plano.alto }}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- una imagen de 5000 px que se escala con transform: el optimizador de Next no aporta y la recortaría */}
                    <img src="/api/administraciones/plano" alt={plano.titulo} width={plano.ancho} height={plano.alto} draggable={false} onLoad={() => setCargada(true)}
                        className={cn("block h-full w-full transition-opacity duration-300", cargada ? "opacity-100" : "opacity-0")} />
                    <svg className="absolute inset-0" width={plano.ancho} height={plano.alto} viewBox={`0 0 ${plano.ancho} ${plano.alto}`}>
                        {ubicados.filter((u) => ver[u.e]).map(({ l, e }) => (
                            <circle key={l.id} data-lote={l.id} cx={l.planoX!} cy={l.planoY!} r={cerca ? r * 1.7 : r} fill={ESTADOS[e].color} fillOpacity={cerca ? 0.14 : 0.85}
                                stroke={cerca ? ESTADOS[e].color : "#fff"} strokeWidth={(cerca ? 3.5 : 2.5) / v.s}
                                className="cursor-pointer" onPointerEnter={(ev) => { const b = caja.current!.getBoundingClientRect(); setEncima({ l, px: ev.clientX - b.left, py: ev.clientY - b.top, w: b.width }); }} onPointerLeave={() => setEncima(null)} />))}
                        {marcado && (() => { const u = ubicados.find((x) => x.l.id === marcado); return u ? <circle cx={u.l.planoX!} cy={u.l.planoY!} r={r * 2.4} fill="none" stroke="var(--accion)" strokeWidth={3 / v.s} className="animate-pulse" /> : null; })()}
                    </svg>
                </div>
                {!cargada && <div className="absolute inset-0 grid place-items-center"><Cargando texto="Dibujando el croquis…" /></div>}

                {/* Lo que dice el punto que está bajo el mouse. */}
                {encima && (
                    <div className="pointer-events-none absolute z-10 rounded-[10px] border border-border bg-card px-3 py-2 text-[12px] shadow-[0_8px_24px_-8px_rgba(0,0,0,0.35)]"
                        style={{ left: Math.min(encima.px + 14, encima.w - 230), top: Math.max(encima.py - 64, 8), width: 216 }}>
                        <p className="flex items-center gap-1.5 font-bold tabular-nums"><span className="h-2 w-2 rounded-full" style={{ background: ESTADOS[estadoDe(encima.l)].color }} />{encima.l.codigo}{encima.l.edificio && <span className="font-normal text-muted-foreground">· {encima.l.edificio}</span>}</p>
                        <p className="truncate text-muted-foreground">{encima.l.titular || "Sin titular"}</p>
                        <p className="text-[11px] text-muted-foreground">{ESTADOS[estadoDe(encima.l)].rotulo}{encima.l.personas.length ? ` · ${encima.l.personas.length} con correo` : ""}</p>
                    </div>
                )}

                <div data-control className="absolute right-3 bottom-3 flex flex-col gap-1.5">
                    <Button size="icon" variant="outline" className="h-9 w-9 bg-card" aria-label="Acercar" onClick={() => { const [x, y] = centro(); zoomEn(1.5, x, y); }}><Plus size={15} /></Button>
                    <Button size="icon" variant="outline" className="h-9 w-9 bg-card" aria-label="Alejar" onClick={() => { const [x, y] = centro(); zoomEn(1 / 1.5, x, y); }}><Minus size={15} /></Button>
                    <Button size="icon" variant="outline" className="h-9 w-9 bg-card" aria-label="Volver a sus lotes" title="Volver a sus lotes" onClick={encuadrarSuyos}><Crosshair size={15} /></Button>
                </div>
                <p data-control className="absolute left-3 bottom-3 max-w-[60%] rounded-[8px] border border-border bg-card/95 px-2.5 py-1.5 text-[11px] text-muted-foreground">
                    {plano.titulo}. Arrastrá para moverte, rueda para acercar; tocá un punto para abrir el lote.
                </p>
            </div>
        </div>
    );
}

/** Abrir un lote en un mapa (Google Maps), con sus coordenadas «lat, lng». */
export function EnElMapa({ coordenadas, className }: { coordenadas: string | null; className?: string }) {
    if (!coordenadas) return null;
    const [lat, lng] = coordenadas.split(/[,;\s]+/).map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return (
        <a href={`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`} target="_blank" rel="noreferrer"
            className={cn("inline-flex items-center gap-1 text-[var(--accion)] hover:underline", className)}>
            <ExternalLink size={12} /> Ver en el mapa
        </a>
    );
}
