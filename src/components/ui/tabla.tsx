"use client";

import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Inbox, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Pista } from "@/components/ui/pista";

/**
 * La tabla de la aplicación.
 *
 * Había once, escritas once veces: cinco `<table>` a mano, cuatro con el `<Table>` del
 * sistema de componentes, una lista de `<div>` y una pantalla con seis tablitas distintas
 * adentro. Cada una resolvió por su cuenta el encabezado fijo, el estado vacío, el
 * "cargando", la paginación y las acciones de fila. **Ninguna resolvió el error**: todas
 * hacían `catch(() => {})`, así que un servidor caído se veía exactamente igual que un
 * período sin datos. Eso es lo que se arregla acá una vez y para todas.
 *
 * ── Las columnas se DECLARAN, no se dibujan ─────────────────────────────────
 *
 * Una columna tiene `valor` — el dato, en texto — y opcionalmente `celda`, que dice cómo
 * se ve. Parece un rodeo y no lo es: cuando el texto vive enterrado en el JSX, exportar o
 * copiar obliga a escribir la extracción una segunda vez, en otro archivo, y las dos
 * versiones se desincronizan a la primera columna que cambia. Con `valor` hay una sola
 * fuente, y ordenar, copiar y exportar salen de ella sin trabajo extra.
 *
 * ── Selección por celda ─────────────────────────────────────────────────────
 *
 * Un clic marca una celda, Shift+clic marca el rectángulo, Ctrl/Cmd+C lo copia como TSV
 * — o sea, se pega en una planilla. Es lo que hoy se hace leyendo la pantalla y tipeando
 * en otro lado, que es donde se cometen los errores de transcripción. El resaltado no es
 * decoración: es lo que hace visible qué se va a copiar antes de copiarlo.
 *
 * ── El encabezado fijo ──────────────────────────────────────────────────────
 *
 * `/admin/users` escribió su tabla a mano justo por esto: el `<Table>` del sistema se
 * auto-envuelve en un `div` con `overflow-x-auto`, y ese `div` crea un contexto de
 * desplazamiento que anula el `sticky` del encabezado. Acá el contenedor con scroll es
 * el de la tabla y el encabezado queda pegado adentro de él, que es lo que hay que hacer.
 */

export type Alineacion = "izq" | "centro" | "der";

export type ColumnaTabla<T> = {
    /** Identifica la columna. Se usa para ordenar y para la selección de celdas. */
    clave: string;
    titulo: React.ReactNode;
    /** Una frase que explica qué hay debajo. Aparece al pasar el mouse por el título. */
    ayuda?: React.ReactNode;
    tituloAyuda?: string;
    icono?: React.ComponentType<{ size?: number; className?: string }>;
    alinear?: Alineacion;
    /** Ancho fijo, en px o en cualquier unidad CSS. Sin esto la columna se acomoda sola. */
    ancho?: number | string;
    /** El dato en texto: lo que se ordena, se copia y se exporta. */
    valor?: (fila: T) => string | number | null | undefined;
    /** Cómo se dibuja. Si falta, se dibuja `valor`. */
    celda?: (fila: T) => React.ReactNode;
    ordenable?: boolean;
    /** Columnas que no son datos — acciones, menús. No se copian ni se exportan. */
    auxiliar?: boolean;
    className?: string;
};

export type MasFilas = {
    hay: boolean;
    cargando?: boolean;
    traer: () => void;
    /** "scroll" trae solo al llegar al final; "boton" espera un clic. */
    modo?: "scroll" | "boton";
};

const texto = <T,>(c: ColumnaTabla<T>, f: T) => {
    const v = c.valor?.(f);
    return v == null ? "" : String(v);
};

const alineado: Record<Alineacion, string> = {
    izq: "text-left",
    centro: "text-center",
    der: "text-right",
};

export function Tabla<T>({
    filas,
    clave,
    columnas,
    cargando,
    error,
    alReintentar,
    vacio,
    alClickFila,
    filaActiva,
    filaDestacada,
    expandir,
    masFilas,
    alto,
    seleccionCeldas = true,
    filasFantasma = 8,
    pie,
    barra,
    className,
}: {
    filas: T[];
    clave: (fila: T) => string;
    columnas: ColumnaTabla<T>[];
    cargando?: boolean;
    /** Si viene, manda sobre todo lo demás: no hay datos que mostrar y se sabe por qué. */
    error?: string | null;
    alReintentar?: () => void;
    vacio?: { icono?: React.ComponentType<{ size?: number; className?: string }>; titulo: string; ayuda?: string };
    alClickFila?: (fila: T) => void;
    filaActiva?: (fila: T) => boolean;
    /** Para el destello de una fila que acaba de llegar por el socket. */
    filaDestacada?: (fila: T) => boolean;
    /** Devuelve el contenido desplegado de la fila, o null si está cerrada. */
    expandir?: (fila: T) => React.ReactNode | null;
    masFilas?: MasFilas;
    /** Alto máximo del contenedor. Sin esto la tabla crece y el encabezado se pega a la página. */
    alto?: string;
    seleccionCeldas?: boolean;
    filasFantasma?: number;
    pie?: React.ReactNode;
    /**
     * La barra de herramientas de esta tabla: buscador, filtros, lo que sea.
     *
     * Va ADENTRO del marco y no encima como una tarjeta aparte. Una tarjeta suelta flotando
     * arriba de la tabla se lee como otra cosa que casualmente está cerca; pegada al borde
     * de arriba, con su línea abajo, se lee como los controles de esta tabla — que es lo
     * que son.
     */
    barra?: React.ReactNode;
    className?: string;
}) {
    const [orden, setOrden] = useState<{ clave: string; desc: boolean } | null>(null);
    const [ancla, setAncla] = useState<{ f: number; c: number } | null>(null);
    const [foco, setFoco] = useState<{ f: number; c: number } | null>(null);
    const [copiado, setCopiado] = useState(false);
    const caja = useRef<HTMLDivElement | null>(null);
    const centinela = useRef<HTMLTableRowElement | null>(null);

    const columnasDato = useMemo(() => columnas.filter((c) => !c.auxiliar), [columnas]);

    /**
     * El orden se aplica sobre lo que ya está cargado, no sobre la consulta.
     *
     * Con paginación del servidor eso ordena la página, no el conjunto — y es correcto que
     * así sea mientras la pantalla no mande el orden al servidor. Lo que no se puede es
     * ofrecer ordenar una columna y dar a entender que se ordenó todo.
     */
    const ordenadas = useMemo(() => {
        if (!orden) return filas;
        const col = columnas.find((c) => c.clave === orden.clave);
        if (!col?.valor) return filas;
        const copia = [...filas];
        copia.sort((a, b) => {
            const va = col.valor!(a), vb = col.valor!(b);
            if (va == null && vb == null) return 0;
            if (va == null) return 1;
            if (vb == null) return -1;
            const n = typeof va === "number" && typeof vb === "number"
                ? va - vb
                : String(va).localeCompare(String(vb), "es", { numeric: true });
            return orden.desc ? -n : n;
        });
        return copia;
    }, [filas, orden, columnas]);

    const alternarOrden = (c: ColumnaTabla<T>) => {
        if (!c.ordenable || !c.valor) return;
        setOrden((o) => (o?.clave !== c.clave ? { clave: c.clave, desc: false } : o.desc ? null : { clave: c.clave, desc: true }));
    };

    // ── selección de celdas ─────────────────────────────────────────────────
    const rango = useMemo(() => {
        if (!ancla || !foco) return null;
        return {
            f0: Math.min(ancla.f, foco.f), f1: Math.max(ancla.f, foco.f),
            c0: Math.min(ancla.c, foco.c), c1: Math.max(ancla.c, foco.c),
        };
    }, [ancla, foco]);

    const marcada = (f: number, c: number) =>
        !!rango && f >= rango.f0 && f <= rango.f1 && c >= rango.c0 && c <= rango.c1;

    const tocarCelda = (e: React.MouseEvent, f: number, c: number) => {
        if (!seleccionCeldas) return;
        // Un clic sobre un botón o un enlace de la celda es del botón, no de la selección.
        if ((e.target as HTMLElement).closest("button,a,input,select,[role=button]")) return;
        if (e.shiftKey && ancla) { setFoco({ f, c }); return; }
        setAncla({ f, c });
        setFoco({ f, c });
    };

    const copiar = useCallback(() => {
        if (!rango) return;
        const lineas: string[] = [];
        for (let f = rango.f0; f <= rango.f1; f++) {
            const fila = ordenadas[f];
            if (fila === undefined) continue;
            const celdas: string[] = [];
            for (let c = rango.c0; c <= rango.c1; c++) {
                const col = columnasDato[c];
                // Los tabuladores y los saltos romperían el TSV: se aplastan a un espacio.
                celdas.push(col ? texto(col, fila).replace(/[\t\n\r]+/g, " ") : "");
            }
            lineas.push(celdas.join("\t"));
        }
        try {
            navigator.clipboard?.writeText(lineas.join("\n"));
            setCopiado(true);
            setTimeout(() => setCopiado(false), 1400);
        } catch { }
    }, [rango, ordenadas, columnasDato]);

    useEffect(() => {
        if (!seleccionCeldas) return;
        const tecla = (e: KeyboardEvent) => {
            if (!rango) return;
            // Solo si el foco está adentro de esta tabla: si no, se le roba el copiar a
            // cualquier otra cosa que el operador tenga seleccionada en la página.
            if (!caja.current?.contains(document.activeElement) && !caja.current?.matches(":hover")) return;
            if ((e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "C")) { e.preventDefault(); copiar(); }
            if (e.key === "Escape") { setAncla(null); setFoco(null); }
        };
        window.addEventListener("keydown", tecla);
        return () => window.removeEventListener("keydown", tecla);
    }, [rango, copiar, seleccionCeldas]);

    // La selección se suelta cuando cambian las filas: los índices ya no señalan lo mismo.
    useEffect(() => { setAncla(null); setFoco(null); }, [filas.length]);

    // ── traer más al llegar al final ────────────────────────────────────────
    useEffect(() => {
        if (!masFilas?.hay || masFilas.modo === "boton") return;
        const el = centinela.current;
        if (!el) return;
        const obs = new IntersectionObserver((e) => {
            if (e[0]?.isIntersecting && !masFilas.cargando) masFilas.traer();
        }, { root: caja.current, rootMargin: "240px" });
        obs.observe(el);
        return () => obs.disconnect();
    }, [masFilas?.hay, masFilas?.cargando, masFilas?.traer, masFilas?.modo]);

    const nCol = columnas.length;
    const vacia = !cargando && !error && ordenadas.length === 0;

    return (
        <div className={cn("rounded-xl border border-border bg-card overflow-hidden flex flex-col", className)}>
            {barra && <div className="shrink-0 border-b border-border">{barra}</div>}
            <div ref={caja} className="relative overflow-auto custom-scrollbar" style={{ maxHeight: alto }} tabIndex={-1}>
                <table className="w-full caption-bottom text-sm text-foreground border-separate border-spacing-0">
                    <thead className="sticky top-0 z-20">
                        <tr>
                            {columnas.map((c) => {
                                const activo = orden?.clave === c.clave;
                                const rotulo = (
                                    <span className={cn(
                                        "inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wide font-semibold transition-colors",
                                        activo ? "text-foreground" : "text-muted-foreground",
                                        c.ordenable && c.valor && "cursor-pointer hover:text-foreground",
                                        c.ayuda && "cursor-help",
                                    )}>
                                        {c.icono && <c.icono size={12} className="opacity-70" />}
                                        {c.titulo}
                                        {c.ordenable && c.valor && (activo
                                            ? (orden!.desc ? <ArrowDown size={11} /> : <ArrowUp size={11} />)
                                            : <ArrowUp size={11} className="opacity-0 group-hover/th:opacity-30" />)}
                                    </span>
                                );
                                return (
                                    <th key={c.clave}
                                        onClick={() => alternarOrden(c)}
                                        style={{ width: c.ancho }}
                                        className={cn(
                                            "group/th bg-card px-5 py-3 font-normal border-b border-border select-none",
                                            alineado[c.alinear || "izq"],
                                        )}>
                                        {c.ayuda
                                            ? <Pista titulo={c.tituloAyuda} texto={c.ayuda} lado="abajo">{rotulo}</Pista>
                                            : rotulo}
                                    </th>
                                );
                            })}
                        </tr>
                    </thead>

                    <tbody>
                        {/* ── ERROR ──────────────────────────────────────────────────
                            Primero que todo lo demás. Una tabla vacía por un servidor
                            caído se veía igual que un período sin datos, y son cosas
                            distintas: de una se espera, de la otra se reintenta. */}
                        {error && (
                            <tr>
                                <td colSpan={nCol} className="px-5 py-14">
                                    <div className="flex flex-col items-center gap-2 text-center">
                                        <AlertTriangle size={22} className="text-amber-400" />
                                        <p className="text-[13px] font-semibold text-foreground">No se pudieron traer los datos</p>
                                        <p className="text-[11.5px] text-muted-foreground max-w-sm">{error}</p>
                                        {alReintentar && (
                                            <button type="button" onClick={alReintentar}
                                                className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-[12px] font-semibold hover:bg-accent transition-colors">
                                                <RefreshCw size={12} /> Reintentar
                                            </button>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        )}

                        {/* Filas fantasma: solo cuando no hay nada abajo. Si ya hay filas,
                            la carga es de "más" y va en el centinela del pie. */}
                        {!error && cargando && ordenadas.length === 0 &&
                            Array.from({ length: filasFantasma }).map((_, i) => (
                                <tr key={`f${i}`} className="border-b border-border/60">
                                    {columnas.map((c) => (
                                        <td key={c.clave} className="px-5 py-3.5">
                                            <span className="block h-3.5 rounded bg-muted animate-pulse"
                                                style={{ width: `${45 + ((i * 17 + c.clave.length * 7) % 45)}%`, animationDelay: `${i * 60}ms` }} />
                                        </td>
                                    ))}
                                </tr>
                            ))}

                        {vacia && (
                            <tr>
                                <td colSpan={nCol} className="px-5 py-16">
                                    <div className="flex flex-col items-center gap-2 text-center">
                                        {(() => { const I = vacio?.icono || Inbox; return <I size={22} className="text-muted-foreground/50" />; })()}
                                        <p className="text-[13px] font-semibold text-foreground/80">{vacio?.titulo || "Sin registros"}</p>
                                        {vacio?.ayuda && <p className="text-[11.5px] text-muted-foreground max-w-sm">{vacio.ayuda}</p>}
                                    </div>
                                </td>
                            </tr>
                        )}

                        {!error && ordenadas.map((fila, i) => {
                            const k = clave(fila);
                            const desplegado = expandir?.(fila) ?? null;
                            return (
                                <React.Fragment key={k}>
                                    <tr
                                        onClick={() => alClickFila?.(fila)}
                                        className={cn(
                                            "border-b border-border/60 transition-colors group",
                                            alClickFila && "cursor-pointer",
                                            filaActiva?.(fila) ? "bg-accent" : "hover:bg-accent/50",
                                            filaDestacada?.(fila) && "omni-fila-nueva",
                                        )}>
                                        {columnas.map((c) => {
                                            const iDato = c.auxiliar ? -1 : columnasDato.indexOf(c);
                                            const sel = iDato >= 0 && marcada(i, iDato);
                                            return (
                                                <td key={c.clave}
                                                    data-marcada={sel || undefined}
                                                    onClick={(e) => iDato >= 0 && tocarCelda(e, i, iDato)}
                                                    className={cn(
                                                        "px-5 py-3 align-middle",
                                                        alineado[c.alinear || "izq"],
                                                        sel && "bg-amber-500/25 dark:bg-amber-500/20",
                                                        c.className,
                                                    )}>
                                                    {c.celda ? c.celda(fila) : texto(c, fila)}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                    {desplegado && (
                                        <tr className="border-b border-border/60">
                                            <td colSpan={nCol} className="p-0 bg-muted/30">{desplegado}</td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            );
                        })}

                        {/* El centinela: lo que dispara traer más al acercarse el final. */}
                        {masFilas?.hay && !error && ordenadas.length > 0 && (
                            <tr ref={centinela}>
                                <td colSpan={nCol} className="px-5 py-4 text-center">
                                    {masFilas.modo === "boton" ? (
                                        <button type="button" onClick={masFilas.traer} disabled={masFilas.cargando}
                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-[12px] font-semibold hover:bg-accent transition-colors disabled:opacity-50">
                                            {masFilas.cargando && <Loader2 size={12} className="animate-spin" />} Ver más
                                        </button>
                                    ) : (
                                        <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                            <Loader2 size={12} className="animate-spin" /> Trayendo más…
                                        </span>
                                    )}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {(pie || rango) && (
                <div className="shrink-0 flex items-center gap-3 px-4 py-2 border-t border-border bg-card text-[11px] text-muted-foreground">
                    {pie}
                    {rango && (
                        <span className="ml-auto flex items-center gap-2">
                            <span className="tabular-nums">
                                {(rango.f1 - rango.f0 + 1) * (rango.c1 - rango.c0 + 1)} celdas
                            </span>
                            <button type="button" onClick={copiar}
                                className="px-2 py-0.5 rounded-md border border-border font-semibold hover:bg-accent transition-colors">
                                {copiado ? "Copiado" : "Copiar  (Ctrl+C)"}
                            </button>
                        </span>
                    )}
                </div>
            )}
        </div>
    );
}
