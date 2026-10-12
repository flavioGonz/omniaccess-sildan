"use client";

import { memo, useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Inbox, List, LayoutGrid, LayoutDashboard, Loader2, ShieldAlert, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { getImagePath } from "@/lib/image-path";
import { fechaCorta, hora } from "@/lib/fechas";
import { Cargando, ErrorEstado, Vacio } from "@/components/ui/estados";
import { Pista } from "@/components/ui/pista";
import { rasgoDe, type FilaHistorial } from "@/components/history/TablaUnificada";
/** Lo que el lector escribe cuando no pudo leer (lo mismo que NO_LEIDAS de lib/relectura, que importa prisma y no entra en el navegador). */
const NO_LEIDAS = new Set(["NO_LEIDA", "UNKNOWN", "S/P"]);
const esNoLeida = (p: string | null | undefined) => NO_LEIDAS.has(String(p || "").toUpperCase());

/**
 * El historial como capturas: grilla (todas del mismo tamaño) y bento (mosaico denso).
 *
 * Traído del historial de Los Olivos (main 1013697), adaptado a este historial, que es otro:
 * acá una fila puede ser un acceso, un avistamiento, una estadía o un «visto», y la tabla ya
 * hace la consulta, el vivo y los filtros. El mosaico no pide nada propio: dibuja las mismas
 * filas que la lista, con el mismo scroll infinito, y abre el mismo visor.
 *
 * Para qué sirve: buscar una captura a ojo («la camioneta blanca de esta mañana») es mirar
 * fotos, y en la lista la foto es una miniatura de 80 px al costado de seis columnas de texto.
 */
export type Vista = "lista" | "grilla" | "bento";
export const VISTAS: { v: Vista; Ico: typeof List; titulo: string; texto: string }[] = [
    { v: "lista", Ico: List, titulo: "Lista", texto: "La tabla, con todos los datos de cada registro." },
    { v: "grilla", Ico: LayoutGrid, titulo: "Grilla", texto: "Las capturas, todas del mismo tamaño." },
    { v: "bento", Ico: LayoutDashboard, titulo: "Bento", texto: "Mosaico denso: más capturas por pantalla. Las denegadas y el merodeo van en grande." },
];
const CLAVE_VISTA = "historial.vista";

/** La vista elegida, recordada en este navegador (es una comodidad de quien mira, no un dato). */
export function useVista(): [Vista, (v: Vista) => void] {
    const [vista, setVista] = useState<Vista>("lista");
    useEffect(() => {
        try { const v = localStorage.getItem(CLAVE_VISTA) as Vista | null; if (v && VISTAS.some((x) => x.v === v)) setVista(v); } catch { /* sin almacenamiento: queda la lista */ }
    }, []);
    const cambiar = (v: Vista) => { setVista(v); try { localStorage.setItem(CLAVE_VISTA, v); } catch { /* idem */ } };
    return [vista, cambiar];
}

/** El selector de vista: tres íconos en un riel; el azul marca la que está puesta. */
export function SelectorVista({ vista, alCambiar }: { vista: Vista; alCambiar: (v: Vista) => void }) {
    return (
        <div className="inline-flex items-center rounded-lg border border-border p-0.5 h-[34px]" role="radiogroup" aria-label="Vista">
            {VISTAS.map(({ v, Ico, titulo, texto }) => (
                <Pista key={v} titulo={titulo} texto={texto}>
                    <button type="button" role="radio" aria-checked={vista === v} aria-label={titulo} onClick={() => alCambiar(v)}
                        className={cn("h-7 w-8 grid place-items-center rounded-md transition-colors",
                            vista === v ? "bg-[var(--accion)] text-white" : "text-muted-foreground hover:text-foreground hover:bg-accent")}>
                        <Ico size={15} />
                    </button>
                </Pista>
            ))}
        </div>
    );
}

/**
 * Ancho con que se pide cada captura. Las fotos de las LPR pesan 1–2 MB; pedirlas enteras
 * para un cuadrito de 150 px es lo que hace que un mosaico de noventa tarde. /api/files las
 * achica con `w` y guarda la miniatura en disco; las rutas que no lo entienden lo ignoran.
 */
const ANCHO = { chica: 260, grande: 520, grilla: 400 };
const conAncho = (url: string, w: number) => `${url}${url.includes("?") ? "&" : "?"}w=${w}`;
/** Cada cuántas tarjetas va una grande aunque no sea denegada: si no, un día tranquilo es un mosaico plano. */
const RITMO_BENTO = 11;
/**
 * Las denegadas van en grande sólo si son la excepción. En Olivos lo son; en un barrio donde la
 * mayoría de las lecturas se deniega (padrón incompleto, visitas sin cargar) ponerlas todas en
 * grande deja una grilla de cuatro columnas que no destaca nada. Con más de esta fracción de
 * denegadas entre los accesos cargados, lo grande queda para el merodeo y el ritmo.
 */
const DENEGADAS_EXCEPCION = 0.5;

const Tarjeta = memo(function Tarjeta({ f, bento, grande, merodea, alAbrir }: {
    f: FilaHistorial; bento: boolean; grande: boolean; merodea: boolean; alAbrir: (f: FilaHistorial) => void;
}) {
    const [cargada, setCargada] = useState(false);
    const url = getImagePath(f.foto);
    const chica = bento && !grande;
    const acceso = f.tipo === "ACCESO";
    const denegado = acceso && f.decision === "DENY";
    const r = rasgoDe(f);
    const leida = !!f.plate && !esNoLeida(f.plate);
    const titulo = leida ? f.plate! : f.persona || "Sin lectura";
    return (
        <button type="button" onClick={() => alAbrir(f)} title={`${titulo} · ${r.rotulo}`}
            className={cn("group relative overflow-hidden rounded-[10px] bg-black text-left ring-1 transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 [content-visibility:auto]",
                denegado || merodea ? "ring-2 ring-[var(--mal)]" : "ring-border hover:ring-[var(--accion)]",
                bento ? (grande ? "col-span-2 row-span-2" : "") : "aspect-video")}>
            {url ? (
                <>
                    {!cargada && <span className="absolute inset-0 animate-pulse bg-white/5" />}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={conAncho(url, bento ? (grande ? ANCHO.grande : ANCHO.chica) : ANCHO.grilla)} alt="" loading="lazy" decoding="async"
                        onLoad={() => setCargada(true)} onError={() => setCargada(true)}
                        className={cn("absolute inset-0 w-full h-full object-cover transition-[opacity,transform] duration-300 group-hover:scale-[1.03]", cargada ? "opacity-100" : "opacity-0")} />
                </>
            ) : <span className="absolute inset-0 grid place-items-center text-white/40"><Camera size={20} /></span>}
            <span className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />

            <span className="absolute top-1.5 left-1.5 right-1.5 flex items-start justify-between gap-1">
                {acceso ? (
                    <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em]", denegado ? "pleno-mal" : "pleno-bien")}>
                        {denegado ? <XCircle size={10} /> : <CheckCircle2 size={10} />}{chica ? "" : denegado ? "Denegado" : "Autorizado"}
                    </span>
                ) : (
                    <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] bg-black/55 text-white">
                        <r.Ico size={10} />{chica ? "" : r.rotulo}
                    </span>
                )}
                {merodea && <span className="grid h-5 w-5 place-items-center rounded-md pleno-mal" title="Merodeo"><ShieldAlert size={11} /></span>}
            </span>

            <span className="absolute bottom-1.5 left-2 right-2 min-w-0">
                <span className={cn("block font-bold tracking-wider text-white truncate tabular-nums", chica ? "text-[12.5px]" : "text-[17px]")}>{titulo}</span>
                <span className={cn("block text-white/75 truncate tabular-nums", chica ? "text-[9.5px]" : "text-[11px]")}>
                    {hora(new Date(f.momento))} · {r.rotulo}{!chica && leida && f.persona ? ` · ${f.persona}` : ""}
                </span>
                {!chica && <span className="block text-[10px] text-white/55 truncate">{fechaCorta(new Date(f.momento))} · {f.camara || "—"}</span>}
            </span>
        </button>
    );
});

export function MosaicoHistorial({ vista, filas, hay, cargando, error, alReintentar, traer, merodeando, alAbrir, barra, pie, alto }: {
    vista: Exclude<Vista, "lista">;
    filas: FilaHistorial[];
    hay: boolean; cargando: boolean; error: string | null;
    alReintentar: () => void;
    /** La página siguiente: la misma que pide la lista al llegar al final. */
    traer: () => void;
    merodeando: Set<string>;
    alAbrir: (f: FilaHistorial) => void;
    barra?: React.ReactNode; pie?: React.ReactNode; alto: string;
}) {
    const bento = vista === "bento";
    const accesos = filas.filter((f) => f.tipo === "ACCESO");
    const destacarDenegadas = !!accesos.length && accesos.filter((f) => f.decision === "DENY").length / accesos.length <= DENEGADAS_EXCEPCION;
    const caja = useRef<HTMLDivElement>(null);
    const centinela = useRef<HTMLDivElement>(null);

    // Scroll infinito: al asomar el final se pide la página siguiente, como en la lista.
    useEffect(() => {
        const el = centinela.current;
        if (!el || !hay || cargando || error) return;
        const io = new IntersectionObserver((e) => { if (e[0]?.isIntersecting) traer(); }, { root: caja.current, rootMargin: "600px 0px" });
        io.observe(el);
        return () => io.disconnect();
    }, [hay, cargando, error, traer, filas.length]);

    return (
        <div className="flex flex-col min-w-0">
            {barra && <div className="shrink-0 pb-3">{barra}</div>}
            {error && !filas.length ? <ErrorEstado mensaje={error} alReintentar={alReintentar} />
                : cargando && !filas.length ? <Cargando texto="Trayendo las capturas…" />
                    : !filas.length ? <Vacio icono={Inbox} titulo="Nada en este período" ayuda="Probá ampliar el rango de fechas, o quitar algún filtro de tipo." />
                        : (
                            <div ref={caja} className="overflow-auto custom-scrollbar pr-1" style={{ maxHeight: alto }}>
                                <div className={cn("grid p-0.5", bento
                                    ? "gap-2 grid-cols-[repeat(auto-fill,minmax(150px,1fr))] auto-rows-[96px] [grid-auto-flow:dense]"
                                    : "gap-3 grid-cols-[repeat(auto-fill,minmax(230px,1fr))]")}>
                                    {filas.map((f, i) => {
                                        const merodea = !!(f.plate && merodeando.has(f.plate));
                                        const grande = bento && ((destacarDenegadas && f.tipo === "ACCESO" && f.decision === "DENY" && !!f.plate && !esNoLeida(f.plate)) || merodea || i % RITMO_BENTO === 0);
                                        return <Tarjeta key={f.id} f={f} bento={bento} grande={grande} merodea={merodea} alAbrir={alAbrir} />;
                                    })}
                                </div>
                                <div ref={centinela} className="h-12 grid place-items-center text-[12px] text-muted-foreground">
                                    {cargando ? <Loader2 size={14} className="animate-spin" /> : !hay ? "No hay más registros en este período." : null}
                                </div>
                            </div>
                        )}
            {pie && <div className="shrink-0 pt-2 text-[11px] text-muted-foreground">{pie}</div>}
        </div>
    );
}
