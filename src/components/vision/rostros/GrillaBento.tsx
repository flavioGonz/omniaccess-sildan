"use client";

import { motion } from "framer-motion";
import { GitMerge, ImagePlus, ScanFace, Sparkles, UserCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { textoVeces, type FilaRostro } from "@/lib/rostros";
import { TEXTO_PATRON } from "@/lib/rostros-frecuencia";
import type { CapturaSinIdentidad } from "@/app/actions/rostros";

/*
 * Las caras como una grilla de baldosas de distinto tamaño (13/11, Nico: «la sección debe ser una
 * grilla tipo bento, mostrando todas las capturas para vestir más la página»).
 *
 * El tamaño no es decoración: dice a quién mirar primero. Grande, la cara que conviene registrar
 * o la que más viene; ancha, la que el motor duda si es la misma que otra (se ven las dos); el
 * resto, una baldosa. La foto ocupa toda la baldosa —es lo que se viene a mirar— y lo demás va
 * escrito encima, abajo.
 */

/** Cuántas baldosas grandes como mucho: con todas grandes ninguna destaca. */
const GRANDES_MAX = 4;

const hace = (iso: string) => {
    const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    return s < 60 ? "recién" : s < 3600 ? `hace ${Math.round(s / 60)} min` : s < 86400 ? `hace ${Math.round(s / 3600)} h` : `hace ${Math.round(s / 86400)} d`;
};

type Forma = "grande" | "ancha" | "normal";
/** Qué forma le toca a cada cara. Exportada para probarla sin pantalla. */
export function formasBento(rostros: FilaRostro[]): Forma[] {
    // Primero las que conviene registrar, después las habituales: son las que piden una decisión o dicen algo.
    const peso = (r: FilaRostro) => (r.frecuencia.conviene ? 1000 : 0) + (r.frecuencia.patron === "habitual" ? 400 : r.frecuencia.patron === "recurrente" ? 150 : 0) + Math.min(100, r.veces);
    const grandes = new Set(rostros.filter((r) => r.foto && (r.frecuencia.conviene || (r.frecuencia.patron !== "ocasional" && r.frecuencia.patron !== "nueva") || r.veces >= 5))
        .sort((a, b) => peso(b) - peso(a)).slice(0, GRANDES_MAX).map((r) => r.id));
    return rostros.map((r) => (grandes.has(r.id) ? "grande" : r.sugerencia ? "ancha" : "normal"));
}

export function GrillaBento({ rostros, sinIdentidad, alAbrir, alSubir, alAgregarCaptura, puedeCambiar }: {
    rostros: FilaRostro[];
    /** Las pasadas recientes que quedaron sin identidad: van al final, más chicas y apagadas. */
    sinIdentidad: CapturaSinIdentidad[];
    alAbrir: (id: string) => void;
    alSubir?: () => void;
    alAgregarCaptura?: (c: CapturaSinIdentidad) => void;
    puedeCambiar: boolean;
}) {
    const formas = formasBento(rostros);
    return (
        <div className="space-y-6">
            <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(124px,1fr))] [grid-auto-rows:148px] [grid-auto-flow:dense]">
                {alSubir && puedeCambiar && (
                    <button type="button" onClick={alSubir}
                        className="group rounded-[10px] border border-dashed border-border bg-muted/40 hover:bg-[color-mix(in_oklab,var(--accion)_8%,transparent)] hover:border-[var(--accion)] transition-colors grid place-items-center text-center px-3">
                        <span>
                            <span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-card border border-border text-[var(--accion)] transition-transform group-hover:scale-110"><ImagePlus size={18} /></span>
                            <span className="mt-2 block text-[12.5px] font-bold leading-tight">Agregar un rostro</span>
                            <span className="block text-[11px] text-muted-foreground leading-tight mt-0.5">subiendo una foto</span>
                        </span>
                    </button>
                )}
                {rostros.map((r, i) => <Baldosa key={r.id} r={r} forma={formas[i]} orden={i} alAbrir={() => alAbrir(r.id)} />)}
            </div>

            {sinIdentidad.length > 0 && (
                <section>
                    <div className="flex items-baseline gap-2 mb-2.5 flex-wrap">
                        <h3 className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Capturas sin identidad</h3>
                        <span className="text-[11.5px] text-muted-foreground">Pasaron, pero la cara no alcanzó para comparar. {puedeCambiar ? "Si sabés quién es, tocala para agregarla igual; las más chicas no se pueden guardar ni a mano." : ""}</span>
                    </div>
                    <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(84px,1fr))]">
                        {sinIdentidad.map((c) => (
                            <button key={c.eventoId} type="button" disabled={!puedeCambiar || !alAgregarCaptura || !c.agregable} onClick={() => alAgregarCaptura?.(c)}
                                title={`${c.camara || "Cámara"} · ${hace(c.cuando)}${c.motivo ? ` · ${c.motivo}` : ""}${c.agregable ? "" : " · demasiado chica para guardarla, ni a mano"}`}
                                className="group relative aspect-[5/6] overflow-hidden rounded-[6px] bg-muted text-left enabled:cursor-pointer">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={c.cara} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover opacity-75 [filter:saturate(.6)] transition-[opacity,filter] group-enabled:group-hover:opacity-100 group-enabled:group-hover:[filter:none]" />
                                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-1.5 pt-4 pb-1 text-[10.5px] font-semibold text-white tabular-nums leading-tight">
                                    {c.px != null ? `${c.px} px` : "dudosa"}<span className="block font-normal text-white/70">{hace(c.cuando)}</span>
                                </span>
                            </button>
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
}

function Baldosa({ r, forma, orden, alAbrir }: { r: FilaRostro; forma: Forma; orden: number; alAbrir: () => void }) {
    const nombre = r.nombre || r.codigo;
    const grande = forma === "grande", ancha = forma === "ancha";
    const fr = r.frecuencia, tope = Math.max(1, ...fr.tira);
    return (
        <motion.button type="button" onClick={alAbrir} title={`${nombre} · ${textoVeces(r.veces)}`}
            initial={{ opacity: 0, y: 10, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.28, delay: Math.min(orden, 24) * 0.018, ease: [0.22, 1, 0.36, 1] }}
            className={cn("group relative overflow-hidden rounded-[10px] bg-muted text-left [box-shadow:var(--sombra-captura)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accion)]",
                grande && "col-span-2 row-span-2", ancha && "col-span-2")}>
            {ancha && r.sugerencia ? (
                // Las dos caras que el motor duda si son la misma: se comparan de un vistazo.
                <span className="absolute inset-0 grid grid-cols-2">
                    <Foto src={r.foto} />
                    <Foto src={r.sugerencia.foto} apagada />
                    <span className="absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2 h-9 px-2.5 rounded-full pleno-aviso inline-flex items-center gap-1 text-[12px] font-bold tabular-nums [box-shadow:var(--sombra-flotante)]">
                        <GitMerge size={13} /> {Math.round(r.sugerencia.parecido * 100)} %
                    </span>
                </span>
            ) : <Foto src={r.foto} />}

            <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent pointer-events-none" style={{ height: grande ? "62%" : "70%" }} />

            {/* Arriba: lo que pide una decisión. */}
            <span className="absolute left-2 top-2 flex flex-col items-start gap-1">
                {fr.conviene && <span className="h-6 pl-1.5 pr-2 rounded-full pleno-info inline-flex items-center gap-1 text-[11px] font-bold"><Sparkles size={12} /> {grande ? "Conviene registrarla" : "Registrar"}</span>}
                {r.sugerencia && !ancha && <span className="h-6 w-6 rounded-full pleno-aviso grid place-items-center" title={`Se parece a ${r.sugerencia.nombre || r.sugerencia.codigo}`}><GitMerge size={12} /></span>}
            </span>
            {r.veces > 1 && <span className="absolute right-2 top-2 h-6 min-w-6 px-1.5 rounded-full bg-black/65 text-white text-[11.5px] font-bold tabular-nums grid place-items-center" title={textoVeces(r.veces)}>{r.veces}</span>}

            {/* Abajo: quién es y cuánto viene. */}
            <span className={cn("absolute inset-x-0 bottom-0 text-white", grande ? "p-3.5" : "p-2.5")}>
                <span className="flex items-center gap-1.5 min-w-0">
                    {r.registro && <UserCheck size={grande ? 15 : 13} className="shrink-0 text-[var(--bien)]" />}
                    <span className={cn("font-bold truncate leading-tight", grande ? "text-[19px] tracking-[-0.015em]" : "text-[13px]", !r.nombre && "tabular-nums")}>{nombre}</span>
                    {grande && r.nombre && <span className="shrink-0 text-[11px] font-semibold text-white/60 tabular-nums">{r.codigo}</span>}
                </span>
                {ancha && r.sugerencia
                    ? <span className="block text-[11.5px] text-white/75 truncate">¿la misma que {r.sugerencia.nombre || r.sugerencia.codigo}?</span>
                    : <span className="block text-[11.5px] text-white/75 truncate">{textoVeces(r.veces)} · {hace(r.ultimaVez)}</span>}
                {grande && (
                    <>
                        <span className="mt-1 block text-[12px] text-white/85 leading-snug line-clamp-2">{r.veces <= 0 && fr.visitas === 0 ? "Cargada a mano: todavía no pasó por ninguna cámara." : `${TEXTO_PATRON[fr.patron]} · ${fr.texto}`}</span>
                        {/* Las visitas de cada uno de los últimos días, hoy a la derecha: se ve si es «todos los días» o «tres veces un martes». */}
                        <span className="mt-2 flex items-end gap-[3px] h-3.5" aria-hidden>
                            {fr.tira.map((n, i) => <span key={i} className={cn("flex-1 rounded-full", n ? "bg-white/90" : "bg-white/25")} style={{ height: n ? `${Math.max(45, (n / tope) * 100)}%` : 2 }} />)}
                        </span>
                    </>
                )}
            </span>
        </motion.button>
    );
}

function Foto({ src, apagada }: { src: string | null; apagada?: boolean }) {
    return (
        <span className="relative block h-full w-full overflow-hidden">
            {src
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={src} alt="" loading="lazy" className={cn("absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]", apagada && "[filter:saturate(.75)]")} />
                : <span className="absolute inset-0 grid place-items-center text-muted-foreground/50"><ScanFace size={26} /></span>}
        </span>
    );
}
