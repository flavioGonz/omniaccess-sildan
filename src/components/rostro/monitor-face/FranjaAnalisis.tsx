"use client";

import { Info } from "lucide-react";
import type { ResumenFace } from "@/app/actions/monitor-face";
import { Pista } from "@/components/ui/pista";
import { cn } from "@/lib/utils";

/**
 * Lo que se analizó en el período, arriba de las capturas (24/11, Nico: «mejorar… datos analizados
 * de capturas»).
 *
 * Tres preguntas, una por bloque, y cada una con su número al lado del dibujo (nunca sólo color):
 *   1. ¿Qué se decidió con cada cara? — la mezcla, en una barra apilada.
 *   2. ¿De qué tamaño llegan las caras? — en tramos, con la raya del mínimo que pide el motor. Es
 *      LA pregunta del reconocimiento: en el lab, la mitad de las caras del portero no llegaba.
 *   3. ¿Por qué quedaron sin comparar? — chica, dudosa o el motor no la tomó.
 * Cuenta TODAS las del período (lo hace el servidor), no sólo las que entran en pantalla.
 */

const PARTES = [
    { k: "padron", rotulo: "Del padrón", tono: "bien", ayuda: "Se parece a alguien enrolado a mano por encima del umbral del padrón." },
    { k: "misma", rotulo: "Ya vistas", tono: "info", ayuda: "Se parece a una cara que ya pasó antes: se le suma una visita." },
    { k: "nueva", rotulo: "Primera vez", tono: "quieto", ayuda: "No se parece a nadie: nace una identidad nueva, que se reconoce la próxima vez." },
    { k: "sin-cara", rotulo: "Sin comparar", tono: "aviso", ayuda: "La cara no alcanzaba (chica o dudosa): queda la foto, sin saber quién es." },
] as const;

const pct = (n: number, t: number) => (t ? Math.round((100 * n) / t) : 0);
const miles = (n: number) => n.toLocaleString("es-UY");

export function FranjaAnalisis({ r, cargando }: { r: ResumenFace | null; cargando: boolean }) {
    if (!r) return <div className={cn("h-[132px] rounded-[14px] border border-border bg-card", cargando && "animate-pulse")} />;
    const vistas = r.identidades.padron + r.identidades.misma + r.identidades.nueva + r.identidades["sin-cara"];
    const sinComparar = r.identidades["sin-cara"];
    const maxTramo = Math.max(1, ...r.tamanos.map((t) => t.n));
    const caras = r.tamanos.reduce((a, t) => a + t.n, 0);
    const llegan = r.tamanos.filter((t) => t.alcanza).reduce((a, t) => a + t.n, 0);

    return (
        <div className="@container">
            {/* Angosto (un teléfono), los tres bloques se deslizan de costado: apilados se comían la
                primera pantalla entera antes de llegar a una sola cara. */}
            <div className="flex gap-2.5 overflow-x-auto snap-x snap-mandatory scroll-px-6 -mx-6 px-6 pb-1 [scrollbar-width:none] *:min-w-[86%] *:snap-start @3xl:mx-0 @3xl:px-0 @3xl:pb-0 @3xl:scroll-px-0 @3xl:grid @3xl:grid-cols-[1.25fr_1fr_0.9fr] @3xl:overflow-visible @3xl:*:min-w-0">
                {/* 1 · Qué se decidió */}
                <section className="rounded-[14px] border border-border bg-card p-4">
                    <Encabezado titulo="Qué se decidió con cada cara" ayuda="Lo que hizo OmniVision con las caras que vio en el período. Lo que reconoció el propio equipo va aparte, abajo." />
                    {vistas === 0 ? (
                        <p className="mt-3 text-[12.5px] text-muted-foreground">OmniVision no miró caras en este período{r.delEquipo ? "; sólo hay lo que contaron los equipos" : ""}.</p>
                    ) : (
                        <>
                            <div className="mt-3 flex h-3 w-full gap-[2px] overflow-hidden rounded-full" role="img"
                                aria-label={PARTES.map((p) => `${p.rotulo}: ${r.identidades[p.k]}`).join(", ")}>
                                {PARTES.map((p) => r.identidades[p.k] > 0 && (
                                    <span key={p.k} className={`pleno-${p.tono} h-full first:rounded-l-full last:rounded-r-full`} style={{ width: `${Math.max(1.5, pct(r.identidades[p.k], vistas))}%` }} />
                                ))}
                            </div>
                            <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 @lg:grid-cols-4">
                                {PARTES.map((p) => (
                                    <li key={p.k} className="min-w-0">
                                        <Pista texto={p.ayuda} titulo={p.rotulo}>
                                            <span className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                                                <span className={`pleno-${p.tono} h-2 w-2 shrink-0 rounded-full`} />{p.rotulo}
                                            </span>
                                        </Pista>
                                        <p className="mt-0.5 text-[17px] font-bold leading-none tabular-nums tracking-[-0.01em]">
                                            {miles(r.identidades[p.k])}<span className="ml-1 text-[11.5px] font-semibold text-muted-foreground">{pct(r.identidades[p.k], vistas)} %</span>
                                        </p>
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}
                    <p className="mt-3 border-t border-border pt-2.5 text-[11.5px] text-muted-foreground tabular-nums">
                        <b className="font-semibold text-foreground">{miles(r.personas)}</b> {r.personas === 1 ? "persona distinta" : "personas distintas"}
                        {" · "}<b className="font-semibold text-foreground">{miles(r.delEquipo)}</b> contadas por los equipos
                        {r.negadas > 0 && <>{" · "}<b className="font-semibold tono-mal">{miles(r.negadas)}</b> {r.negadas === 1 ? "negada" : "negadas"}</>}
                    </p>
                </section>

                {/* 2 · Tamaño de las caras */}
                <section className="rounded-[14px] border border-border bg-card p-4">
                    <Encabezado titulo="Tamaño de las caras" ayuda={`Alto de la cara, en píxeles del cuadro que miró el motor. Con menos de ${r.pxMin} px el motor confunde personas distintas, y la cara queda sin comparar. Se cambia en Ajustes › Rostros.`} />
                    {caras === 0 ? <p className="mt-3 text-[12.5px] text-muted-foreground">Sin caras medidas en el período.</p> : (
                        <>
                            <div className="mt-3 flex h-[52px] items-end gap-1.5">
                                {r.tamanos.map((t) => (
                                    <Pista key={t.rotulo} texto={`${miles(t.n)} caras de ${t.rotulo}`} className="flex h-full flex-1 flex-col justify-end">
                                        <span className={cn("block w-full rounded-t-[4px]", t.alcanza ? "pleno-bien" : "pleno-aviso")} style={{ height: `${Math.max(4, (100 * t.n) / maxTramo)}%` }} />
                                    </Pista>
                                ))}
                            </div>
                            <div className="mt-1 grid grid-cols-4 gap-1.5 text-[10px] leading-tight text-muted-foreground">
                                {r.tamanos.map((t) => <span key={t.rotulo} className="text-center">{t.rotulo}</span>)}
                            </div>
                            <p className="mt-2.5 text-[11.5px] leading-snug text-muted-foreground">
                                Llegan al mínimo <b className="font-semibold text-foreground tabular-nums">{pct(llegan, caras)} %</b>
                                {r.pxMediana != null && <> · la mitad mide menos de <b className="font-semibold text-foreground tabular-nums">{r.pxMediana} px</b></>}
                                {" "}· se piden <span className="tabular-nums">{r.pxMin} px</span>
                            </p>
                        </>
                    )}
                </section>

                {/* 3 · Por qué sin comparar */}
                <section className="rounded-[14px] border border-border bg-card p-4">
                    <Encabezado titulo="Por qué quedaron sin comparar" ayuda="Las capturas que quedaron con foto pero sin saber quién es. Una cara chica se arregla acercando la cámara a donde se para la gente, o con una lente más cerrada." />
                    <p className="mt-2 text-[24px] font-bold leading-none tabular-nums tracking-[-0.02em]">
                        {miles(sinComparar)}<span className="ml-1.5 text-[12px] font-semibold text-muted-foreground">{pct(sinComparar, vistas)} % de las caras</span>
                    </p>
                    <dl className="mt-3 space-y-1.5 text-[12px]">
                        <Motivo k="Cara chica" n={r.motivos.chica} t={sinComparar} />
                        <Motivo k="Cara dudosa" n={r.motivos.dudosa} t={sinComparar} />
                        <Motivo k="El motor no la tomó" n={r.motivos.motor} t={sinComparar} />
                    </dl>
                </section>
            </div>
        </div>
    );
}

function Encabezado({ titulo, ayuda }: { titulo: string; ayuda: string }) {
    return (
        <div className="flex items-center gap-1.5">
            <h3 className="text-[12.5px] font-semibold">{titulo}</h3>
            <Pista texto={ayuda} titulo={titulo} ancho={280}><Info size={12} className="text-muted-foreground" /></Pista>
        </div>
    );
}

function Motivo({ k, n, t }: { k: string; n: number; t: number }) {
    return (
        <div className="flex items-center gap-2">
            <dt className="w-[118px] shrink-0 text-muted-foreground">{k}</dt>
            <dd className="flex min-w-0 flex-1 items-center gap-2">
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full pleno-aviso" style={{ width: `${pct(n, t)}%` }} /></span>
                <span className="w-[42px] shrink-0 text-right font-semibold tabular-nums">{miles(n)}</span>
            </dd>
        </div>
    );
}
