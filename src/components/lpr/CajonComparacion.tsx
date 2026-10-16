"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, CircleOff, Inbox, ScanEye, TriangleAlert, XCircle, ZoomIn } from "lucide-react";
import { cn } from "@/lib/utils";
import { Cajon, CajonContenido } from "@/components/ui/cajon";
import { getImagePath } from "@/lib/image-path";

/**
 * La comparación de un paso por la cámara (16/10, Nico: «al abrir un evento, un drawer que
 * realice la comparativa, claramente visible, con zoom en la matrícula, mostrando el resultado de
 * ambos; premium»).
 *
 * Tres que leen la misma chapa, uno al lado del otro y con la misma forma, para que la diferencia
 * salte sin leer: la CÁMARA (su propio registro: la chapa que más repitió en el paso), OMNIACCESS
 * (lo que le llegó por la alarma) y OMNIVISION (la relectura de la foto). Los caracteres que no
 * coinciden con la cámara van en rojo. Arriba, la foto del evento con lupa al pasar el mouse; y
 * los recortes de la chapa —el de la cámara y el de OmniVision— grandes, que es donde se decide
 * quién tenía razón.
 */
export type EventoComparado = {
    id: string; ts: string; plate: string | null; decision: string; sentido: string; foto: string | null; chapaCamara?: string | null;
    vision: { plate: string | null; estado: string; confianza: number | null; recorte?: string | null; chapa?: string | null; otras?: { plate: string; confianza: number }[] } | null;
};
export type PasoComparado = {
    id: string; ts: string; hasta: string; camara: string; estado: "coincide" | "variante" | "distinta" | "perdida" | "solo";
    cam: { plate: string | null; variantes: { plate: string; veces: number }[]; capturas: number; sinLeer: number; pais: string | null; sentido: string | null } | null;
    eventos: EventoComparado[];
};

const VEREDICTO: Record<PasoComparado["estado"], { r: string; texto: string; tono: string; I: typeof CheckCircle2 }> = {
    coincide: { r: "Coinciden", texto: "La cámara leyó y a OmniAccess le llegó la misma chapa.", tono: "pleno-bien", I: CheckCircle2 },
    variante: { r: "Llegó otra lectura", texto: "Llegó una de las lecturas que la cámara hizo en ese paso, pero no la que más repitió.", tono: "pleno-aviso", I: CheckCircle2 },
    distinta: { r: "Chapa distinta", texto: "Llegó un evento con una chapa que la cámara no leyó en ningún momento del paso.", tono: "pleno-aviso", I: TriangleAlert },
    perdida: { r: "No llegó", texto: "La cámara la tiene en su registro y a OmniAccess no le llegó ningún evento.", tono: "pleno-mal", I: XCircle },
    solo: { r: "Sólo en OmniAccess", texto: "OmniAccess tiene el evento y la cámara no lo registra.", tono: "bg-muted text-foreground", I: CircleOff },
};
const NO_LEIDA = /^(NO_LEIDA|UNKNOWN|S\/P)$/i;
const limpia = (p: string | null | undefined) => (p && !NO_LEIDA.test(p) ? p.toUpperCase() : null);
const hhmmss = (iso: string) => new Date(iso).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "America/Montevideo" });
const dia = (iso: string) => new Date(iso).toLocaleDateString("es-UY", { day: "numeric", month: "long", timeZone: "America/Montevideo" });

/** La chapa como chapa: blanca, con el filo azul de las uruguayas, y en rojo lo que no coincide con `contra`. */
export function ChapaGrande({ p, contra, chica }: { p: string | null | undefined; contra?: string | null; chica?: boolean }) {
    const c = limpia(p);
    if (!c) return <span className={cn("inline-flex items-center justify-center rounded-[8px] border-2 border-dashed border-border text-muted-foreground font-semibold", chica ? "h-9 px-3 text-[12px]" : "h-[58px] px-5 text-[14px]")}>sin leer</span>;
    const otra = limpia(contra);
    const igualLargo = !!otra && otra.length === c.length;
    return (
        <span className={cn("inline-flex flex-col items-stretch rounded-[8px] bg-white text-black border-2 border-black/80 overflow-hidden shadow-[0_1px_0_rgba(0,0,0,.08)]", chica ? "min-w-[96px]" : "min-w-[150px]")}>
            <span className={cn("bg-[#1d4ed8]", chica ? "h-1" : "h-1.5")} />
            <span className={cn("px-3 font-extrabold tabular-nums text-center tracking-[0.16em]", chica ? "py-1 text-[15px]" : "py-1.5 text-[26px] leading-none")}>
                {c.split("").map((ch, i) => {
                    const mal = otra && (igualLargo ? otra[i] !== ch : !otra.includes(ch));
                    return <span key={i} className={cn(mal && "text-[var(--mal)] underline decoration-2 underline-offset-4")}>{ch}</span>;
                })}
            </span>
        </span>
    );
}

/** Una foto con lupa: al pasar el mouse, un círculo con 3× de aumento sigue al puntero (la chapa se lee ahí). */
function Lupa({ src, alt }: { src: string; alt: string }) {
    const caja = useRef<HTMLDivElement>(null);
    const img = useRef<HTMLImageElement>(null);
    const [l, setL] = useState<{ px: number; py: number; bw: number; bh: number; bx: number; by: number } | null>(null);
    const AUMENTO = 3, LENTE = 220;
    const mover = (e: React.MouseEvent) => {
        const c = caja.current!.getBoundingClientRect(), r = img.current!.getBoundingClientRect();
        // Relativo a la IMAGEN (puede tener bandas negras por object-contain), no a la caja.
        const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
        const bw = r.width * AUMENTO, bh = r.height * AUMENTO;
        setL({ px: e.clientX - c.left, py: e.clientY - c.top, bw, bh, bx: LENTE / 2 - x * bw, by: LENTE / 2 - y * bh });
    };
    return (
        <div ref={caja} className="relative bg-black cursor-zoom-in select-none overflow-hidden" onMouseLeave={() => setL(null)} onMouseMove={mover}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img ref={img} src={src} alt={alt} draggable={false} className="block mx-auto max-w-full max-h-[46vh] object-contain" />
            {l && (
                <span aria-hidden className="pointer-events-none absolute rounded-full ring-2 ring-white/90 shadow-2xl bg-black"
                    style={{ width: LENTE, height: LENTE, left: l.px - LENTE / 2, top: l.py - LENTE / 2, backgroundImage: `url("${src}")`, backgroundRepeat: "no-repeat",
                        backgroundSize: `${l.bw}px ${l.bh}px`, backgroundPosition: `${l.bx}px ${l.by}px` }} />
            )}
            {!l && <span className="absolute right-3 bottom-3 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-black/60 text-white/85 text-[11px] font-semibold pointer-events-none"><ZoomIn size={12} /> Pasá el mouse para ampliar</span>}
        </div>
    );
}

/** Un recorte de chapa, grande y con fondo negro: el dato crudo de quién leyó. */
function Recorte({ src, rotulo }: { src: string | null | undefined; rotulo: string }) {
    const url = getImagePath(src || null);
    return (
        <figure className="rounded-[10px] bg-black overflow-hidden">
            {url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={url} alt={rotulo} className="block w-full h-[92px] object-contain [image-rendering:auto]" />
            ) : <div className="h-[92px] grid place-items-center text-[11.5px] text-white/40">Sin recorte</div>}
            <figcaption className="px-2.5 py-1.5 text-[10.5px] font-semibold text-white/70 bg-white/[0.04]">{rotulo}</figcaption>
        </figure>
    );
}

export function CajonComparacion({ paso, alCerrar }: { paso: PasoComparado | null; alCerrar: () => void }) {
    const [i, setI] = useState(0);
    useEffect(() => { setI(0); }, [paso?.id]);
    if (!paso) return null;
    const ev = paso.eventos[i] || null;
    const v = VEREDICTO[paso.estado];
    const camPlate = paso.cam?.plate || null;
    const foto = ev?.foto ? getImagePath(ev.foto) : null;
    const demora = ev && paso.cam ? (new Date(ev.ts).getTime() - new Date(paso.ts).getTime()) / 1000 : null;
    const visionPlate = ev?.vision?.plate || null;
    const visionLeyo = !!ev?.vision && (ev.vision.estado === "LEIDA" || ev.vision.estado === "DUDOSA");

    return (
        <Cajon open={!!paso} onOpenChange={(o) => { if (!o) alCerrar(); }}>
            <CajonContenido ancho="medio" titulo={`${paso.camara} · ${hhmmss(paso.ts)}`} descripcion={`${dia(paso.ts)}${paso.cam ? ` · ${paso.cam.capturas} capturas de la cámara en ${Math.max(0, Math.round((new Date(paso.hasta).getTime() - new Date(paso.ts).getTime()) / 1000))} s` : ""}`}
                encabezado={foto ? <Lupa src={foto} alt="Foto del evento" /> : (
                    <div className="h-48 grid place-items-center bg-muted/40 text-[12.5px] text-muted-foreground">{paso.estado === "perdida" ? "No llegó ningún evento: no hay foto de OmniAccess." : "El evento no tiene foto."}</div>
                )}>
                <div className="px-6 py-5 space-y-5">
                    {/* El veredicto, en una franja: lo primero que se quiere saber. */}
                    <div className={cn("flex items-start gap-3 rounded-[12px] px-4 py-3", v.tono)}>
                        <v.I size={20} className="shrink-0 mt-0.5" />
                        <div className="min-w-0">
                            <div className="text-[15px] font-extrabold leading-tight">{v.r}</div>
                            <div className="text-[12.5px] opacity-90 leading-snug">{v.texto}</div>
                        </div>
                    </div>

                    {paso.eventos.length > 1 && (
                        <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[11.5px] text-muted-foreground mr-1">{paso.eventos.length} eventos en este paso:</span>
                            {paso.eventos.map((e, k) => (
                                <button key={e.id} type="button" onClick={() => setI(k)} aria-pressed={k === i}
                                    className={cn("h-8 px-3 rounded-full text-[12px] font-semibold tabular-nums transition-colors", k === i ? "bg-[var(--accion)] text-white" : "bg-muted/60 text-muted-foreground hover:text-foreground")}>
                                    {limpia(e.plate) || "sin leer"} · {hhmmss(e.ts)}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Los tres que leyeron, con la misma forma. */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <Lector icono={Camera} titulo="Leyó la cámara" sub={paso.cam ? `${paso.cam.capturas} capturas${paso.cam.sinLeer ? ` · ${paso.cam.sinLeer} sin leer` : ""}` : "No está en su registro"}>
                            {paso.cam ? <ChapaGrande p={camPlate} /> : <span className="text-[12.5px] text-muted-foreground">—</span>}
                        </Lector>
                        <Lector icono={Inbox} titulo="Recibió OmniAccess" sub={ev ? `${ev.decision === "DENY" ? "Denegado" : "Permitido"}${demora != null ? ` · ${demora.toLocaleString("es-UY", { maximumFractionDigits: 1, signDisplay: "always" })} s` : ""}` : "No llegó"}
                            tono={ev ? (ev.decision === "DENY" ? "tono-mal" : "tono-bien") : "tono-mal"}>
                            {ev ? <ChapaGrande p={ev.plate} contra={camPlate} /> : <span className="inline-flex items-center gap-1 text-[13px] font-semibold tono-mal"><XCircle size={14} /> Nada</span>}
                        </Lector>
                        <Lector icono={ScanEye} titulo="Releyó OmniVision" sub={!ev?.vision ? "No la releyó" : visionLeyo ? `${ev.vision.confianza != null ? `${Math.round(ev.vision.confianza * 100)} %` : ""}${ev.vision.estado === "DUDOSA" ? " · dudosa" : ""}` : ev.vision.estado === "SIN_CHAPA" ? "Sin chapa legible" : ev.vision.estado === "SIN_VEHICULO" ? "No encontró vehículo" : "No pudo"}>
                            {ev?.vision ? <ChapaGrande p={visionLeyo ? visionPlate : null} contra={camPlate || ev.plate} /> : <span className="text-[12.5px] text-muted-foreground">—</span>}
                        </Lector>
                    </div>

                    {/* Los recortes de la chapa, grandes: donde se ve quién tenía razón. */}
                    {(ev?.chapaCamara || ev?.vision?.chapa || ev?.vision?.recorte) && (
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <Recorte src={ev?.chapaCamara} rotulo="Chapa · recorte de la cámara" />
                            <Recorte src={ev?.vision?.chapa} rotulo="Chapa · recorte de OmniVision" />
                            <Recorte src={ev?.vision?.recorte} rotulo="Vehículo · recorte de OmniVision" />
                        </div>
                    )}

                    {/* Lo demás que leyó cada uno. */}
                    {((paso.cam?.variantes.length || 0) > 1 || (ev?.vision?.otras?.length || 0) > 0) && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[12px]">
                            {(paso.cam?.variantes.length || 0) > 1 && (
                                <div>
                                    <div className="text-[11px] font-semibold text-muted-foreground mb-1.5">Todas las lecturas de la cámara en el paso</div>
                                    <div className="flex flex-wrap gap-1.5">{paso.cam!.variantes.map((x) => <span key={x.plate} className="inline-flex items-center gap-1"><ChapaGrande p={x.plate} contra={camPlate} chica /><span className="text-muted-foreground tabular-nums">×{x.veces}</span></span>)}</div>
                                </div>
                            )}
                            {(ev?.vision?.otras?.length || 0) > 0 && (
                                <div>
                                    <div className="text-[11px] font-semibold text-muted-foreground mb-1.5">Otras lecturas de OmniVision</div>
                                    <div className="flex flex-wrap gap-1.5">{ev!.vision!.otras!.map((x) => <span key={x.plate} className="inline-flex items-center gap-1"><ChapaGrande p={x.plate} contra={camPlate} chica /><span className="text-muted-foreground tabular-nums">{Math.round(x.confianza * 100)} %</span></span>)}</div>
                                </div>
                            )}
                        </div>
                    )}
                    <p className="text-[11px] text-muted-foreground">En rojo, los caracteres que no coinciden con lo que leyó la cámara.</p>
                </div>
            </CajonContenido>
        </Cajon>
    );
}

function Lector({ icono: I, titulo, sub, tono, children }: { icono: typeof Camera; titulo: string; sub: string; tono?: string; children: React.ReactNode }) {
    return (
        <div className="rounded-[12px] bg-muted/40 p-3.5 flex flex-col items-center text-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-muted-foreground"><I size={13} /> {titulo}</span>
            {children}
            <span className={cn("text-[11.5px] tabular-nums", tono || "text-muted-foreground")}>{sub}</span>
        </div>
    );
}
