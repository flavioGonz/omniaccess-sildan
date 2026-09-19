"use client";

import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, Columns3, Download, Loader2, Rows3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Pista } from "@/components/ui/pista";
import { ErrorEstado, Vacio } from "@/components/ui/estados";

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

/** Cuánto aire lleva una fila. Se guarda por tabla: cada una se mira distinto. */
const DENSIDADES = {
    holgada: { celda: "px-5 py-3", fila: 3, rotulo: "Holgada" },
    normal: { celda: "px-4 py-2.5", fila: 2, rotulo: "Normal" },
    apretada: { celda: "px-3 py-1.5", fila: 1, rotulo: "Apretada" },
} as const;
type Densidad = keyof typeof DENSIDADES;

/**
 * Lo que el operador ajusta de la tabla, guardado por tabla.
 *
 * Va en el navegador y no en el servidor a propósito: cuánto aire tiene una fila y qué
 * columnas se miran es la preferencia de quien está sentado ahí, no una configuración del
 * barrio. El puesto de la entrada y el del fondo miran cosas distintas, y hacer que uno le
 * cambie la vista al otro sería un error, no una función.
 */
function usarAjustes(id: string | undefined, claves: string[]) {
    const [densidad, setDensidad] = useState<Densidad>("normal");
    const [ocultas, setOcultas] = useState<string[]>([]);
    const [listo, setListo] = useState(false);

    useEffect(() => {
        if (!id) { setListo(true); return; }
        try {
            const g = JSON.parse(localStorage.getItem(`omni.tabla.${id}`) || "{}");
            if (g.densidad && g.densidad in DENSIDADES) setDensidad(g.densidad);
            if (Array.isArray(g.ocultas)) setOcultas(g.ocultas.filter((c: string) => claves.includes(c)));
        } catch { }
        setListo(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

    useEffect(() => {
        if (!id || !listo) return;
        try { localStorage.setItem(`omni.tabla.${id}`, JSON.stringify({ densidad, ocultas })); } catch { }
    }, [id, listo, densidad, ocultas]);

    return { densidad, setDensidad, ocultas, setOcultas };
}

/** Descarga lo que se está viendo, con las columnas que se están viendo. */
function bajarCsv<T>(nombre: string, filas: T[], columnas: ColumnaTabla<T>[]) {
    const esc = (v: string) => /[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    const lineas = [columnas.map((c) => esc(String(c.titulo ?? c.clave))).join(";")];
    for (const f of filas) lineas.push(columnas.map((c) => esc(texto(c, f))).join(";"));
    // El punto y coma y el BOM son para que Excel en español lo abra en columnas y no
    // en una sola con todo adentro, que es como termina el 90% de los CSV.
    const blob = new Blob(["\ufeff" + lineas.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${nombre}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "")}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

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
    id,
    controles = true,
    nombreArchivo,
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
    /** Identifica la tabla para recordar densidad y columnas. Sin esto no se recuerda nada. */
    id?: string;
    /** Los controles propios: densidad, columnas y exportar. */
    controles?: boolean;
    /** Cómo se llama el archivo al exportar. */
    nombreArchivo?: string;
    className?: string;
}) {
    const [orden, setOrden] = useState<{ clave: string; desc: boolean } | null>(null);
    const [ancla, setAncla] = useState<{ f: number; c: number } | null>(null);
    const [foco, setFoco] = useState<{ f: number; c: number } | null>(null);
    const [copiado, setCopiado] = useState(false);
    const caja = useRef<HTMLDivElement | null>(null);
    const centinela = useRef<HTMLTableRowElement | null>(null);

    const { densidad, setDensidad, ocultas, setOcultas } = usarAjustes(id, columnas.map((c) => c.clave));
    const [menu, setMenu] = useState<"" | "columnas" | "densidad">("");

    // Las columnas que de verdad se dibujan. Todo lo demás —el orden, la selección, el
    // CSV— trabaja sobre esta lista, no sobre la original: si no, exportar traería
    // columnas que el operador decidió no mirar.
    const visibles = useMemo(() => columnas.filter((c) => !ocultas.includes(c.clave)), [columnas, ocultas]);
    const columnasDato = useMemo(() => visibles.filter((c) => !c.auxiliar), [visibles]);
    const dens = DENSIDADES[densidad];

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

    const nCol = visibles.length;
    const vacia = !cargando && !error && ordenadas.length === 0;

    return (
        <div className={cn("rounded-xl border border-border bg-card overflow-hidden flex flex-col", className)}>
            {(barra || controles) && (
                <div className="shrink-0 border-b border-border flex items-stretch">
                    <div className="flex-1 min-w-0">{barra}</div>
                    {controles && (
                        /* Los controles de la tabla misma, separados de los filtros por una
                           línea: los filtros dicen QUÉ se mira, éstos CÓMO se mira. Son dos
                           preguntas distintas y mezclarlas hace que cueste encontrar las dos. */
                        <div className="shrink-0 flex items-center gap-0.5 px-1.5 border-l border-border">
                            <div className="relative">
                                <button type="button" onClick={() => setMenu((m) => m === "densidad" ? "" : "densidad")}
                                    title="Cuánto aire lleva cada fila"
                                    className={cn("w-8 h-8 rounded-lg flex items-center justify-center transition-colors",
                                        menu === "densidad" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent")}>
                                    <Rows3 size={14} />
                                </button>
                                {menu === "densidad" && (
                                    <Menu alCerrar={() => setMenu("")}>
                                        {(Object.keys(DENSIDADES) as Densidad[]).map((d) => (
                                            <ItemMenu key={d} activo={densidad === d} onClick={() => { setDensidad(d); setMenu(""); }}>
                                                {DENSIDADES[d].rotulo}
                                            </ItemMenu>
                                        ))}
                                    </Menu>
                                )}
                            </div>

                            <div className="relative">
                                <button type="button" onClick={() => setMenu((m) => m === "columnas" ? "" : "columnas")}
                                    title="Qué columnas se ven"
                                    className={cn("w-8 h-8 rounded-lg flex items-center justify-center transition-colors relative",
                                        menu === "columnas" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent")}>
                                    <Columns3 size={14} />
                                    {ocultas.length > 0 && <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-[var(--accion)]" />}
                                </button>
                                {menu === "columnas" && (
                                    <Menu alCerrar={() => setMenu("")}>
                                        {columnas.map((c) => {
                                            const on = !ocultas.includes(c.clave);
                                            // Quedarse sin ninguna columna deja una tabla que
                                            // no es una tabla, así que la última no se apaga.
                                            const ultima = on && visibles.length <= 1;
                                            return (
                                                <ItemMenu key={c.clave} activo={on} off={ultima}
                                                    onClick={() => setOcultas((o) => on ? [...o, c.clave] : o.filter((k) => k !== c.clave))}>
                                                    {c.titulo}
                                                </ItemMenu>
                                            );
                                        })}
                                    </Menu>
                                )}
                            </div>

                            <button type="button"
                                onClick={() => bajarCsv(nombreArchivo || id || "tabla", ordenadas, columnasDato)}
                                disabled={!ordenadas.length}
                                title="Bajar lo que se está viendo, con las columnas que se están viendo"
                                className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30 disabled:hover:bg-transparent transition-colors">
                                <Download size={14} />
                            </button>
                        </div>
                    )}
                </div>
            )}
            <div ref={caja} className="relative overflow-auto custom-scrollbar" style={{ maxHeight: alto }} tabIndex={-1}>
                <table className="w-full caption-bottom text-sm text-foreground border-separate border-spacing-0">
                    <thead className="sticky top-0 z-20">
                        <tr>
                            {visibles.map((c) => {
                                const activo = orden?.clave === c.clave;
                                /* ── EL ENCABEZADO ─────────────────────────────────
                                   Sin versalitas, sin espaciado extra entre letras y sin
                                   ícono. Estaba en MAYÚSCULAS con `tracking` y un ícono por
                                   columna, y eso hace dos cosas malas a la vez: un renglón
                                   de mayúsculas espaciadas ocupa bastante más ancho que el
                                   mismo texto normal, y pesa visualmente MÁS que los datos
                                   que rotula. Un encabezado de tabla es una etiqueta, no un
                                   título: tiene que poder leerse una vez y después
                                   desaparecer.

                                   Los íconos no agregaban nada que el nombre de la columna
                                   no dijera ya, y ocho íconos en fila compiten con las ocho
                                   miniaturas que hay justo abajo. */
                                const rotulo = (
                                    <span className={cn(
                                        "inline-flex items-center gap-1 text-[12.5px] font-medium transition-colors",
                                        activo ? "text-foreground" : "text-muted-foreground",
                                        c.ordenable && c.valor && "cursor-pointer hover:text-foreground",
                                        c.ayuda && "cursor-help",
                                    )}>
                                        {c.titulo}
                                        {c.ordenable && c.valor && (activo
                                            ? (orden!.desc ? <ArrowDown size={12} /> : <ArrowUp size={12} />)
                                            : <ArrowUp size={12} className="opacity-0 group-hover/th:opacity-30" />)}
                                    </span>
                                );
                                return (
                                    <th key={c.clave}
                                        onClick={() => alternarOrden(c)}
                                        style={{ width: c.ancho }}
                                        className={cn(
                                            "group/th bg-card px-5 py-2 font-normal border-b border-border select-none",
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
                        {/* ── ERROR ──────────────────────────────────────────────────
                            Primero que todo lo demás. Una tabla vacía por un servidor
                            caído se veía igual que un período sin datos, y son cosas
                            distintas: de una se espera, de la otra se reintenta. */}
                        {error && (
                            <tr>
                                <td colSpan={nCol}>
                                    <ErrorEstado mensaje={error} alReintentar={alReintentar || (() => { })} />
                                </td>
                            </tr>
                        )}

                        {/* Filas fantasma: solo cuando no hay nada abajo. Si ya hay filas,
                            la carga es de "más" y va en el centinela del pie. */}
                        {!error && cargando && ordenadas.length === 0 &&
                            Array.from({ length: filasFantasma }).map((_, i) => (
                                <tr key={`f${i}`} className="border-b border-border/60">
                                    {visibles.map((c) => (
                                        <td key={c.clave} className={cn(dens.celda)}>
                                            <span className="block h-3.5 rounded bg-muted animate-pulse"
                                                style={{ width: `${45 + ((i * 17 + c.clave.length * 7) % 45)}%`, animationDelay: `${i * 60}ms` }} />
                                        </td>
                                    ))}
                                </tr>
                            ))}

                        {vacia && (
                            <tr>
                                <td colSpan={nCol}>
                                    <Vacio
                                        icono={vacio?.icono}
                                        titulo={vacio?.titulo || "Sin registros"}
                                        ayuda={vacio?.ayuda}
                                    />
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
                                        {visibles.map((c) => {
                                            const iDato = c.auxiliar ? -1 : columnasDato.indexOf(c);
                                            const sel = iDato >= 0 && marcada(i, iDato);
                                            return (
                                                <td key={c.clave}
                                                    data-marcada={sel || undefined}
                                                    onClick={(e) => iDato >= 0 && tocarCelda(e, i, iDato)}
                                                    className={cn(
                                                        dens.celda, "align-middle",
                                                        alineado[c.alinear || "izq"],
                                                        sel && "bg-[var(--aviso-suave)]",
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

/**
 * Un menú chico colgado de su botón.
 *
 * Se cierra al hacer clic afuera y con Escape. Sin lo primero queda abierto tapando la
 * tabla hasta que alguien se acuerda de apretar el botón otra vez; sin lo segundo, en un
 * teclado no hay forma de cerrarlo.
 */
function Menu({ children, alCerrar }: { children: React.ReactNode; alCerrar: () => void }) {
    const caja = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        const afuera = (e: MouseEvent) => { if (!caja.current?.contains(e.target as Node)) alCerrar(); };
        const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") alCerrar(); };
        // En el siguiente tick: si no, el mismo clic que abrió el menú lo cierra.
        const t = setTimeout(() => document.addEventListener("mousedown", afuera), 0);
        window.addEventListener("keydown", tecla);
        return () => { clearTimeout(t); document.removeEventListener("mousedown", afuera); window.removeEventListener("keydown", tecla); };
    }, [alCerrar]);
    return (
        <div ref={caja}
            className="absolute right-0 top-full mt-1 z-50 min-w-[168px] p-1 rounded-xl border border-border bg-popover shadow-xl">
            {children}
        </div>
    );
}

function ItemMenu({ children, activo, off, onClick }: {
    children: React.ReactNode; activo?: boolean; off?: boolean; onClick: () => void;
}) {
    return (
        <button type="button" onClick={onClick} disabled={off}
            className={cn("w-full flex items-center gap-2 h-8 px-2 rounded-lg text-[12px] font-medium text-left transition-colors",
                off ? "opacity-40 cursor-default" : "hover:bg-accent")}>
            <span className={cn("w-3.5 shrink-0", activo ? "tono-accion" : "opacity-0")}><Check size={13} /></span>
            <span className="truncate">{children}</span>
        </button>
    );
}
