"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Camera, ChevronLeft, ChevronRight, History, LayoutGrid, Loader2, Maximize2, Minimize2, ShieldAlert, VideoOff } from "lucide-react";
import { Vivo, Foto, Glifo, estiloCasilla, fotoDe, vivoDe, idCanal, ubicacion, reproduceH265, usaHls, FOTO_MS, type Canal, type Modo } from "@/components/monitor/camaras/piezas";
import { DISPOSICIONES, type Disposicion } from "@/lib/monitor/disposiciones";
import { VerGrabacion } from "@/components/video/VerGrabacion";
import type { CamVerif } from "@/components/centrales/VerificacionVideo";
import { hace, usarReloj } from "@/lib/monitor/cliente";
import { tocable } from "@/components/monitor/tactil";
import { cn } from "@/lib/utils";

/**
 * Las cámaras del área de una alarma, como la pared Cámaras (23/10, Nico: «el monitor de alarmas
 * permite ver tipo el monitor de cámaras para mejorar la experiencia de cada alarma; recordá que
 * un evento está asociado a un área donde el dispositivo pertenece»).
 *
 * Antes la pared mostraba sólo las cámaras de la verificación (hasta 4) y, a un toque, las del
 * abonado: lo que pasaba en la cámara de al lado no se veía. Ahora el lugar del video es una
 * pared de cámaras como la de Cámaras, con lo mismo que el operador ya conoce de ahí:
 *
 *  · Qué cámaras: las de la verificación primero (zona → área → abonado, las mismas de la ficha),
 *    marcadas con el color de la prioridad, y después todas las del área del evento y sus
 *    sub-áreas —equipos y canales de NVR, con el área que les da Dispositivos (un canal sin equipo
 *    toma la de su NVR, igual que en Cámaras)—, y las demás del abonado. Se puede mirar otra área.
 *  · Cómo: las disposiciones de un NVR (las de Cámaras). En «Auto» la verificación va en las
 *    casillas grandes. Si no entran todas, se pasa de página y la verificación queda fija.
 *  · Lo que cuesta: si el navegador no reproduce H.265, a lo sumo MAX_CONVERTIDOS van en vivo
 *    convertidas (la verificación primero) y el resto es foto — lo mismo que Cámaras y por lo
 *    mismo: veinte conversiones dejan al servidor sin aire. Cada baldosa dice si es vivo o foto.
 *  · Tocar una baldosa la agranda; «Ver el momento» abre la grabación desde antes del evento.
 */

/** Tope de baldosas convertidas a H.264 cuando el navegador no reproduce H.265 (el mismo de Cámaras). */
const MAX_CONVERTIDOS = 4;
/** La foto de una cámara de la verificación se renueva más seguido que la del resto del área. */
const FOTO_VERIF_MS = 2000;
/** Una detección de la cámara de hace menos que esto la marca en rojo (la ventana de alerta de Cámaras). */
const ALERTA_MS = 120_000;
const PREFS = "omni.pared-alarmas.v1";
const AUTO = "auto";
/** «Todas las cámaras», en el selector de área. */
const TODAS = "__todas";
/** Las disposiciones que se ofrecen a mano (las de Cámaras que tienen sentido para una alarma). */
const OFRECIDAS = ["1", "4", "1+5", "9", "1+7", "2+8", "16"];

type Casilla = Disposicion["casillas"][number];
/** Las casillas de 1×1 de una cuadrícula que no tapan las grandes, después de las grandes (como en disposiciones.ts). */
function cuadricula(cols: number, filas: number, grandes: Casilla[]): Casilla[] {
    const tapada = (x: number, y: number) => grandes.some((g) => x >= g.x && x < g.x + g.w && y >= g.y && y < g.y + g.h);
    const chicas: Casilla[] = [];
    for (let y = 0; y < filas; y++) for (let x = 0; x < cols; x++) if (!tapada(x, y)) chicas.push({ x, y, w: 1, h: 1 });
    return [...grandes, ...chicas];
}
/** Disposiciones que sólo usa «Auto»: dos lado a lado, una grande con dos al costado, y tres o cuatro grandes con el área a la derecha. */
const DOS: Disposicion = { clave: "2", nombre: "Dos", cols: 2, filas: 1, casillas: cuadricula(2, 1, []) };
const UNO_MAS_DOS: Disposicion = { clave: "1+2", nombre: "1 grande + 2", cols: 3, filas: 2, casillas: cuadricula(3, 2, [{ x: 0, y: 0, w: 2, h: 2 }]) };
const CUADRANTES = [{ x: 0, y: 0, w: 2, h: 2 }, { x: 2, y: 0, w: 2, h: 2 }, { x: 0, y: 2, w: 2, h: 2 }, { x: 2, y: 2, w: 2, h: 2 }];
const VARIAS_GRANDES = (k: 3 | 4): Disposicion => ({ clave: `${k}+`, nombre: `${k} grandes`, cols: 6, filas: 4, casillas: cuadricula(6, 4, CUADRANTES.slice(0, k)) });
const disp = (clave: string) => DISPOSICIONES.find((d) => d.clave === clave)!;

/**
 * «Auto»: la que mejor reparte `n` cámaras con la verificación (`k`) en las casillas grandes —es lo
 * que hay que mirar primero—; si el área no entra, se pagina y la verificación queda.
 */
function automatica(n: number, k: number): Disposicion {
    if (n <= 1) return disp("1");
    if (n === 2) return DOS;
    if (k === 0 || n <= 4 && k !== 1) return n <= 4 ? disp("4") : n <= 9 ? disp("9") : disp("16");
    if (k === 1) return n === 3 ? UNO_MAS_DOS : n <= 6 ? disp("1+5") : disp("1+7");
    if (k === 2) return disp("2+8");
    return VARIAS_GRANDES(k >= 4 ? 4 : 3);
}

export type AreaPared = { id: string; nombre: string; padre: string | null; nivel: number };
type Cam = {
    id: string; nombre: string; stream: string; deviceId: string | null; nvrId: string | null; ch: number | null;
    grabador?: boolean; verif: boolean; canal: Canal | null;
};

/** El área y todas las que cuelgan de ella. */
function conSubareas(areas: AreaPared[], id: string): Set<string> {
    const out = new Set([id]);
    let crecio = true;
    while (crecio) { crecio = false; for (const a of areas) if (a.padre && out.has(a.padre) && !out.has(a.id)) { out.add(a.id); crecio = true; } }
    return out;
}

const deCanal = (c: Canal): Cam => ({ id: idCanal(c), nombre: c.nombre, stream: c.stream, deviceId: c.equipoId, nvrId: c.nvrId, ch: c.ch, grabador: !!c.nvrId, verif: false, canal: c });

function leerPrefs(): { disposicion: string } {
    try { const p = JSON.parse(localStorage.getItem(PREFS) || "{}"); return { disposicion: typeof p.disposicion === "string" ? p.disposicion : AUTO }; } catch { return { disposicion: AUTO }; }
}
function guardarPrefs(p: { disposicion: string }) { try { localStorage.setItem(PREFS, JSON.stringify(p)); } catch { /* sin almacenamiento: vale para esta vez */ } }

function Baldosa({ c, modo, hls, grande, color, zona, sola, enPausa, alTocar, alMomento }: {
    c: Cam; modo: Modo; hls: boolean; grande: boolean; color: string; zona: string | null; sola: boolean; enPausa: boolean;
    alTocar: () => void; alMomento: () => void;
}) {
    usarReloj(15_000);
    // El vivo que no arranca pasa a la foto (lo mismo que hace Cámaras).
    const [fallo, setFallo] = useState(false);
    const [listo, setListo] = useState(false);
    useEffect(() => { setFallo(false); setListo(false); }, [c.stream, modo]);
    const foto = c.canal ? fotoDe(c.canal, grande || sola ? 1280 : 640) : c.deviceId ? `/api/snapshot/${c.deviceId}?w=1280` : c.nvrId && c.ch != null ? `/api/monitor/camaras/foto?nvr=${encodeURIComponent(c.nvrId)}&ch=${c.ch}&w=1280` : null;
    const enFoto = modo === "foto" || fallo;
    const sinSenal = c.canal?.online === false;
    const alerta = c.canal?.alerta && Date.now() - new Date(c.canal.alerta.ts).getTime() < ALERTA_MS ? c.canal.alerta : null;
    const g = grande || sola;
    return (
        <motion.div layout transition={{ duration: 0.22 }}
            className={cn("relative min-h-0 min-w-0 rounded-[10px] overflow-hidden bg-black", c.verif || alerta ? "ring-2" : "ring-1 ring-white/10")}
            style={c.verif ? { ["--tw-ring-color" as any]: color } : alerta ? { ["--tw-ring-color" as any]: "var(--mal)" } : undefined}>
            <button type="button" onClick={alTocar} aria-label={sola ? "Volver a la pared" : `Agrandar ${c.nombre}`} className="absolute inset-0 w-full h-full">
                {enPausa ? <span className="absolute inset-0 grid place-items-center text-white/50 text-[14px]">Mirando la grabación…</span>
                    : sinSenal ? <span className="absolute inset-0 grid place-items-center text-white/45 text-[13px]"><span className="text-center"><VideoOff size={22} className="mx-auto mb-1" />Sin señal en el grabador</span></span>
                    : !enFoto ? <Vivo src={vivoDe(c.stream, modo === "convertido", hls)} alResultado={(ok) => { setListo(ok); if (!ok) setFallo(true); }} className="absolute inset-0 w-full h-full object-contain" />
                    : foto ? <Foto src={foto} ms={c.verif ? FOTO_VERIF_MS : FOTO_MS} className="absolute inset-0 w-full h-full object-contain" />
                    : <span className="absolute inset-0 grid place-items-center text-white/45 text-[13px]"><VideoOff size={22} /></span>}
                {!enPausa && !sinSenal && !enFoto && !listo && <span className="absolute inset-0 grid place-items-center text-white/35"><Loader2 size={g ? 30 : 20} className="animate-spin" /></span>}
            </button>
            {/* Arriba: de la zona (con el color de la prioridad), detectó hace poco, y si es vivo o foto. */}
            <div className={cn("absolute top-0 inset-x-0 flex items-center gap-1.5 bg-gradient-to-b from-black/75 to-transparent pointer-events-none", g ? "px-3 pt-2.5 pb-8" : "px-2 pt-1.5 pb-5")}>
                {c.verif && zona && <span className={cn("inline-flex items-center rounded-full font-bold text-white shrink-0", g ? "h-7 px-2.5 text-[13px]" : "h-5 px-2 text-[10.5px]")} style={{ background: color }}>{zona}</span>}
                {alerta && <span className={cn("inline-flex items-center gap-1 rounded-full pleno-mal font-bold shrink-0", g ? "h-7 px-2.5 text-[12.5px]" : "h-5 px-1.5 text-[10px]")}><ShieldAlert size={g ? 13 : 10} /> Detectó {hace(alerta.ts)}</span>}
                <span className={cn("ml-auto inline-flex items-center gap-1 rounded-full font-bold uppercase tracking-[0.08em] shrink-0", g ? "h-6 px-2 text-[11px]" : "h-[18px] px-1.5 text-[9px]", enFoto || sinSenal ? "bg-white/15 text-white/80" : "bg-black/50 text-white")}>
                    {enFoto || sinSenal ? <><Camera size={g ? 11 : 9} /> Foto</> : <><span className="h-1.5 w-1.5 rounded-full bg-[var(--mal)] animate-pulse" /> Vivo</>}
                </span>
            </div>
            {/* Abajo: el nombre, de dónde es, y lo que se hace: el momento y agrandar. */}
            <div className={cn("absolute bottom-0 inset-x-0 flex items-end gap-2 bg-gradient-to-t from-black/80 to-transparent", g ? "px-3 pb-2.5 pt-10" : "px-2 pb-1.5 pt-6")}>
                <div className="min-w-0 flex-1 pointer-events-none">
                    <div className={cn("font-bold text-white truncate drop-shadow", g ? "text-[18px]" : "text-[12.5px]")}>{c.nombre}</div>
                    {g && c.canal && <div className="text-[12px] text-white/60 truncate">{ubicacion(c.canal)}</div>}
                </div>
                {c.grabador && (
                    <button type="button" onClick={alMomento} title="La grabación desde unos segundos antes del evento"
                        className={cn("shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-white/90 text-black font-bold hover:bg-white", tocable, g ? "h-9 px-3 text-[13.5px]" : "h-7 w-7 justify-center")}>
                        <History size={g ? 15 : 13} />{g && "Ver el momento"}
                    </button>
                )}
                <button type="button" onClick={alTocar} aria-label={sola ? "Volver a la pared" : "Agrandar"} title={sola ? "Volver a la pared" : "Agrandar"}
                    className={cn("shrink-0 grid place-items-center rounded-lg bg-black/55 text-white/85 hover:bg-black/70", tocable, g ? "h-9 w-9" : "h-7 w-7")}>
                    {sola ? <Minimize2 size={g ? 16 : 13} /> : <Maximize2 size={g ? 16 : 13} />}
                </button>
            </div>
        </motion.div>
    );
}

export function ParedArea({ eventoId, instanteMs, color, zona, verif, otras, areaId, areaNombre, canales, areas, cargando, vacio }: {
    eventoId: string;
    /** La hora del evento: «Ver el momento» arranca ahí (menos el «antes» de Ajustes). */
    instanteMs: number;
    /** El color de la prioridad: marca las cámaras de la verificación. */
    color: string;
    /** «Zona 3»: el rótulo de las cámaras de la verificación. */
    zona: string | null;
    verif: CamVerif[];
    otras: CamVerif[];
    /** El área del evento (la de la zona o la del equipo de la central). */
    areaId: string | null;
    areaNombre: string | null;
    /** Los canales de /api/monitor/camaras (null mientras no llegan). */
    canales: Canal[] | null;
    areas: AreaPared[];
    cargando: boolean;
    /** Sin ninguna cámara para mostrar. */
    vacio: React.ReactNode;
}) {
    const [h265, setH265] = useState(true);
    const [hls, setHls] = useState(false);
    const [prefs, setPrefs] = useState<{ disposicion: string }>({ disposicion: AUTO });
    useEffect(() => { setH265(reproduceH265()); setHls(usaHls()); setPrefs(leerPrefs()); }, []);
    const elegirDisposicion = (d: string) => { const p = { disposicion: d }; setPrefs(p); guardarPrefs(p); setPagina(0); setSola(null); };

    const [area, setArea] = useState<string | null>(areaId);
    const [pagina, setPagina] = useState(0);
    const [sola, setSola] = useState<string | null>(null);
    const [momento, setMomento] = useState<Cam | null>(null);
    // Otro evento: se vuelve a su área y a la primera página.
    useEffect(() => { setArea(areaId); setPagina(0); setSola(null); setMomento(null); }, [eventoId, areaId]);

    const lista = useMemo<Cam[]>(() => {
        const porId = new Map((canales || []).map((c) => [idCanal(c), c]));
        const out: Cam[] = [];
        const vistas = new Set<string>();
        const sumar = (c: Cam) => { if (!vistas.has(c.id)) { vistas.add(c.id); out.push(c); } };
        for (const v of verif) sumar({ ...v, deviceId: v.deviceId ?? null, nvrId: v.nvrId ?? null, ch: v.ch ?? null, verif: true, canal: porId.get(v.id) || null });
        const dentro = area === TODAS ? null : area ? conSubareas(areas, area) : new Set<string>();
        for (const c of canales || []) if (!dentro || (c.areaId && dentro.has(c.areaId))) sumar(deCanal(c));
        // Las del abonado, cuando se mira el área del evento: son del mismo cliente aunque no tengan área.
        if (area === areaId) for (const o of otras) sumar({ ...o, deviceId: o.deviceId ?? null, nvrId: o.nvrId ?? null, ch: o.ch ?? null, verif: false, canal: porId.get(o.id) || null });
        return out;
    }, [verif, otras, canales, areas, area, areaId]);

    const k = lista.filter((c) => c.verif).length;
    const d = (prefs.disposicion !== AUTO && DISPOSICIONES.find((x) => x.clave === prefs.disposicion)) || automatica(lista.length, k);
    const casillas = d.casillas.length;
    // La verificación queda fija en todas las páginas si entra con lugar de sobra; si no, se pagina todo.
    const fijas = k > 0 && k < casillas ? lista.slice(0, k) : [];
    const resto = fijas.length ? lista.slice(k) : lista;
    const porPagina = casillas - fijas.length;
    const paginas = Math.max(1, Math.ceil(resto.length / porPagina));
    const pag = Math.min(pagina, paginas - 1);
    const enPantalla = sola ? lista.filter((c) => c.id === sola) : [...fijas, ...resto.slice(pag * porPagina, (pag + 1) * porPagina)];
    // El vivo: directo si el navegador puede con H.265; si no, las primeras convertidas y el resto foto.
    const modoDe = (i: number): Modo => (h265 ? "directo" : i < MAX_CONVERTIDOS ? "convertido" : "foto");

    const deArea = lista.length - lista.filter((c) => c.verif).length;
    const nombreArea = area === TODAS ? "Todas las cámaras" : area ? areas.find((a) => a.id === area)?.nombre || areaNombre || "Área" : null;

    return (
        <section className="h-full min-h-0 flex flex-col gap-2">
            {/* La barra, como la de Cámaras: qué se mira, de qué área, cómo se reparte y en qué página. */}
            <div className="shrink-0 flex items-center gap-2 flex-wrap">
                <div className="min-w-0 flex items-center gap-2 text-[15px]">
                    <Camera size={17} className="text-muted-foreground shrink-0" />
                    <span className="font-bold truncate">{nombreArea ? (area === TODAS ? nombreArea : `Área ${nombreArea}`) : "Cámaras del evento"}</span>
                    <span className="text-muted-foreground tabular-nums shrink-0">{lista.length} {lista.length === 1 ? "cámara" : "cámaras"}</span>
                    {k > 0 && <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[12.5px] font-bold shrink-0" style={{ background: `color-mix(in oklab, ${color} 22%, transparent)` }}><span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} /> {k} de la verificación</span>}
                    {cargando && !canales && <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Buscando las demás del área…</span>}
                </div>
                <div className="ml-auto flex items-center gap-2">
                    {areas.length > 0 && (
                        <select value={area || ""} onChange={(e) => { setArea(e.target.value || null); setPagina(0); setSola(null); }} aria-label="Qué área se mira"
                            className="h-10 max-w-[300px] rounded-lg bg-card ring-1 ring-border px-3 text-[14px] font-semibold">
                            {areaId && <option value={areaId}>{areas.find((a) => a.id === areaId)?.nombre || areaNombre} (la del evento)</option>}
                            {!areaId && <option value="">Sólo las del evento</option>}
                            {areas.filter((a) => a.id !== areaId).map((a) => <option key={a.id} value={a.id}>{" ".repeat(Math.max(0, a.nivel))}{a.nombre}</option>)}
                            <option value={TODAS}>Todas las cámaras</option>
                        </select>
                    )}
                    <div className="flex items-center h-10 rounded-lg bg-card ring-1 ring-border p-1 gap-0.5" role="group" aria-label="Disposición">
                        <button type="button" onClick={() => elegirDisposicion(AUTO)} title="Automática: la verificación en grande y el resto alrededor" aria-pressed={prefs.disposicion === AUTO}
                            className={cn("h-8 px-2.5 rounded-md inline-flex items-center gap-1.5 text-[13px] font-semibold", tocable, prefs.disposicion === AUTO ? "bg-[var(--accion)] text-white" : "text-muted-foreground hover:text-foreground")}>
                            <LayoutGrid size={15} /> Auto
                        </button>
                        {OFRECIDAS.map((c) => {
                            const x = disp(c), on = prefs.disposicion === c;
                            return (
                                <button key={c} type="button" onClick={() => elegirDisposicion(c)} title={x.nombre} aria-label={x.nombre} aria-pressed={on}
                                    className={cn("h-8 w-10 rounded-md grid place-items-center", tocable, on ? "bg-[var(--accion)] text-white" : "text-muted-foreground hover:text-foreground")}>
                                    <Glifo d={x} tam={22} />
                                </button>
                            );
                        })}
                    </div>
                    {paginas > 1 && !sola && (
                        <div className="flex items-center h-10 rounded-lg bg-card ring-1 ring-border p-1 gap-0.5">
                            <button type="button" onClick={() => setPagina((p) => (Math.min(p, paginas - 1) - 1 + paginas) % paginas)} aria-label="Página anterior" className={cn("h-8 w-8 rounded-md grid place-items-center text-muted-foreground hover:text-foreground", tocable)}><ChevronLeft size={18} /></button>
                            <span className="px-1.5 text-[13.5px] font-bold tabular-nums">{pag + 1}/{paginas}</span>
                            <button type="button" onClick={() => setPagina((p) => (Math.min(p, paginas - 1) + 1) % paginas)} aria-label="Página siguiente" className={cn("h-8 w-8 rounded-md grid place-items-center text-muted-foreground hover:text-foreground", tocable)}><ChevronRight size={18} /></button>
                        </div>
                    )}
                </div>
            </div>

            {lista.length === 0 ? (cargando && !canales
                ? <div className="flex-1 grid place-items-center rounded-2xl bg-card ring-1 ring-border text-muted-foreground"><Loader2 size={30} className="animate-spin" /></div>
                : vacio
            ) : (
                <div className="flex-1 min-h-0 grid gap-1.5"
                    style={sola ? { gridTemplateColumns: "minmax(0,1fr)", gridTemplateRows: "minmax(0,1fr)" } : { gridTemplateColumns: `repeat(${d.cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${d.filas}, minmax(0, 1fr))` }}>
                    {enPantalla.map((c, i) => {
                        const casilla = sola ? null : d.casillas[i];
                        if (!sola && !casilla) return null;
                        return (
                            <div key={c.id} className="min-h-0 min-w-0 grid" style={casilla ? estiloCasilla(casilla) : undefined}>
                                <Baldosa c={c} modo={sola ? (h265 ? "directo" : "convertido") : modoDe(i)} hls={hls} grande={!!casilla && (casilla.w > 1 || d.casillas.length <= 2)} color={color} zona={zona}
                                    sola={!!sola} enPausa={momento?.id === c.id}
                                    alTocar={() => setSola((s) => (s ? null : lista.length > 1 ? c.id : null))}
                                    alMomento={() => setMomento(c)} />
                            </div>
                        );
                    })}
                </div>
            )}
            {deArea === 0 && k > 0 && canales && area === areaId && (
                <p className="shrink-0 text-[13px] text-muted-foreground">{areaId ? "No hay otras cámaras en esta área." : "La central no tiene área en Dispositivos: se ven sólo las cámaras del evento. Se le asigna desde Dispositivos."}</p>
            )}
            {momento && (
                <VerGrabacion deviceId={momento.deviceId || momento.nvrId || momento.id} nombre={momento.nombre} tab="rec" instanteMs={instanteMs}
                    canal={momento.ch ?? null} nvrId={momento.nvrId ?? null} onClose={() => setMomento(null)} />
            )}
        </section>
    );
}
