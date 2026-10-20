"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Ban, CheckCircle2, Clock, Film, Info, LogIn, LogOut, Route, ScanLine, ScanSearch, Shapes, Type, UserPlus, Video, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Cajon, CajonContenido } from "@/components/ui/cajon";
import { Pista } from "@/components/ui/pista";
import { VerGrabacion } from "@/components/video/VerGrabacion";
import { metaDe } from "@/components/intrusion/comun";
import { ICONO_GRUPO, img, pct, hora, fecha, duracion, nombreClase } from "@/components/vision/ObjetoRegistro";
import { QuienEs, type ResultadoBusqueda } from "@/components/vision/buscar/MosaicoBuscar";

/**
 * Una pista de OmniVision, en un cajón: lo comparten Detecciones y Buscar.
 *
 * 19/10, Nico: «mirá ese drawer de detecciones, le falta estilo». Tenía razón: abría con un rótulo
 * en mayúsculas («EN EL HISTORIAL»), un párrafo gris y un botón rosa a lo ancho de «lista negra»,
 * y la foto —lo que se vino a ver— quedaba abajo, con una caja azul de 1 px y una explicación
 * de cómo leerla. Ahora sigue el criterio de los otros cajones de Visión (Relecturas,
 * Verificación):
 *  · La foto arriba, a sangre, con la caja y el recorrido; sobre ella, en vidrio oscuro, qué es.
 *  · Una cabecera de identidad: el recorte grande, la clase, la empresa y los rasgos claros.
 *  · Una tira con los números (cuánto estuvo, cuadros, confianza, recorrido).
 *  · Quién era (la chapa que leyó la lectora, de quién es, si está vigilada), contado en una
 *    tarjeta; si no hay lectura, una línea tranquila que lo dice, no un párrafo.
 *  · Rotulado y rasgos, compactos.
 *  · Las acciones en el pie fijo: la grabación en azul (es lo que más se hace), parecidos, y la
 *    lista negra como acción de peligro discreta, no como una franja rosa que gana a todo.
 */
export function CajonPista({ r, alCerrar, alRegistrar, alListaNegra, alParecidos }: {
    r: ResultadoBusqueda | null;
    alCerrar: () => void;
    alRegistrar: (plate: string) => void;
    alListaNegra: () => void;
    alParecidos?: () => void;
}) {
    const [grabacion, setGrabacion] = useState(false);
    if (!r) return null;
    const Ic = ICONO_GRUPO[r.grupo] || Shapes;
    const l = r.historial?.lectura || null;
    const alertas = r.historial?.alertas || [];
    const rasgos = (r.atributos || []).filter((a) => !a.dudoso && !(a.tipo === "si_no" && a.valor === "no"));
    const pie = (
        <>
            <button type="button" onClick={alListaNegra}
                className="mr-auto h-9 px-3 rounded-[8px] text-[12.5px] font-semibold inline-flex items-center gap-1.5 tono-mal hover:bg-[var(--mal-suave)] transition-colors">
                <Ban size={14} /> Lista negra con esta captura
            </button>
            {alParecidos && (
                <button type="button" onClick={alParecidos}
                    className="h-9 px-3.5 rounded-[8px] border border-border text-[12.5px] font-semibold inline-flex items-center gap-1.5 hover:bg-accent">
                    <ScanSearch size={14} /> Parecidos
                </button>
            )}
            {r.deviceId && (
                <button type="button" onClick={() => setGrabacion(true)}
                    className="h-9 px-3.5 rounded-[8px] bg-[var(--accion)] text-white text-[12.5px] font-semibold inline-flex items-center gap-1.5">
                    <Film size={14} /> Ver la grabación
                </button>
            )}
        </>
    );
    return (
        <>
            <Cajon open onOpenChange={(o) => { if (!o) alCerrar(); }}>
                <CajonContenido ancho="intermedio" titulo={`${nombreClase(r.clase)} · ${r.camara}`}
                    descripcion={`${fecha(r.primeraVez)} · ${hora(r.primeraVez)}${r.ultimaVez !== r.primeraVez ? ` a ${hora(r.ultimaVez)}` : ""}`}
                    encabezado={<FotoPista r={r} />} pie={pie}>
                    <div className="px-6 py-5 space-y-5">
                        {/* Qué es: el recorte grande y lo que se sabe de él. */}
                        <div className="flex items-center gap-3.5">
                            <span className="relative h-[88px] w-[88px] shrink-0 rounded-[10px] bg-black overflow-hidden">
                                {r.recorte && (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={img(r.recorte, 320)} alt="" className="absolute inset-0 w-full h-full object-contain" />
                                )}
                            </span>
                            <div className="min-w-0 flex-1 space-y-1.5">
                                <div className="flex items-center gap-2 min-w-0">
                                    <Ic size={17} className="shrink-0 text-muted-foreground" />
                                    <span className="text-[17px] font-bold leading-tight truncate">{nombreClase(r.clase)}</span>
                                    {r.empresa && (
                                        <span className="shrink-0 inline-flex items-center gap-1 h-6 px-2 rounded-md bg-white text-black text-[11.5px] font-bold ring-1 ring-border">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            {r.empresa.logo ? <img src={r.empresa.logo} alt="" className="h-3.5 w-auto max-w-12 object-contain" /> : null}
                                            {r.empresa.nombre}
                                        </span>
                                    )}
                                </div>
                                <div className="text-[12.5px] text-muted-foreground truncate">{r.camara}</div>
                                {rasgos.length > 0 && (
                                    <div className="flex flex-wrap gap-1">
                                        {rasgos.slice(0, 5).map((a) => (
                                            <span key={a.id} title={`${a.nombre}: ${a.valor} ${pct(a.prob)}`} className="inline-flex items-center h-6 px-2 rounded-full bg-muted text-[11.5px] font-semibold">
                                                {a.tipo === "si_no" ? a.nombre.toLowerCase() : a.valor}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Los números, en una tira. */}
                        <div className="grid grid-cols-4 rounded-[10px] border border-border divide-x divide-border">
                            <Dato icono={Clock} valor={duracion(r.primeraVez, r.ultimaVez)} rotulo="a la vista" />
                            <Dato icono={Video} valor={String(r.cuadros)} rotulo={r.cuadros === 1 ? "cuadro" : "cuadros"} />
                            <Dato icono={ScanLine} valor={pct(r.confianza)} rotulo="confianza" />
                            <Dato icono={Route} valor={String(r.recorrido?.length || 0)} rotulo="puntos de recorrido" />
                        </div>

                        {/* Quién era: lo que sabe el historial de ese momento. */}
                        <section className="space-y-2">
                            <Rotulo texto={r.grupo === "vehiculo" ? "Quién era" : "En el historial"}
                                pista="Lo que el sistema sabe de este momento: la chapa que leyó la lectora de esta cámara mientras estaba a la vista, de quién es, si está vigilada, y las alertas de la cámara." />
                            {l ? (
                                <div className="rounded-[12px] border border-border p-3.5 space-y-3">
                                    <QuienEs plate={l.plate} persona={l.persona} vigilancia={l.vigilancia} />
                                    <div className="flex items-center gap-2 text-[12px] text-muted-foreground tabular-nums">
                                        {l.sentido === "EXIT" ? <LogOut size={13} /> : <LogIn size={13} />}
                                        La lectora la leyó {l.sentido === "EXIT" ? "saliendo" : "entrando"} a las {hora(l.ts)}
                                        <span className={cn("ml-auto inline-flex items-center gap-1 h-6 px-2 rounded-full text-[11.5px] font-semibold", l.decision === "DENY" ? "chip-mal" : "chip-bien")}>
                                            {l.decision === "DENY" ? <XCircle size={12} /> : <CheckCircle2 size={12} />}{l.decision === "DENY" ? "Denegado" : "Autorizado"}
                                        </span>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <button type="button" onClick={() => alRegistrar(l.plate)} className="h-8 px-3 rounded-[8px] bg-[var(--accion)] text-white text-[12.5px] font-semibold inline-flex items-center gap-1.5">
                                            <UserPlus size={14} /> {l.persona || l.vigilancia ? "Ver o cambiar registro" : "Registrar matrícula"}
                                        </button>
                                        <Link href={`/admin/history?search=${encodeURIComponent(l.plate)}`} className="h-8 px-3 rounded-[8px] border border-border text-[12.5px] font-semibold inline-flex items-center gap-1.5 hover:bg-accent">
                                            Historial de {l.plate} <ArrowUpRight size={13} />
                                        </Link>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex items-start gap-2.5 rounded-[10px] bg-muted/50 px-3.5 py-3 text-[12.5px] text-muted-foreground leading-snug">
                                    <ScanLine size={15} className="shrink-0 mt-px" />
                                    {r.grupo === "vehiculo" ? "Ninguna lectora leyó una chapa en esta cámara mientras el vehículo estaba a la vista." : "Las personas no se cruzan con las lecturas de chapa: pasar frente a la lectora no hace a nadie dueño de un auto."}
                                </div>
                            )}
                            {alertas.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                    {alertas.slice(0, 6).map((a) => { const m = metaDe(a.tipo); return (
                                        <span key={a.id} className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md chip-aviso text-[12px] font-semibold tabular-nums"><m.Icon size={13} /> {m.label} · {hora(a.ts)}</span>
                                    ); })}
                                </div>
                            )}
                        </section>

                        {r.textos && (
                            <section className="space-y-2">
                                <Rotulo texto="Rotulado" pista="El texto que OmniVision leyó en el vehículo, en un cuadro del stream principal. Si coincide con una empresa del catálogo (nombre o alias), se marca." />
                                {r.textos.length === 0 ? <p className="text-[12.5px] text-muted-foreground">Se buscó y no tenía texto legible.</p> : (
                                    <div className="flex flex-wrap gap-1.5">
                                        {r.textos.map((t, i) => (
                                            <span key={i} className={cn("inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12.5px]", t.empresa ? "chip-bien" : "bg-muted")}>
                                                <Type size={12} className="opacity-60" /><b>{t.texto}</b> <span className="text-[11px] opacity-70 tabular-nums">{pct(t.confianza)}</span>{t.empresa && <span className="text-[11px]">→ {t.empresa.nombre}</span>}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </section>
                        )}

                        <section className="space-y-2">
                            <Rotulo texto="Rasgos" pista="De SigLIP 2 sobre el recorte del mejor cuadro. Lo dudoso va entre signos de pregunta; al pasar el mouse, las otras opciones." />
                            {!r.atributos?.length ? <p className="text-[12.5px] text-muted-foreground">Esta clase no tiene rasgos, o el recorte era muy chico para describirlo.</p> : (
                                <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                                    {r.atributos.map((a) => (
                                        <div key={a.id} className="min-w-0" title={a.opciones.map((o) => `${o.valor} ${pct(o.prob)}`).join(" · ")}>
                                            <dt className="text-[11px] text-muted-foreground truncate">{a.nombre}</dt>
                                            <dd className={cn("text-[13.5px] font-semibold truncate", a.dudoso && "text-muted-foreground")}>
                                                {a.dudoso ? `¿${a.valor}?` : a.valor} <span className="text-[11.5px] font-normal text-muted-foreground tabular-nums">{pct(a.prob)}</span>
                                            </dd>
                                        </div>
                                    ))}
                                </dl>
                            )}
                        </section>
                    </div>
                    {/* Adentro del cajón, como antes: afuera, el cajón modal le quitaba los clics. */}
                    {grabacion && r.deviceId && (
                        <VerGrabacion deviceId={r.deviceId} nombre={r.camara} instanteMs={new Date(r.primeraVez).getTime()} onClose={() => setGrabacion(false)} />
                    )}
                </CajonContenido>
            </Cajon>
        </>
    );
}

/**
 * La foto del mejor momento, a sangre: la caja del objeto y por dónde pasó, y encima, en vidrio
 * oscuro, qué es y con cuánta confianza. La caja y la línea van en una capa del tamaño exacto de
 * la imagen (no del cajón), así no se corren con una foto más angosta que el panel.
 */
function FotoPista({ r }: { r: ResultadoBusqueda }) {
    const Ic = ICONO_GRUPO[r.grupo] || Shapes;
    const caja = r.caja;
    const rec = r.recorrido || [];
    if (!r.foto) return <div className="h-40 grid place-items-center bg-muted/40 text-[12.5px] text-muted-foreground">Sin foto de este momento</div>;
    return (
        <div className="relative bg-black flex justify-center">
            <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img(r.foto, 960)} alt="El mejor momento" className="block max-h-[44vh] w-auto max-w-full" />
                <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none">
                    {rec.length > 1 && <polyline points={rec.map(([x, y]) => `${x},${y}`).join(" ")} fill="none" stroke="var(--aviso)" strokeWidth={2.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" strokeOpacity={0.9} />}
                    {caja && <rect x={caja[0]} y={caja[1]} width={caja[2] - caja[0]} height={caja[3] - caja[1]} rx={0.004} fill="var(--accion-en-oscuro)" fillOpacity={0.12} stroke="var(--accion-en-oscuro)" strokeWidth={2.5} vectorEffect="non-scaling-stroke" />}
                </svg>
            </div>
            <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-black/60 backdrop-blur-sm text-white text-[12px] font-semibold">
                <Ic size={13} /> {nombreClase(r.clase)} <span className="tabular-nums opacity-75">{pct(r.confianza)}</span>
            </span>
            <Pista titulo="Cómo leer la foto" texto="Es el cuadro con mejor confianza de toda la pista. El recuadro es el objeto; la línea amarilla, por dónde pasó (el pie de la caja, cuadro a cuadro).">
                <span className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-full bg-black/60 backdrop-blur-sm text-white/85 cursor-help"><Info size={14} /></span>
            </Pista>
            {rec.length > 1 && (
                <span className="absolute left-3 bottom-3 inline-flex items-center gap-1.5 h-6 px-2 rounded-full bg-black/60 backdrop-blur-sm text-white/90 text-[11px] font-semibold">
                    <span className="h-0.5 w-4 rounded-full bg-[var(--aviso)]" /> recorrido
                </span>
            )}
        </div>
    );
}

function Dato({ icono: I, valor, rotulo }: { icono: typeof Clock; valor: string; rotulo: string }) {
    return (
        <div className="px-3 py-2.5 min-w-0">
            <div className="text-[15px] font-bold tabular-nums leading-tight truncate">{valor}</div>
            <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground truncate max-w-full"><I size={11} className="shrink-0" /> {rotulo}</div>
        </div>
    );
}

function Rotulo({ texto, pista }: { texto: string; pista: string }) {
    return (
        <div className="flex items-center gap-1.5">
            <span className="text-[12px] font-semibold text-muted-foreground">{texto}</span>
            <Pista titulo={texto} texto={pista} ancho={300}><Info size={12} className="text-muted-foreground/60 cursor-help" /></Pista>
        </div>
    );
}
