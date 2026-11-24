"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { IdCard, Loader2, ScanFace, UserPlus, X } from "lucide-react";
import type { CapturaFace } from "@/app/actions/monitor-face";
import { explicarIdentidad, rotuloIdentidad, TONO_IDENTIDAD, type Rafaga, type UmbralesFace } from "@/lib/monitor-face";
import { Button } from "@/components/ui/button";
import { Pista } from "@/components/ui/pista";
import { getImagePath } from "@/lib/image-path";
import { fecha, hora } from "@/lib/fechas";
import { cn } from "@/lib/utils";

/**
 * La captura elegida, con todo lo que se analizó de ella (24/11).
 *
 * La versión anterior mostraba la foto y siete renglones (equipo, credencial, parecido…). Faltaba
 * lo que hace falta para juzgar si el sistema decidió bien: DÓNDE estaba la cara en la escena, de
 * qué tamaño, contra qué umbral se comparó y qué se decidió por eso. Va en ese orden: la escena con
 * la cara marcada, la decisión dicha en una frase con sus números, el parecido sobre la escala de
 * umbrales, y la calidad desarmada en sus partes.
 */

const RESORTE = { type: "spring" as const, bounce: 0, duration: 0.35 };
const SUAVE = { duration: 0.14, ease: "easeOut" as const };
const NOMBRE_TIPO: Record<string, string> = { FACE: "Rostro", TAG: "Tarjeta", PIN: "Clave", FINGERPRINT: "Huella" };

export function HojaCaptura({ r, elegida, umbrales, puede, piso, agregando, alElegir, alCerrar, alVerFicha, alAgregar }: {
    r: Rafaga<CapturaFace>;
    elegida: CapturaFace;
    umbrales: UmbralesFace;
    puede: { verFicha: boolean; registrar: boolean };
    piso: number;
    agregando: boolean;
    alElegir: (id: string) => void;
    alCerrar: () => void;
    alVerFicha: (rostroId: string, registrar: boolean) => void;
    alAgregar: (c: CapturaFace) => void;
}) {
    const quieto = useReducedMotion();
    const p = elegida;
    useEffect(() => {
        const esc = (e: KeyboardEvent) => { if (e.key === "Escape") alCerrar(); };
        document.addEventListener("keydown", esc);
        return () => document.removeEventListener("keydown", esc);
    }, [alCerrar]);
    const todas = [r.cabeza, ...r.resto];
    const nuestra = p.fuente === "omnivision";
    const escena = p.escena || p.foto;

    return (
        <motion.aside
            initial={quieto ? { opacity: 0 } : { x: "100%" }} animate={quieto ? { opacity: 1 } : { x: 0 }}
            exit={quieto ? { opacity: 0 } : { x: "100%" }} transition={quieto ? SUAVE : RESORTE}
            className="absolute right-0 top-0 bottom-0 z-30 w-[min(520px,94vw)] overflow-y-auto border-l border-border bg-card/90 backdrop-blur-xl shadow-[var(--sombra-flotante)]">
            <div className="p-5 space-y-4">
                <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                        <div className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{nuestra ? "Lo vio OmniVision" : "Lo contó el equipo"} · {p.equipo}</div>
                        <h2 className="mt-0.5 truncate text-[21px] font-bold leading-tight tracking-[-0.01em]">{p.persona || "Sin identificar"}</h2>
                        <p className="text-[12.5px] text-muted-foreground tabular-nums">{fecha(p.cuando)} · {hora(p.cuando)}</p>
                    </div>
                    <button type="button" onClick={alCerrar} aria-label="Cerrar"
                        className="h-8 w-8 shrink-0 rounded-full grid place-items-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"><X size={16} /></button>
                </div>

                {/* La escena, con la cara marcada donde la encontró el motor. La imagen va entera (sin
                    recortar) para que el recuadro, en fracciones de la escena, caiga donde corresponde. */}
                {escena && (
                    <div className="relative overflow-hidden rounded-[12px] bg-black [box-shadow:var(--sombra-captura)]">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={getImagePath(escena) || ""} alt="" className="block h-auto w-full" />
                        {p.caja && (
                            <span className="pointer-events-none absolute rounded-[4px] border-2 border-[var(--accion-en-oscuro)] shadow-[0_0_0_1px_rgba(0,0,0,.45)]"
                                style={{ left: `${p.caja[0] * 100}%`, top: `${p.caja[1] * 100}%`, width: `${(p.caja[2] - p.caja[0]) * 100}%`, height: `${(p.caja[3] - p.caja[1]) * 100}%` }} />
                        )}
                        {p.cara && (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img src={getImagePath(p.cara) || ""} alt="La cara" className="absolute bottom-2.5 left-2.5 h-[84px] w-[84px] rounded-[10px] object-cover ring-2 ring-white/80 bg-black" />
                        )}
                        {p.escena && <span className="absolute right-2 top-2 h-[20px] px-1.5 rounded-full bg-black/55 text-white text-[10px] font-bold inline-flex items-center backdrop-blur-md">Cuadro principal</span>}
                    </div>
                )}

                {/* La decisión, dicha con sus números. */}
                <section className="rounded-[12px] border border-border p-3.5">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className={cn("h-[22px] px-2 rounded-full border text-[11px] font-bold inline-flex items-center gap-1", `chip-${TONO_IDENTIDAD[p.identidad]}`)}>
                            <ScanFace size={11} /> {rotuloIdentidad(p)}
                        </span>
                        {p.rostroId && p.persona && <span className="text-[12px] font-semibold tabular-nums">{p.persona}</span>}
                        {p.veces != null && p.veces > 0 && <span className="text-[12px] text-muted-foreground tabular-nums">· {p.veces} {p.veces === 1 ? "visita" : "visitas"}</span>}
                    </div>
                    <p className="mt-2 text-[13px] leading-snug">{explicarIdentidad(p, umbrales)}</p>
                    <Acciones key={p.id} p={p} puede={puede} piso={piso} agregando={agregando} alVerFicha={alVerFicha} alAgregar={alAgregar} />
                </section>

                {nuestra && p.similitud != null && <EscalaParecido valor={p.similitud} u={umbrales} />}
                {nuestra && (p.caraPx != null || p.deteccion != null) && <Calidad p={p} pxMin={umbrales.pxMin} />}

                <dl className="rounded-[12px] border border-border divide-y divide-border overflow-hidden">
                    <Dato k="Equipo" v={p.equipo} />
                    <Dato k="Con qué" v={p.tipo ? NOMBRE_TIPO[p.tipo] || p.tipo : null} />
                    {p.credencial && <Dato k="Credencial" v={p.credencial} />}
                    <Dato k="Decisión" v={p.decision === "GRANT" ? (nuestra ? "Registrada (no es una barrera)" : "Permitido") : p.decision === "DENY" ? "Negado" : p.decision} tono={p.decision === "DENY" ? "mal" : !nuestra && p.decision === "GRANT" ? "bien" : undefined} />
                    {p.sentido && <Dato k="Sentido" v={p.sentido === "ENTRY" ? "Entrada" : p.sentido === "EXIT" ? "Salida" : p.sentido} />}
                    <Dato k="En el padrón" v={p.registrado ? "Sí" : "No figura"} tono={p.registrado ? "bien" : undefined} />
                </dl>

                {/* La ráfaga: las otras capturas de la misma pasada. */}
                {todas.length > 1 && (
                    <section>
                        <h3 className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground">La misma pasada · {todas.length} capturas</h3>
                        <div className="mt-2 grid grid-cols-5 gap-1.5">
                            {todas.map((c) => (
                                <button key={c.id} type="button" onClick={() => alElegir(c.id)} title={`${hora(c.cuando)} · ${rotuloIdentidad(c)}${c.caraPx ? ` · ${c.caraPx} px` : ""}`}
                                    className={cn("relative aspect-square overflow-hidden rounded-[8px] border bg-black", c.id === p.id ? "border-[var(--accion)] ring-2 ring-[var(--accion)]/30" : "border-border hover:border-foreground/30")}>
                                    {(c.cara || c.foto)
                                        /* eslint-disable-next-line @next/next/no-img-element */
                                        ? <img src={getImagePath(c.cara || c.foto) || ""} alt="" loading="lazy" className="h-full w-full object-cover" />
                                        : <ScanFace size={16} className="m-auto text-white/40" />}
                                    {c.caraPx != null && <span className="absolute inset-x-0 bottom-0 bg-black/60 text-[9.5px] font-semibold text-white tabular-nums">{c.caraPx} px</span>}
                                </button>
                            ))}
                        </div>
                    </section>
                )}

                {p.detalle && (
                    <details className="text-[11.5px] text-muted-foreground">
                        <summary className="cursor-pointer font-semibold">{nuestra ? "Lo que escribió OmniVision" : "Lo que escribió el equipo"}</summary>
                        <p className="mt-1.5 break-words leading-snug tabular-nums">{p.detalle}</p>
                    </details>
                )}
            </div>
        </motion.aside>
    );
}

/**
 * Lo que se puede hacer con esta cara. Una identidad: ver su ficha (y registrarla, si no tiene
 * nombre). Una sin comparar: agregarla igual, en dos pasos — el segundo dice a qué se expone quien
 * la agrega, porque una cara chica se confunde y eso no se deshace solo. El mismo criterio que el
 * Monitor Face de pared (components/monitor/vistas/VistaFace.tsx › AccionesRostro).
 */
function Acciones({ p, puede, piso, agregando, alVerFicha, alAgregar }: {
    p: CapturaFace; puede: { verFicha: boolean; registrar: boolean }; piso: number; agregando: boolean;
    alVerFicha: (rostroId: string, registrar: boolean) => void; alAgregar: (c: CapturaFace) => void;
}) {
    /* Se monta de nuevo con cada captura (key={p.id} donde se usa): la confirmación no pasa de una a otra. */
    const [confirmando, setConfirmando] = useState(false);
    if (p.rostroId && puede.verFicha) {
        const sinNombre = !p.registrado && /^R-\d+$/.test(p.persona || "");
        return (
            <div className="mt-3 flex flex-wrap gap-2">
                {sinNombre && puede.registrar && <Button size="sm" onClick={() => alVerFicha(p.rostroId!, true)}><UserPlus size={14} /> Decir quién es</Button>}
                <Button size="sm" variant="outline" onClick={() => alVerFicha(p.rostroId!, false)}><IdCard size={14} /> Ver su ficha</Button>
            </div>
        );
    }
    if (p.identidad !== "sin-cara" || p.fuente !== "omnivision" || !p.cara || !puede.registrar) return null;
    if (p.caraPx != null && p.caraPx < piso) {
        return <p className="mt-2.5 text-[12px] leading-snug text-muted-foreground">No se puede agregar ni a mano: con menos de {piso} px el motor confunde personas distintas.</p>;
    }
    return !confirmando ? (
        <div className="mt-3"><Button size="sm" onClick={() => setConfirmando(true)}><UserPlus size={14} /> Agregar como rostro conocido</Button></div>
    ) : (
        <div className="mt-3 rounded-[10px] bg-muted p-3">
            <p className="text-[12.5px] leading-snug">Se guarda con su número aunque no alcanzó para comparar, y después le ponés el nombre. Con una cara así el motor puede sumarle pasadas de alguien parecido: conviene mirar su ficha cada tanto.</p>
            <div className="mt-2.5 flex gap-2">
                <Button size="sm" disabled={agregando} onClick={() => alAgregar(p)}>{agregando ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />} Agregarla</Button>
                <Button size="sm" variant="ghost" disabled={agregando} onClick={() => setConfirmando(false)}>Cancelar</Button>
            </div>
        </div>
    );
}

/**
 * El parecido sobre la escala de umbrales: dónde cayó esta cara respecto de «se propone unir», «es
 * la misma» y «es del padrón». Un 78 % solo no dice nada; entre el 74 y el 80 dice «casi».
 */
function EscalaParecido({ valor, u }: { valor: number; u: UmbralesFace }) {
    const marcas = [
        { v: u.parecida * 100, rotulo: "se propone unir" },
        { v: u.misma * 100, rotulo: "es la misma" },
        { v: u.padron * 100, rotulo: "padrón" },
    ];
    /* La escala arranca en 30: debajo todo es «no se parece», y abrirla desde 0 aplasta la zona que importa. */
    const DESDE = 30;
    const x = (v: number) => `${Math.max(0, Math.min(100, ((v - DESDE) / (100 - DESDE)) * 100))}%`;
    return (
        <section className="rounded-[12px] border border-border p-3.5">
            <div className="flex items-baseline justify-between">
                <h3 className="text-[12.5px] font-semibold">Parecido</h3>
                <span className="text-[20px] font-bold leading-none tabular-nums tracking-[-0.01em]">{valor} %</span>
            </div>
            <div className="relative mt-4 mb-6 h-1.5 rounded-full bg-muted">
                <span className="absolute inset-y-0 left-0 rounded-full bg-[color-mix(in_oklab,var(--accion)_40%,transparent)]" style={{ width: x(valor) }} />
                {marcas.map((m) => (
                    <span key={m.rotulo} className="absolute -top-1 -translate-x-1/2" style={{ left: x(m.v) }}>
                        <Pista texto={`Desde ${Math.round(m.v)} %: ${m.rotulo}`}>
                            <span className="flex flex-col items-center">
                                <span className="block h-3.5 w-px bg-foreground/50" />
                                <span className="mt-0.5 whitespace-nowrap text-[9.5px] text-muted-foreground tabular-nums">{Math.round(m.v)}</span>
                            </span>
                        </Pista>
                    </span>
                ))}
                <span className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-[var(--accion)]" style={{ left: x(valor) }} />
            </div>
        </section>
    );
}

/** La calidad desarmada: el puntaje y de qué sale (lib/monitor/rostro › calidadRostro). */
function Calidad({ p, pxMin }: { p: CapturaFace; pxMin: number }) {
    const tono = (v: number | null) => (v == null ? "" : v >= 70 ? "pleno-bien" : v >= 45 ? "pleno-aviso" : "pleno-mal");
    const alcanza = p.caraPx != null && p.caraPx >= pxMin;
    return (
        <section className="rounded-[12px] border border-border p-3.5">
            <div className="flex items-baseline justify-between">
                <h3 className="text-[12.5px] font-semibold">Calidad de la captura</h3>
                {p.calidad != null && <span className="text-[20px] font-bold leading-none tabular-nums tracking-[-0.01em]">{p.calidad}<span className="text-[12px] font-semibold text-muted-foreground">/100</span></span>}
            </div>
            <div className="mt-3 space-y-2.5">
                {p.caraPx != null && (
                    <Barra rotulo="Alto de la cara" valor={`${p.caraPx} px`} ayuda={`El motor pide ${pxMin} px para comparar. La raya marca el mínimo.`}
                        lleno={Math.min(100, (p.caraPx / (pxMin * 2)) * 100)} clase={alcanza ? "pleno-bien" : "pleno-aviso"} marca={50} />
                )}
                {p.deteccion != null && <Barra rotulo="Seguridad de que es una cara" valor={`${p.deteccion} %`} ayuda="Qué tan seguro estaba el motor de que lo que encontró es una cara." lleno={p.deteccion} clase={tono(p.deteccion)} />}
                {p.caraFrac != null && <Barra rotulo="Lugar que ocupa en la escena" valor={`${p.caraFrac} %`} ayuda="Alto de la cara sobre el alto de la imagen. De 22 % para arriba ya es un primer plano." lleno={Math.min(100, (p.caraFrac / 22) * 100)} clase={tono(Math.min(100, (p.caraFrac / 22) * 100))} />}
            </div>
        </section>
    );
}

function Barra({ rotulo, valor, ayuda, lleno, clase, marca }: { rotulo: string; valor: string; ayuda: string; lleno: number; clase: string; marca?: number }) {
    return (
        <div>
            <div className="flex items-baseline justify-between text-[11.5px]">
                <Pista texto={ayuda}><span className="text-muted-foreground">{rotulo}</span></Pista>
                <span className="font-semibold tabular-nums">{valor}</span>
            </div>
            <div className="relative mt-1 h-1.5 rounded-full bg-muted">
                <span className={cn("absolute inset-y-0 left-0 rounded-full", clase)} style={{ width: `${Math.max(2, lleno)}%` }} />
                {marca != null && <span className="absolute -top-1 h-3.5 w-px bg-foreground/60" style={{ left: `${marca}%` }} />}
            </div>
        </div>
    );
}

function Dato({ k, v, tono }: { k: string; v: string | null | undefined; tono?: "bien" | "mal" }) {
    return (
        <div className="flex items-baseline gap-3 px-3 py-2 text-[12.5px]">
            <dt className="w-[92px] shrink-0 text-muted-foreground">{k}</dt>
            <dd className={cn("min-w-0 font-semibold", !v && "text-muted-foreground/60 italic font-normal", tono === "bien" && "tono-bien", tono === "mal" && "tono-mal")}>{v || "—"}</dd>
        </div>
    );
}
