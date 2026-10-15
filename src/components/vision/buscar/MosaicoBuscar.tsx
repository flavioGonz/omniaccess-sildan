"use client";

import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Ban, Camera, CheckCircle2, LogIn, LogOut, ShieldAlert, Shapes, UserPlus, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { getImagePath } from "@/lib/image-path";
import { metaDe } from "@/components/intrusion/comun";
import { rolEtiqueta } from "@/lib/roles-etiquetas";
import { ICONO_GRUPO, img, nombreClase, hora, fecha, type FilaObjeto } from "@/components/vision/ObjetoRegistro";
import { CapaAnalisis } from "@/components/vision/CapaAnalisis";
import { useSiluetas } from "@/lib/use-siluetas";
import type { Analisis } from "@/lib/vision-capa";
import type { HistorialPista, LecturaCruzada, PasoChapa, Persona, Vigilancia } from "@/lib/vision-historial";

/**
 * Los resultados de Buscar como el historial de accesos: un mosaico (bento) de capturas, con lo
 * que el historial sabe de cada una encima (pedido de Nico, 15/10).
 *
 * Antes cada resultado era el RECORTE del objeto dentro de una tarjeta 4:3: una persona o una
 * moto (altas y angostas) quedaban como una franja entre dos barras negras, y abajo, cuatro
 * líneas de texto chico. La foto es lo que se vino a mirar: acá es el cuadro entero de la cámara,
 * acercado al objeto, y el texto va sobre la foto como en el historial.
 *
 * Lo que agrega el historial (ver lib/vision-historial): la chapa que leyó la lectora en ese
 * momento, si entró o no, de quién es y si está vigilada; y las alertas de la cámara.
 */
export type ResultadoBusqueda = FilaObjeto & { coseno: number; prob: number | null; historial: HistorialPista | null };

/** Una pista vista hace menos de esto está «en curso» (el worker la cierra a los 15 s sin verla). */
const EN_CURSO_MS = 20_000;
/** Cada cuántas tarjetas va una grande: si no, un mosaico de iguales no destaca nada. */
const RITMO_BENTO = 9;
/** Lo que ocupa el objeto en la tarjeta: acercarlo hasta acá, sin pasar de ACERCAR_MAX. */
const OCUPA = 0.55;
const ACERCAR_MAX = 3;

export const esNegra = (v: Vigilancia | null | undefined) => v?.categoria === "BLACKLISTED" || v?.categoria === "SEARCH";

/**
 * El cuadro entero acercado al objeto, con su silueta encima (como en el historial).
 *
 * Se arma a mano en vez de con object-fit: la foto va en una caja del tamaño que le toca (cover
 * por ACERCAR, con el centro de la caja del objeto en el centro de la tarjeta, sin dejar bordes
 * vacíos), y la silueta en la MISMA caja, con su misma proporción: así coinciden siempre. Con
 * object-position y un scale() la foto quedaba bien pero la silueta no tenía cómo seguirla.
 * El recorte suelto de antes perdía el contexto: la vereda, el portón, hacia dónde iba.
 */
function FotoAcercada({ f, ancho, siluetas, alCargar }: { f: FilaObjeto; ancho: number; siluetas: boolean; alCargar: () => void }) {
    const caja = useRef<HTMLSpanElement>(null);
    const [tam, setTam] = useState<{ w: number; h: number } | null>(null);
    const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
    const [analisis, setAnalisis] = useState<Analisis | null>(null);
    useLayoutEffect(() => {
        const el = caja.current; if (!el) return;
        const ro = new ResizeObserver(() => setTam({ w: el.clientWidth, h: el.clientHeight }));
        ro.observe(el); setTam({ w: el.clientWidth, h: el.clientHeight });
        return () => ro.disconnect();
    }, []);
    // La silueta se pide sólo con la tarjeta a la vista y las siluetas prendidas.
    useEffect(() => {
        if (!siluetas || !f.foto || !f.caja || analisis) return;
        const el = caja.current; if (!el) return;
        let vivo = true;
        const io = new IntersectionObserver((e) => {
            if (!e[0]?.isIntersecting) return;
            io.disconnect();
            pedirSilueta(f.id).then((a) => { if (vivo && a) setAnalisis(a); });
        }, { rootMargin: "200px 0px" });
        io.observe(el);
        return () => { vivo = false; io.disconnect(); };
    }, [siluetas, f.id, f.foto, f.caja, analisis]);

    const src = f.foto ? img(f.foto, ancho) : f.recorte ? img(f.recorte, ancho) : null;
    if (!src) return <span ref={caja} className="absolute inset-0" />;
    if (!f.foto || !f.caja) {
        return (
            <span ref={caja} className="absolute inset-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={nombreClase(f.clase)} loading="lazy" decoding="async" onLoad={alCargar} onError={alCargar} className="absolute inset-0 w-full h-full object-contain" />
            </span>
        );
    }
    const c = f.caja;
    const W = natural?.w || analisis?.ancho || 16, H = natural?.h || analisis?.alto || 9;
    let estilo: React.CSSProperties = { inset: 0 };
    if (tam?.w && tam.h) {
        const k = Math.max(1, Math.min(ACERCAR_MAX, OCUPA / Math.max(c[2] - c[0], c[3] - c[1], 0.05)));
        const s = Math.max(tam.w / W, tam.h / H) * k, iw = W * s, ih = H * s;
        const bx = (c[0] + c[2]) / 2, by = (c[1] + c[3]) / 2;
        const left = Math.min(0, Math.max(tam.w - iw, tam.w / 2 - bx * iw)), top = Math.min(0, Math.max(tam.h - ih, tam.h / 2 - by * ih));
        estilo = { left, top, width: iw, height: ih };
    }
    return (
        <span ref={caja} className="absolute inset-0 overflow-hidden">
            <span className="absolute" style={estilo}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={nombreClase(f.clase)} loading="lazy" decoding="async"
                    onLoad={(e) => { const i = e.currentTarget; if (i.naturalWidth) setNatural({ w: i.naturalWidth, h: i.naturalHeight }); alCargar(); }} onError={alCargar}
                    className="absolute inset-0 w-full h-full" />
                {siluetas && analisis && analisis.objetos.length > 0 && <CapaAnalisis analisis={analisis} ajuste="contain" etiquetas={false} className="absolute inset-0 w-full h-full pointer-events-none" />}
            </span>
        </span>
    );
}

/**
 * Las siluetas se piden de a dos: cada una es un pedido a omni-vision (~40 ms) que el servidor
 * atiende de a uno. Un mosaico de 60 abre todas a la vez; sin esta fila salían 60 pedidos juntos.
 */
const EN_VUELO_MAX = 2;
let enVuelo = 0;
const esperando: (() => void)[] = [];
const yaPedidas = new Map<string, Promise<Analisis | null>>();
function pedirSilueta(id: string): Promise<Analisis | null> {
    const ya = yaPedidas.get(id); if (ya) return ya;
    const p = new Promise<void>((r) => { if (enVuelo < EN_VUELO_MAX) { enVuelo++; r(); } else esperando.push(() => { enVuelo++; r(); }); })
        .then(() => fetch(`/api/vision/objetos/${encodeURIComponent(id)}/silueta`).then((r) => (r.ok ? r.json() : null)).catch(() => null))
        .finally(() => { enVuelo--; esperando.shift()?.(); });
    // Un 429 o un error no se recuerda: la próxima vez que se vea, se vuelve a pedir.
    p.then((a) => { if (!a) yaPedidas.delete(id); });
    yaPedidas.set(id, p);
    return p;
}

const Tarjeta = memo(function Tarjeta({ r, grande, relevancia, lejos, siluetas, nueva, alAbrir }: {
    r: ResultadoBusqueda; grande: boolean; relevancia: number | null; lejos: boolean; siluetas: boolean;
    /** Llegó en el último refresco (Detecciones en vivo): un anillo que se apaga solo. */
    nueva: boolean;
    alAbrir: (r: ResultadoBusqueda) => void;
}) {
    const [cargada, setCargada] = useState(false);
    const Ic = ICONO_GRUPO[r.grupo] || Shapes;
    const l = r.historial?.lectura || null;
    const negra = esNegra(l?.vigilancia);
    const denegado = l?.decision === "DENY";
    const alerta = r.historial?.alertas?.[0] || null;
    const ma = alerta ? metaDe(alerta.tipo) : null;
    const chica = !grande;
    return (
        <button type="button" onClick={() => alAbrir(r)} title={`${l?.plate || nombreClase(r.clase)} · ${r.camara}`}
            className={cn("group relative overflow-hidden rounded-[8px] bg-black text-left outline-none transition-[box-shadow,opacity] duration-200 hover:ring-2 hover:ring-[var(--accion)] focus-visible:ring-2 focus-visible:ring-[var(--accion)] [content-visibility:auto]",
                grande && "col-span-2 row-span-2", negra && "ring-2 ring-[var(--mal)]", lejos && "opacity-60 hover:opacity-100", nueva && !negra && "ring-2 ring-[var(--accion-en-oscuro)] animate-[pulse_1.2s_ease-in-out_2]")}>
            <span className="absolute inset-0 overflow-hidden">
                {!cargada && <span className="absolute inset-0 animate-pulse bg-white/5" />}
                <span className="absolute inset-0 transition-transform duration-300 group-hover:scale-[1.04]">
                    <FotoAcercada f={r} ancho={grande ? 960 : 640} siluetas={siluetas} alCargar={() => setCargada(true)} />
                </span>
                {!r.foto && !r.recorte && <span className="absolute inset-0 grid place-items-center text-white/40"><Camera size={20} /></span>}
            </span>
            <span className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/15 to-black/25" />

            {/* Arriba: qué es (o qué decidió la lectora), y a la derecha la empresa y cuánto se parece. */}
            <span className="absolute top-1.5 left-1.5 right-1.5 flex items-start justify-between gap-1">
                <span className="flex items-center gap-1 min-w-0">
                    {negra ? (
                        <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] pleno-mal"><Ban size={10} />{chica ? "" : l!.vigilancia!.etiqueta}</span>
                    ) : l ? (
                        <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em]", denegado ? "pleno-mal" : "pleno-bien")}>
                            {denegado ? <XCircle size={10} /> : <CheckCircle2 size={10} />}{chica ? "" : denegado ? "Denegado" : "Autorizado"}
                        </span>
                    ) : null}
                    <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold bg-black/55 text-white truncate">
                        <Ic size={11} />{chica && l ? "" : nombreClase(r.clase)}
                    </span>
                    {ma && <span className="grid h-5 w-5 place-items-center rounded-md pleno-aviso shrink-0" title={`${ma.label} · ${hora(alerta!.ts)}`}><ma.Icon size={11} /></span>}
                    {/* Todavía a la vista de la cámara (el worker cierra la pista a los 15 s sin verla). */}
                    {Date.now() - new Date(r.ultimaVez).getTime() < EN_CURSO_MS && (
                        <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] pleno-bien shrink-0"><span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />{grande ? "en curso" : ""}</span>
                    )}
                </span>
                <span className="flex items-center gap-1 shrink-0">
                    {r.empresa && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-white text-black text-[10px] font-bold max-w-[110px]">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            {r.empresa.logo ? <img src={r.empresa.logo} alt="" className="h-3.5 w-auto max-w-12 object-contain" /> : null}
                            {(!r.empresa.logo || grande) && <span className="truncate">{r.empresa.nombre}</span>}
                        </span>
                    )}
                    {relevancia != null && (
                        <span className="px-1.5 py-0.5 rounded-md bg-black/55 text-white text-[10px] font-bold tabular-nums" title="Cuánto se parece, comparado con el mejor resultado">{Math.round(relevancia * 100)} %</span>
                    )}
                </span>
            </span>

            {/* Abajo: la chapa (si la lectora la leyó) o qué es; cuándo y dónde; quién. */}
            <span className="absolute bottom-1.5 left-2 right-2 min-w-0">
                <span className={cn("block font-bold text-white truncate tabular-nums", l ? "tracking-wider" : "", grande ? "text-[19px]" : "text-[13px]")}>
                    {l ? l.plate : nombreClase(r.clase)}
                </span>
                <span className={cn("block text-white/75 truncate tabular-nums", grande ? "text-[11.5px]" : "text-[10px]")}>
                    {hora(r.primeraVez).slice(0, 5)} · {fecha(r.primeraVez)}{grande || !l ? ` · ${r.camara}` : ""}
                </span>
                {l?.persona && (
                    <span className={cn("block truncate", grande ? "text-[11.5px]" : "text-[10px]", negra ? "text-[color-mix(in_oklab,var(--mal)_45%,white)]" : "text-white/90")}>
                        {l.persona.nombre}{grande ? ` · ${rolEtiqueta(l.persona.rol)}${l.persona.unidad ? ` · ${l.persona.unidad}` : ""}` : ""}
                    </span>
                )}
                {!l?.persona && grande && r.textos && r.textos.length > 0 && !r.empresa && (
                    <span className="block text-[10.5px] text-white/65 truncate">«{r.textos.map((t) => t.texto).join(" · ")}»</span>
                )}
            </span>
        </button>
    );
});

/**
 * El mosaico. Van en grande: los dos primeros (lo más parecido), lo vigilado (lista negra o en
 * búsqueda: es lo que más importa encontrar) y una cada RITMO_BENTO.
 */
export function MosaicoBuscar({ resultados, alAbrir, relativa, lejos = false, atenuado = false, nuevas }: {
    resultados: ResultadoBusqueda[]; alAbrir: (r: ResultadoBusqueda) => void;
    /** Dar el % relativo al primero (texto, foto, parecidos); en la búsqueda por chapa no aplica. */
    relativa: boolean; lejos?: boolean; atenuado?: boolean;
    /** Ids que acaban de llegar (pantalla en vivo). */
    nuevas?: Set<string>;
}) {
    const max = resultados[0]?.coseno || 1, min = resultados[resultados.length - 1]?.coseno ?? 0;
    // La misma preferencia que el historial y el visor: apagarla en uno las apaga en todos.
    const [siluetas] = useSiluetas();
    return (
        <div className={cn("grid gap-2 grid-cols-[repeat(auto-fill,minmax(160px,1fr))] auto-rows-[104px] [grid-auto-flow:dense] transition-opacity", atenuado && "opacity-60")}>
            {resultados.map((r, i) => {
                const grande = !lejos && (i < 2 || esNegra(r.historial?.lectura?.vigilancia) || i % RITMO_BENTO === 0);
                const rel = relativa ? (max > min ? (r.coseno - min) / (max - min) : 1) : null;
                return <Tarjeta key={r.id} r={r} grande={grande} relevancia={rel} lejos={lejos} siluetas={siluetas} nueva={!!nuevas?.has(r.id)} alAbrir={alAbrir} />;
            })}
        </div>
    );
}

/* ─────────────────────────── La ficha: lo que sabe el historial ─────────────────────────── */

function QuienEs({ plate, persona, vigilancia }: { plate: string; persona: Persona | null; vigilancia: Vigilancia | null }) {
    return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center h-8 px-2.5 rounded-md border-2 border-foreground/80 bg-background text-[15px] font-bold tracking-[0.12em] tabular-nums">{plate}</span>
            {persona ? (
                <span className="text-[13px]"><b>{persona.nombre}</b> <span className="text-muted-foreground">· {rolEtiqueta(persona.rol)}{persona.unidad ? ` · ${persona.unidad}` : ""}</span></span>
            ) : <span className="text-[13px] text-muted-foreground">No está en el padrón</span>}
            {vigilancia && (
                <span className={cn("inline-flex items-center gap-1 h-6 px-2 rounded-full text-[11.5px] font-semibold", esNegra(vigilancia) ? "pleno-mal" : "chip-info")}>
                    <ShieldAlert size={12} /> {vigilancia.etiqueta}{vigilancia.motivo ? ` · ${vigilancia.motivo}` : ""}
                </span>
            )}
        </div>
    );
}

/**
 * Lo que el historial dice de la pista, con las acciones: registrar la chapa (residente,
 * personal, proveedor o lista negra: el mismo selector del monitor de LPR), marcar en lista negra
 * con la foto de la captura, e ir al historial de esa matrícula.
 */
export function HistorialDePista({ r, alRegistrar, alListaNegra }: {
    r: ResultadoBusqueda;
    alRegistrar: (plate: string) => void;
    alListaNegra: () => void;
}) {
    const l: LecturaCruzada | null = r.historial?.lectura || null;
    const alertas = r.historial?.alertas || [];
    return (
        <div className="space-y-3">
            {l ? (
                <div className="rounded-[10px] border border-border bg-card p-3 space-y-2.5">
                    <div className="flex items-center gap-2 text-[12px] text-muted-foreground tabular-nums">
                        {l.sentido === "EXIT" ? <LogOut size={13} /> : <LogIn size={13} />}
                        La lectora la leyó {l.sentido === "EXIT" ? "saliendo" : "entrando"} a las {hora(l.ts)}
                        <span className={cn("ml-auto inline-flex items-center gap-1 h-6 px-2 rounded-full text-[11.5px] font-semibold", l.decision === "DENY" ? "chip-mal" : "chip-bien")}>
                            {l.decision === "DENY" ? <XCircle size={12} /> : <CheckCircle2 size={12} />}{l.decision === "DENY" ? "Denegado" : "Autorizado"}
                        </span>
                    </div>
                    <QuienEs plate={l.plate} persona={l.persona} vigilancia={l.vigilancia} />
                    <div className="flex flex-wrap gap-2 pt-0.5">
                        <button type="button" onClick={() => alRegistrar(l.plate)} className="h-8 px-3 rounded-md bg-[var(--accion)] text-white text-[12.5px] font-semibold inline-flex items-center gap-1.5">
                            <UserPlus size={14} /> {l.persona || l.vigilancia ? "Ver o cambiar registro" : "Registrar matrícula"}
                        </button>
                        <Link href={`/admin/history?search=${encodeURIComponent(l.plate)}`} className="h-8 px-3 rounded-md border border-border text-[12.5px] font-semibold inline-flex items-center gap-1.5 hover:bg-accent">
                            Historial de {l.plate} <ArrowUpRight size={13} />
                        </Link>
                    </div>
                </div>
            ) : (
                <p className="text-[12.5px] text-muted-foreground">
                    {r.grupo === "vehiculo" ? "Ninguna lectora leyó una chapa en esta cámara mientras el vehículo estaba a la vista." : "Las personas no se cruzan con las lecturas de chapa: pasar frente a la lectora no hace a nadie dueño de un auto."}
                </p>
            )}
            {alertas.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {alertas.slice(0, 6).map((a) => { const m = metaDe(a.tipo); return (
                        <span key={a.id} className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md chip-aviso text-[12px] font-semibold tabular-nums"><m.Icon size={13} /> {m.label} · {hora(a.ts)}</span>
                    ); })}
                </div>
            )}
            <button type="button" onClick={alListaNegra}
                className="w-full h-9 rounded-md border border-[color-mix(in_oklab,var(--mal)_40%,transparent)] bg-[var(--mal-suave)] tono-mal text-[12.5px] font-semibold inline-flex items-center justify-center gap-1.5 hover:border-[var(--mal)]">
                <Ban size={14} /> Marcar en lista negra con esta captura
            </button>
        </div>
    );
}

/**
 * Buscar una matrícula: sus pasos por las lectoras (el historial de accesos de esa chapa) arriba
 * de las pistas de OmniVision de esos mismos pasos.
 */
export function PasosDeChapa({ pasos, alRegistrar }: { pasos: PasoChapa[]; alRegistrar: (plate: string) => void }) {
    if (!pasos.length) return null;
    const u = pasos[0];
    return (
        <section className="space-y-2.5">
            <div className="rounded-[10px] border border-border bg-card p-3 flex flex-wrap items-center gap-3">
                <QuienEs plate={u.plate} persona={u.persona} vigilancia={u.vigilancia} />
                <span className="text-[12px] text-muted-foreground tabular-nums">{pasos.length} {pasos.length === 1 ? "paso" : "pasos"} por las lectoras</span>
                <span className="ml-auto flex gap-2">
                    <button type="button" onClick={() => alRegistrar(u.plate)} className="h-8 px-3 rounded-md bg-[var(--accion)] text-white text-[12.5px] font-semibold inline-flex items-center gap-1.5">
                        <UserPlus size={14} /> {u.persona || u.vigilancia ? "Ver o cambiar registro" : "Registrar"}
                    </button>
                    <Link href={`/admin/history?search=${encodeURIComponent(u.plate)}`} className="h-8 px-3 rounded-md border border-border text-[12.5px] font-semibold inline-flex items-center gap-1.5 hover:bg-accent">Historial <ArrowUpRight size={13} /></Link>
                </span>
            </div>
            <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(160px,1fr))] auto-rows-[104px]">
                {pasos.map((p) => {
                    const url = getImagePath(p.foto);
                    const den = p.decision === "DENY";
                    return (
                        <Link key={p.id} href={`/admin/history?search=${encodeURIComponent(p.plate)}`} className="group relative overflow-hidden rounded-[8px] bg-black hover:ring-2 hover:ring-[var(--accion)]">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            {url && <img src={`${url}${url.includes("?") ? "&" : "?"}w=400`} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.04]" />}
                            <span className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />
                            <span className={cn("absolute top-1.5 left-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em]", den ? "pleno-mal" : "pleno-bien")}>
                                {den ? <XCircle size={10} /> : <CheckCircle2 size={10} />}{p.sentido === "EXIT" ? "Sale" : "Entra"}
                            </span>
                            <span className="absolute bottom-1.5 left-2 right-2 min-w-0">
                                <span className="block text-[13px] font-bold tracking-wider text-white tabular-nums">{p.plate}</span>
                                <span className="block text-[10px] text-white/75 truncate tabular-nums">{hora(p.ts).slice(0, 5)} · {fecha(p.ts)} · {p.camara || "—"}</span>
                            </span>
                        </Link>
                    );
                })}
            </div>
        </section>
    );
}
