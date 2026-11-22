"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { CircleMarker, Marker, Polyline, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import { ChevronLeft, ChevronRight, Gauge, Loader2, Pause, Play, SquareParking, TriangleAlert, X } from "lucide-react";
import { sileo as toast } from "sileo";
import { guardarLimiteVelocidadGps, type PuntoGps, type RecorridoGps } from "@/app/actions/gps";
import {
    COLOR_FRANJA, duracionLarga, excesosDe, jornadaDe, minutosEstacionado, puntoMasCercano, resumenDeExcesos, rumboEnPalabras, trozosPorVelocidad,
    type Exceso, type Tramo,
} from "@/lib/gps-jornada";
import { fechaCorta, hora, horaSeg } from "@/lib/fechas";
import { cn } from "@/lib/utils";

/**
 * Leer un recorrido (pedido de Nico, 22/11). Tres cosas, y cada una contesta una pregunta distinta:
 *
 *  · **La jornada** — viaje, estacionado, viaje…: «¿qué hizo en el día?». Antes los viajes eran una
 *    lista y lo estacionado un cartelito en el mapa; ahora es una sola secuencia, y lo estacionado
 *    tiene su reloj, incluido el de antes del primer viaje y el que todavía corre.
 *  · **La velocidad sobre la línea** — el color es a cuánto iba, contra el límite de la empresa;
 *    lo que lo pasó va en rojo y corre. Pasar el mouse por la línea dice la velocidad y la hora.
 *  · **Recorrerlo** — una barra que mueve el vehículo por el trayecto, punto por punto, con la
 *    hora exacta y lo que reportó el equipo ahí. Tocar la línea lleva la barra a ese punto.
 *
 * Son dos piezas porque viven en dos árboles: las líneas adentro del mapa, el panel flotando
 * afuera. Lo que comparten (el viaje elegido, el punto de la barra) lo guarda quien las junta.
 */

const fmtKm = (km: number) => `${km.toFixed(1).replace(".", ",")} km`;
const t = (p: PuntoGps) => new Date(p.cuando).getTime();

/** Los puntos de cada viaje (por su horario) y a qué índice del recorrido corresponde cada uno. */
export function usePartes(datos: RecorridoGps | null, viajeSel: number | null) {
    return useMemo(() => {
        const pts = datos?.puntos || [], viajes = datos?.viajes || [];
        const porViaje = viajes.map((v) => { const i0 = pts.findIndex((p) => p.cuando >= v.desde); let i1 = i0; while (i0 >= 0 && i1 + 1 < pts.length && pts[i1 + 1].cuando <= v.hasta) i1++; return i0 < 0 ? null : { i0, i1 }; });
        /* Lo que recorre la barra: el viaje elegido, o todo. */
        const r = viajeSel !== null ? porViaje[viajeSel] : null;
        const desde = r ? r.i0 : 0, hasta = r ? r.i1 : pts.length - 1;
        const limite = datos?.limite || 90;
        const excesos = porViaje.flatMap((r2) => (r2 ? excesosDe(pts.slice(r2.i0, r2.i1 + 1), limite).map((e) => ({ ...e, i0: e.i0 + r2.i0, i1: e.i1 + r2.i0 })) : []));
        return { pts, viajes, porViaje, desde, hasta, limite, excesos };
    }, [datos, viajeSel]);
}
type Partes = ReturnType<typeof usePartes>;

/* ─────────────────────────── Sobre el mapa ─────────────────────────── */

export function LineasDelRecorrido({ partes, viajeSel, cursor, alCursor }: { partes: Partes; viajeSel: number | null; cursor: number | null; alCursor: (i: number) => void }) {
    const mapa = useMap();
    const { pts, porViaje, limite, excesos } = partes;
    /** El punto bajo el mouse: su velocidad y su hora, sin tener que tocar nada. */
    const [sobre, setSobre] = useState<number | null>(null);
    const trozos = useMemo(() => porViaje.map((r) => (r ? trozosPorVelocidad(pts.slice(r.i0, r.i1 + 1), limite) : [])), [porViaje, pts, limite]);
    const cercano = (e: L.LeafletMouseEvent) => puntoMasCercano(pts, e.latlng.lat, e.latlng.lng);

    /* El vehículo de la barra se mantiene a la vista: si el punto cae fuera de lo que se ve, el mapa lo sigue. */
    const pc = cursor !== null ? pts[cursor] : null;
    useEffect(() => { if (pc && !mapa.getBounds().pad(-0.15).contains([pc.lat, pc.lon])) mapa.panTo([pc.lat, pc.lon], { animate: true }); }, [pc, mapa]);

    return (
        <>
            {porViaje.map((r, v) => r && r.i1 > r.i0 && (
                <React.Fragment key={`v-${v}`}>
                    {/* Un borde oscuro debajo: sobre el satélite, una línea de color sola se pierde. Es también
                        la que escucha el mouse: más ancha que la de color, se le acierta sin apuntar. */}
                    <Polyline positions={pts.slice(r.i0, r.i1 + 1).map((p) => [p.lat, p.lon] as [number, number])}
                        pathOptions={{ color: "#0a0e14", weight: viajeSel === v ? 11 : 8, opacity: viajeSel !== null && viajeSel !== v ? 0.3 : 0.6, lineCap: "round", lineJoin: "round" }}
                        eventHandlers={{ mousemove: (e) => setSobre(cercano(e)), mouseout: () => setSobre(null), click: (e) => { L.DomEvent.stopPropagation(e); alCursor(cercano(e)); } }} />
                    {trozos[v].map((tz, k) => (
                        <Polyline key={k} positions={tz.linea} interactive={false}
                            pathOptions={{ color: COLOR_FRANJA[tz.franja], weight: viajeSel === v ? 6 : 4, opacity: viajeSel !== null && viajeSel !== v ? 0.35 : 1, lineCap: "round", lineJoin: "round" }} />
                    ))}
                </React.Fragment>
            ))}
            {/* Los excesos, encima y corriendo: una raya blanca que avanza sobre el rojo. */}
            {excesos.map((e, k) => e.i1 > e.i0 && (
                <Polyline key={`ex-${k}-${e.i0}`} positions={pts.slice(e.i0, e.i1 + 1).map((p) => [p.lat, p.lon] as [number, number])} interactive={false}
                    pathOptions={{ color: "#fff", weight: 2.5, opacity: 0.95, lineCap: "butt", className: "gps-exceso" }} />
            ))}

            {/* Dónde empieza cada viaje: su número, el mismo de la lista. */}
            {porViaje.map((r, v) => r && (
                <Marker key={`n-${v}`} position={[pts[r.i0].lat, pts[r.i0].lon]} interactive={false} zIndexOffset={1250}
                    icon={L.divIcon({ className: "bg-transparent border-0", iconSize: [22, 22], iconAnchor: [11, 11],
                        html: `<div style="width:22px;height:22px;border-radius:50%;background:${viajeSel === v ? "#fbbf24" : "#0a0e14"};color:${viajeSel === v ? "#0a0e14" : "#fff"};border:2px solid #fff;font:800 11px/18px Outfit,system-ui,sans-serif;text-align:center;box-shadow:0 1px 5px rgba(0,0,0,.5)">${v + 1}</div>` })} />
            ))}

            {sobre !== null && pts[sobre] && sobre !== cursor && (
                <CircleMarker center={[pts[sobre].lat, pts[sobre].lon]} radius={5} interactive={false} pathOptions={{ color: "#fff", weight: 2, fillColor: "#0a0e14", fillOpacity: 1 }}>
                    <Tooltip permanent direction="top" offset={[0, -8]} opacity={1} className="!rounded-[6px] !border-0 !bg-[#0a0e14] !px-2 !py-1 !text-[11.5px] !font-bold !text-white !shadow-lg before:!hidden">
                        <span className={cn("tabular-nums", pts[sobre].velocidad > limite && "text-red-400")}>{pts[sobre].velocidad} km/h</span> <span className="font-normal opacity-70 tabular-nums">· {horaSeg(pts[sobre].cuando)}</span>
                    </Tooltip>
                </CircleMarker>
            )}

            {/* El vehículo de la barra: una flecha con su rumbo, y un aro para encontrarlo. */}
            {pc && (
                <>
                    <CircleMarker center={[pc.lat, pc.lon]} radius={20} interactive={false} pathOptions={{ color: "#fbbf24", weight: 1.5, fillColor: "#fbbf24", fillOpacity: 0.2 }} />
                    <Marker position={[pc.lat, pc.lon]} interactive={false} zIndexOffset={2000}
                        icon={L.divIcon({ className: "bg-transparent border-0", iconSize: [30, 30], iconAnchor: [15, 15],
                            html: `<div style="width:30px;height:30px;transform:rotate(${pc.velocidad > 3 ? pc.rumbo || 0 : 0}deg)"><svg width="30" height="30" viewBox="0 0 30 30"><path d="M15 3 24 26 15 21 6 26Z" fill="#fbbf24" stroke="#0a0e14" stroke-width="2.5" stroke-linejoin="round"/></svg></div>` })} />
                </>
            )}
        </>
    );
}

/* ─────────────────────────── El panel ─────────────────────────── */

export function PanelDelRecorrido({ datos, partes, viajeSel, alViaje, cursor, alCursor, hastaAhora, alCambiarLimite, alLugar }: {
    datos: RecorridoGps; partes: Partes; viajeSel: number | null; alViaje: (i: number) => void;
    cursor: number | null; alCursor: (i: number | null) => void;
    /** El período llega hasta ahora: lo estacionado después del último viaje sigue corriendo. */
    hastaAhora: boolean;
    alCambiarLimite: () => void;
    /** Dónde es, en palabras (según las geocercas). Null si no se sabe. */
    alLugar: (lat: number, lon: number) => string | null;
}) {
    const { pts, viajes, porViaje, desde, hasta, limite, excesos } = partes;
    const jornada = useMemo(() => jornadaDe(viajes, { desde: datos.resumen.desde, hasta: hastaAhora ? new Date().toISOString() : datos.resumen.hasta, hastaAhora }), [viajes, datos.resumen.desde, datos.resumen.hasta, hastaAhora]);
    const rex = resumenDeExcesos(excesos);
    const excesosDeViaje = (v: number): Exceso[] => { const r = porViaje[v]; return r ? excesos.filter((e) => e.i0 >= r.i0 && e.i1 <= r.i1) : []; };
    const variosDias = !!datos.resumen.desde && !!datos.resumen.hasta && fechaCorta(datos.resumen.desde) !== fechaCorta(datos.resumen.hasta);
    const cuando = (iso: string) => (variosDias ? `${fechaCorta(iso)} ${hora(iso)}` : hora(iso));

    return (
        <>
            <dl className="mt-2 grid grid-cols-4 gap-3 text-[12.5px]">
                <Dato k="Recorrió" v={fmtKm(datos.resumen.km)} />
                <Dato k="Andando" v={duracionLarga(datos.resumen.enMovimientoMin)} />
                <Dato k="Estacionado" v={duracionLarga(minutosEstacionado(jornada))} />
                <Dato k="Máxima" v={`${datos.resumen.velMax} km/h`} mal={datos.resumen.velMax > limite} />
            </dl>

            <Limite limite={limite} rex={rex} alCambiar={alCambiarLimite} />

            <div className="mt-2.5 border-t border-border pt-2">
                <p className="mb-1 text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">La jornada · {viajes.length} {viajes.length === 1 ? "viaje" : "viajes"}</p>
                <ol className="-mx-1 max-h-[178px] overflow-y-auto [scrollbar-width:thin]">
                    {jornada.map((tr, i) => tr.tipo === "viaje" ? (
                        <FilaViaje key={`v${tr.n}`} tr={tr} elegido={viajeSel === tr.n - 1} excesos={excesosDeViaje(tr.n - 1)} cuando={cuando} alElegir={() => alViaje(tr.n - 1)} />
                    ) : (
                        <li key={`e${i}`} className="flex items-center gap-2.5 px-2 py-1 text-[12px] text-muted-foreground">
                            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-[5px] border border-border"><SquareParking size={12} /></span>
                            <span className="min-w-0 flex-1 truncate">
                                <span className="font-semibold text-foreground">{tr.sigue ? "Estacionado desde las" : "Estacionado"} {tr.sigue ? cuando(tr.desde) : duracionLarga(tr.minutos)}</span>
                                {tr.sigue ? ` · lleva ${duracionLarga(tr.minutos)}` : <span className="tabular-nums"> · {cuando(tr.desde)} a {hora(tr.hasta)}</span>}
                                {alLugar(tr.lat, tr.lon) && ` · ${alLugar(tr.lat, tr.lon)}`}
                            </span>
                        </li>
                    ))}
                </ol>
            </div>

            {hasta > desde && <Barra pts={pts} desde={desde} hasta={hasta} limite={limite} cursor={cursor} alCursor={alCursor} deViaje={viajeSel !== null ? viajeSel + 1 : null} />}
        </>
    );
}

function Dato({ k, v, mal }: { k: string; v: string; mal?: boolean }) {
    return <div className="min-w-0"><dt className="text-[10.5px] text-muted-foreground">{k}</dt><dd className={cn("font-bold tabular-nums truncate", mal && "tono-mal")}>{v}</dd></div>;
}

function FilaViaje({ tr, elegido, excesos, cuando, alElegir }: { tr: Extract<Tramo, { tipo: "viaje" }>; elegido: boolean; excesos: Exceso[]; cuando: (iso: string) => string; alElegir: () => void }) {
    const v = tr.viaje, r = resumenDeExcesos(excesos);
    return (
        <li>
            <button type="button" onClick={alElegir} aria-pressed={elegido}
                className={cn("flex w-full items-center gap-2.5 rounded-[6px] px-2 py-1 text-left text-[12px] tabular-nums", elegido ? "bg-amber-400/20" : "hover:bg-accent")}>
                <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10.5px] font-extrabold", elegido ? "bg-amber-400 text-black" : "bg-foreground text-background")}>{tr.n}</span>
                <span className="w-[98px] shrink-0 font-bold">{cuando(v.desde)} → {hora(v.hasta)}</span>
                <span className="w-[54px] shrink-0">{fmtKm(v.km)}</span>
                <span className="w-[62px] shrink-0 text-muted-foreground">{duracionLarga(v.minutos)}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">máx {v.velMax} · media {v.velMedia} km/h</span>
                {r.veces > 0 && <span className="inline-flex shrink-0 items-center gap-1 font-bold tono-mal" title={`${r.veces} ${r.veces === 1 ? "vez" : "veces"} sobre el límite, ${r.segundos} s en total, hasta ${r.velMax} km/h`}><TriangleAlert size={11} /> {r.veces}</span>}
            </button>
        </li>
    );
}

/** El límite de la empresa: se ve, se cambia acá mismo, y al lado cuánto se lo pasó. */
function Limite({ limite, rex, alCambiar }: { limite: number; rex: ReturnType<typeof resumenDeExcesos>; alCambiar: () => void }) {
    const [editando, setEditando] = useState(false);
    const [valor, setValor] = useState(String(limite));
    const [guardando, setGuardando] = useState(false);
    async function guardar() {
        setGuardando(true);
        try {
            const r = await guardarLimiteVelocidadGps(Number(valor));
            if (!r.ok) { toast.error({ title: "No se guardó", description: r.error }); return; }
            setEditando(false); alCambiar();
        } catch (e) { toast.error({ title: "No se guardó", description: e instanceof Error ? e.message : undefined }); }
        finally { setGuardando(false); }
    }
    return (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[6px] bg-muted/60 px-2.5 py-1.5 text-[12px]">
            <span className="inline-flex items-center gap-1.5 text-muted-foreground"><Gauge size={13} /> Velocidad permitida</span>
            {editando ? (
                <form className="inline-flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); guardar(); }}>
                    <input autoFocus type="number" min={20} max={200} value={valor} onChange={(e) => setValor(e.target.value)} className="h-6 w-[58px] rounded-[5px] border border-border bg-background px-1.5 text-[12px] font-bold tabular-nums" aria-label="Velocidad permitida, km/h" />
                    km/h
                    <button type="submit" disabled={guardando} className="ml-1 font-semibold text-[var(--accion)] hover:underline">{guardando ? <Loader2 size={12} className="animate-spin" /> : "Guardar"}</button>
                    <button type="button" onClick={() => setEditando(false)} className="text-muted-foreground hover:underline">Cancelar</button>
                </form>
            ) : (
                <button type="button" onClick={() => { setValor(String(limite)); setEditando(true); }} className="font-bold tabular-nums hover:underline" title="Cambiar la velocidad permitida por la empresa (vale para todos los vehículos)">{limite} km/h</button>
            )}
            <span className={cn("ml-auto tabular-nums", rex.veces ? "font-bold tono-mal" : "text-muted-foreground")}>
                {rex.veces ? `La pasó ${rex.veces} ${rex.veces === 1 ? "vez" : "veces"} · ${rex.segundos >= 60 ? duracionLarga(Math.round(rex.segundos / 60)) : `${rex.segundos} s`} · hasta ${rex.velMax} km/h` : "No la pasó"}
            </span>
        </div>
    );
}

const PASOS = [{ r: "×1", cada: 400, salto: 1 }, { r: "×4", cada: 120, salto: 1 }, { r: "×16", cada: 120, salto: 4 }];

/**
 * La barra para recorrer el trayecto. Arriba, la velocidad de todo el tramo como un perfil —rojo lo
 * que pasó el límite— sobre el mismo eje que la barra: el dibujo ya dice dónde mirar antes de
 * mover nada. Abajo, lo que reportó el equipo en el punto elegido.
 *
 * El eje es el número de reporte y no el reloj: así una hora estacionado en medio del período no
 * se come la mitad de la barra, y cada paso de la flecha es exactamente un reporte.
 */
function Barra({ pts, desde, hasta, limite, cursor, alCursor, deViaje }: { pts: PuntoGps[]; desde: number; hasta: number; limite: number; cursor: number | null; alCursor: (i: number | null) => void; deViaje: number | null }) {
    const [andando, setAndando] = useState(false);
    const [paso, setPaso] = useState(1);
    const i = cursor !== null ? Math.min(Math.max(cursor, desde), hasta) : null;
    /* El reloj que lo hace andar lee de acá por dónde va: si dependiera de `i`, se rearmaría en cada paso. */
    const ref = useRef({ i, hasta, desde });
    useEffect(() => { ref.current = { i, hasta, desde }; }, [i, hasta, desde]);
    useEffect(() => {
        if (!andando) return;
        const { cada, salto } = PASOS[paso];
        const iv = setInterval(() => {
            const a = ref.current.i ?? ref.current.desde;
            if (a >= ref.current.hasta) { setAndando(false); return; }
            alCursor(Math.min(a + salto, ref.current.hasta));
        }, cada);
        return () => clearInterval(iv);
    }, [andando, paso, alCursor]);

    const n = hasta - desde, tope = Math.max(limite * 1.25, ...pts.slice(desde, hasta + 1).map((p) => p.velocidad), 1);
    const perfil = useMemo(() => {
        const x = (k: number) => ((k - desde) / Math.max(1, n)) * 300, y = (v: number) => 34 - (v / tope) * 32;
        const linea = pts.slice(desde, hasta + 1).map((p, k) => `${x(k + desde).toFixed(1)},${y(p.velocidad).toFixed(1)}`).join(" ");
        const rojos: string[] = [];
        for (let k = desde + 1; k <= hasta; k++) if (pts[k].velocidad > limite || pts[k - 1].velocidad > limite) rojos.push(`M${x(k - 1).toFixed(1)},${y(pts[k - 1].velocidad).toFixed(1)}L${x(k).toFixed(1)},${y(pts[k].velocidad).toFixed(1)}`);
        return { linea, rojos: rojos.join(""), yLim: y(limite), x };
    }, [pts, desde, hasta, n, tope, limite]);
    const p = i !== null ? pts[i] : null;
    const mover = (d: number) => { setAndando(false); alCursor(Math.min(Math.max((i ?? desde) + d, desde), hasta)); };

    return (
        <div className="mt-2.5 border-t border-border pt-2">
            <div className="flex items-center gap-2">
                <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Recorrer {deViaje ? `el viaje ${deViaje}` : "el trayecto"}</p>
                {p && <button type="button" onClick={() => { setAndando(false); alCursor(null); }} className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"><X size={11} /> Soltar</button>}
            </div>
            <div className="relative mt-1">
                <svg viewBox="0 0 300 36" preserveAspectRatio="none" className="block h-9 w-full" aria-hidden>
                    <line x1="0" x2="300" y1={perfil.yLim} y2={perfil.yLim} stroke="currentColor" strokeOpacity="0.35" strokeDasharray="3 3" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                    <polyline points={perfil.linea} fill="none" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
                    {perfil.rojos && <path d={perfil.rojos} fill="none" stroke="#ef4444" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
                    {i !== null && <line x1={perfil.x(i)} x2={perfil.x(i)} y1="0" y2="36" stroke="#fbbf24" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
                </svg>
                {/* La barra va ENCIMA del perfil, invisible: se arrastra sobre el dibujo mismo. */}
                <input type="range" min={desde} max={hasta} step={1} value={i ?? desde} aria-label="Punto del trayecto"
                    onChange={(e) => { setAndando(false); alCursor(Number(e.target.value)); }}
                    onKeyDown={(e) => { if (e.key === " ") { e.preventDefault(); setAndando((a) => !a); } }}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
            </div>
            <div className="mt-1 flex items-center gap-1.5">
                <button type="button" onClick={() => mover(-1)} title="Un reporte atrás" className="grid h-7 w-7 place-items-center rounded-[6px] border border-border hover:bg-accent"><ChevronLeft size={14} /></button>
                <button type="button" onClick={() => { if (i === null || i >= hasta) alCursor(desde); setAndando((a) => !a); }} title={andando ? "Pausar" : "Recorrerlo solo"}
                    className="grid h-7 w-7 place-items-center rounded-[6px] bg-[var(--accion)] text-white">{andando ? <Pause size={13} /> : <Play size={13} />}</button>
                <button type="button" onClick={() => mover(1)} title="Un reporte adelante" className="grid h-7 w-7 place-items-center rounded-[6px] border border-border hover:bg-accent"><ChevronRight size={14} /></button>
                <div className="flex gap-0.5" role="group" aria-label="Rapidez">
                    {PASOS.map((x, k) => <button key={x.r} type="button" aria-pressed={paso === k} onClick={() => setPaso(k)} className={cn("h-7 rounded-[6px] px-1.5 text-[11px] font-bold tabular-nums", paso === k ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent")}>{x.r}</button>)}
                </div>
                <p className="ml-auto text-[11px] tabular-nums text-muted-foreground">{p ? `reporte ${i! - desde + 1} de ${n + 1}` : `${n + 1} reportes · ${hora(pts[desde].cuando)} a ${hora(pts[hasta].cuando)}`}</p>
            </div>
            {p ? (
                <dl className="mt-1.5 grid grid-cols-4 gap-x-3 gap-y-1 rounded-[6px] bg-muted/60 px-2.5 py-1.5 text-[12px]">
                    <Dato k="Hora" v={horaSeg(p.cuando)} />
                    <Dato k="Velocidad" v={`${p.velocidad} km/h`} mal={p.velocidad > limite} />
                    <Dato k="Rumbo" v={p.velocidad > 3 ? rumboEnPalabras(p.rumbo) || "—" : "detenido"} />
                    <Dato k="Motor" v={p.enc == null ? "no informa" : p.enc ? "encendido" : "apagado"} />
                    <Dato k="Satélites" v={p.sat != null ? String(p.sat) : "—"} />
                    <Dato k="Desde el anterior" v={i! > desde ? `${Math.round((t(p) - t(pts[i! - 1])) / 1000)} s` : "—"} />
                    <div className="col-span-2 min-w-0"><dt className="text-[10.5px] text-muted-foreground">Posición</dt><dd className="truncate font-bold tabular-nums">{p.lat.toFixed(5)}, {p.lon.toFixed(5)}</dd></div>
                </dl>
            ) : <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">Arrastrá sobre el perfil de velocidad, o tocá la línea en el mapa, para ver la hora exacta y lo que reportó en ese punto. Con ← → se avanza de a un reporte.</p>}
        </div>
    );
}
