"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { EyeOff, Waypoints, Crown, ShieldAlert, Eye, ArrowDownUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChapaMercosur } from "@/components/tracking/ChapaMercosur";
import { leerDuracion, useTranscurrido } from "@/components/tracking/Cronometro";
import { interioresAdentro } from "@/app/actions/lpr-interiores";
import type { ChapaAdentro } from "@/lib/lpr-interiores";
import { rolEtiqueta } from "@/lib/roles-etiquetas";
import { VisorEventoAcceso } from "@/components/eventos/VisorEventoAcceso";

/**
 * La columna del centro del monitor LPR: las interiores (26/11). Nico: «una tercera columna en el
 * centro, destinada a las LPR interiores, que se pueda ocultar; que contabilice el tiempo de cada
 * matrícula que ve y está dentro; tipo bento, sólo matrículas, con estilo premium».
 *
 * Arriba los cuadros de las cámaras interiores; abajo, las chapas que están adentro, cada una con su
 * reloj. La más reciente va grande (la que el guardia acaba de ver pasar por adentro); el resto en
 * mosaico. El reloj corre desde la entrada si se la registró, o desde que una interior la vio —y lo
 * dice—, porque no es lo mismo «adentro hace 2 h» que «la vemos hace 2 h».
 *
 * Rediseño (27/11, Nico: «le falta diseño, legibilidad, UX a ese bloque central»). Lo medido en la
 * captura: la chapa grande «destacada» ocupaba un tercio de la columna para UNA lectura; los nombres
 * se cortaban («Vanessa Coates · Residente · …»); y el reloj usaba los colores pensados para video
 * (verde y rosa claros) sobre fondo blanco, ilegibles. Ahora es una LISTA: una fila por chapa, con la
 * chapa a la izquierda, quién es y de dónde en el medio (el rol como chip) y el tiempo adentro a la
 * derecha con los tonos de estado del sistema. Arriba, filtros por grupo con su conteo y el orden
 * (recientes o más tiempo adentro), que es lo que el guardia pregunta: «¿quién lleva horas adentro?».
 *
 * Se pide cada REFRESCO_MS y no por socket: las interiores leen por OmniVision (la pasarela) y no
 * todas sus lecturas llegan como evento al monitor.
 */
const REFRESCO_MS = 15_000;

export function ColumnaInteriores({ tiles, camaras, alOcultar, alInvestigar }: {
    tiles: React.ReactNode;
    camaras: number;
    alOcultar: () => void;
    alInvestigar?: (plate: string) => void;
}) {
    const [chapas, setChapas] = useState<ChapaAdentro[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const traer = useCallback(() => {
        interioresAdentro().then((r) => { if (r.ok) { setChapas(r.chapas); setError(null); } else setError(r.error || "No se pudo leer."); }).catch(() => setError("No se pudo leer."));
    }, []);
    useEffect(() => { const t = setTimeout(traer, 0); const iv = setInterval(traer, REFRESCO_MS); return () => { clearTimeout(t); clearInterval(iv); }; }, [traer]);

    const [filtro, setFiltro] = useState<Grupo | "todos">("todos");
    const [orden, setOrden] = useState<"recientes" | "tiempo">("recientes");
    const conteo = useMemo(() => {
        const m: Record<Grupo, number> = { residentes: 0, proveedores: 0, sin: 0, listas: 0 };
        for (const c of chapas || []) m[grupoDe(c)]++;
        return m;
    }, [chapas]);
    const lista = useMemo(() => {
        const xs = (chapas || []).filter((c) => filtro === "todos" || grupoDe(c) === filtro);
        return orden === "tiempo" ? [...xs].sort((a, b) => Date.parse(a.desde) - Date.parse(b.desde)) : xs;
    }, [chapas, filtro, orden]);
    const FILTROS: { v: Grupo | "todos"; r: string; n: number }[] = [
        { v: "todos", r: "Todos", n: chapas?.length || 0 },
        { v: "residentes", r: "Residentes", n: conteo.residentes },
        { v: "proveedores", r: "Proveedores", n: conteo.proveedores },
        { v: "sin", r: "Sin padrón", n: conteo.sin },
        ...(conteo.listas ? [{ v: "listas" as const, r: "En lista", n: conteo.listas }] : []),
    ];

    return (
        <section className="flex flex-col min-h-0 overflow-hidden bg-background">
            <div className="shrink-0 flex items-center gap-2.5 px-4 h-11 border-b border-border">
                <span className="w-7 h-7 rounded-md grid place-items-center border border-border bg-muted text-violet-500"><Waypoints size={15} /></span>
                <h2 className="text-[14px] font-bold">Interiores</h2>
                <span className="text-[11.5px] text-muted-foreground tabular-nums">{camaras} cámara{camaras === 1 ? "" : "s"}</span>
                <span className="ml-auto text-[11.5px] text-muted-foreground tabular-nums"><b className="text-foreground">{chapas?.length ?? "—"}</b> adentro</span>
                <button type="button" onClick={alOcultar} title="Ocultar la columna de interiores" aria-label="Ocultar la columna de interiores"
                    className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"><EyeOff size={14} /></button>
            </div>

            <div className="shrink-0 p-3 border-b border-border">
                <div className={cn("grid gap-2", camaras > 1 ? "grid-cols-2" : "grid-cols-1")}>{tiles}</div>
            </div>

            <div className="shrink-0 px-3 pt-2.5">
                <div className="flex items-center gap-2">
                    <p className="flex items-center gap-1.5 text-[12px] font-bold"><Eye size={13} className="text-muted-foreground" /> Adentro ahora</p>
                    <button type="button" onClick={() => setOrden((o) => (o === "recientes" ? "tiempo" : "recientes"))}
                        title="Cambiar el orden" className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11.5px] font-semibold text-muted-foreground hover:bg-accent hover:text-foreground">
                        <ArrowDownUp size={12} /> {orden === "recientes" ? "Vistas recién" : "Más tiempo adentro"}
                    </button>
                </div>
                {/* Los filtros como pestañas con su número (27/11, Nico: «no me gustan esos chips como
                    controles de filtro»): una sola fila, el conteo grande y el nombre chico, y la elegida
                    subrayada. Se lee como un resumen de quién está adentro antes de tocar nada. */}
                <div className="mt-1 grid border-b border-border" style={{ gridTemplateColumns: `repeat(${FILTROS.length}, minmax(0, 1fr))` }} role="tablist" aria-label="Filtrar">
                    {FILTROS.map((f) => {
                        const activa = filtro === f.v;
                        return (
                            <button key={f.v} type="button" role="tab" aria-selected={activa} onClick={() => setFiltro(f.v)}
                                className={cn("-mb-px flex min-w-0 flex-col items-center gap-0.5 border-b-2 px-1 pb-2 pt-1.5 transition-colors",
                                    activa ? "border-[var(--accion)] text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
                                <span className={cn("text-[17px] font-bold leading-none tabular-nums", activa && "text-[var(--accion)]", f.v === "listas" && f.n > 0 && !activa && "tono-mal")}>{f.n}</span>
                                <span className="w-full truncate text-center text-[10.5px] font-semibold">{f.r}</span>
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3">
                {error && <p className="rounded-[10px] border border-dashed border-border p-4 text-center text-[12px] tono-mal">{error}</p>}
                {!error && chapas && chapas.length === 0 && (
                    <div className="rounded-[14px] border border-dashed border-border p-6 text-center">
                        <Waypoints size={20} className="mx-auto mb-2 text-violet-500/60" />
                        <p className="text-[12.5px] text-muted-foreground">Las interiores no vieron matrículas en las últimas 12 horas.</p>
                    </div>
                )}
                {!error && chapas && chapas.length > 0 && lista.length === 0 && <p className="rounded-[10px] border border-dashed border-border p-4 text-center text-[12px] text-muted-foreground">Nadie de ese grupo adentro.</p>}
                {!chapas && !error && <div className="space-y-1.5">{Array.from({ length: 7 }).map((_, i) => <div key={i} className="h-[58px] rounded-[10px] bg-muted animate-pulse" />)}</div>}
                {lista.length > 0 && (
                    <ul className="space-y-1.5">
                        <AnimatePresence initial={false}>
                            {lista.map((c) => <Fila key={c.plate} c={c} alInvestigar={alInvestigar} />)}
                        </AnimatePresence>
                    </ul>
                )}
            </div>
        </section>
    );
}

type Grupo = "residentes" | "proveedores" | "sin" | "listas";
/** El grupo de cada chapa: la lista manda (es lo que no puede pasar desapercibido), después el padrón. */
const grupoDe = (c: ChapaAdentro): Grupo => (c.lista ? "listas" : !c.quien ? "sin" : /PROV/i.test(c.quien.rol) ? "proveedores" : "residentes");

/** El rol como chip: el tono dice el estado (del padrón, proveedor, sin padrón, en lista), no decora. */
function ChipQuien({ c }: { c: ChapaAdentro }) {
    if (c.lista) return <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-bold", c.lista === "negra" ? "chip-mal" : "chip-aviso")}><ShieldAlert size={10} />Lista {c.lista}</span>;
    if (!c.quien) return <span className="inline-flex shrink-0 rounded-full border px-1.5 py-px text-[10px] font-bold chip-aviso">No está en el padrón</span>;
    const prov = /PROV/i.test(c.quien.rol);
    return <span className={cn("inline-flex shrink-0 rounded-full border px-1.5 py-px text-[10px] font-bold", prov ? "chip-info" : "chip-bien")}>{rolEtiqueta(c.quien.rol)}</span>;
}

/**
 * Cuánto lleva adentro, con los tonos de ESTADO del sistema (se leen en claro y en oscuro). El
 * cronómetro de tracking usa colores claros pensados para ir sobre video: en una tarjeta blanca no se
 * leían. Menos de 15 min, bien; menos de 1 h, info; menos de 3 h, aviso; más, mal.
 */
function Estadia({ desde, es }: { desde: string; es: ChapaAdentro["desdeEs"] }) {
    const ms = useTranscurrido(desde) || 0;
    const min = ms / 60000;
    const tono = min < 15 ? "chip-bien" : min < 60 ? "chip-info" : min < 180 ? "chip-aviso" : "chip-mal";
    return (
        <span className="flex shrink-0 flex-col items-end gap-0.5" title={es === "entrada" ? "Desde que entró por la barrera" : "Sin entrada registrada: desde que una interior la vio"}>
            <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[12.5px] font-bold tabular-nums", tono)}>
                <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />{leerDuracion(ms)}
            </span>
            <span className="text-[10px] text-muted-foreground">{es === "entrada" ? "adentro" : "vista"}</span>
        </span>
    );
}

function Fila({ c, alInvestigar }: { c: ChapaAdentro; alInvestigar?: (plate: string) => void }) {
    const visto = Math.max(0, Math.round((useTranscurrido(c.ultima) || 0) / 60000));
    const hace = visto < 1 ? "recién" : `hace ${visto < 60 ? `${visto} min` : `${Math.floor(visto / 60)} h`}`;
    /**
     * La fila abre la ficha de su última lectura: la MISMA que un evento LPR (26/11, Nico: «las
     * que procesa OmniVision, la ventana modal debe ser igual a la de eventos LPR, sólo cambia el
     * tipo de procesamiento; ese drawer no va para eso»). Antes abría el cajón de investigar.
     */
    const evento = c.ultimaId ? {
        id: c.ultimaId, sinEvento: true, plateDetected: c.plate, snapshotPath: c.foto, imagePath: null,
        timestamp: c.ultima, deviceId: c.deviceId, deviceName: c.camara, decision: null, direction: "INTERIOR", accessType: "PLATE",
        details: `Metodo: RTSP Detect${c.confianza != null ? `, Confianza: ${Math.round(c.confianza * 100)}%` : ""}`,
    } : null;
    const borde = c.lista === "negra" ? "border-[color-mix(in_oklab,var(--mal)_55%,transparent)] bg-[color-mix(in_oklab,var(--mal)_5%,var(--card))]" : c.lista === "amarilla" ? "border-[color-mix(in_oklab,var(--aviso)_55%,transparent)]" : "border-border";
    const nombre = c.quien ? c.quien.nombre : "Sin identificar";
    const boton = (
            <button type="button" onClick={evento ? undefined : () => alInvestigar?.(c.plate)} title={`${c.plate} · ${nombre}${c.quien?.lote ? ` · ${c.quien.lote}` : ""}`}
                className={cn("flex w-full items-center gap-2.5 rounded-[10px] border bg-card px-2.5 py-2 text-left transition-colors hover:border-[color-mix(in_oklab,var(--accion)_50%,transparent)]", borde)}>
                {/* La chapa siempre del mismo ancho: la columna se lee de arriba abajo como una planilla. */}
                <ChapaMercosur plate={c.plate} tamano="chico" className="w-[128px] shrink-0 [&_.chapa-texto]:whitespace-nowrap" />
                <span className="min-w-0 flex-1">
                    <span className={cn("flex min-w-0 items-center gap-1 text-[13px] font-semibold leading-tight", !c.quien && "text-muted-foreground")}>
                        {c.quien?.vip && <Crown size={12} className="shrink-0 text-amber-500" />}
                        <span className="truncate">{nombre}</span>
                    </span>
                    <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                        <ChipQuien c={c} />
                        {c.quien?.lote && <span className="truncate font-semibold text-foreground/80">{c.quien.lote}</span>}
                    </span>
                    <span className="mt-0.5 block truncate text-[10.5px] text-muted-foreground tabular-nums">{hace}{c.veces > 1 ? ` · ${c.veces} veces` : ""}{c.camara ? ` · ${c.camara}` : ""}</span>
                </span>
                <Estadia desde={c.desde} es={c.desdeEs} />
            </button>
    );
    return (
        <motion.li layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ type: "spring", bounce: 0, duration: 0.3 }}>
            {evento ? <VisorEventoAcceso event={evento} timeStatus={null}>{boton}</VisorEventoAcceso> : boton}
        </motion.li>
    );
}
