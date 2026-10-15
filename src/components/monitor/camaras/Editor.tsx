"use client";

import { useMemo, useState } from "react";
import { X, Search, Save, Trash2, Loader2, Server, Plus, ShieldAlert, Car, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DISPOSICIONES, disposicionDe, NOMBRE_VISTA_MAX, type VistaCamaras } from "@/lib/monitor/disposiciones";
import { guardarVistaCamaras, borrarVistaCamaras } from "@/app/actions/monitores";
import { Foto, Glifo, estiloCasilla, fotoDe, ubicacion, grupoDe, type Canal } from "./piezas";
import { cn } from "@/lib/utils";

/**
 * Diseñar una vista, como en un NVR: se elige la disposición y qué canal va en cada casilla.
 *
 * Dos formas de poner un canal, porque la pared puede ser táctil o tener mouse:
 *  · tocar una casilla y después un canal de la lista (y la selección pasa a la próxima vacía);
 *  · arrastrar un canal de la lista a una casilla, o una casilla sobre otra para cambiarlas.
 *
 * Las casillas muestran la FOTO del canal, no el vivo: mientras se diseña no hace falta, y con
 * 25 casillas sería abrir 25 vivos para nada.
 */

/** Cada cuánto se renueva la foto de una casilla mientras se diseña. */
const FOTO_EDITOR_MS = 30_000;
const ARRASTRE = "text/omni-canal";

export function EditorVista({ inicial, canales, alSalir }: {
    inicial: VistaCamaras;
    canales: Canal[];
    /** Al terminar: la vista guardada (para mostrarla), "borrada", o null si se canceló. */
    alSalir: (r: VistaCamaras | "borrada" | null) => void;
}) {
    const [b, setB] = useState<VistaCamaras>(inicial);
    const [sel, setSel] = useState<number>(() => Math.max(0, inicial.canales.findIndex((x) => !x)));
    const [buscar, setBuscar] = useState("");
    const [guardando, setGuardando] = useState(false);
    const [borrar, setBorrar] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const d = disposicionDe(b.disposicion);
    const porClave = useMemo(() => new Map(canales.map((c) => [c.clave, c])), [canales]);
    const usados = new Set(b.canales.filter(Boolean) as string[]);

    const cambiarDisposicion = (clave: string) => {
        const n = disposicionDe(clave).casillas.length;
        // Se conservan las primeras: achicar no borra lo elegido en las casillas que siguen existiendo.
        setB((x) => ({ ...x, disposicion: clave, canales: Array.from({ length: n }, (_, i) => x.canales[i] ?? null) }));
        setSel((s) => Math.min(s, n - 1));
    };
    const poner = (i: number, clave: string | null) => setB((x) => {
        const canales = [...x.canales];
        // Un canal va una sola vez por vista: si ya estaba en otra casilla, se mueve.
        if (clave) { const j = canales.indexOf(clave); if (j >= 0 && j !== i) canales[j] = canales[i]; }
        canales[i] = clave;
        return { ...x, canales };
    });
    const elegir = (clave: string) => {
        poner(sel, clave);
        const sig = b.canales.findIndex((x, i) => i > sel && !x);
        if (sig >= 0) setSel(sig);
    };
    const soltar = (i: number, e: React.DragEvent) => {
        e.preventDefault();
        const dato = e.dataTransfer.getData(ARRASTRE);
        if (!dato) return;
        if (dato.startsWith("casilla:")) {
            const j = Number(dato.slice(8));
            setB((x) => { const c = [...x.canales]; [c[i], c[j]] = [c[j], c[i]]; return { ...x, canales: c }; });
        } else poner(i, dato);
        setSel(i);
    };

    const grupos = useMemo(() => {
        const q = buscar.trim().toLowerCase();
        const m = new Map<string, Canal[]>();
        for (const c of canales) {
            if (q && !`${c.nombre} ${ubicacion(c)}`.toLowerCase().includes(q)) continue;
            m.set(grupoDe(c), [...(m.get(grupoDe(c)) || []), c]);
        }
        return [...m.entries()];
    }, [canales, buscar]);

    const guardar = async () => {
        setGuardando(true); setError(null);
        try {
            const r = await guardarVistaCamaras(b);
            if (r.ok) alSalir(r.vista); else setError(r.error);
        } catch (e: any) { setError(e?.message || "No se pudo guardar"); } finally { setGuardando(false); }
    };
    const confirmarBorrar = async () => {
        setGuardando(true);
        try { await borrarVistaCamaras(b.id); alSalir("borrada"); } catch (e: any) { setError(e?.message || "No se pudo borrar"); setGuardando(false); }
    };

    return (
        <div className="absolute inset-0 flex gap-3 p-3">
            {/* La disposición, con lo elegido en cada casilla. */}
            <div className="flex-1 min-w-0 grid gap-2" style={{ gridTemplateColumns: `repeat(${d.cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${d.filas}, minmax(0, 1fr))` }}>
                {d.casillas.map((cas, i) => {
                    const c = b.canales[i] ? porClave.get(b.canales[i]!) : null;
                    const f = c ? fotoDe(c, 480) : null;
                    return (
                        <div key={i} style={estiloCasilla(cas)} role="button" tabIndex={0} onClick={() => setSel(i)}
                            onDragOver={(e) => e.preventDefault()} onDrop={(e) => soltar(i, e)}
                            draggable={!!c} onDragStart={(e) => e.dataTransfer.setData(ARRASTRE, `casilla:${i}`)}
                            className={cn("relative min-h-0 rounded-[10px] overflow-hidden bg-neutral-950 cursor-pointer outline-none",
                                sel === i ? "ring-[3px] ring-[var(--accion-en-oscuro)]" : "ring-1 ring-white/10 hover:ring-white/30")}>
                            {c && f && <Foto src={f} ms={FOTO_EDITOR_MS} className="absolute inset-0 w-full h-full object-cover opacity-80" />}
                            {c ? (
                                <>
                                    <div className="absolute top-0 inset-x-0 px-3 pt-2 pb-6 bg-gradient-to-b from-black/80 to-transparent">
                                        <div className="text-[14px] font-bold text-white truncate">{c.nombre}</div>
                                        <div className="text-[12px] text-white/65 truncate">{ubicacion(c)}</div>
                                    </div>
                                    <button type="button" aria-label="Vaciar esta casilla" onClick={(e) => { e.stopPropagation(); poner(i, null); }}
                                        className="absolute top-2 right-2 grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white/85 hover:text-white"><X size={15} /></button>
                                </>
                            ) : b.canales[i] ? (
                                <span className="absolute inset-0 grid place-items-center text-[13px] text-white/45 text-center px-3">Este canal ya no está en la lista</span>
                            ) : (
                                <span className="absolute inset-0 grid place-items-center text-white/35">
                                    <span className="flex flex-col items-center gap-1 text-[13px]"><Plus size={20} />{sel === i ? "Elegí un canal de la lista" : "Vacía"}</span>
                                </span>
                            )}
                            <span className="absolute bottom-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white/70 tabular-nums">{i + 1}</span>
                        </div>
                    );
                })}
            </div>

            {/* El panel: nombre, disposición y la lista de canales. */}
            <aside className="w-[340px] shrink-0 flex flex-col gap-3 min-h-0 rounded-[14px] border border-border bg-card p-3">
                <div>
                    <label className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground" htmlFor="nombre-vista">Nombre de la vista</label>
                    <input id="nombre-vista" value={b.nombre} maxLength={NOMBRE_VISTA_MAX} onChange={(e) => setB((x) => ({ ...x, nombre: e.target.value }))} placeholder="Ej.: Perímetro norte"
                        className="mt-1 w-full h-10 rounded-[6px] border border-input bg-background px-3 text-[14px] outline-none focus:ring-2 focus:ring-[var(--accion)]" />
                </div>
                <div>
                    <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-1">Disposición</div>
                    <div className="grid grid-cols-5 gap-1">
                        {DISPOSICIONES.map((x) => (
                            <button key={x.clave} type="button" onClick={() => cambiarDisposicion(x.clave)} title={`${x.nombre} · ${x.casillas.length} casillas`} aria-pressed={b.disposicion === x.clave}
                                className={cn("h-10 rounded-[6px] grid place-items-center transition-colors",
                                    b.disposicion === x.clave ? "bg-[color-mix(in_oklab,var(--accion-en-oscuro)_22%,transparent)] text-[var(--accion-en-oscuro)]" : "text-muted-foreground hover:bg-muted")}>
                                <Glifo d={x} tam={24} />
                            </button>
                        ))}
                    </div>
                </div>
                <div className="relative">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar canal" aria-label="Buscar canal"
                        className="w-full h-10 rounded-[6px] border border-input bg-background pl-9 pr-3 text-[14px] outline-none focus:ring-2 focus:ring-[var(--accion)]" />
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain -mx-1 px-1">
                    {grupos.map(([g, lista]) => (
                        <div key={g} className="mb-2">
                            <div className="sticky top-0 bg-card py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground inline-flex items-center gap-1"><Server size={10} /> {g}</div>
                            {lista.map((c) => {
                                const en = b.canales.indexOf(c.clave);
                                return (
                                    <button key={c.clave} type="button" draggable onDragStart={(e) => e.dataTransfer.setData(ARRASTRE, c.clave)} onClick={() => elegir(c.clave)}
                                        className={cn("w-full flex items-center gap-2 rounded-[6px] px-2 py-1.5 text-left hover:bg-muted", usados.has(c.clave) && "opacity-60")}>
                                        <GripVertical size={14} className="text-muted-foreground/60 shrink-0" />
                                        <span className="min-w-0 flex-1">
                                            <span className="block text-[13px] font-semibold truncate">{c.nombre}</span>
                                            <span className="block text-[11.5px] text-muted-foreground truncate">{ubicacion(c)}{c.online === false ? " · sin señal" : ""}</span>
                                        </span>
                                        {c.funcion === "intrusion" && <ShieldAlert size={14} className="text-muted-foreground shrink-0" aria-label="Intrusión" />}
                                        {c.funcion === "lpr" && <Car size={14} className="text-muted-foreground shrink-0" aria-label="Lee matrículas" />}
                                        {en >= 0 && <span className="rounded-full bg-muted px-1.5 text-[11px] font-semibold tabular-nums">{en + 1}</span>}
                                    </button>
                                );
                            })}
                        </div>
                    ))}
                    {!grupos.length && <p className="text-[13px] text-muted-foreground p-2">Ningún canal con ese nombre.</p>}
                </div>
                {error && <p className="text-[13px] tono-mal">{error}</p>}
                <div className="flex items-center gap-2">
                    {b.id && (borrar
                        ? <Button variant="outline" size="sm" onClick={confirmarBorrar} disabled={guardando} className="tono-mal">¿Borrar? Sí</Button>
                        : <Button variant="ghost" size="sm" onClick={() => setBorrar(true)} disabled={guardando} aria-label="Borrar la vista"><Trash2 /></Button>)}
                    <Button variant="ghost" size="sm" className="ml-auto" onClick={() => alSalir(null)} disabled={guardando}>Cancelar</Button>
                    <Button size="sm" onClick={guardar} disabled={guardando || !b.nombre.trim()}>{guardando ? <Loader2 className="animate-spin" /> : <Save />} Guardar</Button>
                </div>
            </aside>
        </div>
    );
}
