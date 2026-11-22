"use client";

import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { CircleMarker, Marker, Polyline, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import { ChevronLeft, ChevronRight, Gauge, Loader2, Pause, Play, SquareParking, TriangleAlert, X } from "lucide-react";
import { sileo as toast } from "sileo";
import { guardarLimiteVelocidadGps, type PuntoGps, type RecorridoGps } from "@/app/actions/gps";
import {
    COLOR_FRANJA, duracionLarga, excesosDe, jornadaDe, lineaDeTiempo, minutosEstacionado, posicionEnLinea, puntoMasCercano, resumenDeExcesos, rumboEnPalabras, rumboEntre, tiempoEnLinea, trozosPorVelocidad,
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

/** El dibujo de un auto (trazos de Lucide, licencia ISC), por si quien llama no pasa el del rastreador. */
const AUTO = '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>';

/**
 * Por dónde va la barra: una posición con decimales sobre los puntos del recorrido (12,4 es «a
 * cuatro décimos del camino entre el punto 12 y el 13»), o null si está suelta.
 *
 * NO es estado de React, a propósito. La primera versión lo era, y al darle a reproducir cada paso
 * volvía a dibujar la capa entera del GPS —todos los rastreadores, las geocercas, las líneas— y
 * rehacía el marcador del auto desde cero: iba a los saltos y parpadeaba (22/11, Nico: «se corta
 * mucho y no es continuo ni fluido»). Ahora cambia sesenta veces por segundo sin que React se
 * entere: el auto y la raya del perfil se mueven tocando su propio elemento, y sólo el cuadro de
 * datos se vuelve a dibujar, y sólo cuando se pasa a otro reporte.
 */
export type CursorDeRuta = { get(): number | null; set(v: number | null): void; oir(f: () => void): () => void };
export function crearCursor(): CursorDeRuta {
    let v: number | null = null;
    const oyentes = new Set<() => void>();
    return {
        get: () => v,
        set: (n) => { if (n === v) return; v = n; for (const f of oyentes) f(); },
        oir: (f) => { oyentes.add(f); return () => { oyentes.delete(f); }; },
    };
}

/**
 * El vehículo que recorre el trayecto: el MISMO dibujo con que el rastreador se ve en el mapa (22/11,
 * Nico: «en vez de una flecha, que sea el mismo autito, sin el círculo» — la primera versión era
 * una flecha adentro de un aro). Va en ámbar, que es el color de «esto es lo que estoy recorriendo»,
 * para no confundirlo con el vehículo de verdad, que sigue en su lugar y en su color. Encima, la
 * velocidad de ese punto; y la flecha de rumbo por fuera, sólo si se movía.
 *
 * El dibujo se arma UNA vez. Lo que cambia mientras anda —el número, el color del cartel, hacia
 * dónde apunta la flecha— lo cambia `VehiculoDelRecorrido` sobre estos mismos elementos.
 */
function autitoDelRecorrido(dibujo: string): L.DivIcon {
    return L.divIcon({
        className: "bg-transparent border-0", iconSize: [36, 36], iconAnchor: [18, 18],
        html: `<div style="position:relative;width:36px;height:36px">`
            + `<div class="rec-cartel" style="position:absolute;left:50%;bottom:calc(100% + 12px);transform:translateX(-50%);padding:1px 8px;border-radius:999px;background:#0a0e14;color:#fff;border:2px solid #fbbf24;box-shadow:0 2px 8px rgba(0,0,0,.45);font:800 12px/16px Outfit,system-ui,sans-serif;font-variant-numeric:tabular-nums;white-space:nowrap"><span class="rec-vel">0</span><span style="font-weight:600;font-size:9.5px;opacity:.8"> km/h</span></div>`
            + `<div class="rec-rumbo" style="position:absolute;inset:-9px;will-change:transform"><div style="margin:0 auto;width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-bottom:10px solid #fbbf24"></div></div>`
            + `<div style="width:36px;height:36px;border-radius:50%;background:#fbbf24;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.5);display:grid;place-items:center"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#0a0e14" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${dibujo}</svg></div>`
            + `</div>`,
    });
}

/**
 * El auto sobre el mapa. Se mueve a mano —`setLatLng` sobre un marcador que se crea una sola vez—
 * cada vez que cambia el cursor: entre dos reportes está donde corresponde, no salta de uno a otro.
 * El rumbo es el del tramo que está andando (calculado con los dos puntos), que gira parejo; el que
 * informa el equipo viene de a un reporte y, quieto, es ruido.
 */
function VehiculoDelRecorrido({ pts, cur, limite, dibujo }: { pts: PuntoGps[]; cur: CursorDeRuta; limite: number; dibujo: string }) {
    const mapa = useMap();
    useEffect(() => {
        let marca: L.Marker | null = null, vel: HTMLElement | null = null, cartel: HTMLElement | null = null, flecha: HTMLElement | null = null;
        let dicho = -1, pasado: boolean | null = null, rumbo = 0, conFlecha: boolean | null = null, ultimoPaneo = 0;
        const pintar = () => {
            const pos = cur.get();
            if (pos === null || !pts.length) { marca?.remove(); marca = null; return; }
            const i = Math.min(Math.max(Math.floor(pos), 0), pts.length - 1), k = Math.min(Math.max(pos - i, 0), 1);
            const a = pts[i], b = pts[Math.min(i + 1, pts.length - 1)];
            const ll: [number, number] = [a.lat + (b.lat - a.lat) * k, a.lon + (b.lon - a.lon) * k];
            if (!marca) {
                marca = L.marker(ll, { icon: autitoDelRecorrido(dibujo), interactive: false, zIndexOffset: 2000, keyboard: false }).addTo(mapa);
                const el = marca.getElement();
                vel = el?.querySelector(".rec-vel") || null; cartel = el?.querySelector(".rec-cartel") || null; flecha = el?.querySelector(".rec-rumbo") || null;
                dicho = -1; pasado = null; conFlecha = null;
            } else marca.setLatLng(ll);
            /* Sólo se toca lo que cambió: escribir el mismo número sesenta veces por segundo también cuesta. */
            const v = Math.round(a.velocidad + (b.velocidad - a.velocidad) * k);
            if (v !== dicho && vel) { vel.textContent = String(v); dicho = v; }
            if ((v > limite) !== pasado && cartel) { pasado = v > limite; cartel.style.background = pasado ? "#ef4444" : "#0a0e14"; }
            const anda = v > 3, r = rumboEntre(a, b);
            if (r !== null) rumbo = r;
            if (flecha) {
                if (anda !== conFlecha) { conFlecha = anda; flecha.style.display = anda ? "" : "none"; }
                if (anda) flecha.style.transform = `rotate(${rumbo.toFixed(1)}deg)`;
            }
            /* Que no se vaya de la vista: cuando se acerca al borde, el mapa lo alcanza con un solo
               movimiento suave. No en cada cuadro —pelearía con el arrastre de quien mira— y no más
               de una vez por segundo: dos paneos encimados es justo el tirón que se quería sacar. */
            const ahora = Date.now();
            if (ahora - ultimoPaneo > 900 && !mapa.getBounds().pad(-0.18).contains(ll)) { ultimoPaneo = ahora; mapa.panTo(ll, { animate: true, duration: 0.7, easeLinearity: 0.6 }); }
        };
        pintar();
        const soltar = cur.oir(pintar);
        return () => { soltar(); marca?.remove(); };
    }, [pts, cur, limite, dibujo, mapa]);
    return null;
}

export function LineasDelRecorrido({ partes, viajeSel, cur, dibujo = AUTO }: {
    partes: Partes; viajeSel: number | null; cur: CursorDeRuta;
    /** El dibujo del rastreador (auto, camión, moto…): con él se ve el vehículo que recorre el trayecto. */
    dibujo?: string;
}) {
    const { pts, porViaje, limite, excesos } = partes;
    /** El punto bajo el mouse: su velocidad y su hora, sin tener que tocar nada. */
    const [sobre, setSobre] = useState<number | null>(null);
    const trozos = useMemo(() => porViaje.map((r) => (r ? trozosPorVelocidad(pts.slice(r.i0, r.i1 + 1), limite) : [])), [porViaje, pts, limite]);
    const cercano = (e: L.LeafletMouseEvent) => puntoMasCercano(pts, e.latlng.lat, e.latlng.lng);

    return (
        <>
            {porViaje.map((r, v) => r && r.i1 > r.i0 && (
                <React.Fragment key={`v-${v}`}>
                    {/* Un borde oscuro debajo: sobre el satélite, una línea de color sola se pierde. Es también
                        la que escucha el mouse: más ancha que la de color, se le acierta sin apuntar. */}
                    <Polyline positions={pts.slice(r.i0, r.i1 + 1).map((p) => [p.lat, p.lon] as [number, number])}
                        pathOptions={{ color: "#0a0e14", weight: viajeSel === v ? 11 : 8, opacity: viajeSel !== null && viajeSel !== v ? 0.3 : 0.6, lineCap: "round", lineJoin: "round" }}
                        eventHandlers={{ mousemove: (e) => setSobre(cercano(e)), mouseout: () => setSobre(null), click: (e) => { L.DomEvent.stopPropagation(e); cur.set(cercano(e)); } }} />
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

            {sobre !== null && pts[sobre] && (
                <CircleMarker center={[pts[sobre].lat, pts[sobre].lon]} radius={5} interactive={false} pathOptions={{ color: "#fff", weight: 2, fillColor: "#0a0e14", fillOpacity: 1 }}>
                    <Tooltip permanent direction="top" offset={[0, -8]} opacity={1} className="!rounded-[6px] !border-0 !bg-[#0a0e14] !px-2 !py-1 !text-[11.5px] !font-bold !text-white !shadow-lg before:!hidden">
                        <span className={cn("tabular-nums", pts[sobre].velocidad > limite && "text-red-400")}>{pts[sobre].velocidad} km/h</span> <span className="font-normal opacity-70 tabular-nums">· {horaSeg(pts[sobre].cuando)}</span>
                    </Tooltip>
                </CircleMarker>
            )}

            {/* El vehículo de la barra: el mismo dibujo del rastreador, sin aro alrededor. */}
            <VehiculoDelRecorrido pts={pts} cur={cur} limite={limite} dibujo={dibujo} />
        </>
    );
}

/* ─────────────────────────── El panel ─────────────────────────── */

export function PanelDelRecorrido({ datos, partes, viajeSel, alViaje, cur, hastaAhora, alCambiarLimite, alLugar }: {
    datos: RecorridoGps; partes: Partes; viajeSel: number | null; alViaje: (i: number) => void;
    cur: CursorDeRuta;
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

            {hasta > desde && <Barra key={`${desde}-${hasta}`} pts={pts} desde={desde} hasta={hasta} limite={limite} cur={cur} deViaje={viajeSel !== null ? viajeSel + 1 : null} />}
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

/**
 * A qué ritmo se reproduce: segundos del viaje por cada segundo de reloj. A ×1 un viaje de veinte
 * minutos se ve en uno; a ×16, en cuatro segundos. El auto va siempre de corrido: lo que cambia es
 * cuánto camino hace por cuadro, no cada cuánto salta.
 */
const PASOS = [{ r: "×1", f: 20 }, { r: "×4", f: 80 }, { r: "×16", f: 320 }];

/**
 * La barra para recorrer el trayecto. Arriba, la velocidad de todo el tramo como un perfil —rojo lo
 * que pasó el límite— sobre el mismo eje que la barra: el dibujo ya dice dónde mirar antes de
 * mover nada. Abajo, lo que reportó el equipo en el punto elegido.
 *
 * El eje es el número de reporte y no el reloj: así una hora estacionado en medio del período no
 * se come la mitad de la barra, y cada paso de la flecha es exactamente un reporte.
 */
function Barra({ pts, desde, hasta, limite, cur, deViaje }: { pts: PuntoGps[]; desde: number; hasta: number; limite: number; cur: CursorDeRuta; deViaje: number | null }) {
    const [andando, setAndando] = useState(false);
    const [paso, setPaso] = useState(1);
    /* El reporte en el que está parada la barra. De acá sale el cuadro de datos: se vuelve a dibujar
       cuando se pasa a OTRO reporte, no en cada cuadro de la reproducción. */
    const i = useSyncExternalStore(cur.oir, () => { const v = cur.get(); return v === null ? null : Math.min(Math.max(Math.round(v), desde), hasta); }, () => null);
    const linea = useMemo(() => lineaDeTiempo(pts, desde, hasta), [pts, desde, hasta]);

    /* La reproducción: un reloj que avanza con cada cuadro del navegador. Si la pestaña estuvo
       tapada, al volver no se come de un salto todo lo que «pasó»: retoma de a un cuadro. */
    useEffect(() => {
        if (!andando) return;
        let cuadro = 0, antes = performance.now(), seg = tiempoEnLinea(linea, cur.get() ?? desde);
        const avanzar = (ahora: number) => {
            seg += Math.min(0.1, Math.max(0, (ahora - antes) / 1000)) * PASOS[paso].f; antes = ahora;
            if (seg >= linea.total) { cur.set(hasta); setAndando(false); return; }
            cur.set(posicionEnLinea(linea, seg));
            cuadro = requestAnimationFrame(avanzar);
        };
        cuadro = requestAnimationFrame(avanzar);
        return () => cancelAnimationFrame(cuadro);
    }, [andando, paso, linea, cur, desde, hasta]);

    /* La raya sobre el perfil acompaña al auto de corrido: se mueve tocando su atributo, sin pasar por React. */
    const raya = useRef<SVGLineElement>(null);
    useEffect(() => {
        const mover = () => {
            const v = cur.get(), el = raya.current;
            if (!el) return;
            if (v === null) { el.style.display = "none"; return; }
            const x = (((Math.min(Math.max(v, desde), hasta) - desde) / Math.max(1, hasta - desde)) * 300).toFixed(2);
            el.style.display = ""; el.setAttribute("x1", x); el.setAttribute("x2", x);
        };
        mover();
        return cur.oir(mover);
    }, [cur, desde, hasta]);
    /* Si la barra quedó sobre un punto de otro viaje, se suelta: su punto ya no es de lo que se está recorriendo. */
    useEffect(() => { const v = cur.get(); if (v !== null && (v < desde || v > hasta)) cur.set(null); }, [cur, desde, hasta]);

    const n = hasta - desde, tope = Math.max(limite * 1.25, ...pts.slice(desde, hasta + 1).map((p) => p.velocidad), 1);
    const perfil = useMemo(() => {
        const x = (k: number) => ((k - desde) / Math.max(1, n)) * 300, y = (v: number) => 34 - (v / tope) * 32;
        const linea = pts.slice(desde, hasta + 1).map((p, k) => `${x(k + desde).toFixed(1)},${y(p.velocidad).toFixed(1)}`).join(" ");
        const rojos: string[] = [];
        for (let k = desde + 1; k <= hasta; k++) if (pts[k].velocidad > limite || pts[k - 1].velocidad > limite) rojos.push(`M${x(k - 1).toFixed(1)},${y(pts[k - 1].velocidad).toFixed(1)}L${x(k).toFixed(1)},${y(pts[k].velocidad).toFixed(1)}`);
        return { linea, rojos: rojos.join(""), yLim: y(limite), x };
    }, [pts, desde, hasta, n, tope, limite]);
    const p = i !== null ? pts[i] : null;
    const mover = (d: number) => { setAndando(false); cur.set(Math.min(Math.max((i ?? desde) + d, desde), hasta)); };

    return (
        <div className="mt-2.5 border-t border-border pt-2">
            <div className="flex items-center gap-2">
                <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Recorrer {deViaje ? `el viaje ${deViaje}` : "el trayecto"}</p>
                {p && <button type="button" onClick={() => { setAndando(false); cur.set(null); }} className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"><X size={11} /> Soltar</button>}
            </div>
            <div className="relative mt-1">
                <svg viewBox="0 0 300 36" preserveAspectRatio="none" className="block h-9 w-full" aria-hidden>
                    <line x1="0" x2="300" y1={perfil.yLim} y2={perfil.yLim} stroke="currentColor" strokeOpacity="0.35" strokeDasharray="3 3" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                    <polyline points={perfil.linea} fill="none" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
                    {perfil.rojos && <path d={perfil.rojos} fill="none" stroke="#ef4444" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
                    <line ref={raya} x1="0" x2="0" y1="0" y2="36" stroke="#fbbf24" strokeWidth="2" vectorEffect="non-scaling-stroke" style={{ display: "none" }} />
                </svg>
                {/* La barra va ENCIMA del perfil, invisible: se arrastra sobre el dibujo mismo. */}
                <input type="range" min={desde} max={hasta} step={1} value={i ?? desde} aria-label="Punto del trayecto"
                    onChange={(e) => { setAndando(false); cur.set(Number(e.target.value)); }}
                    onKeyDown={(e) => { if (e.key === " ") { e.preventDefault(); setAndando((a) => !a); } }}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
            </div>
            <div className="mt-1 flex items-center gap-1.5">
                <button type="button" onClick={() => mover(-1)} title="Un reporte atrás" className="grid h-7 w-7 place-items-center rounded-[6px] border border-border hover:bg-accent"><ChevronLeft size={14} /></button>
                <button type="button" onClick={() => { if (i === null || i >= hasta) cur.set(desde); setAndando((a) => !a); }} title={andando ? "Pausar" : "Recorrerlo solo"}
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
                    {/* Andando con el contacto «apagado» no es un motor apagado: es el cable de contacto sin conectar. Se dice así. */}
                    <Dato k="Contacto" v={p.enc == null ? "no informa" : p.enc ? "encendido" : p.velocidad >= 10 ? "sin cable (ACC)" : "apagado"} />
                    <Dato k="Satélites" v={p.sat != null ? String(p.sat) : "—"} />
                    <Dato k="Desde el anterior" v={i! > desde ? `${Math.round((t(p) - t(pts[i! - 1])) / 1000)} s` : "—"} />
                    <div className="col-span-2 min-w-0"><dt className="text-[10.5px] text-muted-foreground">Posición</dt><dd className="truncate font-bold tabular-nums">{p.lat.toFixed(5)}, {p.lon.toFixed(5)}</dd></div>
                </dl>
            ) : <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">Arrastrá sobre el perfil de velocidad, o tocá la línea en el mapa, para ver la hora exacta y lo que reportó en ese punto. Con ← → se avanza de a un reporte.</p>}
        </div>
    );
}
