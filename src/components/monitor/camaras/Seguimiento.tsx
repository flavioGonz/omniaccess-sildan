"use client";

import { useMemo, useRef, useState } from "react";
import { Camera, Crosshair, Plus, Trash2, Search, X, Eye, EyeOff, ShieldAlert } from "lucide-react";
import { Girando as Loader2 } from "@/components/brand/CargaOmni";
import { setVisualTrackLinks, type TrackLink } from "@/app/actions/detections";
import { Vivo, vivoDe, ubicacion, idCanal, type Canal, type Alerta } from "./piezas";
import { avisoDeVecina, tituloDeAviso, type AvisoVecina } from "@/lib/aviso-vecina";
import { getImagePath } from "@/lib/image-path";
import { fechaHoraSeg, hace } from "@/lib/fechas";
import { cn } from "@/lib/utils";

/**
 * Seguimiento visual en la cámara abierta (pedido 15/10: «permitir en cámaras el visual track»).
 *
 * Es el mismo de la ficha de intrusión (LiveModal), con los mismos datos (Setting
 * VISUAL_TRACK_LINKS: por cámara, a qué cámaras vecinas se pasa y por qué punto de la escena):
 * sobre el vivo, un ícono en cada salida; tocarlo abre esa cámara, y la de origen queda chica en
 * una esquina para volver. Lo que se suma acá:
 *  · Sirve también para los canales de NVR que no son equipo (id `nvrch-<nvr>-<ch>`).
 *  · Los puntos se guardan en 0–1 del CUADRO de la cámara, no de la pantalla: la ficha es a
 *    pantalla completa con el video «contain», y en un monitor de otra proporción el ícono caía
 *    fuera de la puerta que marca.
 *  · Al pasar el mouse, el vivo de la vecina en chico (directo, sin convertir si el equipo puede).
 *  · Si la vecina está detectando algo, el ícono late en rojo: «el intruso pasó para allá».
 *  · Si la vecina leyó una chapa de lista negra o amarilla, el ícono toma el color de esa lista y
 *    tocarlo abre el cartel del aviso (16/11) en vez de saltar derecho a la cámara: la chapa, si
 *    todavía la ve o no, con la fecha exacta, y la captura. Seguir queda a un botón del cartel —
 *    antes de irse de la cámara que estoy mirando conviene saber a qué voy.
 *
 * Editar (arrastrar, agregar, quitar) pide sesión: guarda con una acción del servidor, que un
 * enlace de pared no puede usar.
 */

type Rect = { left: number; top: number; width: number; height: number };

export function SeguimientoVisual({ c, canales, links: inicial, editando, cuadro, h265, hls, alertaDe, alSeguir, alGuardado }: {
    c: Canal;
    canales: Canal[];
    links: TrackLink[];
    editando: boolean;
    /** Dónde está el cuadro del video en la pantalla (contain): los puntos son relativos a él. */
    cuadro: Rect | null;
    h265: boolean; hls: boolean;
    alertaDe: (c: Canal) => Alerta | null;
    alSeguir: (destino: Canal) => void;
    alGuardado?: (links: TrackLink[]) => void;
}) {
    const [links, setLinks] = useState<TrackLink[]>(inicial);
    const [guardando, setGuardando] = useState(false);
    const [agregando, setAgregando] = useState(false);
    const [buscar, setBuscar] = useState("");
    const [encima, setEncima] = useState<number | null>(null);
    const [cartel, setCartel] = useState<number | null>(null);
    const arrastrando = useRef<number | null>(null);
    const porId = useMemo(() => new Map(canales.map((x) => [idCanal(x), x])), [canales]);
    const propio = idCanal(c);
    const guardar = async (n: TrackLink[]) => {
        setLinks(n); setGuardando(true);
        try { await setVisualTrackLinks(propio, n); alGuardado?.(n); } finally { setGuardando(false); }
    };
    const candidatos = useMemo(() => {
        const q = buscar.trim().toLowerCase();
        return canales.filter((x) => idCanal(x) !== propio && !links.some((l) => l.to === idCanal(x)) && (!q || `${x.nombre} ${ubicacion(x)}`.toLowerCase().includes(q)));
    }, [canales, propio, links, buscar]);
    if (!cuadro) return null;
    const enPantalla = (l: TrackLink) => ({ left: cuadro.left + l.x * cuadro.width, top: cuadro.top + l.y * cuadro.height });
    const aCuadro = (x: number, y: number) => ({ x: Math.max(0, Math.min(1, (x - cuadro.left) / cuadro.width)), y: Math.max(0, Math.min(1, (y - cuadro.top) / cuadro.height)) });

    return (
        <div className={cn("absolute inset-0", editando ? "pointer-events-auto" : "pointer-events-none")}
            onPointerMove={(e) => { if (arrastrando.current == null) return; const p = aCuadro(e.clientX, e.clientY); setLinks((prev) => prev.map((l, i) => (i === arrastrando.current ? { ...l, ...p } : l))); }}
            onPointerUp={() => { if (arrastrando.current != null) { arrastrando.current = null; guardar(links); } }}>
            {links.map((l, i) => {
                const destino = porId.get(l.to); if (!destino) return null;
                const pos = enPantalla(l);
                const alarma = !!alertaDe(destino);
                const aviso = avisoDeVecina(destino.lecturas);
                const abierto = cartel === i;
                // Donde cae la tarjeta: el punto del enlace puede estar en cualquier borde del cuadro.
                const lado = cn(l.y < 0.42 ? "top-full mt-2" : "bottom-full mb-2", l.x < 0.2 ? "left-0" : l.x > 0.8 ? "right-0" : "left-1/2 -translate-x-1/2");
                return (
                    <div key={l.to} className="absolute -translate-x-1/2 -translate-y-1/2" style={pos}>
                        {editando ? (
                            <div onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); arrastrando.current = i; }}
                                className="flex items-center gap-1.5 pl-2.5 pr-1 h-10 rounded-full visor-panel text-white ring-2 ring-[var(--accion-en-oscuro)] cursor-move select-none touch-none">
                                <Crosshair size={15} className="shrink-0 text-[var(--accion-en-oscuro)]" />
                                <span className="text-[13px] font-semibold truncate max-w-[160px]">{destino.nombre}</span>
                                <button type="button" aria-label={`Quitar ${destino.nombre}`} onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); guardar(links.filter((_, j) => j !== i)); }}
                                    className="w-8 h-8 grid place-items-center rounded-full hover:bg-[var(--mal)] text-white/85"><Trash2 size={14} /></button>
                            </div>
                        ) : (
                            <button type="button"
                                // Con un aviso de lista, tocar abre el cartel; sin aviso, sigue derecho como siempre.
                                onClick={() => { if (!aviso) { setCartel(null); alSeguir(destino); return; } setCartel((x) => (x === i ? null : i)); }}
                                onMouseEnter={() => setEncima(i)} onMouseLeave={() => setEncima((x) => (x === i ? null : x))}
                                aria-label={aviso ? `${tituloDeAviso(aviso)} en ${destino.nombre}` : `Seguir a ${destino.nombre}`}
                                className={cn("pointer-events-auto relative grid place-items-center w-12 h-12 rounded-full ring-1 transition-transform active:scale-90",
                                    // Sobre el ámbar la tinta va oscura, como la píldora de la silueta: el blanco sobre amarillo no se lee.
                                    aviso?.lista === "amarilla" ? "pleno-aviso ring-white/70" : "text-white",
                                    aviso?.lista === "negra" ? "bg-[var(--mal)] ring-white/70"
                                        : !aviso && alarma ? "bg-[var(--mal)] ring-white/70"
                                            : !aviso ? "visor-panel ring-white/25 hover:ring-white/70" : "")}>
                                <span className={cn("absolute inset-0 rounded-full animate-ping",
                                    aviso ? (aviso.lista === "negra" ? "bg-[var(--mal)]/60" : "bg-[var(--aviso)]/60") : alarma ? "bg-[var(--mal)]/60" : "bg-white/15")} />
                                <Camera size={19} className="relative" />
                                {aviso && (
                                    // El distintivo: sobre un botón ya pintado del color de la lista, un punto del mismo
                                    // color no se ve. Va el escudo en un disco oscuro, y el color adentro.
                                    <span className="absolute -top-1 -right-1 w-5 h-5 grid place-items-center rounded-full bg-black/80 ring-1 ring-white/25">
                                        <ShieldAlert size={12} className={aviso.lista === "negra" ? "text-[var(--mal)]" : "text-[var(--aviso)]"} />
                                    </span>
                                )}
                                {encima === i && !abierto && (
                                    <span className={cn("absolute w-60 rounded-[14px] overflow-hidden visor-panel pointer-events-none text-left", lado)}>
                                        <span className="relative block aspect-video bg-black">
                                            <Vivo src={vivoDe(destino.stream, !h265, hls)} className="absolute inset-0 w-full h-full object-cover" />
                                        </span>
                                        <span className="block px-3 py-2">
                                            <span className="block text-[13px] font-bold text-white truncate">{destino.nombre}</span>
                                            <span className="block text-[11.5px] text-white/65 truncate">
                                                {aviso ? `${tituloDeAviso(aviso)} · tocar para ver` : alarma ? "Está detectando algo · tocar para seguir" : `${ubicacion(destino)} · tocar para seguir`}
                                            </span>
                                        </span>
                                    </span>
                                )}
                            </button>
                        )}
                        {abierto && aviso && (
                            <CartelDeLista aviso={aviso} destino={destino} lado={lado}
                                alSeguir={() => { setCartel(null); alSeguir(destino); }} alCerrar={() => setCartel(null)} />
                        )}
                    </div>
                );
            })}

            {editando && (
                <div className="pointer-events-auto absolute top-24 left-1/2 -translate-x-1/2 w-[min(92%,440px)] rounded-[14px] visor-panel p-3 text-white">
                    <div className="flex items-center gap-2">
                        <Crosshair size={16} className="text-[var(--accion-en-oscuro)]" />
                        <span className="text-[14px] font-bold">Seguimiento visual</span>
                        {guardando && <Loader2 size={14} className="animate-spin text-white/60" />}
                        <button type="button" onClick={() => setAgregando((x) => !x)} className="ml-auto inline-flex items-center gap-1 h-8 px-3 rounded-full bg-[var(--accion)] text-white text-[12.5px] font-semibold"><Plus size={14} /> Agregar cámara</button>
                    </div>
                    <p className="mt-1 text-[12px] text-white/65 leading-snug">Arrastrá cada ícono al lugar de la escena por donde se pasa a esa cámara. En el vivo, tocarlo abre la vecina y esta queda en una esquina para volver.</p>
                    {agregando && (
                        <div className="mt-2 rounded-[10px] bg-black/35 ring-1 ring-white/10">
                            <div className="relative border-b border-white/10">
                                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/50" />
                                <input autoFocus value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar cámara" className="w-full h-9 bg-transparent pl-8 pr-2 text-[13px] outline-none placeholder:text-white/40" />
                            </div>
                            <div className="max-h-52 overflow-y-auto">
                                {candidatos.length === 0 && <div className="px-3 py-2 text-[12px] text-white/45">No hay más cámaras para enlazar.</div>}
                                {candidatos.map((x) => (
                                    <button key={x.clave} type="button" onClick={() => { guardar([...links, { to: idCanal(x), x: 0.5, y: 0.5 }]); setAgregando(false); setBuscar(""); }}
                                        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/10">
                                        <Camera size={13} className="text-white/60 shrink-0" />
                                        <span className="text-[13px] font-semibold truncate">{x.nombre}</span>
                                        <span className="ml-auto text-[11px] text-white/45 truncate">{ubicacion(x)}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

/**
 * El cartel del aviso de lista en una cámara vecina.
 *
 * Contesta las tres preguntas del pedido, en ese orden: qué lista (el badge con su color y el
 * título), si todavía la ve o ya no (con la fecha exacta, no «hace un rato»: en una lista negra
 * la hora es el dato), y cómo se vio (la captura de esa lectura, la misma que está en últimas
 * capturas de esa cámara). Recién al final el botón para irse a esa cámara.
 *
 * No es un diálogo: sale sobre el video en vivo, pegado al ícono que lo abrió, y no tapa la
 * escena. Entra con fundido y escala — es lo que hace que se note sin sonido.
 */
function CartelDeLista({ aviso, destino, lado, alSeguir, alCerrar }: {
    aviso: AvisoVecina; destino: Canal; lado: string;
    alSeguir: () => void; alCerrar: () => void;
}) {
    const [rota, setRota] = useState(false);
    const foto = getImagePath(aviso.foto);
    const negra = aviso.lista === "negra";
    return (
        <div role="dialog" aria-label={tituloDeAviso(aviso)}
            className={cn("pointer-events-auto absolute z-[2] w-72 rounded-[14px] overflow-hidden visor-panel text-left text-white",
                "animate-in fade-in zoom-in-95 duration-200", lado)}>
            <div className={cn("flex items-center gap-2 px-3 h-9", negra ? "pleno-mal" : "pleno-aviso")}>
                <ShieldAlert size={15} className="shrink-0" />
                <span className="text-[12.5px] font-bold truncate">{negra ? (aviso.requerida ? "Requerida · Ministerio" : "Lista negra") : "Alerta Amarilla"}</span>
                <button type="button" onClick={alCerrar} aria-label="Cerrar el aviso"
                    className="ml-auto -mr-1 w-7 h-7 grid place-items-center rounded-full hover:bg-black/15"><X size={14} /></button>
            </div>

            <div className="px-3 pt-2.5 pb-3">
                <p className="text-[13.5px] font-bold leading-tight">{tituloDeAviso(aviso)}</p>
                <p className="mt-1 text-[19px] font-bold tabular-nums tracking-tight">{aviso.plate}</p>

                <div className={cn("mt-2 flex items-start gap-2 text-[12px] leading-snug", aviso.sigue ? "text-white" : "text-white/70")}>
                    {aviso.sigue ? <Eye size={14} className="mt-0.5 shrink-0 text-[var(--bien)]" /> : <EyeOff size={14} className="mt-0.5 shrink-0" />}
                    <span>
                        <span className="block font-semibold">{aviso.sigue ? "Todavía la está viendo" : `Ya no la ve · ${hace(aviso.vistaHasta)}`}</span>
                        <span className="block tabular-nums text-white/60">Última vez {fechaHoraSeg(aviso.vistaHasta)}</span>
                    </span>
                </div>

                {foto && !rota && (
                    <img src={`${foto}${foto.includes("?") ? "&" : "?"}w=560`} alt={`Captura de ${aviso.plate}`} loading="lazy" decoding="async" draggable={false}
                        onError={() => setRota(true)} className="mt-2.5 block w-full aspect-video object-cover rounded-[10px] ring-1 ring-white/15" />
                )}

                <button type="button" onClick={alSeguir}
                    className="mt-2.5 w-full h-9 inline-flex items-center justify-center gap-1.5 rounded-full bg-[var(--accion)] text-white text-[12.5px] font-semibold">
                    <Crosshair size={14} /> Seguir a {destino.nombre}
                </button>
                <p className="mt-1.5 text-[11px] text-white/45 truncate">{ubicacion(destino)}</p>
            </div>
        </div>
    );
}
