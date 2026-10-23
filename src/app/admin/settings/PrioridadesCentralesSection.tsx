"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Database, HardDrive, Loader2, Plus, RotateCcw, Save, Siren, Trash2 } from "lucide-react";
import { toast } from "@/lib/avisos";
import { Button } from "@/components/ui/button";
import { ChipPrioridad } from "@/components/alarmas/MensajesCentrales";
import { CLASES, NIVELES, PRIORIDADES_DEFECTO, type ClaseEvento, type Prioridades } from "@/lib/centrales/prioridades";
import { CLASES_CON_PROCEDIMIENTO, PASOS_MAX, type Cierre, type Escalado, type Paso, type Procedimiento, type ProcedimientosClase } from "@/lib/centrales/tratamiento-tipos";
import { cn } from "@/lib/utils";
import { useFuncion } from "@/lib/funciones-cliente";

/**
 * Ajustes › Centrales de alarma (22/10, Nico: «clasificar los eventos en grado de importancia,
 * editables del lado del administrador: robo y pánico 1, sabotaje 2, fallos del sistema 4»).
 *
 * Una fila por clase de evento, no por código: «Robo» cubre el robo perimetral, interior, de 24 h…
 * La prioridad se ve en Gestión de alarmas (pestaña Centrales y las alarmas de central). Cambiarla
 * no toca lo ya recibido: se recalcula al mostrar, así que vale también para lo de antes.
 */
/**
 * Ajustes › Centrales de alarma: cuatro partes, cada una con su guardar (22/10): las prioridades, cómo
 * se cierra un evento (el catálogo que se elige al TRATAR), el procedimiento de cada prioridad y cuándo
 * salta la ventana y cuándo se escala.
 */
export default function CentralesSection() {
    const [parte, setParte] = useState<"prioridades" | "cierres" | "procedimiento" | "escalado" | "fotos">("prioridades");
    // Sin la Recepción de alarmas estos ajustes no existen (sus rutas contestan 404): se dice dónde prenderla.
    const recepcion = useFuncion("FUNC_ALARMAS_RECEPCION");
    if (recepcion === false) {
        return (
            <div className="rounded-[10px] border border-border bg-card px-5 py-6 flex items-start gap-3 max-w-2xl">
                <Siren size={20} className="mt-0.5 text-muted-foreground shrink-0" />
                <div>
                    <div className="text-[14px] font-semibold">La Recepción de alarmas está apagada</div>
                    <p className="mt-1 text-[12.5px] text-muted-foreground leading-relaxed">Las prioridades, los cierres, los procedimientos y el escalado son de las alarmas de las centrales. Se prende en Ajustes → Modos → Funciones de la instalación.</p>
                </div>
            </div>
        );
    }
    return (
        <div className="space-y-5">
            <div className="flex items-center rounded-full border border-border p-0.5 w-fit" role="tablist">
                {([["prioridades", "Prioridades"], ["cierres", "Cierres"], ["procedimiento", "Procedimiento"], ["escalado", "Ventana y escalado"], ["fotos", "Fotos y retención"]] as const).map(([k, l]) => (
                    <button key={k} type="button" role="tab" aria-selected={parte === k} onClick={() => setParte(k)}
                        className={cn("h-8 px-4 rounded-full text-[12.5px] font-semibold", parte === k ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>{l}</button>
                ))}
            </div>
            {parte === "prioridades" ? <PrioridadesCentralesSection /> : parte === "fotos" ? <FotosAlarmas /> : <AjustesTratamiento parte={parte} />}
        </div>
    );
}

function PrioridadesCentralesSection() {
    const [guardadas, setGuardadas] = useState<Prioridades | null>(null);
    const [p, setP] = useState<Prioridades>(PRIORIDADES_DEFECTO);
    const [error, setError] = useState<string | null>(null);
    const [guardando, setGuardando] = useState(false);

    const cargar = () => fetch("/api/centrales/prioridades", { cache: "no-store" })
        .then(async (r) => { const j = await r.json().catch(() => null); if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`); return j.prioridades as Prioridades; })
        .then((x) => { setGuardadas(x); setP(x); setError(null); })
        .catch((e) => setError(e?.message || "No se pudieron leer las prioridades."));
    useEffect(() => { cargar(); }, []);

    const cambiadas = useMemo(() => !!guardadas && CLASES.some((c) => guardadas[c.clase] !== p[c.clase]), [guardadas, p]);
    const deFabrica = CLASES.every((c) => p[c.clase] === c.defecto);

    const guardar = async (restaurar = false) => {
        setGuardando(true);
        try {
            const r = await fetch("/api/centrales/prioridades", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(restaurar ? { restaurar: true } : { prioridades: p }) });
            const j = await r.json().catch(() => null);
            if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);
            setGuardadas(j.prioridades); setP(j.prioridades);
            toast.success(restaurar ? "Prioridades de fábrica restauradas" : "Prioridades guardadas");
        } catch (e: any) { toast.error(e?.message || "No se pudieron guardar."); }
        finally { setGuardando(false); }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-start gap-3">
                <span className="grid place-items-center w-10 h-10 rounded-[10px] bg-muted/60 shrink-0"><Siren size={18} className="text-muted-foreground" /></span>
                <div className="min-w-0">
                    <h2 className="text-lg font-bold tracking-tight">Prioridad de los eventos de las centrales</h2>
                    <p className="text-[12.5px] text-muted-foreground mt-0.5 max-w-prose">
                        Qué tan urgente es cada clase de evento que mandan las centrales de alarma, de 1 (crítica) a 5 (informativa).
                        Se ve en Gestión de alarmas, en la pestaña Centrales y en cada alarma de central. Vale también para lo ya recibido. Sólo un administrador puede cambiarlas.
                    </p>
                </div>
            </div>

            {error ? (
                <div className="rounded-[10px] chip-mal px-3 py-2.5 text-[12.5px] flex items-center gap-3"><span className="flex-1">{error}</span><Button size="sm" variant="outline" onClick={cargar}>Reintentar</Button></div>
            ) : !guardadas ? (
                <div className="py-10 grid place-items-center"><Loader2 size={18} className="animate-spin text-muted-foreground" /></div>
            ) : (
                <>
                    {/* En dos columnas en pantallas anchas: una sola dejaba media pantalla vacía (23/10, Nico). */}
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
                        {CLASES.map((c) => (
                            <div key={c.clase} className="flex items-center gap-4 px-4 py-3 rounded-[10px] border border-border bg-card">
                                <div className="min-w-0 flex-1">
                                    <div className="text-[13.5px] font-semibold flex items-center gap-2">{c.nombre}{p[c.clase] !== c.defecto && <span className="text-[11px] font-normal text-muted-foreground">de fábrica: P{c.defecto}</span>}</div>
                                    <div className="text-[12px] text-muted-foreground truncate">{c.ejemplos}</div>
                                </div>
                                {/* Píldoras: es una elección entre cinco, no una acción. */}
                                <div className="flex items-center rounded-full border border-border p-0.5 shrink-0" role="radiogroup" aria-label={`Prioridad de ${c.nombre}`}>
                                    {NIVELES.map((n) => (
                                        <button key={n.n} type="button" role="radio" aria-checked={p[c.clase] === n.n} title={`P${n.n} · ${n.nombre}`}
                                            onClick={() => setP((x) => ({ ...x, [c.clase as ClaseEvento]: n.n }))}
                                            className={cn("h-7 w-9 rounded-full text-[12px] font-semibold tabular-nums transition-colors",
                                                p[c.clase] === n.n ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>
                                            {n.n}
                                        </button>
                                    ))}
                                </div>
                                <span className="w-[112px] shrink-0 flex justify-end"><ChipPrioridad n={p[c.clase]} /></span>
                            </div>
                        ))}
                    </div>
                    <div className="flex items-center gap-2 justify-end">
                        <Button variant="outline" onClick={() => guardar(true)} disabled={guardando || deFabrica} className="gap-1.5"><RotateCcw size={14} /> Volver a las de fábrica</Button>
                        <Button onClick={() => guardar(false)} disabled={guardando || !cambiadas} className="gap-1.5">{guardando ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Guardar</Button>
                    </div>
                </>
            )}
        </div>
    );
}

/* ── Cierres, procedimiento y escalado (lib/centrales/tratamiento-tipos) ── */

type Ajustes = { cierres: Cierre[]; procedimiento: Procedimiento; procedimientosClase: ProcedimientosClase; escalado: Escalado };

/**
 * Los pasos de un procedimiento, uno por fila: el texto, si es obligatorio, y subir, bajar o quitar
 * (openspec alarmas-como-funciones). Era un textarea con un paso por renglón: no había dónde decir que
 * un paso es obligatorio, y ordenar era cortar y pegar.
 */
function EditorPasos({ pasos, alCambiar }: { pasos: Paso[]; alCambiar: (p: Paso[]) => void }) {
    const entrada = "h-8 rounded-[8px] px-2.5 text-[12.5px] bg-background border border-border outline-none focus:ring-2 focus:ring-[var(--accion)]/40";
    const mover = (i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= pasos.length) return; const x = [...pasos]; [x[i], x[j]] = [x[j], x[i]]; alCambiar(x); };
    return (
        <div className="space-y-1.5">
            {pasos.length === 0 && <p className="text-[12px] text-muted-foreground">Sin pasos.</p>}
            {pasos.map((p, i) => (
                <div key={i} className="flex items-center gap-1.5">
                    <span className="w-5 text-right text-[11.5px] text-muted-foreground tabular-nums">{i + 1}.</span>
                    <input value={p.texto} onChange={(e) => alCambiar(pasos.map((x, j) => (j === i ? { ...x, texto: e.target.value.slice(0, 100) } : x)))} placeholder="Qué hacer" className={cn(entrada, "flex-1 min-w-0")} />
                    <label className={cn("flex items-center gap-1.5 h-8 px-2 rounded-[8px] border text-[11.5px] font-semibold cursor-pointer select-none", p.obligatorio ? "chip-aviso" : "border-border text-muted-foreground")} title="Para tratar el evento hay que tildarlo o saltearlo escribiendo por qué">
                        <input type="checkbox" checked={p.obligatorio} onChange={(e) => alCambiar(pasos.map((x, j) => (j === i ? { ...x, obligatorio: e.target.checked } : x)))} className="accent-[var(--aviso)]" /> Obligatorio
                    </label>
                    <button type="button" onClick={() => mover(i, -1)} disabled={i === 0} aria-label="Subir" className="h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:bg-accent disabled:opacity-30"><ArrowUp size={14} /></button>
                    <button type="button" onClick={() => mover(i, 1)} disabled={i === pasos.length - 1} aria-label="Bajar" className="h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:bg-accent disabled:opacity-30"><ArrowDown size={14} /></button>
                    <button type="button" onClick={() => alCambiar(pasos.filter((_, j) => j !== i))} aria-label="Quitar el paso" className="h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-[var(--mal-texto)] hover:bg-accent"><Trash2 size={14} /></button>
                </div>
            ))}
            {pasos.length < PASOS_MAX && <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => alCambiar([...pasos, { texto: "", obligatorio: false }])}><Plus size={14} /> Agregar paso</Button>}
        </div>
    );
}

function AjustesTratamiento({ parte }: { parte: "cierres" | "procedimiento" | "escalado" }) {
    const [guardado, setGuardado] = useState<Ajustes | null>(null);
    const [a, setA] = useState<Ajustes | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [guardando, setGuardando] = useState(false);
    const cargar = () => fetch("/api/centrales/ajustes", { cache: "no-store" })
        .then(async (r) => { const j = await r.json().catch(() => null); if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`); return j as Ajustes; })
        .then((x) => { setGuardado(x); setA(x); setError(null); }).catch((e) => setError(e?.message || "No se pudo leer."));
    useEffect(() => { cargar(); }, []);
    // El procedimiento son dos ajustes que se editan juntos: el de cada clase y el de cada prioridad.
    const delaParte = (x: Ajustes) => (parte === "procedimiento" ? { procedimiento: x.procedimiento, procedimientosClase: x.procedimientosClase } : { [parte]: x[parte] });
    const cambiado = !!a && !!guardado && JSON.stringify(delaParte(a)) !== JSON.stringify(delaParte(guardado));
    const guardar = async (restaurar = false) => {
        if (!a) return;
        setGuardando(true);
        try {
            const r = await fetch("/api/centrales/ajustes", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(restaurar ? { restaurar: parte } : delaParte(a)) });
            const j = await r.json().catch(() => null);
            if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);
            setGuardado(j); setA(j); toast.success(restaurar ? "Restaurado lo de fábrica" : "Guardado");
        } catch (e: any) { toast.error(e?.message || "No se pudo guardar."); }
        finally { setGuardando(false); }
    };
    if (error) return <div className="rounded-[10px] chip-mal px-3 py-2.5 text-[12.5px] flex items-center gap-3"><span className="flex-1">{error}</span><Button size="sm" variant="outline" onClick={cargar}>Reintentar</Button></div>;
    if (!a) return <div className="py-10 grid place-items-center"><Loader2 size={18} className="animate-spin text-muted-foreground" /></div>;
    const entrada = "h-9 rounded-[8px] px-3 text-[12.5px] bg-background border border-border outline-none focus:ring-2 focus:ring-[var(--accion)]/40";
    return (
        <div className="space-y-4">
            {parte === "cierres" && (<>
                <p className="text-[12.5px] text-muted-foreground max-w-prose">Lo que se elige al <b>tratar</b> un evento de central, además del texto obligatorio. El resultado (falsa, real u otro) es el que cuenta en los informes. Uno desactivado deja de ofrecerse pero no se borra de lo ya tratado.</p>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
                    {a.cierres.map((c, i) => (
                        <div key={c.id} className="flex items-center gap-2 px-3 py-2 rounded-[10px] border border-border bg-card">
                            <input value={c.texto} onChange={(e) => setA({ ...a, cierres: a.cierres.map((x, j) => (j === i ? { ...x, texto: e.target.value } : x)) })} className={cn(entrada, "flex-1 min-w-0", !c.activo && "opacity-50")} maxLength={120} />
                            <select value={c.resultado} onChange={(e) => setA({ ...a, cierres: a.cierres.map((x, j) => (j === i ? { ...x, resultado: e.target.value as Cierre["resultado"] } : x)) })} className={cn(entrada, "w-[110px]")}>
                                <option value="falsa">Falsa</option><option value="real">Real</option><option value="otro">Otro</option>
                            </select>
                            <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground w-[86px]"><input type="checkbox" checked={c.activo} onChange={(e) => setA({ ...a, cierres: a.cierres.map((x, j) => (j === i ? { ...x, activo: e.target.checked } : x)) })} /> Activo</label>
                        </div>
                    ))}
                </div>
                <Button variant="outline" size="sm" onClick={() => setA({ ...a, cierres: [...a.cierres, { id: `nuevo-${Date.now().toString(36)}`, texto: "", resultado: "otro", activo: true }] })}>Agregar cierre</Button>
            </>)}
            {parte === "procedimiento" && (<>
                <p className="text-[12.5px] text-muted-foreground max-w-prose">Los pasos que el operador tilda en la ficha del evento. Cada <b>clase</b> de evento puede tener el suyo (un incendio no se atiende como un robo); la que no tiene usa el de su <b>prioridad</b>. Un paso <b>obligatorio</b> hay que hacerlo, o saltearlo escribiendo por qué, para poder tratar el evento. Cada tilde y cada salteo quedan con nombre y hora. Un evento conserva el procedimiento con que llegó.</p>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-6 gap-y-3 items-start">
                <div className="space-y-3">
                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground pt-1">Por clase de evento</div>
                {CLASES.filter((c) => (CLASES_CON_PROCEDIMIENTO as readonly string[]).includes(c.clase)).map((c) => {
                    const propio = (a.procedimientosClase as Record<string, Paso[] | null | undefined>)[c.clase];
                    const tiene = Array.isArray(propio);
                    const fijar = (v: Paso[] | null) => setA({ ...a, procedimientosClase: { ...a.procedimientosClase, [c.clase]: v } });
                    return (
                        <div key={c.clase} className="rounded-[10px] border border-border p-3 space-y-2">
                            <div className="flex items-center gap-2">
                                <span className="text-[13px] font-semibold">{c.nombre}</span>
                                <span className="text-[11.5px] text-muted-foreground truncate">{c.ejemplos}</span>
                                <span className="ml-auto flex items-center rounded-full border border-border p-0.5 shrink-0">
                                    <button type="button" onClick={() => fijar(null)} className={cn("h-7 px-2.5 rounded-full text-[11.5px] font-semibold", !tiene ? "bg-foreground text-background" : "text-muted-foreground")}>Usa el de su prioridad</button>
                                    <button type="button" onClick={() => fijar(tiene ? propio! : [])} className={cn("h-7 px-2.5 rounded-full text-[11.5px] font-semibold", tiene ? "bg-foreground text-background" : "text-muted-foreground")}>Propio</button>
                                </span>
                            </div>
                            {tiene && <EditorPasos pasos={propio!} alCambiar={(p) => fijar(p)} />}
                        </div>
                    );
                })}
                </div>
                <div className="space-y-3">
                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground pt-1">Por prioridad (para las clases sin procedimiento propio)</div>
                {(["1", "2", "3", "4", "5"] as const).map((n) => (
                    <div key={n} className="rounded-[10px] border border-border p-3 space-y-2">
                        <div className="flex items-center gap-2"><ChipPrioridad n={Number(n)} /></div>
                        <EditorPasos pasos={a.procedimiento[n]} alCambiar={(p) => setA({ ...a, procedimiento: { ...a.procedimiento, [n]: p } })} />
                    </div>
                ))}
                </div>
                </div>
            </>)}
            {parte === "escalado" && (
                <div className="rounded-[10px] border border-border divide-y divide-border bg-card">
                    {([
                        ["ventanaHasta", "Abre la ventana con sonido hasta", "prioridad", "En todas las pantallas del panel, hasta que alguien lo trate. 0 = nunca."],
                        ["avisoHasta", "Aparece en los avisos de abajo hasta", "prioridad", "Sin abrir ventana. No puede ser menos que la de la ventana."],
                        ["escalarHasta", "Se escala hasta", "prioridad", "0 = no se escala nunca."],
                        ["tomarMin", "Se escala si nadie lo toma en", "min", "Desde que llegó el evento."],
                        ["tratarMin", "Se escala si quien lo tomó no lo trata en", "min", "Desde que lo tomó."],
                    ] as const).map(([k, rotulo, unidad, ayuda]) => (
                        <div key={k} className="flex items-center gap-4 px-4 py-3">
                            <div className="min-w-0 flex-1"><div className="text-[13px] font-semibold">{rotulo}</div><div className="text-[12px] text-muted-foreground">{ayuda}</div></div>
                            {unidad === "prioridad" ? (
                                <select value={a.escalado[k]} onChange={(e) => setA({ ...a, escalado: { ...a.escalado, [k]: Number(e.target.value) } })} className={cn(entrada, "w-[120px]")}>
                                    {[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n ? `P${n}` : "Nunca"}</option>)}
                                </select>
                            ) : (
                                <span className="flex items-center gap-1.5"><input type="number" min={0} max={240} value={a.escalado[k]} onChange={(e) => setA({ ...a, escalado: { ...a.escalado, [k]: Number(e.target.value) } })} className={cn(entrada, "w-[80px] tabular-nums")} /><span className="text-[12px] text-muted-foreground">min</span></span>
                            )}
                        </div>
                    ))}
                    <p className="px-4 py-3 text-[12px] text-muted-foreground">Escalar vuelve a abrir la ventana en todas las pantallas y dispara el evento <b>«Alarma de central sin atender»</b> de las reglas de notificación: para que le llegue a un supervisor, armá una regla con ese evento (Notificaciones › Reglas).</p>
                </div>
            )}
            <div className="flex items-center gap-2 justify-end">
                <Button variant="outline" onClick={() => guardar(true)} disabled={guardando} className="gap-1.5"><RotateCcw size={14} /> Volver a lo de fábrica</Button>
                <Button onClick={() => guardar(false)} disabled={guardando || !cambiado} className="gap-1.5">{guardando ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Guardar</Button>
            </div>
        </div>
    );
}

// ── Fotos y retención ───────────────────────────────────────────────────────────────────────

type DatosFotos = {
    bucket: string; dias: number; topeGb: number; regla: number; existe: boolean; n: number; bytes: number; desde: string | null; truncado: boolean;
    limites: { diasMin: number; diasMax: number; topeMin: number; topeMax: number };
};
const tamano = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(0)} MB` : `${Math.round(b / 1e3)} KB`);

/**
 * Dónde quedan los cuadros que se guardan con cada alarma y cuánto se guardan (23/10, Nico: «su
 * bucket para separar las fotos de confirmaciones de robo; cuidar muy bien las retenciones para que
 * no se nos llene el disco»). Dos topes: los días (los aplica el almacenamiento solo) y el tamaño
 * (lo revisa el receptor cada 6 h: una central en bucle llena el disco antes de que venzan los días).
 */
function FotosAlarmas() {
    const [d, setD] = useState<DatosFotos | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [dias, setDias] = useState("");
    const [tope, setTope] = useState("");
    const [guardando, setGuardando] = useState(false);
    const cargar = () => fetch("/api/centrales/fotos", { cache: "no-store" }).then((r) => r.json()).then((j) => {
        if (!j?.ok) throw new Error(j?.error || "No se pudo leer");
        setD(j); setDias(String(j.dias)); setTope(String(j.topeGb)); setError(null);
    }).catch((e) => setError(e?.message || "No se pudo leer"));
    useEffect(() => { cargar(); }, []);
    const guardar = async () => {
        setGuardando(true);
        try {
            const r = await fetch("/api/centrales/fotos", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ dias: Number(dias), topeGb: Number(tope) }) });
            const j = await r.json().catch(() => null);
            if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);
            if (j.aviso) toast.error(j.aviso); else toast.success(`Las fotos se guardan ${j.dias} días, con un tope de ${j.topeGb} GB`);
            cargar();
        } catch (e: any) { toast.error(e?.message || "No se pudo guardar"); }
        finally { setGuardando(false); }
    };
    if (error && !d) return <div className="rounded-[10px] chip-mal border px-4 py-3 text-[13px] flex items-center gap-3">{error}<Button size="sm" variant="outline" onClick={cargar} className="ml-auto">Reintentar</Button></div>;
    if (!d) return <div className="py-10 grid place-items-center text-muted-foreground"><Loader2 size={20} className="animate-spin" /></div>;
    const uso = d.topeGb ? Math.min(1, d.bytes / (d.topeGb * 1e9)) : 0;
    const cambiado = String(d.dias) !== dias || String(d.topeGb) !== tope;
    const reglaDistinta = d.existe && d.regla !== d.dias;
    return (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
            <section className="rounded-[10px] border border-border bg-card p-5">
                <div className="flex items-center gap-2 text-[14px] font-semibold"><Database size={16} className="text-muted-foreground" /> Dónde quedan</div>
                <p className="mt-1 text-[12.5px] text-muted-foreground leading-relaxed">Los cuadros de las cámaras que se guardan con cada alarma de central van a un bucket propio, separado de las capturas de intrusión y de matrículas. Así cada cosa tiene su retención y se ve cuánto ocupa.</p>
                <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-[13px]">
                    <div><dt className="text-[11.5px] text-muted-foreground">Bucket</dt><dd className="font-semibold">{d.bucket}{!d.existe && <span className="ml-1.5 font-normal text-muted-foreground">(se crea con la primera foto)</span>}</dd></div>
                    <div><dt className="text-[11.5px] text-muted-foreground">Fotos</dt><dd className="font-semibold tabular-nums">{d.n.toLocaleString("es-UY")}{d.truncado ? "+" : ""}</dd></div>
                    <div><dt className="text-[11.5px] text-muted-foreground">Ocupa</dt><dd className="font-semibold tabular-nums">{tamano(d.bytes)} <span className="font-normal text-muted-foreground">de {d.topeGb} GB</span></dd></div>
                    <div><dt className="text-[11.5px] text-muted-foreground">La más vieja</dt><dd className="font-semibold tabular-nums">{d.desde ? new Date(d.desde).toLocaleDateString("es-UY", { day: "2-digit", month: "short", year: "numeric" }) : "—"}</dd></div>
                </dl>
                <div className="mt-4 h-2 rounded-full bg-muted overflow-hidden" title={`${Math.round(uso * 100)} % del tope`}>
                    <div className={cn("h-full rounded-full", uso > 0.9 ? "bg-[var(--mal)]" : uso > 0.7 ? "bg-[var(--aviso)]" : "bg-[var(--bien)]")} style={{ width: `${Math.max(uso * 100, d.bytes ? 1 : 0)}%` }} />
                </div>
                <div className="mt-3 flex items-center gap-2 text-[12.5px]">
                    <HardDrive size={14} className="text-muted-foreground" />
                    {!d.existe ? <span className="text-muted-foreground">Sin fotos todavía.</span>
                        : d.regla ? <span>El almacenamiento borra solo lo de más de <b>{d.regla} días</b>.</span>
                            : <span className="tono-aviso font-semibold">El bucket no tiene regla de días: crece hasta el tope de tamaño.</span>}
                </div>
                {reglaDistinta && d.regla > 0 && <p className="mt-1.5 text-[12px] tono-aviso">La regla del bucket ({d.regla} días) no coincide con lo guardado ({d.dias}): se corrige al guardar o en la próxima revisión del receptor.</p>}
            </section>
            <section className="rounded-[10px] border border-border bg-card p-5">
                <div className="text-[14px] font-semibold">Cuánto se guardan</div>
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <label className="block">
                        <span className="text-[12.5px] font-semibold">Días</span>
                        <input type="number" min={d.limites.diasMin} max={d.limites.diasMax} value={dias} onChange={(e) => setDias(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-[13px] tabular-nums" />
                        <span className="mt-1 block text-[11.5px] text-muted-foreground leading-snug">Lo más viejo se borra solo. Entre {d.limites.diasMin} y {d.limites.diasMax}. Un robo se reclama semanas después: lo que haga falta guardar más se exporta desde la ficha.</span>
                    </label>
                    <label className="block">
                        <span className="text-[12.5px] font-semibold">Tope de tamaño (GB)</span>
                        <input type="number" min={d.limites.topeMin} max={d.limites.topeMax} value={tope} onChange={(e) => setTope(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-[13px] tabular-nums" />
                        <span className="mt-1 block text-[11.5px] text-muted-foreground leading-snug">Si una central se dispara de más y se pasa, se borran las más viejas hasta quedar en el 90 %. Lo revisa el receptor cada 6 horas.</span>
                    </label>
                </div>
                <div className="mt-4 flex justify-end">
                    <Button onClick={guardar} disabled={!cambiado || guardando}>{guardando ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Guardar</Button>
                </div>
            </section>
        </div>
    );
}
