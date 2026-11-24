"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, ImagePlus, Loader2, RefreshCw, ScanFace, Trash2 } from "lucide-react";
import { sileo as toast } from "sileo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Los rostros que tiene cargados el equipo: verlos, pasarlos a otro portero, cargar uno nuevo y
 * borrar los elegidos (18/11, pedido de Nico).
 *
 * Las fotos salen del equipo y se sirven por nuestra ruta: la cara de un vecino no viaja a una
 * URL con credencial ni sale del servidor. Y lo que un equipo NO puede dar se dice: el terminal
 * facial entrega la plantilla pero no la foto, y el portero al revés (ver lib/rostros-equipo).
 */

type Fila = { fpid: string; nombre: string | null; foto: boolean; plantilla: boolean };
type Lista = { total: number; daFoto: boolean; daPlantilla: boolean; rostros: Fila[] };

export function RostrosDelEquipo({ id, otros, amplio = false }: {
    id: string;
    /** Los otros equipos de acceso a los que se puede copiar. */
    otros: { id: string; nombre: string }[];
    /**
     * A todo el ancho, en la base de los lectores del Monitor Face (24/11, Nico: «se deben ver los
     * rostros»): caras grandes y todas a la vista. En el cajón del portero queda la grilla chica
     * con su propio scroll, porque ahí comparte lugar con la ficha del equipo.
     */
    amplio?: boolean;
}) {
    const [lista, setLista] = useState<Lista | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [cargando, setCargando] = useState(false);
    const [elegidos, setElegidos] = useState<Set<string>>(new Set());
    const [trabajando, setTrabajando] = useState<string | null>(null);
    const [destino, setDestino] = useState("");
    const archivo = useRef<HTMLInputElement>(null);

    const traer = useCallback(async () => {
        setCargando(true);
        try {
            const r = await fetch(`/api/devices/rostros-equipo?deviceId=${encodeURIComponent(id)}`);
            const j = await r.json();
            if (!r.ok) { setError(j.error || "No se pudieron leer"); setLista(null); }
            else { setLista(j); setError(null); setElegidos(new Set()); }
        } catch { setError("No se pudieron leer los rostros del equipo"); }
        finally { setCargando(false); }
    }, [id]);
    useEffect(() => { traer(); }, [traer]);

    const alternar = (f: string) => setElegidos((p) => { const n = new Set(p); if (n.has(f)) n.delete(f); else n.add(f); return n; });

    const accion = async (cuerpo: Record<string, unknown>, etiqueta: string) => {
        setTrabajando(etiqueta);
        try {
            const r = await fetch("/api/devices/rostros-equipo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ deviceId: id, ...cuerpo }) });
            const j = await r.json();
            if (!r.ok || j.error) { toast.error({ title: "No se pudo", description: j.error }); return; }
            const fallados = (j.hechos || []).filter((x: { ok: boolean }) => !x.ok);
            if (fallados.length) toast.error({ title: `${fallados.length} no se pudieron`, description: fallados.map((x: { fpid: string; error?: string }) => `${x.fpid}: ${x.error}`).join(" · ").slice(0, 160) });
            else toast.success({ title: "Hecho" });
            await traer();
        } catch (e) { toast.error({ title: "No se pudo", description: e instanceof Error ? e.message : undefined }); }
        finally { setTrabajando(null); }
    };

    const subir = async (f: File) => {
        const fpid = window.prompt("¿Con qué legajo se carga esta cara en el equipo? (es el número de la persona en el equipo)")?.trim();
        if (!fpid) return;
        const nombre = window.prompt("Nombre (opcional)")?.trim() || null;
        const b64 = Buffer.from(await f.arrayBuffer()).toString("base64");
        await accion({ accion: "alta", fpid, nombre, jpegB64: b64 }, "alta");
    };

    if (error) return <p className="text-[12.5px] tono-mal">{error}</p>;
    if (!lista) return <p className="text-[12.5px] text-muted-foreground inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Preguntándole al equipo qué rostros tiene…</p>;

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2 text-[12.5px]">
                <span><b className="tabular-nums">{lista.total}</b> {lista.total === 1 ? "rostro cargado" : "rostros cargados"}</span>
                {elegidos.size > 0 && <span className="text-muted-foreground">· {elegidos.size} elegido{elegidos.size === 1 ? "" : "s"}</span>}
                <button type="button" onClick={traer} disabled={cargando}
                    className="ml-auto inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--accion)] hover:underline disabled:opacity-50">
                    {cargando ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Volver a leer
                </button>
            </div>

            {lista.rostros.length === 0 ? (
                <p className="text-[12.5px] text-muted-foreground">Este equipo no tiene ninguna cara cargada.</p>
            ) : (
                <div className={amplio
                    ? "grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(132px,1fr))]"
                    : "grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(84px,1fr))] max-h-[280px] overflow-y-auto pr-1"}>
                    {lista.rostros.map((r) => {
                        const sel = elegidos.has(r.fpid);
                        if (amplio) return (
                            <button key={r.fpid} type="button" onClick={() => alternar(r.fpid)} aria-pressed={sel}
                                className={cn("group relative aspect-[4/5] overflow-hidden rounded-[14px] border text-left transition-colors",
                                    sel ? "border-[var(--accion)] ring-2 ring-[var(--accion)]/30" : "border-border hover:border-foreground/25", r.foto ? "bg-black" : "bg-card")}>
                                {r.foto
                                    /* eslint-disable-next-line @next/next/no-img-element */
                                    ? <img src={`/api/devices/rostros-equipo/foto?deviceId=${encodeURIComponent(id)}&fpid=${encodeURIComponent(r.fpid)}`} alt="" loading="lazy"
                                        className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
                                    : <span className="absolute inset-0 grid place-items-center text-muted-foreground/60"><ScanFace size={26} /></span>}
                                {r.foto && <span className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/80 to-transparent" />}
                                {sel && <span className="absolute right-2 top-2 h-5 w-5 rounded-full bg-[var(--accion)] ring-2 ring-white grid place-items-center text-white text-[11px] font-bold">✓</span>}
                                <span className={cn("absolute inset-x-0 bottom-0 p-2.5", r.foto ? "text-white" : "text-foreground")}>
                                    <span className="block truncate text-[12.5px] font-bold">{r.nombre || r.fpid}</span>
                                    <span className={cn("block truncate text-[10.5px] tabular-nums", r.foto ? "text-white/70" : "text-muted-foreground")}>{r.nombre ? r.fpid : r.foto ? "sin nombre en el equipo" : r.plantilla ? "con plantilla, sin foto" : "sin foto"}</span>
                                </span>
                            </button>
                        );
                        return (
                            <button key={r.fpid} type="button" onClick={() => alternar(r.fpid)}
                                className={cn("text-left rounded-[8px] border p-1 transition-colors", sel ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_8%,transparent)]" : "border-border hover:bg-accent/50")}>
                                {r.foto
                                    /* eslint-disable-next-line @next/next/no-img-element */
                                    ? <img src={`/api/devices/rostros-equipo/foto?deviceId=${encodeURIComponent(id)}&fpid=${encodeURIComponent(r.fpid)}`} alt=""
                                        className="aspect-[5/6] w-full rounded-[5px] object-cover bg-muted" loading="lazy" />
                                    : <span className="aspect-[5/6] w-full rounded-[5px] grid place-items-center bg-muted text-muted-foreground"><ScanFace size={18} /></span>}
                                <span className="block mt-1 text-[11.5px] font-bold truncate">{r.nombre || r.fpid}</span>
                                <span className="block text-[10.5px] text-muted-foreground truncate tabular-nums">{r.nombre ? r.fpid : r.plantilla ? "con plantilla" : "sin foto"}</span>
                            </button>
                        );
                    })}
                </div>
            )}

            <div className="flex items-center gap-2 flex-wrap">
                <input ref={archivo} type="file" accept="image/jpeg,image/png" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) subir(f); e.target.value = ""; }} />
                <Button variant="outline" size="sm" className="gap-1.5" disabled={!!trabajando} onClick={() => archivo.current?.click()}>
                    {trabajando === "alta" ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />} Cargar un rostro
                </Button>
                {otros.length > 0 && (
                    <>
                        <select value={destino} onChange={(e) => setDestino(e.target.value)}
                            className="h-8 px-2 rounded-md border border-border bg-card text-[12.5px]">
                            <option value="">Copiar a…</option>
                            {otros.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
                        </select>
                        <Button variant="outline" size="sm" className="gap-1.5" disabled={!destino || !elegidos.size || !!trabajando}
                            onClick={() => accion({ accion: "copiar", destinoId: destino, fpids: [...elegidos] }, "copiar")}>
                            {trabajando === "copiar" ? <Loader2 size={14} className="animate-spin" /> : <Copy size={14} />} Copiar {elegidos.size || ""}
                        </Button>
                    </>
                )}
                <Button variant="outline" size="sm" className="gap-1.5 ml-auto tono-mal" disabled={!elegidos.size || !!trabajando}
                    onClick={() => { if (window.confirm(`Borrar ${elegidos.size} ${elegidos.size === 1 ? "rostro" : "rostros"} del equipo. Esa persona deja de poder abrir con la cara. No se puede deshacer desde acá.`)) accion({ accion: "borrar", fpids: [...elegidos] }, "borrar"); }}>
                    {trabajando === "borrar" ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Borrar {elegidos.size || ""}
                </Button>
            </div>

            <p className="text-[11.5px] text-muted-foreground leading-snug">
                {lista.daFoto
                    ? "De este equipo se puede bajar la foto de cada cara, así que se pueden copiar a otro portero tal cual."
                    : lista.daPlantilla
                        ? "Este equipo no entrega las fotos, pero sí la plantilla facial: se pueden copiar a otro equipo Hikvision, aunque no verlas acá."
                        : "Este equipo no entrega ni las fotos ni las plantillas: se pueden listar y borrar, no copiar."}
                {" "}Cargar y borrar escriben en el equipo y quedan en Auditoría.
            </p>
        </div>
    );
}
